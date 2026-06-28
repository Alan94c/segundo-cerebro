'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('./auth.middleware');
const reminderService = require('../tasks/reminder.service');

router.use(authMiddleware);

/**
 * GET /api/v1/reminders
 * Lista recordatorios futuros del usuario.
 */
router.get('/', async (req, res) => {
  try {
    const reminders = await reminderService.getUpcomingReminders(req.user.id);
    res.json({ data: reminders, count: reminders.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/reminders
 * Crea un recordatorio manualmente.
 */
router.post('/', async (req, res) => {
  try {
    const { message, scheduled_at, task_id } = req.body;

    if (!message || !scheduled_at) {
      return res.status(400).json({ error: 'message y scheduled_at son requeridos' });
    }

    const reminder = await reminderService.createReminder(
      req.user.id,
      message,
      new Date(scheduled_at),
      task_id || null
    );
    res.status(201).json(reminder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/v1/reminders/:id
 * Cancela un recordatorio pendiente.
 */
router.delete('/:id', async (req, res) => {
  try {
    const cancelled = await reminderService.cancelReminder(req.params.id, req.user.id);
    if (!cancelled) return res.status(404).json({ error: 'Recordatorio no encontrado o ya enviado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
