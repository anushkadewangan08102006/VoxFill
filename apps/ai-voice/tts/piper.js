'use strict';

/**
 * tts/piper.js — Core Text-to-Speech Engine (Piper TTS)
 *
 * WHAT IT DOES:
 *   Takes a text string and produces an audio file ready for Asterisk to play
 *   on an active SIP call. Uses Piper — a fast, offline, neural TTS binary.
 *
 * WHY PIPER OVER ALTERNATIVES:
 *   - Google TTS / AWS Polly : costs money, requires internet, privacy concerns
 *   - Festival / eSpeak      : robotic quality — sounds terrible on a demo
 *   - Coqui TTS              : abandoned in 2023 (company shut down)
 *   - Kokoro                 : good quality but Python dependency
 *   - Piper ✅               : offline, neural quality, runs as a fast binary,
 *                              single npm-free install, MIT licensed
 *
 * ASTERISK AUDIO FORMAT REQUIREMENT:
 *   Asterisk's Playback() application expects:
 *     - Sample rate  : 8000 Hz
 *     - Channels     : mono (1)
 *     - Bit depth    : 16-bit signed PCM
 *     - Container    : WAV
 *   Piper natively outputs 22050 Hz WAV. We use ffmpeg to resample.
 *
 * FILE LIFECYCLE:
 *   1. [synthesize()] creates two temp files in config.tts.outputDir:
 *      - tts_raw_{uuid}.wav    → Piper's 22050Hz output   (deleted immediately)
 *      - tts_{uuid}.wav        → 8kHz Asterisk-ready file (returned to caller)
 *   2. [cleanup(path)] must be called by the voice pipeline AFTER
 *      Asterisk finishes playing the file, to prevent disk accumulation.
 *
 * PIPER INSTALLATION (one-time setup):
 *   macOS : brew install piper-tts     (or download binary from GitHub releases)
 *   Linux : download from https://github.com/rhasspy/piper/releases
 *   Model : download en_US-lessac-medium.onnx from the same releases page
 *           and place it in ./models/
 *   Then update PIPER_BINARY_PATH and PIPER_VOICE_MODEL in your .env
 */

const { spawn }      = require('child_process');
const { execFile }   = require('child_process');
const { promisify }  = require('util');
const fs             = require('fs');
const fsp            = require('fs').promises;
const path           = require('path');
const { v4: uuidv4 } = require('uuid');
const ffmpeg         = require('@ffmpeg-installer/ffmpeg');

const config = require('../config');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Piper's native output sample rate (depends on the voice model) */
const PIPER_SAMPLE_RATE = config.tts.sampleRate;            // 22050 Hz

/** Target sample rate Asterisk's Playback() expects */
const ASTERISK_SAMPLE_RATE = config.tts.asteriskSampleRate; // 8000 Hz

/** Safety cap — Piper can hang on very long strings; split if needed */
const MAX_TEXT_LENGTH = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Startup Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies that the Piper binary and voice model exist on disk.
 * Called once at module load to give a clear error early if misconfigured.
 */
function verifyPiperInstallation() {
  const binary = config.tts.piperBinaryPath;
  const model  = config.tts.voiceModel;

  if (!fs.existsSync(binary)) {
    logger.warn(
      'TTS: Piper binary not found — synthesize() will fail until installed.',
      {
        expected: binary,
        hint: 'Set PIPER_BINARY_PATH in .env  |  brew install piper-tts  |  ' +
              'or download from https://github.com/rhasspy/piper/releases',
      },
    );
    return false;
  }

  if (!fs.existsSync(model)) {
    logger.warn(
      'TTS: Piper voice model not found — synthesize() will fail.',
      {
        expected: model,
        hint: 'Download en_US-lessac-medium.onnx from Piper releases and ' +
              'place it in ./models/  |  Update PIPER_VOICE_MODEL in .env',
      },
    );
    return false;
  }

  logger.info('TTS: Piper installation verified', { binary, model });
  return true;
}

/** true once both binary and model are confirmed present */
const _piperAvailable = verifyPiperInstallation();

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Piper Invocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawns the Piper binary, pipes text to its stdin, and waits for the
 * output WAV file to be written.
 *
 * Piper CLI usage:
 *   echo "text" | piper --model <model.onnx> --output_file <out.wav>
 *
 * We use spawn() (not execFile) so we can write text to stdin without
 * the risk of hitting shell argument-length limits on long sentences.
 *
 * @param {string} text        - Text to synthesize
 * @param {string} outputPath  - Where Piper should write the WAV file
 * @returns {Promise<void>}
 */
function runPiper(text, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.tts.piperBinaryPath, [
      '--model',       config.tts.voiceModel,
      '--output_file', outputPath,
      '--quiet',       // suppress progress output to stderr
    ]);

    // Collect stderr for error reporting
    const stderrChunks = [];
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    // Write text to Piper's stdin, then close to signal end of input
    proc.stdin.write(text, 'utf8');
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString().trim();
        reject(new Error(
          `Piper exited with code ${code}. stderr: ${stderr || '(empty)'}`
        ));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(
        `Failed to start Piper: ${err.message}. ` +
        `Check PIPER_BINARY_PATH in .env (currently: ${config.tts.piperBinaryPath})`
      ));
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Audio Format Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts Piper's 22050Hz WAV output to the 8000Hz PCM WAV format
 * that Asterisk's Playback() application requires.
 *
 * ffmpeg flags:
 *   -ar 8000       → resample to 8kHz
 *   -ac 1          → ensure mono
 *   -c:a pcm_s16le → 16-bit signed little-endian PCM (uncompressed)
 *   -f wav         → WAV container
 *
 * @param {string} inputPath   - Path to Piper's 22050Hz WAV output
 * @param {string} outputPath  - Where to write the 8kHz WAV
 * @returns {Promise<void>}
 */
