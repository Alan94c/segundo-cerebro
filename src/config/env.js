'use strict';

const requiredVars = [
  'DATABASE_URL',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WEBHOOK_VERIFY_TOKEN',
  'GEMINI_API_KEY',
  'JWT_SECRET',
];

/**
 * Valida que todas las variables de entorno críticas estén definidas.
 * El proceso falla rápido en startup si falta alguna.
 */
function validateEnv() {
  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌  Variables de entorno faltantes:');
    missing.forEach((k) => console.error(`   - ${k}`));
    console.error('\nCopia .env.example a .env y rellena los valores.');
    process.exit(1);
  }
}

module.exports = {
  validateEnv,

  // Servidor
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // PostgreSQL
  DATABASE_URL: process.env.DATABASE_URL,

  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // WhatsApp
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION || 'v19.0',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,

  // Gemini
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',

  // Google OAuth2
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',

  // Scheduler
  DAILY_DIGEST_CRON: process.env.DAILY_DIGEST_CRON || '0 7 * * *',
};
