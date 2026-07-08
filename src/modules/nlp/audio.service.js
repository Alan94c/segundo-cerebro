'use strict';

const fs = require('fs');
const { withFallback } = require('./gemini.client');
const { downloadWhatsAppMedia } = require('./vision.extractor');
const { GEMINI_MODEL } = require('../../config/env');

/**
 * Transcribe un archivo de audio (nota de voz) de WhatsApp usando Gemini 1.5/2.5 Flash.
 * @param {string} mediaId - ID del recurso de audio en WhatsApp
 * @returns {Promise<string>} La transcripción en texto
 */
async function transcribeAudio(mediaId) {
  let filePath = null;

  try {
    console.log(`[AudioService] Descargando audio con ID: ${mediaId}`);
    const downloaded = await downloadWhatsAppMedia(mediaId);
    filePath = downloaded.filePath;
    
    // WhatsApp suele enviar 'audio/ogg; codecs=opus' o similares.
    // Limpiamos el mimeType para que Gemini no lo rechace (solo requiere 'audio/ogg')
    let mimeType = downloaded.mimeType;
    if (mimeType.includes(';')) {
      mimeType = mimeType.split(';')[0].trim();
    }

    console.log(`[AudioService] Archivo de audio descargado en: ${filePath} | MimeType original: ${downloaded.mimeType} -> MimeType limpio: ${mimeType}`);

    // Leer el archivo como base64
    const audioBase64 = fs.readFileSync(filePath).toString('base64');

    // Prompt del sistema para la transcripción
    const prompt = 'Transcribe textualmente y de manera exacta esta nota de voz en español. No agregues comentarios introductorios ni explicaciones. Si el audio contiene solo ruido o no se entiende nada, devuelve una cadena vacía "".';

    console.log('[AudioService] Enviando audio a Gemini para transcripción...');
    const result = await withFallback(async (textModel, visionModel, genAIInstance) => {
      // Obtenemos un modelo limpio sin responseMimeType forzado a JSON
      const model = genAIInstance.getGenerativeModel({ model: GEMINI_MODEL });
      return model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: audioBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.0 // Cero temperatura para transcripción exacta y determinista
        }
      });
    });

    const transcription = result.response.text().trim();
    console.log(`[AudioService] Transcripción completada: "${transcription}"`);
    return transcription;
  } catch (err) {
    console.error('[AudioService] Error al transcribir el audio:', err.message, err.stack);
    throw err;
  } finally {
    // Eliminar el archivo temporal
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[AudioService] Archivo temporal eliminado: ${filePath}`);
      } catch (cleanupErr) {
        console.warn('[AudioService] No se pudo eliminar el archivo temporal:', cleanupErr.message);
      }
    }
  }
}

module.exports = { transcribeAudio };
