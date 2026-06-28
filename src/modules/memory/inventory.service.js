'use strict';

const db = require('../../config/db');

/**
 * Crea o actualiza un ítem de inventario (UPSERT por nombre de ítem).
 * Si el ítem ya existe para ese usuario, actualiza su ubicación.
 *
 * @param {string} userId        - UUID del usuario
 * @param {string} itemName      - Nombre del objeto físico
 * @param {string} location      - Ubicación actual en lenguaje natural
 * @param {string} [description] - Descripción adicional
 * @param {string} [category]    - Categoría del objeto
 * @returns {Promise<Object>} El registro actualizado o creado
 */
async function upsertItem(userId, itemName, location, description = null, category = null) {
  const { rows } = await db.query(
    `INSERT INTO inventory_items (user_id, item_name, current_location, description, category, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, item_name_lower)
     DO UPDATE SET
       current_location = EXCLUDED.current_location,
       description      = COALESCE(EXCLUDED.description, inventory_items.description),
       category         = COALESCE(EXCLUDED.category, inventory_items.category),
       last_seen_at     = NOW(),
       updated_at       = NOW()
     RETURNING *`,
    [userId, itemName, location, description, category]
  );
  return rows[0];
}

/**
 * Busca un ítem de inventario por nombre aproximado.
 * @param {string} userId - UUID del usuario
 * @param {string} query  - Nombre o descripción del objeto buscado
 * @returns {Promise<Object|null>} El ítem encontrado o null
 */
async function findItem(userId, query) {
  const { rows } = await db.query(
    `SELECT *,
            similarity(item_name_lower, LOWER($2)) AS sim
     FROM inventory_items
     WHERE user_id = $1
       AND (
         item_name_lower ILIKE $3
         OR to_tsvector('spanish', item_name) @@ plainto_tsquery('spanish', $2)
       )
     ORDER BY sim DESC, last_seen_at DESC
     LIMIT 1`,
    [userId, query, `%${query.toLowerCase()}%`]
  );

  return rows[0] || null;
}

/**
 * Lista todos los ítems de inventario de un usuario.
 * @param {string} userId
 * @param {string} [category] - Filtro opcional por categoría
 */
async function listItems(userId, category = null) {
  if (category) {
    const { rows } = await db.query(
      `SELECT * FROM inventory_items
       WHERE user_id = $1 AND category ILIKE $2
       ORDER BY item_name ASC`,
      [userId, `%${category}%`]
    );
    return rows;
  }

  const { rows } = await db.query(
    `SELECT * FROM inventory_items
     WHERE user_id = $1
     ORDER BY item_name ASC`,
    [userId]
  );
  return rows;
}

/**
 * Elimina un ítem del inventario.
 */
async function deleteItem(itemId, userId) {
  const { rowCount } = await db.query(
    `DELETE FROM inventory_items WHERE id = $1 AND user_id = $2`,
    [itemId, userId]
  );
  return rowCount > 0;
}

module.exports = { upsertItem, findItem, listItems, deleteItem };
