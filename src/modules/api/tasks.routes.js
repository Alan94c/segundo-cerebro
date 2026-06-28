'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth.middleware');
const taskService = require('../tasks/list.service');

// Todas las rutas requieren auth
router.use(authMiddleware);

/**
 * GET /api/v1/tasks
 * Lista todas las tareas del usuario con filtros opcionales.
 * Query: ?listId=UUID&status=pending&page=1&pageSize=20
 */
router.get('/', async (req, res) => {
  try {
    const { listId, status } = req.query;
    const tasks = await taskService.getTasks(req.user.id, listId, status);
    res.json({ data: tasks, count: tasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/tasks/today
 * Tareas programadas para hoy.
 */
router.get('/today', async (req, res) => {
  try {
    const tasks = await taskService.getTodayTasks(req.user.id);
    res.json({ data: tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/tasks
 * Crea una nueva tarea manualmente.
 */
router.post('/', async (req, res) => {
  try {
    const { title, description, list_id, due_date, priority, assigned_to } = req.body;
    if (!title) return res.status(400).json({ error: 'El campo "title" es requerido' });

    const task = await taskService.addTask(
      list_id || null,
      assigned_to || req.user.id,
      req.user.id,
      title,
      description,
      due_date ? new Date(due_date) : null,
      priority || 'normal'
    );
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/v1/tasks/:id
 * Actualiza una tarea (estado, prioridad, título, descripción, fecha).
 */
router.patch('/:id', async (req, res) => {
  try {
    const updated = await taskService.updateTask(req.params.id, req.user.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/tasks/:id/complete
 * Marca una tarea como completada.
 */
router.post('/:id/complete', async (req, res) => {
  try {
    const task = await taskService.completeTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/tasks/lists
 * Obtiene todas las listas del usuario (propias + compartidas).
 */
router.get('/lists', async (req, res) => {
  try {
    const lists = await taskService.getLists(req.user.id);
    res.json({ data: lists });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/tasks/lists
 * Crea una nueva lista.
 */
router.post('/lists', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'El campo "name" es requerido' });
    const list = await taskService.createList(req.user.id, name, color);
    res.status(201).json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
