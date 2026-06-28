'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WHATSAPP_TOKEN, WHATSAPP_API_VERSION } = require('../../config/env');
const { withFallback } = require('./gemini.client');
const { SchemaType } = require('@google/generative-ai');

// Prompt del sistema para extracción de entidades desde imágenes
const VISION_SYSTEM_PROMPT = `
Eres un experto en extracción de información de documentos e imágenes.
Analiza la imagen y extrae la información más relevante de manera estructurada.
`;

const VISION_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    document_type: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    entities: {
      type: SchemaType.OBJECT,
      properties: {
        dates: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        amounts: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        products: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        companies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        locations: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        contacts: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        other: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
      },
      required: ["dates", "amounts", "products", "companies", "locations", "contacts", "other"]
    },
    suggested_action: { type: SchemaType.STRING }
  },
  required: ["document_type", "summary", "entities", "suggested_action"]
};

/**
 * Descarga un archivo multimedia de WhatsApp Cloud API.
 * @param {string} mediaId - ID del media en WA
 * @returns {Promise<{filePath: string, mimeType: string}>}
 */
async function downloadWhatsAppMedia(mediaId) {
  // 1. Obtener la URL de descarga del media
  const metaRes = await axios.get(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}`,
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
      visionModel.generateContent({
        contents: [
          { role: 'user', parts: [
            { text: VISION_SYSTEM_PROMPT },
            { inlineData: { mimeType, data: imageData } }
          ]}
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: VISION_RESPONSE_SCHEMA,
          temperature: 0.1
        }
      })
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
