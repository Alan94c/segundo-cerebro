'use strict';

require('dotenv').config({ override: true });
const db = require('../config/db');
const { getEmbedding } = require('../modules/nlp/gemini.client');

async function runBackfill() {
  console.log('⏳ Iniciando proceso de backfill de embeddings para memories...');

  try {
    // 1. Obtener todos los registros de memorias que no tengan embedding
    const { rows: memories } = await db.query(
      'SELECT id, content FROM memories WHERE embedding IS NULL'
    );

    console.log(`📋 Se encontraron ${memories.length} memorias sin embedding.`);

    if (memories.length === 0) {
      console.log('✅ Todas las memorias ya cuentan con embeddings.');
      process.exit(0);
    }

    // 2. Procesar una por una
    let count = 0;
    for (const memory of memories) {
      console.log(`   [${count + 1}/${memories.length}] Generando embedding para ID ${memory.id}: "${memory.content.substring(0, 50)}..."`);
      
      try {
        const embedding = await getEmbedding(memory.content);
        
        // El driver pg traduce arrays de JS a formato PostgreSQL '{val1,val2,...}'
        // que no es compatible con el tipo vector. Lo formateamos a '[val1,val2,...]'
        await db.query(
          'UPDATE memories SET embedding = $1 WHERE id = $2',
          [`[${embedding.join(',')}]`, memory.id]
        );
        count++;
      } catch (err) {
        console.error(`❌ Error procesando memoria ID ${memory.id}:`, err.message);
      }
      
      // Breve pausa para evitar golpear cuotas de la API de Gemini
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`🎉 Proceso completado. Se actualizaron ${count} memorias con sus embeddings.`);
  } catch (err) {
    console.error('❌ Error crítico en el proceso de backfill:', err.message);
  } finally {
    // Cerrar el pool de conexiones de la base de datos
    await db.pool.end();
  }
}

runBackfill();
