'use strict';

const { textModel } = require('./gemini.client');

// ============================================================
// Prompt del Sistema — El "Cerebro" del enrutador NLP
// ============================================================
const ROUTER_SYSTEM_PROMPT = `
Eres el motor de clasificación inteligente del "Segundo Cerebro", un asistente personal avanzado.
Tu ÚNICA función es analizar mensajes de texto del usuario y responder con un JSON estructurado.

INTENCIONES DISPONIBLES:
- RECORDATORIO: El usuario quiere que se le recuerde algo en una fecha/hora específica o relativa
- MEMORIA_LARGO_PLAZO: El usuario comparte un dato, hecho, cifra, o información para guardar y recordar después
- TAREA_LISTA: El usuario quiere agregar algo a una lista de pendientes o tareas (sin fecha específica crítica)
- EVENTO_CALENDARIO: El usuario menciona un evento, cita, reunión, mantenimiento o actividad con fecha/hora para el calendario
- INVENTARIO_5S: El usuario registra o pregunta por la ubicación física de un objeto o herramienta
- CONSULTA: El usuario hace una pregunta sobre información previamente guardada
- CANCELAR: El usuario quiere eliminar, borrar, cancelar o desactivar un recordatorio, tarea, evento o ítem de inventario
- CONVERSACION: Saludo, agradecimiento o mensaje informal sin acción específica
- DESCONOCIDO: No se puede determinar la intención con claridad

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown, sin explicaciones
2. Si el mensaje menciona fecha/hora + tarea = RECORDATORIO (no TAREA_LISTA)
3. Si el mensaje menciona fecha/hora + evento social/trabajo = EVENTO_CALENDARIO
4. Para INVENTARIO_5S con pregunta de "¿dónde está X?" usa intent=CONSULTA y query_type="inventory"
5. Calcula las fechas relativas o absolutas basándote en la fecha/hora UTC provista y devuélvelas SIEMPRE en formato ISO 8601 con indicador de zona UTC (añadiendo la letra 'Z' al final), por ejemplo: '2026-06-28T09:33:00Z'. Nunca omitas la 'Z'.
6. El campo "response_to_user" debe ser cordial, breve y en español latinoamericano

ESQUEMA DE RESPUESTA:
{
  "intent": "UNA_DE_LAS_INTENCIONES_LISTADAS",
  "confidence": 0.95,
  "extracted_data": {
    "title": "Título o resumen corto de la acción",
    "description": "Descripción completa extraída del mensaje",
    "datetime": "2024-01-15T14:00:00Z" | null,
    "list_name": "Nombre de la lista si aplica" | null,
    "item_name": "Nombre del objeto (para inventario)" | null,
    "location": "Ubicación del objeto (para inventario)" | null,
    "tags": ["etiqueta1", "etiqueta2"],
    "priority": "low | normal | high | urgent",
    "related_contact": "número o nombre si menciona a alguien más" | null,
    "query_type": "inventory | memory | tasks | reminders" | null
  },
  "response_to_user": "Mensaje amigable confirmando la acción o respondiendo la consulta"
}
`.trim();

/**
 * Clasifica la intención del usuario a partir de un mensaje de texto.
 * @param {string} message  - Texto del usuario
 * @param {string} [context] - Contexto adicional (historial reciente, nombre del usuario, etc.)
 * @returns {Promise<IntentResult>}
 */
async function classifyIntent(message, context = '') {
  const contextBlock = context
    ? `\n\nCONTEXTO ADICIONAL:\n${context}`
    : '';

  const prompt = `${ROUTER_SYSTEM_PROMPT}${contextBlock}\n\nMENSAJE DEL USUARIO:\n"${message}"`;

  try {
    const result = await textModel.generateContent(prompt);
    const rawText = result.response.text();
    const parsed = JSON.parse(rawText);

    // Validación básica de estructura
    if (!parsed.intent || !parsed.extracted_data) {
      throw new Error('Respuesta de Gemini con estructura inválida');
    }

    return parsed;
  } catch (err) {
    console.error('[IntentRouter] Error al clasificar intención:', err.message);

    // Fallback seguro — no interrumpir el flujo
    return {
      intent: 'DESCONOCIDO',
      confidence: 0,
      extracted_data: {
        title: message.substring(0, 100),
        description: message,
        datetime: null,
        list_name: null,
        item_name: null,
        location: null,
        tags: [],
        priority: 'normal',
        related_contact: null,
        query_type: null,
      },
      response_to_user: 'Entendido, guardé tu mensaje. ¿Puedes darme más detalles sobre lo que necesitas?',
    };
  }
}

module.exports = { classifyIntent };
