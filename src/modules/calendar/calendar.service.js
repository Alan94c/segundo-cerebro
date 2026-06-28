'use strict';

const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./google.auth');

/**
 * Crea un evento en Google Calendar del usuario.
 *
 * @param {string}      userId        - UUID del usuario en la BD
 * @param {string}      title         - Título del evento
 * @param {string}      startDateTime - ISO 8601 (ej: "2024-12-25T14:00:00")
 * @param {string|null} endDateTime   - ISO 8601 (opcional; +1 hora si no se provee)
 * @param {string|null} description   - Descripción del evento
 * @returns {Promise<Object>} El evento creado por la API de Google
 */
async function createEvent(userId, title, startDateTime, endDateTime = null, description = null) {
  const authClient = await getAuthenticatedClient(userId);
  const calendar = google.calendar({ version: 'v3', auth: authClient });

  // Si no hay end time, el evento dura 1 hora por defecto
  const start = new Date(startDateTime);
  const end = endDateTime
    ? new Date(endDateTime)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: description || '',
      start: {
        dateTime: start.toISOString(),
        timeZone: 'America/Mexico_City',
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: 'America/Mexico_City',
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
          { method: 'email', minutes: 60 },
        ],
      },
    },
  });

  return data;
}

/**
 * Lista los eventos del calendario del usuario para el día de hoy.
 * Usado por el resumen diario (scheduler).
 *
 * @param {string} userId - UUID del usuario
 * @returns {Promise<Object[]>} Eventos de hoy
 */
async function listTodayEvents(userId) {
  try {
    const authClient = await getAuthenticatedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth: authClient });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return data.items || [];
  } catch (err) {
    if (err.code === 'NO_GOOGLE_TOKEN') return [];
    throw err;
  }
}

/**
 * Lista los próximos eventos (hasta 7 días).
 * @param {string} userId
 * @param {number} [days=7]
 */
async function listUpcomingEvents(userId, days = 7) {
  try {
    const authClient = await getAuthenticatedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth: authClient });

    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return data.items || [];
  } catch (err) {
    if (err.code === 'NO_GOOGLE_TOKEN') return [];
    throw err;
  }
}

module.exports = { createEvent, listTodayEvents, listUpcomingEvents };
