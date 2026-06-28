'use strict';

const memoryService = require('../memory/memory.service');
const inventoryService = require('../memory/inventory.service');
const taskService = require('../tasks/list.service');
const reminderService = require('../tasks/reminder.service');
const calendarService = require('../calendar/calendar.service');
const whatsappService = require('../whatsapp/whatsapp.service');
const db = require('../../config/db');

/**
 * Despacha la acción correcta según la intención clasificada por Gemini.
 * @param {string} userId   - UUID del usuario en la BD
 * @param {string} phone    - Número de teléfono del usuario (para respuesta WA)
 * @param {Object} intentResult - Resultado del intent router
 */
async function dispatch(userId, phone, intentResult) {
  const { intent, extracted_data: data, response_to_user: responseText } = intentResult;

  console.log(`[Dispatcher] Intent="${intent}" | User="${phone}"`);

  try {
    switch (intent) {
      case 'MEMORIA_LARGO_PLAZO':
        await handleMemory(userId, data);
        break;

      case 'RECORDATORIO':
        await handleReminder(userId, data);
        break;

      case 'TAREA_LISTA':
        await handleTask(userId, data);
        break;

      case 'EVENTO_CALENDARIO':
        await handleCalendar(userId, data);
        break;

      case 'INVENTARIO_5S':
        await handleInventory(userId, phone, data);
        return; // handleInventory envía su propio mensaje

      case 'CONSULTA':
        await handleQuery(userId, phone, data);
        return; // handleQuery envía su propio mensaje

      case 'CANCELAR':
        await handleCancel(userId, phone, data);
        return; // handleCancel envía su propio mensaje

      case 'CONVERSACION':
        // Solo responder el texto generado por Gemini
        break;

      case 'DESCONOCIDO':
      default:
        // Guardar como memoria por si acaso y responder con texto genérico
        await memoryService.saveFact(userId, data.description || data.title, data.tags || []);
        break;
    }

    // Respuesta genérica de confirmación generada por Gemini
    await whatsappService.sendTextMessage(phone, responseText);
  } catch (err) {
    console.error(`[Dispatcher] Error procesando intent "${intent}":`, err.message);
    await whatsappService.sendTextMessage(
      phone,
      '⚠️ Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo.'
    );
  }
}

// ============================================================
// Handlers por intención
// ============================================================

async function handleMemory(userId, data) {
  await memoryService.saveFact(
    userId,
    data.description || data.title,
    data.tags || []
  );
}

async function handleReminder(userId, data) {
  // Crear tarea si hay descripción de tarea
  let taskId = null;
  if (data.title) {
    const task = await taskService.addTask(null, userId, userId, data.title, data.description, data.datetime);
    taskId = task.id;
  }

  // Crear el recordatorio con fecha
  if (data.datetime) {
    await reminderService.createReminder(
      userId,
      data.description || data.title,
      new Date(data.datetime),
      taskId
    );
  }
}

async function handleTask(userId, data) {
  // Buscar o crear la lista mencionada
  let listId = null;
  if (data.list_name) {
    const list = await taskService.findOrCreateList(userId, data.list_name);
    listId = list.id;
  }

  await taskService.addTask(
    listId,
    userId,
    userId,
    data.title || data.description,
    data.description,
    data.datetime || null
  );
}

async function handleCalendar(userId, data) {
  try {
    await calendarService.createEvent(
      userId,
      data.title,
      data.datetime,
      null, // endDateTime — Gemini puede extraerlo en el futuro
      data.description
    );
  } catch (calErr) {
    // Si Google Calendar no está vinculado, guardar como recordatorio local
    if (calErr.code === 'NO_GOOGLE_TOKEN') {
      console.warn('[Dispatcher] Google Calendar no vinculado. Guardando como recordatorio.');
      await reminderService.createReminder(
        userId,
        `📅 Evento: ${data.title}\n${data.description || ''}`,
        new Date(data.datetime)
      );
    } else {
      throw calErr;
    }
  }
}

async function handleInventory(userId, phone, data) {
  const updated = await inventoryService.upsertItem(
    userId,
    data.item_name,
    data.location,
    data.description
  );
  await whatsappService.sendTextMessage(
    phone,
    `📦 *${updated.item_name}* registrado en: _${updated.current_location}_\n✅ Ubicación actualizada.`
  );
}

async function handleQuery(userId, phone, data) {
  let responseMsg = '';

  if (data.query_type === 'inventory') {
    const searchTerm = data.item_name || data.title || data.description;
    const item = await inventoryService.findItem(userId, searchTerm);
    if (item) {
      responseMsg = `📦 *${item.item_name}*\n📍 Ubicación: _${item.current_location}_\n🕐 Visto por última vez: ${new Date(item.last_seen_at).toLocaleString('es-MX')}`;
    } else {
      responseMsg = `🔍 No encontré ningún objeto que coincida con "${searchTerm}". ¿Puedes ser más específico?`;
    }
  } else {
    // Búsqueda en memorias
    const memories = await memoryService.searchFacts(userId, data.title || data.description);
    if (memories.length > 0) {
      const items = memories.slice(0, 3).map((m, i) => `${i + 1}. ${m.content}`).join('\n');
      responseMsg = `🧠 Encontré esto en tu memoria:\n\n${items}`;
    } else {
      responseMsg = `🔍 No encontré información sobre "${data.title}" en tu memoria.`;
    }
  }

  await whatsappService.sendTextMessage(phone, responseMsg);
}

async function handleCancel(userId, phone, data) {
  let responseMsg = '';
  const searchTerm = data.item_name || data.title || data.description;

  if (data.query_type === 'inventory') {
    const item = await inventoryService.findItem(userId, searchTerm);
    if (item) {
      const deleted = await inventoryService.deleteItem(item.id, userId);
      responseMsg = deleted
        ? `🗑️ Objeto *${item.item_name}* eliminado del inventario.`
        : `⚠️ No se pudo eliminar *${item.item_name}*.`;
    } else {
      responseMsg = `🔍 No encontré ningún objeto en el inventario que coincida con "${searchTerm}".`;
    }
  } else if (data.query_type === 'tasks') {
    // Cancelar tarea
    const { rows } = await db.query(
      `SELECT * FROM tasks WHERE user_id = $1 AND is_completed = FALSE AND (title ILIKE $2 OR description ILIKE $2) LIMIT 1`,
      [userId, `%${searchTerm}%`]
    );
    if (rows.length > 0) {
      const task = rows[0];
      await db.query(`DELETE FROM tasks WHERE id = $1`, [task.id]);
      responseMsg = `🗑️ Tarea *${task.title}* eliminada de tus pendientes.`;
    } else {
      responseMsg = `🔍 No encontré ninguna tarea pendiente que coincida con "${searchTerm}".`;
    }
  } else {
    // Por defecto: recordatorios (reminders)
    // Buscar un recordatorio activo
    const { rows } = await db.query(
      `SELECT * FROM reminders WHERE user_id = $1 AND is_sent = FALSE AND message ILIKE $2 ORDER BY scheduled_at ASC LIMIT 1`,
      [userId, `%${searchTerm}%`]
    );
    if (rows.length > 0) {
      const reminder = rows[0];
      await reminderService.cancelReminder(reminder.id, userId);
      responseMsg = `🗑️ Recordatorio de *${reminder.message}* cancelado con éxito.`;
    } else {
      responseMsg = `🔍 No encontré ningún recordatorio pendiente para "${searchTerm}".`;
    }
  }

  await whatsappService.sendTextMessage(phone, responseMsg);
}

module.exports = { dispatch };
