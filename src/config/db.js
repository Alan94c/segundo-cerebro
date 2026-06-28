'use strict';

const { Pool } = require('pg');
const { DATABASE_URL } = require('./env');

/**
 * Pool de conexiones compartido para toda la aplicación.
 * pg.Pool gestiona automáticamente la reutilización y reconexión.
 */
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,              // Máximo de conexiones simultáneas
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('❌  Error inesperado en el pool de PostgreSQL:', err.message);
});

/**
 * Ejecuta una query con parámetros de forma segura.
 * @param {string} text  - SQL con placeholders ($1, $2, ...)
 * @param {Array}  params - Valores de los parámetros
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DB] ${duration}ms | ${text.substring(0, 80)}`);
  }
  return res;
}

/**
 * Obtiene un cliente individual del pool para transacciones manuales.
 * SIEMPRE hacer client.release() en el bloque finally.
 */
async function getClient() {
  return pool.connect();
}

/**
 * Verifica la conexión a la base de datos.
 * @throws Si no puede conectarse.
 */
async function testConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('✅  PostgreSQL conectado correctamente.');
  } finally {
    client.release();
  }
}

module.exports = { query, getClient, testConnection, pool };
