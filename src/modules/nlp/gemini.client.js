'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GEMINI_API_KEY, GEMINI_MODEL } = require('../../config/env');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

/**
 * Modelo de texto principal (gemini-1.5-flash por defecto).
 * Configurado para devolver JSON estructurado de forma confiable.
 */
const textModel = genAI.getGenerativeModel({
  model: GEMINI_MODEL,
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.1,   // Baja temperatura = salidas más deterministas
    maxOutputTokens: 2048,
  },
});

/**
 * Modelo multimodal para análisis de imágenes (Gemini Vision).
 * Usa gemini-1.5-flash que soporta imágenes nativamente.
 */
const visionModel = genAI.getGenerativeModel({
  model: GEMINI_MODEL,
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.2,
    maxOutputTokens: 4096,
  },
});

module.exports = { textModel, visionModel, genAI };
