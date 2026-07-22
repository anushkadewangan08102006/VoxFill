'use strict';

/**
 * config.js — Centralised Configuration
 *
 * WHY THIS EXISTS:
 *   Every module (STT, TTS, LLM, SIP, session) needs configuration values.
 *   Instead of each file calling process.env directly (which scatters magic
 *   strings across the codebase), they all import from here.
 *
 *   Benefits:
 *   - One place to change a value → affects entire system
 *   - Explicit defaults make the system self-documenting
 *   - Startup validation catches missing env vars before anything breaks
 *
 * USAGE:
 *   const config = require('./config');
 *   config.ollama.model  // 'llama3.2:3b'
 */

require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────────
// Config Object
// ─────────────────────────────────────────────────────────────────────────────

const config = {

  // ── Server ─────────────────────────────────────────────────────────────────
  server: {
    port:     parseInt(process.env.PORT, 10) || 3001,
    env:      process.env.NODE_ENV           || 'development',
    logLevel: process.env.LOG_LEVEL          || 'info',
    isDev:    (process.env.NODE_ENV || 'development') === 'development',
  },

  // ── Ollama (Local LLM) ─────────────────────────────────────────────────────
  ollama: {
    baseUrl:   process.env.OLLAMA_BASE_URL     || 'http://localhost:11434',
    model:     process.env.OLLAMA_MODEL        || 'llama3.2:3b',
    timeoutMs: parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 30000,
    // Endpoint paths (relative to baseUrl)
    endpoints: {
      generate: '/api/generate',
      chat:     '/api/chat',
      tags:     '/api/tags',   // list installed models
    },
  },

  // ── Speech-to-Text (Whisper) ───────────────────────────────────────────────
  stt: {
    model:        process.env.WHISPER_MODEL    || 'base.en',
    language:     process.env.WHISPER_LANGUAGE || 'en',
    audioTempDir: process.env.AUDIO_TEMP_DIR   || './tmp/audio',
  },

  // ── Text-to-Speech (Piper) ─────────────────────────────────────────────────
  tts: {
    piperBinaryPath: process.env.PIPER_BINARY_PATH  || '/usr/local/bin/piper',
    voiceModel:      process.env.PIPER_VOICE_MODEL  || './models/en_US-lessac-medium.onnx',
    outputDir:       process.env.TTS_OUTPUT_DIR     || './tmp/tts',
    // Piper outputs 22050 Hz mono WAV — Asterisk expects 8000 Hz μ-law
    // The TTS module will handle the conversion via ffmpeg
    sampleRate:      22050,
    asteriskSampleRate: 8000,
  },

  // ── Asterisk AMI ───────────────────────────────────────────────────────────
  asterisk: {
    host:              process.env.AMI_HOST                   || '127.0.0.1',
    port:              parseInt(process.env.AMI_PORT, 10)     || 5038,
    username:          process.env.AMI_USERNAME               || 'formpilot',
    password:          process.env.AMI_PASSWORD               || '',
    reconnectDelayMs:  parseInt(process.env.AMI_RECONNECT_DELAY_MS, 10) || 3000,
  },

  // ── Session Management ─────────────────────────────────────────────────────
  session: {
    // Idle sessions are purged after this duration
    ttlSeconds: parseInt(process.env.SESSION_TTL_SECONDS, 10) || 1800,
  },

  // ── Backend Integration (Member 3) ─────────────────────────────────────────
  backend: {
    apiUrl: process.env.BACKEND_API_URL || 'http://localhost:3000',
    apiKey: process.env.BACKEND_API_KEY || '',
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// Startup Validation
// Only enforced in production — dev can run with defaults.
// ─────────────────────────────────────────────────────────────────────────────

if (!config.server.isDev) {
  const required = [
    ['AMI_PASSWORD',      config.asterisk.password],
    ['BACKEND_API_KEY',   config.backend.apiKey],
  ];

  const missing = required
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `[config] Missing required environment variables in production: ${missing.join(', ')}\n` +
      'Check your .env file against .env.example'
    );
  }
}

module.exports = config;
