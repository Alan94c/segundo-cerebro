'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY, GEMINI_API_KEY_BACKUP, GEMINI_MODEL } = require('../../config/env');

// ============================================================
// Sistema de respaldo automático de API Keys
// Si la clave principal falla por cuota (429), usa la de respaldo
// ============================================================

function createModels(apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return {
    textModel: genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }),
    // Vision con JSON forzado para garantizar respuesta válida
    visionModel: genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    }),
    genAI,
  };
}

const primary   = createModels(GEMINI_API_KEY);
const backup    = GEMINI_API_KEY_BACKUP ? createModels(GEMINI_API_KEY_BACKUP) : null;

let usingBackup = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta una llamada a Gemini con fallback automático y reintentos para errores temporales (429/503).
 * @param {Function} fn - async (textModel, visionModel) => result
 */
async function withFallback(fn) {
  let retries = 3;
  let delay = 1000;

  while (retries > 0) {
    const current = usingBackup && backup ? backup : primary;
    try {
      const result = await fn(current.textModel, current.visionModel, current.genAI);
      if (usingBackup) {
        console.log('[Gemini] ✅ Respondiendo con clave de respaldo');
      }
      return result;
    } catch (err) {
      const errStatus = err?.status || (err?.message && err.message.includes('429') ? 429 : err.message.includes('503') ? 503 : null);
      const isTransient = errStatus === 429 || errStatus === 503 || 
                          (err?.message && (err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('temp') || err.message.toLowerCase().includes('demand')));

      retries--;

      // Si es error de cuota 429 y tenemos backup sin usar, cambiamos a backup inmediatamente sin esperar
      if (errStatus === 429 && backup && !usingBackup) {
        console.warn('[Gemini] ⚠️ Clave principal agotada (429). Cambiando a clave de respaldo...');
        usingBackup = true;
        retries++; // No consumimos reintento al cambiar de clave
        continue;
      }

      // Si es un error transitorio y quedan reintentos, esperamos y reintentamos
      if (isTransient && retries > 0) {
        console.warn(`[Gemini] ⚠️ Error temporal (${errStatus || err.message}). Reintentando en ${delay}ms... (Intentos restantes: ${retries})`);
        await sleep(delay);
        delay *= 2; // Backoff exponencial
        continue;
      }

      throw err;
    }
  }
}

// Exporta los modelos de la clave activa directamente
// y la función withFallback para llamadas que necesiten resiliencia
const textModel   = primary.textModel;
const visionModel = primary.visionModel;
const genAI       = primary.genAI;

module.exports = { textModel, visionModel, genAI, withFallback };
