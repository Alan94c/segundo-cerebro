'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const webhookRoutes = require('./modules/webhook/webhook.routes');
const calendarRoutes = require('./modules/calendar/calendar.routes');
const apiRoutes = require('./modules/api/api.routes');

const app = express();

// ============================================================
// Middlewares de seguridad
// ============================================================
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ============================================================
// Body Parser — con captura de rawBody para verificación HMAC
// El webhook de Meta requiere el body RAW para validar la firma
// ============================================================
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
    limit: '10mb',
  })
);
app.use(express.urlencoded({ extended: true }));

// ============================================================
// Rutas
// ============================================================

// Webhook de WhatsApp (público — la seguridad es via HMAC en el middleware)
app.use('/webhook', webhookRoutes);

// OAuth2 de Google (público — flujo OAuth en navegador)
app.use('/auth', calendarRoutes);

// API REST (protegida por JWT en cada sub-router)
app.use('/api/v1', apiRoutes);

// ============================================================
// Manejo de errores global
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[App] Error no controlado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
