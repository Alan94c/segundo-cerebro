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

  const migrationPath = path.join(__dirname, 'migrations', '001_initial_schema.sql');
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ No se encontró el archivo de migración en: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('📡 Conectado a PostgreSQL Cloud...');
    await client.query('BEGIN');
    
    // Ejecutar el script SQL completo
    await client.query(sql);
    
    await client.query('COMMIT');
    console.log('✅ Base de datos inicializada correctamente. Tablas y triggers creados.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error ejecutando la migración:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
