'use strict';

const cron = require('node-cron');
const reminderService = require('../tasks/reminder.service');
const taskService = require('../tasks/list.service');
const calendarService = require('../calendar/calendar.service');
const whatsappService = require('../whatsapp/whatsapp.service');
const { textModel } = require('../nlp/gemini.client');
const db = require('../../config/db');
const { DAILY_DIGEST_CRON } = require('../../config/env');

// ============================================================
// Job 1: Verificación de Recordatorios (cada minuto)
// ============================================================

async function checkReminders() {
  try {
    const pending = await reminderService.getPendingReminders();

    if (pending.length === 0) return;

    console.log(`[Scheduler] 🔔 Procesando ${pending.length} recordatorio(s)...`);

    for (const reminder of pending) {
      try {
        const msg = `🔔 *Recordatorio*\n\n${reminder.message}`;
        await whatsappService.sendTextMessage(reminder.phone_number, msg);
        await reminderService.markAsSent(reminder.id);
        console.log(`[Scheduler] ✅ Recordatorio enviado a ${reminder.phone_number}`);
      } catch (err) {
        console.error(`[Scheduler] ❌ Error enviando recordatorio ${reminder.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error en checkReminders:', err.message);
  }
}

// ============================================================
// Job 2: Resumen Diario (7:00 AM por defecto)
// ============================================================

async function sendDailyDigest() {
  console.log('[Scheduler] 📋 Generando resumen diario...');

  try {
    // Obtener todos los usuarios activos
    const { rows: users } = await db.query(
      `SELECT id, phone_number, name, timezone FROM users WHERE is_active = TRUE`
    );

    for (const user of users) {
      try {
        await buildAndSendDigest(user);
      } catch (err) {
        console.error(`[Scheduler] Error en digest para ${user.phone_number}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error en sendDailyDigest:', err.message);
  }
}

async function buildAndSendDigest(user) {
  // 1. Obtener tareas de hoy
  const tasks = await taskService.getTodayTasks(user.id);

  // 2. Obtener eventos de Google Calendar
  const events = await calendarService.listTodayEvents(user.id);

  // 3. Obtener recordatorios de hoy
  const { rows: reminders } = await db.query(
    `SELECT * FROM reminders
     WHERE user_id = $1
       AND is_sent = FALSE
       AND scheduled_at::date = CURRENT_DATE
     ORDER BY scheduled_at ASC`,
    [user.id]
  );

  // Si no hay nada para hoy, no enviar digest
  if (tasks.length === 0 && events.length === 0 && reminders.length === 0) {
    return;
  }

  // 4. Construir contexto para Gemini
  const today = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const contextData = {
    fecha: today,
    nombre: user.name || 'Usuario',
    tareas: tasks.map((t) => ({ titulo: t.title, prioridad: t.priority, hora: t.due_date })),
    eventos: events.map((e) => ({ titulo: e.summary, inicio: e.start?.dateTime || e.start?.date })),
    recordatorios: reminders.map((r) => ({ mensaje: r.message, hora: r.scheduled_at })),
  };

  // 5. Pedirle a Gemini que redacte el mensaje de buenos días
  const prompt = `
Eres el asistente personal de ${contextData.nombre}.
Hoy es ${contextData.fecha}.

Redacta un mensaje de "Buenos días" motivador y estructurado en WhatsApp (usando *negrita* y _cursiva_ del formato WA).
El mensaje debe incluir:
1. Saludo personalizado con el día
2. Resumen de tareas del día (si hay)
3. Eventos del calendario (si hay)
4. Recordatorios programados (si hay)
5. Frase motivacional de cierre

DATOS:
${JSON.stringify(contextData, null, 2)}

Responde SOLO el texto del mensaje, sin JSON, sin explicaciones adicionales.
`.trim();

  const result = await textModel.generateContent(prompt);
  // El modelo está configurado para JSON por defecto, aquí necesitamos texto libre
  // Usando la respuesta directa
  let digestMessage = result.response.text();

  // Si la respuesta viene envuelta en JSON (por la config del modelo), extraer
  try {
    const parsed = JSON.parse(digestMessage);
    digestMessage = parsed.message || parsed.text || digestMessage;
  } catch {
    // Ya es texto plano, OK
  }

  await whatsappService.sendTextMessage(user.phone_number, digestMessage);
  console.log(`[Scheduler] 📨 Digest enviado a ${user.phone_number}`);
}

// ============================================================
// Inicialización del Scheduler
// ============================================================

/**
 * Inicia todos los cron jobs del sistema.
 * Llamar una vez al arrancar el servidor.
 */
function startScheduler() {
  // Job 1: Recordatorios — cada minuto
  cron.schedule('* * * * *', checkReminders, {
    name: 'reminder-check',
  });

  // Job 2: Resumen diario — configurable via env (default 7 AM)
  cron.schedule(DAILY_DIGEST_CRON, sendDailyDigest, {
    name: 'daily-digest',
    timezone: process.env.TZ || 'America/Mexico_City',
  });

  console.log('✅  Scheduler iniciado:');
  console.log(`   • Recordatorios: cada minuto`);
  console.log(`   • Resumen diario: cron="${DAILY_DIGEST_CRON}" (${process.env.TZ || 'America/Mexico_City'})`);
}

module.exports = { startScheduler, checkReminders, sendDailyDigest };
