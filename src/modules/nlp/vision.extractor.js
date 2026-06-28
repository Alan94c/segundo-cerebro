'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WHATSAPP_TOKEN } = require('../../config/env');
const { withFallback } = require('./gemini.client');

// Prompt del sistema para extracción de entidades desde imágenes
const VISION_SYSTEM_PROMPT = `
Eres un experto en extracción de información de documentos e imágenes.
Analiza la imagen proporcionada y extrae TODAS las entidades relevantes.

Responde ÚNICAMENTE con un objeto JSON con la siguiente estructura:
{
  "document_type": "factura | recibo | diagrama | evento | producto | otro",
  "summary": "Descripción breve de lo que muestra la imagen",
  "entities": {
    "dates": ["2024-01-15"],
    "amounts": [{"value": 1500.00, "currency": "MXN", "description": "total"}],
    "contacts": [{"name": "Nombre", "phone": "5551234567", "email": "a@b.com"}],
    "locations": ["Calle 5 de Mayo #123, CDMX"],
    "products": [{"name": "Cable UTP Cat6", "quantity": 10, "unit": "metros"}],
    "companies": ["Empresa XYZ S.A. de C.V."],
    "other": []
  },
  "suggested_action": "MEMORIA_LARGO_PLAZO | TAREA_LISTA | EVENTO_CALENDARIO | INVENTARIO_5S",
  "raw_text": "Todo el texto visible en la imagen"
}
`.trim();

/**
 * Descarga un archivo multimedia de WhatsApp Cloud API.
 * @param {string} mediaId - ID del media en WA
 * @returns {Promise<{filePath: string, mimeType: string}>}
 */
async function downloadWhatsAppMedia(mediaId) {
  // 1. Obtener la URL de descarga del media
  const metaRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );

  const { url, mime_type } = metaRes.data;

  // 2. Descargar el archivo binario
  const mediaRes = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });

  // 3. Guardar temporalmente en el sistema de archivos
  const ext = mime_type.split('/')[1] || 'bin';
  const tmpPath = path.join(os.tmpdir(), `wa_media_${mediaId}.${ext}`);
  fs.writeFileSync(tmpPath, Buffer.from(mediaRes.data));

  return { filePath: tmpPath, mimeType: mime_type };
}

/**
 * Analiza una imagen con Gemini Vision y extrae entidades estructuradas.
 * @param {string} mediaId - ID del media de WhatsApp
 * @returns {Promise<Object>} Entidades extraídas en formato JSON
 */
async function extractFromImage(mediaId) {
  let filePath = null;

  try {
    const { filePath: fp, mimeType } = await downloadWhatsAppMedia(mediaId);
    filePath = fp;

    // Leer imagen como base64
    const imageData = fs.readFileSync(fp).toString('base64');

    const result = await withFallback((_, visionModel) =>
      visionModel.generateContent([
        { text: VISION_SYSTEM_PROMPT },
        { inlineData: { mimeType, data: imageData } },
      ])
    );

    let responseText = result.response.text().trim();

    // Extraer JSON robusto: buscar primer { y último } sin importar el markdown
    const firstBrace = responseText.indexOf('{');
    const lastBrace  = responseText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      responseText = responseText.slice(firstBrace, lastBrace + 1);
    }

    return JSON.parse(responseText);
  } catch (err) {
    console.error('[VisionExtractor] Error al procesar imagen:', err.message);
    return {
      document_type: 'otro',
      summary: 'No se pudo procesar la imagen',
      entities: { dates: [], amounts: [], contacts: [], locations: [], products: [], companies: [], other: [] },
      suggested_action: 'MEMORIA_LARGO_PLAZO',
      raw_text: '',
      error: err.message,
    };
  } finally {
    // Limpiar archivo temporal
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

module.exports = { extractFromImage, downloadWhatsAppMedia };
