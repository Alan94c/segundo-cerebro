'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth.middleware');
const inventoryService = require('../memory/inventory.service');

router.use(authMiddleware);

/**
 * GET /api/v1/inventory
 * Lista todos los ítems del inventario.
 * Query: ?category=herramientas&q=buscartexto
 */
router.get('/', async (req, res) => {
  try {
    const { category, q } = req.query;

    let items;
    if (q) {
      // Búsqueda por nombre
      const found = await inventoryService.findItem(req.user.id, q);
      items = found ? [found] : [];
    } else {
      items = await inventoryService.listItems(req.user.id, category);
    }

    res.json({ data: items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/inventory
 * Registra o actualiza un ítem de inventario.
 */
router.post('/', async (req, res) => {
  try {
    const { item_name, current_location, description, category } = req.body;

    if (!item_name || !current_location) {
      return res.status(400).json({ error: 'item_name y current_location son requeridos' });
    }

    const item = await inventoryService.upsertItem(
      req.user.id,
      item_name,
      current_location,
      description,
      category
    );
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/inventory/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await inventoryService.deleteItem(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
