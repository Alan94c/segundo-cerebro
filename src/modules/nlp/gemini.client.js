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
    visionModel: genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    }),
    genAI,
  };
}

const primary   = createModels(GEMINI_API_KEY);
const backup    = GEMINI_API_KEY_BACKUP ? createModels(GEMINI_API_KEY_BACKUP) : null;

let usingBackup = false;

/**
 * Ejecuta una llamada a Gemini con fallback automático.
 * Si la clave principal devuelve 429, cambia a la clave de respaldo.
 * @param {Function} fn - async (textModel, visionModel) => result
 */
async function withFallback(fn) {
  const current = usingBackup && backup ? backup : primary;

  try {
    const result = await fn(current.textModel, current.visionModel, current.genAI);
    // Si estábamos en backup y funcionó, log informativo
    if (usingBackup) {
      console.log('[Gemini] ✅ Respondiendo con clave de respaldo');
    }
    return result;
  } catch (err) {
    const isQuotaError = err?.status === 429 ||
      (err?.message && err.message.includes('429')) ||
      (err?.message && err.message.toLowerCase().includes('quota'));

    if (isQuotaError && backup && !usingBackup) {
      console.warn('[Gemini] ⚠️  Clave principal agotada (429). Cambiando a clave de respaldo...');
      usingBackup = true;
      // Reintenta con el backup
      return await fn(backup.textModel, backup.visionModel, backup.genAI);
    }

    throw err;
  }
}

// Exporta los modelos de la clave activa directamente
// y la función withFallback para llamadas que necesiten resiliencia
const textModel   = primary.textModel;
const visionModel = primary.visionModel;
const genAI       = primary.genAI;

module.exports = { textModel, visionModel, genAI, withFallback };
