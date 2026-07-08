'use strict';

require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: La variable DATABASE_URL no está definida en el .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }, // Requerido para Neon y conexiones seguras
});

async function runMigration() {
  console.log('⏳ Iniciando migración de base de datos...');

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.error(`❌ No se encontró la carpeta de migraciones en: ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('⚠️ No se encontraron archivos de migración (.sql).');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    console.log('📡 Conectado a PostgreSQL...');
    
    for (const file of files) {
      if (file === '001_initial_schema.sql') {
        const { rows } = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'memories'
          );
        `);
        if (rows[0].exists) {
          console.log('⚡ La tabla "memories" ya existe. Omitiendo 001_initial_schema.sql.');
          continue;
        }
      }
      
      console.log(`⏳ Ejecutando migración: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`✅ Migración ${file} completada con éxito.`);
    }
    
    console.log('✅ Todas las migraciones se han ejecutado correctamente.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // Ignorar si no hay transacción activa
    }
    console.error('❌ Error ejecutando la migración:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
