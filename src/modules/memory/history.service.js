'use strict';

const db = require('../../config/db');

/**
 * Registra un mensaje de chat (entrante o saliente) en la base de datos.
 * @param {string} userId   - UUID del usuario
 * @param {string} sender   - 'user' o 'bot'
 * @param {string} content  - Contenido del mensaje
 * @returns {Promise<void>}
 */
async function logMessage(userId, sender, content) {
  if (!userId || !content) return;
  try {
    await db.query(
      `INSERT INTO messages (user_id, sender, content) VALUES ($1, $2, $3)`,
      [userId, sender, content]
    );
  } catch (err) {
    console.error('[HistoryService] Error al guardar mensaje:', err.message);
  }
}

/**
 * Obtiene los últimos mensajes del historial de chat de un usuario en orden cronológico.
 * @param {string} userId - UUID del usuario
 * @param {number} [limit=6] - Cantidad de mensajes a recuperar
 * @returns {Promise<Array<{sender: string, content: string}>>}
 */
async function getRecentHistory(userId, limit = 6) {
  try {
    const { rows } = await db.query(
      `SELECT sender, content FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows.reverse();
  } catch (err) {
    console.error('[HistoryService] Error al obtener historial:', err.message);
    return [];
  }
}

module.exports = { logMessage, getRecentHistory };
