'use strict';

/**
 * services/index.js — Public Interface for the Services Layer
 *
 * WHY A services/ FOLDER (not just one file):
 *   As the project grows, more services could be added here without
 *   touching the rest of the codebase. For example:
 *   - services/backend.js  → HTTP client to Member 3's API
 *   - services/health.js   → aggregated health checks across all services
 *
 *   For now, we expose only the Ollama client.
 *
 * PUBLIC API:
 *   llm.chat(messages, options) → Promise<{ text, duration_ms, usage }>
 *   llm.ping()                  → Promise<{ reachable, modelInstalled, ... }>
 *
 * USAGE (from voice pipeline or integration layer):
 *   const { llm } = require('../services');
 *
 *   // Health check at startup
 *   const status = await llm.ping();
 *   if (!status.modelInstalled) { ... }
 *
 *   // On each conversation turn
 *   const { text } = await llm.chat(session.messages);
 */

const ollama = require('./ollama');

module.exports = {
  /**
   * The local Ollama LLM client.
   * Use llm.chat() for completions, llm.ping() for health checks.
   */
  llm: ollama,
};
