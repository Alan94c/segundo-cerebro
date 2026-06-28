'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth.middleware');
const memoryService = require('../memory/memory.service');

router.use(authMiddleware);

/**
 * GET /api/v1/memory
 * Lista o busca memorias del usuario.
 * Query: ?q=texto_a_buscar&page=1&pageSize=20
 */
router.get('/', async (req, res) => {
  try {
    const { q, page = 1, pageSize = 20 } = req.query;

    let memories;
    if (q) {
      memories = await memoryService.searchFacts(req.user.id, q);
    } else {
      memories = await memoryService.listFacts(req.user.id, Number(page), Number(pageSize));
    }

    res.json({ data: memories, count: memories.length, query: q || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/memory
 * Guarda un nuevo hecho manualmente desde el frontend.
 */
router.post('/', async (req, res) => {
  try {
    const { content, tags } = req.body;
    if (!content) return res.status(400).json({ error: 'El campo "content" es requerido' });

    const memory = await memoryService.saveFact(req.user.id, content, tags || []);
    res.status(201).json(memory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/memory/:id
 * Elimina una memoria por ID.
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await memoryService.deleteFact(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Memoria no encontrada' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
