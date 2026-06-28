'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const webhookController = require('./webhook.controller');
const { WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET } = require('../../config/env');

// ============================================================
// Middleware de verificación de firma HMAC-SHA256
// Valida que el webhook viene de Meta, no de un tercero malicioso
// ============================================================
function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature) {
    console.warn('[Webhook] Solicitud sin firma recibida — rechazada');
    return res.status(401).json({ error: 'Firma requerida' });
  }

  const rawBody = req.rawBody; // Necesita bodyParser con rawBody (configurado en app.js)
  if (!rawBody) {
    return next(); // En desarrollo puede omitirse
  }

  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  if (signature !== expectedSig) {
    console.warn('[Webhook] Firma inválida — solicitud rechazada');
    return res.status(403).json({ error: 'Firma inválida' });
  }

  next();
}

// ============================================================
// GET /webhook — Handshake de verificación de WhatsApp Cloud API
// Meta hace esta llamada cuando configuras el webhook en el panel
// ============================================================
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] ✅ Webhook verificado correctamente');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] ⚠️ Verificación fallida — token incorrecto');
  return res.status(403).json({ error: 'Forbidden' });
});

// ============================================================
// POST /webhook — Recepción de mensajes de WhatsApp
// ============================================================
router.post('/', verifySignature, webhookController.handleIncoming);

module.exports = router;
