'use strict';

const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const tasksRoutes = require('./tasks.routes');
const memoryRoutes = require('./memory.routes');
const inventoryRoutes = require('./inventory.routes');
const remindersRoutes = require('./reminders.routes');

// ============================================================
// Montaje de rutas bajo /api/v1
// ============================================================
router.use('/auth', authRoutes);
router.use('/tasks', tasksRoutes);
router.use('/memory', memoryRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/reminders', remindersRoutes);

/**
 * GET /api/v1/health
 * Health check público para monitoreo.
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

module.exports = router;
