'use strict';

/**
 * tts/index.js — Public Interface for the TTS Module
 *
 * FAÇADE PATTERN (same reasoning as stt/index.js):
 *   All external code imports from here, never from piper.js directly.
 *   If we ever replace Piper with Kokoro, Coqui, or a cloud API,
 *   only piper.js (and this re-export) changes — zero impact on the
 *   voice pipeline, session manager, or integration layer.
 *
 * PUBLIC API:
 *   synthesize(text)    → Promise<string>   (path to 8kHz WAV file)
 *   cleanup(filePath)   → Promise<void>     (delete file after Asterisk plays it)
 *   isAvailable()       → boolean           (Piper binary + model present?)
 *
 * USAGE (from voice pipeline):
 *   const tts = require('../tts');
 *
 *   // Check at startup
 *   if (!tts.isAvailable()) {
 *     logger.error('TTS unavailable — check Piper installation');
 *   }
 *
 *   // On each LLM response
 *   const audioFile = await tts.synthesize("Please say your name.");
 *   await asterisk.playFile(callId, audioFile);  // Step 7: SIP handler
 *   await tts.cleanup(audioFile);                // Delete after playback
 */

const { synthesize, cleanup, isAvailable } = require('./piper');

module.exports = {
  /**
   * Synthesizes text to speech.
   * Returns path to a WAV file (8kHz PCM) ready for Asterisk Playback().
   * @type {(text: string) => Promise<string>}
   */
  synthesize,

  /**
   * Deletes a TTS output file after Asterisk has finished playing it.
   * Always call this to avoid filling up disk during long demos.
   * @type {(filePath: string) => Promise<void>}
   */
  cleanup,

  /**
   * Returns true if Piper binary and voice model are present on disk.
   * @type {() => boolean}
   */
  isAvailable,
};
