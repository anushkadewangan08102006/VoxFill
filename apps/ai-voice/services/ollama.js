'use strict';

/**
 * services/ollama.js — Ollama LLM HTTP Client
 *
 * WHAT IT DOES:
 *   Sends structured chat messages to a locally running Ollama process
 *   and returns the model's text response.
 *
 * WHY OLLAMA (vs alternatives):
 *   ┌─────────────────┬──────────────────────────────────────────────┐
 *   │ Option          │ Why not chosen                               │
 *   ├─────────────────┼──────────────────────────────────────────────┤
 *   │ OpenAI API      │ Costs money, requires internet, data leaves  │
 *   │                 │ your machine — not OK for a form assistant   │
 *   │ HuggingFace     │ Rate limits, slower cold starts, cloud-only  │
 *   │ llama.cpp HTTP  │ Excellent but needs manual server setup;     │
 *   │                 │ Ollama wraps llama.cpp with a clean REST API │
 *   │ Ollama ✅       │ Local, free, OpenAI-compatible /api/chat,   │
 *   │                 │ manages model downloads, single binary       │
 *   └─────────────────┴──────────────────────────────────────────────┘
 *
 * API ENDPOINT CHOICE — /api/chat vs /api/generate:
 *   /api/generate  → single prompt → single completion (no history)
 *   /api/chat ✅   → messages[] with system/user/assistant roles
 *                    Supports multi-turn conversation natively.
 *                    The session manager (Step 6) maintains history;
 *                    we just forward the full messages array here.
 *
 * TEMPERATURE CHOICE (0.3):
 *   Form filling is a precision task, not a creative one. Low temperature
 *   keeps responses factual and deterministic. We don't want the LLM to
 *   "hallucinate" field names or make up form values.
 *
 * MAX TOKENS (150):
 *   Voice UX constraint. Nobody wants to listen to a 500-word monologue.
 *   Responses should be 1–2 short sentences. The prompt (Step 5) will
 *   also instruct the model to be brief.
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Axios Instance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A dedicated axios instance for all Ollama communication.
 *
 * WHY A CUSTOM INSTANCE (not axios.get/post directly):
 *   - baseURL is set once — no repetition in every call
 *   - timeout is enforced globally — no forgotten timeouts
 *   - Interceptors attach cleanly without affecting other axios calls
 */