async function convertForAsterisk(inputPath, outputPath) {
  await execFileAsync(ffmpeg.path, [
    '-i',  inputPath,
    '-ar', String(ASTERISK_SAMPLE_RATE),
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    '-f', 'wav',
    '-y',             // overwrite output without asking
    outputPath,
  ]);

  logger.debug('TTS: audio resampled for Asterisk', {
    from: `${PIPER_SAMPLE_RATE}Hz`,
    to:   `${ASTERISK_SAMPLE_RATE}Hz`,
    outputPath,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Text Sanitisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cleans text before feeding it to Piper.
 * - Collapses multiple whitespace/newlines into a single space
 * - Trims leading/trailing whitespace
 * - Enforces MAX_TEXT_LENGTH (TTS hangs on very long inputs)
 *
 * @param {string} raw - Raw text from the LLM
 * @returns {string}   - Sanitised text safe to pass to Piper
 */
function sanitiseText(raw) {
  let text = raw
    .replace(/\s+/g, ' ')    // collapse whitespace
    .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII (Piper en models only handle ASCII)
    .trim();

  if (text.length > MAX_TEXT_LENGTH) {
    logger.warn('TTS: text truncated to MAX_TEXT_LENGTH', {
      originalLength: text.length,
      truncatedAt: MAX_TEXT_LENGTH,
    });
    // Truncate at the last full sentence within the limit
    const truncated = text.slice(0, MAX_TEXT_LENGTH);
    const lastPeriod = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?'),
    );
    text = lastPeriod > 0 ? truncated.slice(0, lastPeriod + 1) : truncated;
  }

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synthesizes text to speech and returns a path to an audio file that
 * Asterisk can play directly with the Playback() application.
 *
 * This is the main function the voice pipeline calls after the LLM responds.
 *
 * @param {string} text - Text to speak (will be sanitised internally)
 * @returns {Promise<string>} - Absolute path to the 8kHz WAV file
 *
 * @example
 *   const audioPath = await synthesize("Please say your date of birth.");
 *   // audioPath = '/path/to/tmp/tts/tts_abc123.wav'
 *   // → pass this to Asterisk AGI: STREAM FILE tts_abc123
 */
async function synthesize(text) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('TTS: synthesize() called with empty or invalid text');
  }

  if (!_piperAvailable) {
    throw new Error(
      'TTS: Piper is not available. Check PIPER_BINARY_PATH and PIPER_VOICE_MODEL in .env'
    );
  }

  const startTime = Date.now();
  const fileId    = uuidv4();

  // Temp file paths
  const rawPiperPath      = path.join(config.tts.outputDir, `tts_raw_${fileId}.wav`);
  const asteriskReadyPath = path.join(config.tts.outputDir, `tts_${fileId}.wav`);

  try {
    const cleanText = sanitiseText(text);

    logger.debug('TTS: starting synthesis', {
      chars:  cleanText.length,
      fileId,
    });

    // ── 1. Synthesise with Piper (22050Hz WAV) ────────────────────────────
    await runPiper(cleanText, rawPiperPath);

    // ── 2. Convert to 8kHz PCM WAV for Asterisk ───────────────────────────
    await convertForAsterisk(rawPiperPath, asteriskReadyPath);

    const duration_ms = Date.now() - startTime;

    logger.info('TTS: synthesis complete', {
      chars:       cleanText.length,
      duration_ms,
      outputFile:  path.basename(asteriskReadyPath),
    });

    return asteriskReadyPath;

  } catch (err) {
    logger.error('TTS: synthesis failed', { error: err.message, fileId });

    // Clean up any partially-written output file
    fsp.unlink(asteriskReadyPath).catch(() => {});

    throw err;

  } finally {
    // Always delete the intermediate Piper raw output — only keep the converted file
    fsp.unlink(rawPiperPath).catch(() => {});
  }
}

/**
 * Deletes a previously synthesised audio file from disk.
 *
 * WHEN TO CALL THIS:
 *   After Asterisk finishes playing the audio on the call.
 *   The voice pipeline is responsible for calling cleanup() — TTS only
 *   generates files, it doesn't track when Asterisk is done with them.
 *
 * @param {string} filePath - Path returned by a previous synthesize() call
 * @returns {Promise<void>}
 */
async function cleanup(filePath) {
  try {
    await fsp.unlink(filePath);
    logger.debug('TTS: cleaned up audio file', { filePath });
  } catch (err) {
    // Non-fatal — log and continue
    logger.warn('TTS: could not delete audio file', { filePath, error: err.message });
  }
}

/**
 * Returns true if the Piper binary and model file are both present.
 * Used by health-check endpoints.
 *
 * @returns {boolean}
 */
function isAvailable() {
  return _piperAvailable;
}

module.exports = { synthesize, cleanup, isAvailable };
