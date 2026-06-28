'use strict';

require('dotenv').config();

const { validateEnv } = require('./config/env');
const { testConnection } = require('./config/db');
const { startScheduler } = require('./modules/scheduler/scheduler');
const app = require('./app');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║       🧠 SEGUNDO CEREBRO v1.0        ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // 1. Validar variables de entorno (falla rápido si falta alguna crítica)
  validateEnv();
  console.log('✅  Variables de entorno: OK');

  // 2. Verificar conexión a PostgreSQL
  await testConnection();

  // 3. Iniciar cron jobs
  startScheduler();

  // 4. Arrancar servidor HTTP
  app.listen(PORT, () => {
    console.log('');
    console.log(`🚀  Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📡  Webhook:     POST http://localhost:${PORT}/webhook`);
    console.log(`🔐  API REST:    http://localhost:${PORT}/api/v1`);
    console.log(`📅  Google Auth: http://localhost:${PORT}/auth/google`);
    console.log(`❤️   Health:      http://localhost:${PORT}/api/v1/health`);
    console.log('');
    console.log('Esperando mensajes de WhatsApp...');
  });
}

bootstrap().catch((err) => {
  console.error('❌  Error fatal al iniciar el servidor:', err.message);
  process.exit(1);
});
