'use strict';

/**
 * stt/index.js — Public Interface for the STT Module
 *
 * WHY THIS FILE EXISTS (Façade Pattern):
 *   Other modules (voice pipeline, integration layer) should never import
 *   whisper.js directly. They import this file instead.
 *
 *   Benefits:
 *   - If we swap Whisper for another STT engine later, only this file changes.
 *   - Internal implementation details (pipeline singleton, ffmpeg logic)
 *     stay hidden behind this clean interface.
 *   - Explicit documentation of the public API surface.
 *
 * PUBLIC API:
 *   transcribe(audioFilePath) → Promise<{ text: string, duration_ms: number }>
 *   warmup()                  → Promise<void>
 *   isReady()                 → boolean
 *
 * USAGE (from voice pipeline or integration layer):
 *   const stt = require('../stt');
 *
 *   // At startup — eagerly load model
 *   await stt.warmup();
 *
 *   // On each call recording
 *   const { text, duration_ms } = await stt.transcribe('/tmp/audio/call.wav');
 *   console.log(text); // "help me fill the address field"
 *
 *   // Health check
 *   if (!stt.isReady()) { ... }
 */

const { transcribe, warmup, isReady } = require('./whisper');

module.exports = {
  /**
   * Transcribes an audio file to text using Whisper.
   * @type {(audioFilePath: string) => Promise<{ text: string, duration_ms: number }>}
   */
  transcribe,

  /**
   * Pre-loads the Whisper model into memory.
   * Call once at startup to avoid cold-start latency.
   * @type {() => Promise<void>}
   */
  warmup,

  /**
   * Returns true if the model is loaded and ready to transcribe.
   * @type {() => boolean}
   */
  isReady,
};
