'use strict';

const express = require('express');
const router = express.Router();
const { getAuthUrl, exchangeCodeAndSave } = require('./google.auth');
const whatsappService = require('../whatsapp/whatsapp.service');
const db = require('../../config/db');

/**
 * GET /auth/google
 * Inicia el flujo de OAuth2 con Google.
 * El usuario abre este link en su navegador.
 * Query param: ?userId=UUID_del_usuario
 */
router.get('/google', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Se requiere el parámetro userId' });
  }

  const authUrl = getAuthUrl(userId);
  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Recibe el código de autorización de Google.
 * Intercambia el código por tokens y notifica al usuario por WhatsApp.
 */
router.get('/google/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    console.error('[Google Auth] Usuario rechazó el acceso:', error);
    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
        <h2>❌ Acceso cancelado</h2>
        <p>No se vinculó tu cuenta de Google. Puedes intentarlo de nuevo.</p>
      </body></html>
    `);
  }

  if (!code || !userId) {
    return res.status(400).send('Parámetros faltantes');
  }

  try {
    await exchangeCodeAndSave(code, userId);

    // Obtener el número del usuario para notificarle por WA
    const { rows } = await db.query(
      `SELECT phone_number, name FROM users WHERE id = $1`,
      [userId]
    );

    if (rows.length > 0) {
      const user = rows[0];
      await whatsappService.sendTextMessage(
        user.phone_number,
        `✅ *¡Google Calendar vinculado correctamente!*\n\nAhora cuando me digas sobre un evento o cita, lo agregaré automáticamente a tu calendario. 📅`
      );
    }

    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4">
        <h2 style="color:#16a34a">✅ ¡Google Calendar vinculado!</h2>
        <p>Puedes cerrar esta ventana y continuar usando tu Segundo Cerebro en WhatsApp.</p>
      </body></html>
    `);
  } catch (err) {
    console.error('[Google Auth] Error en callback:', err.message);
    res.status(500).send('Error al procesar la autenticación. Intenta de nuevo.');
  }
});

module.exports = router;
