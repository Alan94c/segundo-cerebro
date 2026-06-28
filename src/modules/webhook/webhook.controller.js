'use strict';

const db = require('../../config/db');
const { classifyIntent } = require('../nlp/intent.router');
const { extractFromImage } = require('../nlp/vision.extractor');
const { dispatch } = require('../nlp/action.dispatcher');
const whatsappService = require('../whatsapp/whatsapp.service');
const memoryService = require('../memory/memory.service');

// ============================================================
// Controlador Principal del Webhook
// ============================================================

/**
 * Maneja todos los mensajes entrantes de WhatsApp Cloud API.
 * Responde 200 inmediatamente (requisito de Meta) y procesa en background.
 */
async function handleIncoming(req, res) {
  console.log('[Webhook] 📥 Petición POST recibida en el webhook');
  console.log('[Webhook] Payload body:', JSON.stringify(req.body, null, 2));

  // Meta requiere 200 en < 5 segundos — responder PRIMERO, procesar después
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    // Validar estructura básica del payload de WA
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Ignorar notificaciones de estado (delivered, read, etc.)
    if (!value?.messages || value.messages.length === 0) return;

    const message = value.messages[0];
    const phoneNumber = message.from; // Número del remitente
    const messageId = message.id;
    const messageType = message.type;

    console.log(`[Webhook] 📨 Mensaje recibido | Tipo: ${messageType} | De: ${phoneNumber}`);

    // Marcar como leído (doble palomita azul)
    await whatsappService.markAsRead(messageId);

    // Obtener o registrar al usuario
    const user = await findOrCreateUser(phoneNumber);

    // Procesar según el tipo de mensaje
    switch (messageType) {
      case 'text':
        await processTextMessage(user, phoneNumber, message.text.body);
        break;

      case 'image':
      case 'document':
        await processMediaMessage(user, phoneNumber, message[messageType], messageType);
        break;

      case 'audio':
        // Gemini no transcribe audio directamente desde WA
        // Informar al usuario y guardar el hecho
        await whatsappService.sendTextMessage(
          phoneNumber,
          '🎙️ Recibí tu nota de voz. Por ahora, por favor envía tu mensaje en texto. La transcripción automática estará disponible pronto.'
        );
        break;

      case 'interactive':
        await processInteractiveMessage(user, phoneNumber, message.interactive);
        break;

      default:
        console.log(`[Webhook] Tipo de mensaje no soportado: ${messageType}`);
        await whatsappService.sendTextMessage(
          phoneNumber,
          '📎 Recibí tu mensaje pero aún no puedo procesar ese tipo de contenido. ¿Puedes enviarlo como texto?'
        );
    }
  } catch (err) {
    console.error('[Webhook] Error procesando mensaje:', err.message, err.stack);
  }
}

// ============================================================
// Procesadores por tipo de mensaje
// ============================================================

/**
 * Procesa un mensaje de texto a través del pipeline NLP.
 */
async function processTextMessage(user, phoneNumber, text) {
  // Ignorar mensajes muy cortos o de estado
  if (!text || text.trim().length < 2) return;

  // Clasificar intención con Gemini, inyectando la fecha y hora actual para cálculos relativos
  const now = new Date();
  const localTimeStr = now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  const intentResult = await classifyIntent(
    text,
    `Nombre del usuario: ${user.name || phoneNumber}\nFecha y hora actual (local): ${localTimeStr}\nFecha y hora actual (UTC): ${now.toISOString()}`
  );

  // Despachar la acción correspondiente
  await dispatch(user.id, phoneNumber, intentResult);
}

/**
 * Procesa imágenes y documentos con Gemini Vision.
 */
async function processMediaMessage(user, phoneNumber, mediaPayload, mediaType) {
  const mediaId = mediaPayload.id;

  await whatsappService.sendTextMessage(
    phoneNumber,
    '🔍 Analizando tu imagen con IA... Un momento.'
  );

  try {
    const extracted = await extractFromImage(mediaId);

    // Guardar la extracción en la BD
    await db.query(
      `INSERT INTO media_extractions (user_id, media_type, extracted_data, raw_text)
       VALUES ($1, $2, $3, $4)`,
      [user.id, mediaType, JSON.stringify(extracted), extracted.raw_text || '']
    );

    // Guardar como memoria si hay contenido útil
    if (extracted.summary && extracted.summary !== 'No se pudo procesar la imagen') {
      const content = `[Imagen] ${extracted.summary}. ${extracted.raw_text || ''}`.trim();
      await memoryService.saveFact(user.id, content, [extracted.document_type, 'imagen']);
    }

    // Responder con el resumen de lo extraído
    const entityCount = Object.values(extracted.entities || {})
      .flat().filter(Boolean).length;

    // Si hubo error, mostrarlo para debug
    if (extracted.error) {
      await whatsappService.sendTextMessage(phoneNumber,
        `⚠️ *Error al analizar imagen:*\n\`${extracted.error}\``
      );
      return;
    }

    const response = `
✅ *Imagen procesada*
📄 Tipo: ${extracted.document_type}
📝 Resumen: ${extracted.summary}
🔍 Entidades encontradas: ${entityCount}

Todo ha sido guardado en tu memoria. Puedes preguntarme sobre este documento cuando quieras.
    `.trim();

    await whatsappService.sendTextMessage(phoneNumber, response);
  } catch (err) {
    console.error('[Webhook] Error procesando imagen:', err.message);
    await whatsappService.sendTextMessage(
      phoneNumber,
      '❌ No pude analizar la imagen. ¿Puedes describirla en texto?'
    );
  }
}

/**
 * Procesa respuestas de mensajes interactivos (botones/listas).
 */
async function processInteractiveMessage(user, phoneNumber, interactive) {
  const responseId = interactive.button_reply?.id || interactive.list_reply?.id;
  const responseTitle = interactive.button_reply?.title || interactive.list_reply?.title;

  // Tratar la respuesta como texto para el NLP router
  if (responseTitle) {
    await processTextMessage(user, phoneNumber, responseTitle);
  }
}

// ============================================================
// Gestión de Usuarios
// ============================================================

/**
 * Busca un usuario por número de teléfono.
 * Si no existe, lo registra automáticamente (auto-onboarding).
 *
 * @param {string} phoneNumber - Número en formato internacional
 * @returns {Promise<Object>} El usuario (nuevo o existente)
 */
async function findOrCreateUser(phoneNumber) {
  const { rows } = await db.query(
    `SELECT * FROM users WHERE phone_number = $1`,
    [phoneNumber]
  );

  if (rows.length > 0) return rows[0];

  // Auto-registro del nuevo usuario
  const { rows: newUser } = await db.query(
    `INSERT INTO users (phone_number) VALUES ($1) RETURNING *`,
    [phoneNumber]
  );

  const user = newUser[0];
  console.log(`[Webhook] 🆕 Nuevo usuario registrado: ${phoneNumber}`);

  // Mensaje de bienvenida
  await whatsappService.sendTextMessage(
    phoneNumber,
    `👋 ¡Hola! Soy tu *Segundo Cerebro* 🧠\n\nPuedo ayudarte a:\n• 📝 Guardar información importante\n• ✅ Crear tareas y listas\n• 🔔 Programar recordatorios\n• 📅 Agregar eventos a tu calendario\n• 📦 Rastrear la ubicación de tus objetos\n\nSimplemente escríbeme en lenguaje natural. ¡Adelante!`
  );

  return user;
}

module.exports = { handleIncoming };
