'use strict';

const db = require('../../config/db');

/**
 * Crea un nuevo recordatorio programado.
 *
 * @param {string} userId       - UUID del usuario
 * @param {string} message      - Mensaje a enviar en el recordatorio
 * @param {Date}   scheduledAt  - Fecha y hora exacta del recordatorio
 * @param {string|null} taskId  - UUID de tarea vinculada (opcional)
 * @param {boolean} isRecurring - Si es recurrente
 * @param {string|null} recurrenceRule - Regla de recurrencia ('daily', 'weekly', 'monthly')
 * @returns {Promise<Object>}   El recordatorio creado
 */
async function createReminder(userId, message, scheduledAt, taskId = null, isRecurring = false, recurrenceRule = null) {
  const { rows } = await db.query(
    `INSERT INTO reminders (user_id, task_id, message, scheduled_at, is_recurring, recurrence_rule)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, taskId, message, scheduledAt, isRecurring, recurrenceRule]
  );
  return rows[0];
}

/**
 * Reprograma un recordatorio recurrente para su próxima fecha.
 * @param {string} reminderId
 * @param {Date}   nextDate
 */
async function rescheduleReminder(reminderId, nextDate) {
  await db.query(
    `UPDATE reminders
     SET scheduled_at = $2, sent_at = NOW()
     WHERE id = $1`,
    [reminderId, nextDate]
  );
}

/**
 * Obtiene todos los recordatorios pendientes cuya hora ya llegó.
 * Usado por el scheduler cada minuto.
 *
 * @returns {Promise<Object[]>} Array de recordatorios con info del usuario
 */
async function getPendingReminders() {
  const { rows } = await db.query(
    `SELECT r.*, u.phone_number
     FROM reminders r
     JOIN users u ON r.user_id = u.id
     WHERE r.is_sent = FALSE
       AND r.scheduled_at <= NOW()
     ORDER BY r.scheduled_at ASC
     LIMIT 50`  // Procesar máximo 50 a la vez para no sobrecargar
  );
  return rows;
}

/**
 * Marca un recordatorio como enviado.
 * @param {string} reminderId
 */
async function markAsSent(reminderId) {
  await db.query(
    `UPDATE reminders
     SET is_sent = TRUE, sent_at = NOW()
     WHERE id = $1`,
    [reminderId]
  );
}

/**
 * Lista los recordatorios futuros de un usuario.
 * @param {string} userId
 */
async function getUpcomingReminders(userId) {
  const { rows } = await db.query(
    `SELECT r.*, t.title AS task_title
     FROM reminders r
     LEFT JOIN tasks t ON r.task_id = t.id
     WHERE r.user_id = $1
       AND r.is_sent = FALSE
       AND r.scheduled_at > NOW()
     ORDER BY r.scheduled_at ASC`,
    [userId]
  );
  return rows;
}

/**
 * Cancela (elimina) un recordatorio pendiente.
 */
async function cancelReminder(reminderId, userId) {
  const { rowCount } = await db.query(
    `DELETE FROM reminders
     WHERE id = $1 AND user_id = $2 AND is_sent = FALSE`,
    [reminderId, userId]
  );
  return rowCount > 0;
}

module.exports = {
  createReminder,
  getPendingReminders,
  markAsSent,
  getUpcomingReminders,
  cancelReminder,
  rescheduleReminder,
};