const ollamaClient = axios.create({
  baseURL: config.ollama.baseUrl,
  timeout: config.ollama.timeoutMs,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Interceptors — Request / Response Logging
// ─────────────────────────────────────────────────────────────────────────────

/** Log every outbound request at debug level */
ollamaClient.interceptors.request.use((reqConfig) => {
  logger.debug('LLM → Ollama request', {
    method:  reqConfig.method?.toUpperCase(),
    url:     reqConfig.url,
    model:   reqConfig.data?.model,
    msgCount: reqConfig.data?.messages?.length,
  });
  return reqConfig;
});

/** Log every response (success path) at debug level */
ollamaClient.interceptors.response.use((response) => {
  logger.debug('LLM ← Ollama response', {
    status:     response.status,
    eval_count: response.data?.eval_count,
    done:       response.data?.done,
  });
  return response;
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts raw axios/network errors into human-readable messages with
 * actionable hints — critical for quick debugging on demo day.
 *
 * @param {Error} err - Raw error from axios
 * @throws {Error}    - Re-throws a cleaner, contextual error
 */
function normaliseOllamaError(err) {
  // Ollama process is not running
  if (err.code === 'ECONNREFUSED') {
    throw new Error(
      `[LLM] Ollama is not running.\n` +
      `  Start it with : ollama serve\n` +
      `  Expected at   : ${config.ollama.baseUrl}\n` +
      `  Then verify   : curl ${config.ollama.baseUrl}/api/tags`
    );
  }

  // Model not installed in Ollama
  if (err.response?.status === 404) {
    throw new Error(
      `[LLM] Model '${config.ollama.model}' is not installed in Ollama.\n` +
      `  Install it with : ollama pull ${config.ollama.model}\n` +
      `  List available  : ollama list`
    );
  }

  // Request timed out — model too slow for the hardware
  if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
    throw new Error(
      `[LLM] Ollama request timed out after ${config.ollama.timeoutMs}ms.\n` +
      `  The model may be too large for your hardware.\n` +
      `  Try a smaller model : ollama pull llama3.2:1b\n` +
      `  Or increase timeout : OLLAMA_TIMEOUT_MS=60000 in .env`
    );
  }

  // Ollama returned an application-level error body
  if (err.response?.data?.error) {
    throw new Error(`[LLM] Ollama error: ${err.response.data.error}`);
  }

  // Unknown — re-throw as-is
  throw err;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a chat completion request to Ollama and returns the response text.
 *
 * This is the primary function called by the voice pipeline after the
 * prompt engine assembles the messages array from session history +
 * form context + current user transcript.
 *
 * @param {Array<{ role: 'system'|'user'|'assistant', content: string }>} messages
 *   Full conversation history. The prompt engine (Step 5) constructs this.
 *   The session manager (Step 6) appends to it after each turn.
 *
 * @param {object}  [options]              - Optional generation parameters
 * @param {number}  [options.temperature]  - Creativity (0 = deterministic, 1 = creative). Default: 0.3
 * @param {number}  [options.maxTokens]    - Max tokens to generate. Default: 150
 * @param {number}  [options.topP]         - Nucleus sampling probability. Default: 0.9
 * @param {string}  [options.model]        - Override the model for this call only
 *
 * @returns {Promise<{ text: string, duration_ms: number, usage: object }>}
 *
 * @example
 *   const { text } = await chat([
 *     { role: 'system',    content: 'You are a form assistant...' },
 *     { role: 'user',      content: 'help me fill the name field' },
 *   ]);
 *   // text = "Please say your full name."
 */
async function chat(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('[LLM] chat() requires a non-empty messages array');
  }

  const startTime = Date.now();

  const payload = {
    model:  options.model ?? config.ollama.model,
    messages,
    stream: false,   // We need the full response before TTS can speak it

    /**
     * Ollama model parameters.
     * These map directly to llama.cpp sampling parameters.
     */
    options: {
      temperature: options.temperature ?? 0.3,
      num_predict: options.maxTokens   ?? 150,
      top_p:       options.topP        ?? 0.9,

      /**
       * stop sequences — prevent the model from generating beyond
       * a natural response endpoint (avoids hallucinated "User: ...")
       */
      stop: ['User:', 'Human:', '\n\n'],
    },
  };

  try {
    const response = await ollamaClient.post(
      config.ollama.endpoints.chat,
      payload,
    );

    const text       = (response.data?.message?.content ?? '').trim();
    const duration_ms = Date.now() - startTime;

    logger.info('LLM: completion received', {
      model:       payload.model,
      duration_ms,
      eval_count:  response.data?.eval_count   ?? 0,
      prompt_eval: response.data?.prompt_eval_count ?? 0,
      chars:       text.length,
    });

    return {
      text,
      duration_ms,
      usage: {
        eval_count:        response.data?.eval_count        ?? 0,
        prompt_eval_count: response.data?.prompt_eval_count ?? 0,
        total_duration:    response.data?.total_duration    ?? 0,
      },
    };

  } catch (err) {
    logger.error('LLM: chat request failed', {
      model:  payload.model,
      error:  err.message,
      code:   err.code,
      status: err.response?.status,
    });

    normaliseOllamaError(err); // throws a clean contextual error
  }
}

/**
 * Health check — verifies Ollama is running AND the configured model is installed.
 *
 * Call this at application startup and expose via a /health endpoint
 * so you can quickly verify the system during the demo.
 *
 * @returns {Promise<{
 *   reachable:      boolean,
 *   modelInstalled: boolean,
 *   model:          string,
 *   installedModels: string[],
 *   error?:         string
 * }>}
 */
async function ping() {
  try {
    const response = await axios.get(
      `${config.ollama.baseUrl}${config.ollama.endpoints.tags}`,
      { timeout: 3000 },
    );

    const installedModels = (response.data?.models ?? []).map((m) => m.name);

    /**
     * Model name matching: config may specify 'llama3.2:3b', but Ollama
     * stores it as 'llama3.2:3b'. We match on the name before the colon
     * to handle cases like 'llama3.2' matching 'llama3.2:3b'.
     */
    const configModelBase  = config.ollama.model.split(':')[0];
    const modelInstalled = installedModels.some((name) =>
      name.startsWith(configModelBase),
    );

    if (!modelInstalled) {
      logger.warn('LLM: configured model not found in Ollama', {
        configured: config.ollama.model,
        available:  installedModels,
        hint:       `Run: ollama pull ${config.ollama.model}`,
      });
    } else {
      logger.info('LLM: Ollama reachable and model available', {
        model:  config.ollama.model,
        allInstalled: installedModels,
      });
    }

    return {
      reachable:       true,
      modelInstalled,
      model:           config.ollama.model,
      installedModels,
    };

  } catch (err) {
    logger.warn('LLM: Ollama not reachable', {
      url:   config.ollama.baseUrl,
      error: err.message,
      hint:  'Start Ollama with: ollama serve',
    });

    return {
      reachable:       false,
      modelInstalled:  false,
      model:           config.ollama.model,
      installedModels: [],
      error:           err.message,
    };
  }
}

module.exports = { chat, ping };
