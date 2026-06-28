'use strict';

const db = require('../../config/db');

/**
 * Guarda un hecho o dato en la memoria a largo plazo del usuario.
 * El trigger de PostgreSQL actualiza el tsvector automáticamente.
 *
 * @param {string} userId   - UUID del usuario
 * @param {string} content  - Texto del hecho a guardar
 * @param {string[]} tags   - Etiquetas opcionales para filtrar
 * @returns {Promise<Object>} El registro creado
 */
async function saveFact(userId, content, tags = []) {
  const { rows } = await db.query(
    `INSERT INTO memories (user_id, content, tags)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, content, tags]
  );
  return rows[0];
}

/**
 * Busca hechos por similitud de texto usando full-text search en español.
 * Combina búsqueda exacta con similitud de trigramas (pg_trgm).
 *
 * @param {string} userId - UUID del usuario
 * @param {string} query  - Texto a buscar
 * @param {number} [limit=5] - Máximo de resultados
 * @returns {Promise<Object[]>} Memorias encontradas ordenadas por relevancia
 */
async function searchFacts(userId, query, limit = 5) {
  // Lista de stopwords comunes en español y palabras de relleno de preguntas
  const stopwords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'en', 'para', 'por', 'con', 'sin', 'sobre',
    'recuerdas', 'recuerda', 'busca', 'buscar', 'consulta', 'consultar', 'que', 'tiene', 'datos', 'informacion', 'ticket', 'recibo'
  ]);

  const words = query
    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9 ]/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.has(w));

  // Si no quedan palabras clave descriptivas, usamos todas las palabras sanitizadas por defecto
  const searchWords = words.length > 0
    ? words
    : query.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);

  if (searchWords.length === 0) return [];

  // Unir palabras descriptivas con '|' (OR) para permitir coincidencias parciales rankeadas por relevancia
  const sanitized = searchWords.join(' | ');

  // Para el ILIKE de respaldo, usamos la palabra clave más larga (más descriptiva)
  const mainKeyword = searchWords.sort((a, b) => b.length - a.length)[0];

  const { rows } = await db.query(
    `SELECT *,
             ts_rank(search_vec, to_tsquery('spanish', $2)) AS rank
      FROM memories
      WHERE user_id = $1
        AND (
          search_vec @@ to_tsquery('spanish', $2)
          OR content ILIKE $3
        )
      ORDER BY rank DESC, created_at DESC
      LIMIT $4`,
    [userId, sanitized, `%${mainKeyword}%`, limit]
  );

  return rows;
}

/**
 * Lista todas las memorias de un usuario con paginación.
 * @param {string} userId
 * @param {number} [page=1]
 * @param {number} [pageSize=20]
 */
async function listFacts(userId, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const { rows } = await db.query(
    `SELECT * FROM memories
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, pageSize, offset]
  );
  return rows;
}

/**
 * Elimina una memoria por ID (verificando que pertenezca al usuario).
 * @param {string} memoryId
 * @param {string} userId
 */
async function deleteFact(memoryId, userId) {
  const { rowCount } = await db.query(
    `DELETE FROM memories WHERE id = $1 AND user_id = $2`,
    [memoryId, userId]
  );
  return rowCount > 0;
}

module.exports = { saveFact, searchFacts, listFacts, deleteFact };
