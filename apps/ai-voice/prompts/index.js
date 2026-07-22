'use strict';

/**
 * prompts/index.js — Prompt Builder
 *
 * WHAT IT DOES:
 *   Takes the current session state (conversation history, active form field,
 *   user's latest transcript) and assembles the messages[] array that gets
 *   sent to Ollama's /api/chat endpoint.
 *
 * THE MESSAGES ARRAY STRUCTURE:
 *
 *   Every call to Ollama's /api/chat includes the full conversation
 *   history in a messages array. The structure is:
 *
 *   [
 *     { role: 'system',    content: '<persona + rules>'          },  ← set once
 *     { role: 'system',    content: '<current field context>'    },  ← updated per field
 *     { role: 'assistant', content: 'Hello! I will guide you...' },  ← previous turns
 *     { role: 'user',      content: 'My name is John'           },  ← previous turns
 *     { role: 'assistant', content: 'Got it John. Date of birth?'},  ← previous turns
 *     { role: 'user',      content: '<latest transcript>'        },  ← current user input
 *   ]
 *
 * WHY TWO SYSTEM MESSAGES:
 *   The first system message is the permanent persona — it never changes.
 *   The second system message is the field context — it changes every time
 *   the Chrome Extension tells us the active field changed.
 *   Keeping them separate makes it easy to update one without rebuilding both.
 *
 * HISTORY WINDOW:
 *   We don't send ALL history — only the last N turns. LLMs have a context
 *   window limit, and old turns from 5 fields ago are irrelevant noise.
 *   HISTORY_WINDOW = 6 means the last 3 user + 3 assistant messages.
 */

const templates = require('./templates');
const logger    = require('../utils/logger');

/** How many recent messages (user + assistant pairs) to include in context */
const HISTORY_WINDOW = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the messages[] array for an Ollama /api/chat call.
 *
 * Called by the voice pipeline on every conversation turn, right before
 * calling llm.chat().
 *
 * @param {object} context
 * @param {string} context.transcript       - Latest user utterance from Whisper STT
 * @param {object} context.fieldContext     - Current form field (from Chrome Extension)
 * @param {Array}  context.history          - Previous messages [{role, content}, ...]
 * @param {string} [context.intentOverride] - Special intent: 'greeting' | 'clarification' | 'completion'
 *
 * @returns {Array<{ role: string, content: string }>} Messages array ready for llm.chat()
 */
function buildMessages(context) {
  const {
    transcript,
    fieldContext,
    history        = [],
    intentOverride = null,
  } = context;

  // ── Validate inputs ─────────────────────────────────────────────────────
  if (!intentOverride && (!transcript || typeof transcript !== 'string')) {
    throw new Error('[Prompt] buildMessages() requires a transcript string');
  }

  const messages = [];

  // ── 1. System Persona (always first, always the same) ───────────────────
  messages.push({
    role:    'system',
    content: templates.systemPrompt(),
  });

  // ── 2. Field Context (updated whenever the active field changes) ─────────
  if (fieldContext && Object.keys(fieldContext).length > 0) {
    messages.push({
      role:    'system',
      content: templates.fieldContextPrompt(fieldContext),
    });
  }

  // ── 3. Conversation History (sliding window — last N messages) ───────────
  //    We take the tail of history to stay within the LLM context window.
  //    Older turns from previous fields don't help and waste tokens.
  if (history.length > 0) {
    const window = history.slice(-HISTORY_WINDOW);
    messages.push(...window);

    if (history.length > HISTORY_WINDOW) {
      logger.debug('Prompt: history trimmed to window', {
        total:  history.length,
        window: HISTORY_WINDOW,
        dropped: history.length - HISTORY_WINDOW,
      });
    }
  }

  // ── 4. Current User Turn ─────────────────────────────────────────────────
  //    intentOverride lets the voice pipeline inject special instructions
  //    without a real user utterance (e.g. on call connect → greeting).
  if (intentOverride === 'greeting') {
    messages.push({
      role:    'user',
      content: templates.greetingPrompt(fieldContext?.formName),
    });

  } else if (intentOverride === 'clarification') {
    messages.push({
      role:    'user',
      content: templates.clarificationPrompt(),
    });

  } else if (intentOverride === 'completion') {
    messages.push({
      role:    'user',
      content: templates.completionPrompt(),
    });

  } else {
    // Normal turn: the user spoke and STT produced a transcript
    messages.push({
      role:    'user',
      content: transcript.trim(),
    });
  }

  logger.debug('Prompt: messages array built', {
    total:         messages.length,
    systemCount:   messages.filter((m) => m.role === 'system').length,
    historyWindow: Math.min(history.length, HISTORY_WINDOW),
    intent:        intentOverride ?? 'normal',
    field:         fieldContext?.label ?? 'none',
  });

  return messages;
}

/**
 * Convenience: builds a greeting messages array for the start of a call.
 * The voice pipeline calls this immediately when a call connects.
 *
 * @param {object} [fieldContext] - First field on the form
 * @returns {Array<{ role: string, content: string }>}
 */
function buildGreeting(fieldContext) {
  return buildMessages({
    transcript:     '',
    fieldContext:   fieldContext ?? {},
    history:        [],
    intentOverride: 'greeting',
  });
}

/**
 * Convenience: builds a clarification request when STT returns empty text.
 *
 * @param {object} fieldContext - Current form field
 * @param {Array}  history      - Current conversation history
 * @returns {Array<{ role: string, content: string }>}
 */
function buildClarification(fieldContext, history) {
  return buildMessages({
    transcript:     '',
    fieldContext,
    history,
    intentOverride: 'clarification',
  });
}

/**
 * Convenience: builds a completion message when all fields are filled.
 *
 * @param {Array} history - Full conversation history
 * @returns {Array<{ role: string, content: string }>}
 */
function buildCompletion(history) {
  return buildMessages({
    transcript:     '',
    fieldContext:   {},
    history,
    intentOverride: 'completion',
  });
}

module.exports = {
  buildMessages,
  buildGreeting,
  buildClarification,
  buildCompletion,
};
