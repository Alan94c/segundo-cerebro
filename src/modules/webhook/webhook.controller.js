'use strict';

const db = require('../../config/db');
const { classifyIntent } = require('../nlp/intent.router');
const { extractFromImage } = require('../nlp/vision.extractor');
const { dispatch } = require('../nlp/action.dispatcher');
const whatsappService = require('../whatsapp/whatsapp.service');
const memoryService = require('../memory/memory.service');
const historyService = require('../memory/history.service');
const audioService = require('../nlp/audio.service');

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
        try {
          // Informar al usuario que se está procesando
          await whatsappService.sendTextMessage(
            phoneNumber,
            '🎙️ Procesando nota de voz... Un momento.'
          );

          const transcription = await audioService.transcribeAudio(message.audio.id);

          if (!transcription || transcription.trim() === '') {
            await whatsappService.sendTextMessage(
              phoneNumber,
              '🤷 No logré entender el audio. ¿Podrías intentar grabarlo de nuevo o escribir tu mensaje?'
            );
            break;
          }

          // Re-inyectar al pipeline de texto
          await processTextMessage(user, phoneNumber, transcription, `[Nota de voz] ${transcription}`);
        } catch (audioErr) {
          console.error('[Webhook] Error transcribiendo audio:', audioErr.message);
          await whatsappService.sendTextMessage(
            phoneNumber,
            '❌ Ocurrió un error al procesar tu nota de voz. Por favor, intenta de nuevo o escribe tu mensaje en texto.'
          );
        }
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
async function processTextMessage(user, phoneNumber, text, logText = null) {
  // Ignorar mensajes muy cortos o de estado
  if (!text || text.trim().length < 2) return;

  // Obtener el historial reciente del usuario para contexto de la conversación
  const recentMessages = await historyService.getRecentHistory(user.id, 6);
  const historyContext = recentMessages.map(m => `${m.sender === 'user' ? 'Usuario' : 'Asistente'}: "${m.content}"`).join('\n');

  // Guardar mensaje entrante del usuario en el historial (usando logText si se provee, p. ej. para notas de voz)
  await historyService.logMessage(user.id, 'user', logText || text);

  // Clasificar intención con Gemini, inyectando historial y fecha actual para cálculos relativos
  const now = new Date();
  const tz = user.timezone || 'America/Mexico_City';
  const localTimeStr = now.toLocaleString('es-MX', { timeZone: tz });
  const fullContext = `Nombre del usuario: ${user.name || phoneNumber}
Zona horaria del usuario: ${tz}
Fecha y hora actual (local): ${localTimeStr}
Fecha y hora actual (UTC): ${now.toISOString()}

HISTORIAL RECIENTE DE LA CONVERSACIÓN:
${historyContext || 'No hay mensajes previos.'}`;

  const intentResult = await classifyIntent(text, fullContext);

  // Despachar la acción correspondiente
  await dispatch(user.id, phoneNumber, intentResult);
}

/**
 * Procesa imágenes y documentos con Gemini Vision.
 */
async function processMediaMessage(user, phoneNumber, mediaPayload, mediaType) {
  const mediaId = mediaPayload.id;

  // Log incoming image virtual message
  await historyService.logMessage(user.id, 'user', `[Envió una imagen/documento]`);

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

    // Si hubo error, mostrar mensaje amigable
    if (extracted.error) {
      const errResponse = '❌ Por el momento no pude analizar la imagen debido a una sincronización en el servicio de Google. Por favor, intenta de nuevo en unos minutos.';
      await whatsappService.sendTextMessage(phoneNumber, errResponse);
      await historyService.logMessage(user.id, 'bot', errResponse);
      return;
    }

    const response = `
✅ *Imagen procesada*
📄 Tipo: ${extracted.document_type}
📝 Resumen: ${extracted.summary}

Todo ha sido guardado en tu memoria. Puedes preguntarme sobre este documento cuando quieras.
    `.trim();

    await whatsappService.sendTextMessage(phoneNumber, response);
    await historyService.logMessage(user.id, 'bot', response);
  } catch (err) {
    console.error('[Webhook] Error procesando imagen:', err.message);
    const failResponse = '❌ No pude analizar la imagen. ¿Puedes describirla en texto?';
    await whatsappService.sendTextMessage(phoneNumber, failResponse);
    await historyService.logMessage(user.id, 'bot', failResponse);
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

  // Auto-registro del nuevo usuario con control de concurrencia
  const { rows: newUser } = await db.query(
    `INSERT INTO users (phone_number) 
     VALUES ($1) 
     ON CONFLICT (phone_number) 
     DO NOTHING 
     RETURNING *`,
    [phoneNumber]
  );

  if (newUser.length === 0) {
    // Si no se insertó nada, significa que otro hilo lo insertó primero.
    // Buscamos y retornamos el usuario existente sin enviar duplicado el mensaje de bienvenida.
    const { rows: existingUser } = await db.query(
      `SELECT * FROM users WHERE phone_number = $1`,
      [phoneNumber]
    );
    return existingUser[0];
  }

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
