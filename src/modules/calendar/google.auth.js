'use strict';

const { google } = require('googleapis');
const db = require('../../config/db');
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} = require('../../config/env');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

// ============================================================
// Factory de OAuth2 Client
// ============================================================

/**
 * Crea una nueva instancia del cliente OAuth2.
 * @returns {import('googleapis').Auth.OAuth2Client}
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

/**
 * Genera la URL de autorización de Google para un usuario.
 * @param {string} userId - Se pasa como "state" para identificar al usuario en el callback
 * @returns {string} URL a la que redirigir al usuario
 */
function getAuthUrl(userId) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Fuerza la entrega del refresh_token
    state: userId,     // Identificamos al usuario en el callback
  });
}

/**
 * Intercambia el código de autorización por tokens y los persiste en la BD.
 * @param {string} code   - Código recibido en el callback de OAuth
 * @param {string} userId - UUID del usuario
 * @returns {Promise<Object>} Los tokens guardados
 */
async function exchangeCodeAndSave(code, userId) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  await db.query(
    `INSERT INTO google_tokens (user_id, access_token, refresh_token, token_type, expiry_date, scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
       token_type    = EXCLUDED.token_type,
       expiry_date   = EXCLUDED.expiry_date,
       scope         = EXCLUDED.scope,
       updated_at    = NOW()`,
    [userId, tokens.access_token, tokens.refresh_token, tokens.token_type, tokens.expiry_date, tokens.scope]
  );

  // Marcar usuario como vinculado con Google
  await db.query(
    `UPDATE users SET google_linked = TRUE WHERE id = $1`,
    [userId]
  );

  return tokens;
}

/**
 * Reconstruye un cliente OAuth2 autenticado para un usuario usando
 * su refresh token almacenado en la BD.
 *
 * @param {string} userId - UUID del usuario
 * @returns {Promise<import('googleapis').Auth.OAuth2Client>}
 * @throws {Error} con code 'NO_GOOGLE_TOKEN' si el usuario no ha vinculado Google
 */
async function getAuthenticatedClient(userId) {
  const { rows } = await db.query(
    `SELECT * FROM google_tokens WHERE user_id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    const err = new Error('El usuario no ha vinculado su cuenta de Google');
    err.code = 'NO_GOOGLE_TOKEN';
    throw err;
  }

  const tokenData = rows[0];
  const oauth2Client = createOAuth2Client();

  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type,
    expiry_date: Number(tokenData.expiry_date),
  });

  // Auto-renovar el access_token si está expirado
  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await db.query(
        `UPDATE google_tokens SET access_token = $1, expiry_date = $2, updated_at = NOW()
         WHERE user_id = $3`,
        [newTokens.access_token, newTokens.expiry_date, userId]
      );
    }
  });

  return oauth2Client;
}

module.exports = { createOAuth2Client, getAuthUrl, exchangeCodeAndSave, getAuthenticatedClient };
