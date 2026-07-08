'use strict';

const db = require('../../config/db');

// ============================================================
// Gestión de Listas
// ============================================================

/**
 * Crea una nueva lista de tareas.
 * @param {string} ownerId - UUID del usuario propietario
 * @param {string} name    - Nombre de la lista
 * @param {string} [color] - Color hexadecimal para el frontend
 */
async function createList(ownerId, name, color = '#3B82F6') {
  const { rows } = await db.query(
    `INSERT INTO lists (owner_id, name, color)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [ownerId, name, color]
  );
  return rows[0];
}

/**
 * Busca una lista por nombre (case-insensitive) o la crea si no existe.
 * Útil cuando Gemini detecta el nombre de la lista en el mensaje.
 *
 * @param {string} ownerId  - UUID del usuario
 * @param {string} listName - Nombre de la lista
 */
async function findOrCreateList(ownerId, listName) {
  const { rows } = await db.query(
    `SELECT * FROM lists
     WHERE owner_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [ownerId, listName]
  );

  if (rows.length > 0) return rows[0];
  return createList(ownerId, listName);
}

/**
 * Obtiene todas las listas de un usuario (propias + compartidas).
 */
async function getLists(userId) {
  const { rows } = await db.query(
    `SELECT l.*, 'owner' AS role
     FROM lists l
     WHERE l.owner_id = $1

     UNION ALL

     SELECT l.*, lm.role
     FROM lists l
     JOIN list_members lm ON l.id = lm.list_id
     WHERE lm.user_id = $1

     ORDER BY name ASC`,
    [userId]
  );
  return rows;
}

/**
 * Comparte una lista con otro usuario.
 */
async function shareList(listId, targetUserId, role = 'viewer') {
  const { rows } = await db.query(
    `INSERT INTO list_members (list_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (list_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [listId, targetUserId, role]
  );
  return rows[0];
}

// ============================================================
// Gestión de Tareas
// ============================================================

/**
 * Agrega una nueva tarea a una lista.
 *
 * @param {string|null} listId      - UUID de la lista (puede ser null)
 * @param {string}      assignedTo  - UUID del usuario asignado
 * @param {string}      createdBy   - UUID del usuario que la creó
 * @param {string}      title       - Título de la tarea
 * @param {string}      [description]
 * @param {Date|null}   [dueDate]
 * @param {string}      [priority]
 */
async function addTask(listId, assignedTo, createdBy, title, description = null, dueDate = null, priority = 'normal') {
  const { rows } = await db.query(
    `INSERT INTO tasks (list_id, assigned_to, created_by, title, description, due_date, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [listId, assignedTo, createdBy, title, description, dueDate, priority]
  );
  return rows[0];
}

/**
 * Obtiene las tareas de una lista o todas las tareas de un usuario.
 * @param {string} userId
 * @param {string} [listId] - Si se provee, filtra por lista
 * @param {string} [status] - Filtro de estado
 */
async function getTasks(userId, listId = null, status = null) {
  let sql = `SELECT t.*, l.name AS list_name
             FROM tasks t
             LEFT JOIN lists l ON t.list_id = l.id
             WHERE t.assigned_to = $1`;
  const params = [userId];
  let idx = 2;

  if (listId) {
    sql += ` AND t.list_id = $${idx++}`;
    params.push(listId);
  }
  if (status) {
    sql += ` AND t.status = $${idx++}`;
    params.push(status);
  }

  sql += ' ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC';

  const { rows } = await db.query(sql, params);
  return rows;
}

/**
 * Marca una tarea como completada.
 */
async function completeTask(taskId, userId) {
  const { rows } = await db.query(
    `UPDATE tasks
     SET status = 'completed', completed_at = NOW()
     WHERE id = $1 AND assigned_to = $2
     RETURNING *`,
    [taskId, userId]
  );
  return rows[0] || null;
}

/**
 * Actualiza el estado o prioridad de una tarea.
 */
async function updateTask(taskId, userId, updates) {
  const allowed = ['status', 'priority', 'title', 'description', 'due_date'];
  const fields = Object.keys(updates).filter((k) => allowed.includes(k));

  if (fields.length === 0) return null;

  const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
  const values = fields.map((f) => updates[f]);

  const { rows } = await db.query(
    `UPDATE tasks SET ${setClause}, updated_at = NOW()
     WHERE id = $1 AND assigned_to = $2
     RETURNING *`,
    [taskId, userId, ...values]
  );
  return rows[0] || null;
}

/**
 * Obtiene tareas con due_date para hoy (para el resumen diario).
 */
async function getTodayTasks(userId) {
  const { rows } = await db.query(
    `SELECT t.*, l.name AS list_name
     FROM tasks t
     LEFT JOIN lists l ON t.list_id = l.id
     WHERE t.assigned_to = $1
       AND t.status NOT IN ('completed', 'cancelled')
       AND (t.due_date AT TIME ZONE COALESCE((SELECT timezone FROM users WHERE id = $1), 'America/Mexico_City'))::date = (NOW() AT TIME ZONE COALESCE((SELECT timezone FROM users WHERE id = $1), 'America/Mexico_City'))::date
     ORDER BY t.priority DESC, t.due_date ASC`,
    [userId]
  );
  return rows;
}

module.exports = {
  createList,
  findOrCreateList,
  getLists,
  shareList,
  addTask,
  getTasks,
  completeTask,
  updateTask,
  getTodayTasks,
};
