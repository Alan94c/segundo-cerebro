'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// Inicializar la App de Admin de Firebase
admin.initializeApp();

// Importar la app de Express
const app = require('./app');

/**
 * Cloud Function HTTPS.
 * Envuelve el servidor Express completo.
 * Su URL será: https://<region>-<project-id>.cloudfunctions.net/secondbrain
 */
exports.secondbrain = onRequest({
  cors: true,
  timeoutSeconds: 60, // Aumentar timeout por si Gemini tarda en responder
  memory: '256MiB',
}, app);
