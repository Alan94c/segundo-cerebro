'use strict';

const axios = require('axios');
const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_API_VERSION,
} = require('../../config/env');

const BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

const headers = {
  'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

// ============================================================
// Funciones de ayuda
// ============================================================

/**
 * Formatea el número de destino para compatibilidad con el Sandbox de Meta.
 * Para números de México, remueve el prefijo '1' que Meta inserta en los webhooks entrantes (521...)
 * pero que rechaza al enviar de vuelta si el número está registrado como '52...' en la lista.
 */
function formatNumber(to) {
  if (to && to.startsWith('521') && to.length === 13) {
    return '52' + to.substring(3);
  }
  return to;
}

// ============================================================
// Funciones de envío
// ============================================================

/**
 * Envía un mensaje de texto simple.
 * @param {string} to   - Número de destino en formato internacional (ej: 521234567890)
 * @param {string} text - Texto del mensaje (soporta *negrita* y _cursiva_ de WA)
 */
async function sendTextMessage(to, text) {
  const formattedTo = formatNumber(to);
  try {
    const { data } = await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedTo,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      { headers }
    );
    return data;
  } catch (err) {
    console.error('[WhatsApp] Error enviando mensaje de texto:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Envía un mensaje con botones de respuesta rápida.
 * @param {string} to       - Número de destino
 * @param {string} body     - Texto del mensaje
 * @param {Array}  buttons  - Array de {id, title} (máx 3 botones en WA)
 */
async function sendButtonMessage(to, body, buttons) {
  const formattedTo = formatNumber(to);
  const waButtons = buttons.slice(0, 3).map((btn) => ({
    type: 'reply',
    reply: { id: btn.id, title: btn.title.substring(0, 20) }, // WA limita a 20 chars
  }));

  try {
    const { data } = await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedTo,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: { buttons: waButtons },
        },
      },
      { headers }
    );
    return data;
  } catch (err) {
    console.error('[WhatsApp] Error enviando mensaje con botones:', err.response?.data || err.message);
    // Fallback a texto si los botones fallan
    return sendTextMessage(formattedTo, body);
  }
}

/**
 * Envía un mensaje de lista (menú desplegable) en WhatsApp.
 * @param {string} to       - Número de destino
 * @param {string} body     - Texto del cuerpo
 * @param {string} btnText  - Texto del botón de la lista
 * @param {Array}  sections - Array de {title, rows: [{id, title, description}]}
 */
async function sendListMessage(to, body, btnText, sections) {
  const formattedTo = formatNumber(to);
  try {
    const { data } = await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedTo,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: btnText.substring(0, 20),
            sections,
          },
        },
      },
      { headers }
    );
    return data;
  } catch (err) {
    console.error('[WhatsApp] Error enviando lista:', err.response?.data || err.message);
    return sendTextMessage(formattedTo, body);
  }
}

/**
 * Obtiene la URL de descarga de un archivo multimedia de WhatsApp.
 * @param {string} mediaId - ID del media en WhatsApp
 * @returns {Promise<{url: string, mimeType: string}>}
 */
async function getMediaUrl(mediaId) {
  const { data } = await axios.get(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`,
    { headers }
  );
  return { url: data.url, mimeType: data.mime_type, fileSize: data.file_size };
}

/**
 * Marca un mensaje como "leído" (doble palomita azul en WA).
 * @param {string} messageId - ID del mensaje recibido
 */
async function markAsRead(messageId) {
  try {
    await axios.post(
      BASE_URL,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      { headers }
    );
  } catch {
    // No crítico — ignorar si falla
  }
}

module.exports = {
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  getMediaUrl,
  markAsRead,
};
