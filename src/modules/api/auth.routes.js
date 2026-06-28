'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../../config/db');
const { authMiddleware } = require('./auth.middleware');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../../config/env');
const { getAuthUrl } = require('../calendar/google.auth');

/**
 * POST /api/v1/auth/login
 * Login con número de teléfono + PIN (para el frontend).
 * Si el usuario no tiene PIN, se establece en el primer login.
 */
router.post('/login', async (req, res) => {
  const { phone_number, pin } = req.body;

  if (!phone_number || !pin) {
    return res.status(400).json({ error: 'phone_number y pin son requeridos' });
  }

  try {
    const { rows } = await db.query(
      `SELECT * FROM users WHERE phone_number = $1`,
      [phone_number]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado. Primero envía un mensaje por WhatsApp.' });
    }

    const user = rows[0];

    // Si el usuario no tiene PIN, establecerlo ahora
    if (!user.pin_hash) {
      const salt = await bcrypt.genSalt(10);
      const pinHash = await bcrypt.hash(pin, salt);
      await db.query(
        `UPDATE users SET pin_hash = $1 WHERE id = $2`,
        [pinHash, user.id]
      );
    } else {
      // Verificar PIN
      const isValid = await bcrypt.compare(pin, user.pin_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'PIN incorrecto' });
      }
    }

    // Generar JWT
    const token = jwt.sign(
      { id: user.id, phoneNumber: user.phone_number },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user.id,
        phone_number: user.phone_number,
        name: user.name,
        google_linked: user.google_linked,
      },
    });
  } catch (err) {
    console.error('[Auth] Error en login:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/v1/auth/me
 * Obtiene el perfil del usuario autenticado.
 */
router.get('/me', authMiddleware, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, phone_number, name, timezone, google_linked, created_at FROM users WHERE id = $1`,
    [req.user.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(rows[0]);
});

/**
 * GET /api/v1/auth/google-link
 * Devuelve la URL para vincular Google Calendar desde el frontend.
 */
router.get('/google-link', authMiddleware, (req, res) => {
  const url = getAuthUrl(req.user.id);
  res.json({ url });
});

/**
 * PATCH /api/v1/auth/profile
 * Actualiza el nombre o zona horaria del usuario.
 */
router.patch('/profile', authMiddleware, async (req, res) => {
  const { name, timezone } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (timezone) updates.timezone = timezone;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' });
  }

  const fields = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

  const { rows } = await db.query(
    `UPDATE users SET ${setClause} WHERE id = $1 RETURNING id, phone_number, name, timezone`,
    [req.user.id, ...values]
  );
  res.json(rows[0]);
});

module.exports = router;
