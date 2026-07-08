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

function calculateNextOccurrence(currentDate, rule) {
  const next = new Date(currentDate);
  const cleanRule = String(rule).toLowerCase().trim();
  
  if (cleanRule === 'hourly') {
    next.setHours(next.getHours() + 1);
    return next;
  }
  
  // Custom intervals: every_X_minutes, every_X_hours, every_X_days, every_X_weeks, every_X_months
  if (cleanRule.startsWith('every_')) {
    const match = cleanRule.match(/every_(\d+)_(minute|hour|day|week|month)s?/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      
      if (unit === 'minute') {
        next.setMinutes(next.getMinutes() + value);
      } else if (unit === 'hour') {
        next.setHours(next.getHours() + value);
      } else if (unit === 'day') {
        next.setDate(next.getDate() + value);
      } else if (unit === 'week') {
        next.setDate(next.getDate() + (value * 7));
      } else if (unit === 'month') {
        next.setMonth(next.getMonth() + value);
      }
      return next;
    }
  }
  
  // Backward compatibility
  if (cleanRule === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (cleanRule === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else if (cleanRule === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function checkReminders() {
  try {
    const pending = await reminderService.getPendingReminders();

    if (pending.length === 0) return;

    console.log(`[Scheduler] 🔔 Procesando ${pending.length} recordatorio(s)...`);

    for (const reminder of pending) {
      try {
        const msg = `🔔 *Recordatorio*\n\n${reminder.message}`;
        await whatsappService.sendTextMessage(reminder.phone_number, msg);

        if (reminder.is_recurring && reminder.recurrence_rule) {
          const nextDate = calculateNextOccurrence(reminder.scheduled_at, reminder.recurrence_rule);
          await reminderService.rescheduleReminder(reminder.id, nextDate);
          console.log(`[Scheduler] 🔁 Recordatorio recurrente enviado y reprogramado para ${nextDate.toLocaleString('es-MX')}`);
        } else {
          await reminderService.markAsSent(reminder.id);
          console.log(`[Scheduler] ✅ Recordatorio único enviado a ${reminder.phone_number}`);
        }
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

    // Obtener la hora objetivo del cron diario
    const cronParts = DAILY_DIGEST_CRON.split(/\s+/);
    const targetHour = cronParts.length >= 2 ? parseInt(cronParts[1], 10) : 7;
    const now = new Date();

    for (const user of users) {
      try {
        const tz = user.timezone || 'America/Mexico_City';
        
        // Obtener la hora local actual del usuario en formato 24h
        const localHourStr = new Intl.DateTimeFormat('es-MX', {
          timeZone: tz,
          hour: 'numeric',
          hour12: false,
        }).format(now);
        
        const localHour = parseInt(localHourStr, 10);

        if (localHour === targetHour) {
          console.log(`[Scheduler] ✉️ Es hora (${localHour}:00) para el usuario ${user.phone_number} (TZ: ${tz})`);
          await buildAndSendDigest(user);
        }
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
  const tz = user.timezone || 'America/Mexico_City';
  const { rows: reminders } = await db.query(
    `SELECT * FROM reminders
      WHERE user_id = $1
       AND is_sent = FALSE
       AND (scheduled_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
     ORDER BY scheduled_at ASC`,
    [user.id, tz]
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

  // Job 2: Resumen diario — corre cada hora en punto para verificar husos horarios locales
  cron.schedule('0 * * * *', sendDailyDigest, {
    name: 'daily-digest-timezone-check',
  });

  console.log('✅  Scheduler iniciado:');
  console.log(`   • Recordatorios: cada minuto`);
  console.log(`   • Resumen diario (verificación por huso horario): cada hora en punto`);
}

module.exports = { startScheduler, checkReminders, sendDailyDigest };
