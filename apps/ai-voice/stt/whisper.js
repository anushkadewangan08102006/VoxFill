'use strict';

/**
 * stt/whisper.js — Core Speech-to-Text Engine
 *
 * WHAT IT DOES:
 *   Takes any audio file (WAV, GSM, μ-law — whatever Asterisk recorded)
 *   and returns a clean text transcript using OpenAI's Whisper model,
 *   running entirely locally inside Node.js via @xenova/transformers.
 *
 * WHY @xenova/transformers:
 *   - Zero Python dependency — pure Node.js, works anywhere npm works
 *   - No C++ compilation (unlike nodejs-whisper which wraps whisper.cpp)
 *   - Model downloads once on first run, then cached locally in ./models/
 *   - ONNX Runtime backend — optimised for CPU inference
 *
 * AUDIO PIPELINE:
 *   Input file (any format)
 *     → ffmpeg → 16kHz mono 16-bit PCM WAV   (Whisper's required format)
 *     → WaveFile → Float32Array              (normalised audio samples)
 *     → Whisper pipeline → transcript string
 *
 * SINGLETON PATTERN:
 *   The Whisper model (~145MB for base.en) is loaded once at warmup and
 *   kept in memory. Every subsequent transcription call reuses the same
 *   loaded model — no repeated disk I/O or model parsing overhead.
 */

const { pipeline, env } = require('@xenova/transformers');
const { execFile }      = require('child_process');
const { promisify }     = require('util');
const { WaveFile }      = require('wavefile');
const fs                = require('fs');
const fsp               = require('fs').promises;
const path              = require('path');
const { v4: uuidv4 }   = require('uuid');
const ffmpeg            = require('@ffmpeg-installer/ffmpeg');

const config = require('../config');
const logger = require('../utils/logger');

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Xenova model ID derived from config (e.g. 'base.en' → 'Xenova/whisper-base.en') */
const MODEL_ID = `Xenova/whisper-${config.stt.model}`;

/** Whisper requires exactly 16000 Hz. Non-negotiable. */
const WHISPER_SAMPLE_RATE = 16000;

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Pipeline — Load Once, Reuse Forever
// ─────────────────────────────────────────────────────────────────────────────

/** Resolved pipeline instance (null until first load) */
let _pipe = null;

/**
 * In-flight loading promise — prevents duplicate model loads if two calls
 * arrive before the first load finishes (e.g. at startup under load).
 */
let _loadPromise = null;

/**
 * Returns the Whisper pipeline, loading it if necessary.
 * Subsequent calls return the cached instance immediately.
 *
 * @returns {Promise<Function>} The @xenova/transformers pipeline function
 */
async function getPipeline() {
  // Fast path — already loaded
  if (_pipe) return _pipe;

  // If a load is in progress, wait for it instead of starting another
  if (_loadPromise) return _loadPromise;

  logger.info('STT: loading Whisper model (first run — will download if not cached)', {
    model:    MODEL_ID,
    cacheDir: path.resolve(process.cwd(), 'models', 'whisper'),
  });

  // Tell @xenova/transformers where to store downloaded model files
  env.cacheDir        = path.resolve(process.cwd(), 'models', 'whisper');
  env.allowLocalModels = true;

  _loadPromise = pipeline('automatic-speech-recognition', MODEL_ID, {
    /**
     * quantized: true → use the INT8 quantized ONNX model.
     * 2–4× faster inference on CPU with only a minor accuracy drop.
     * Ideal for demo hardware where we don't have a GPU.
     */
    quantized: true,
  })
  .then((pipe) => {
    _pipe         = pipe;
    _loadPromise  = null;
    logger.info('STT: Whisper model loaded and ready', { model: MODEL_ID });
    return _pipe;
  })
  .catch((err) => {
    _loadPromise = null; // Allow retry on next call
    logger.error('STT: failed to load Whisper model', { model: MODEL_ID, error: err.message });
    throw err;
  });

  return _loadPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Preprocessing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts any audio file to the exact format Whisper requires:
 * 16kHz, mono channel, 16-bit signed PCM, WAV container.
 *
 * WHY FFMPEG HERE:
 *   Asterisk can record in many codecs: GSM, G.711 μ-law (ulaw/alaw),
 *   G.722, SLIN, etc. Rather than writing a codec-specific parser,
 *   we delegate all format complexity to ffmpeg — the industry standard.
 *
 * @param {string} inputPath  - Path to the source audio file
 * @returns {Promise<string>} - Path to the temporary 16kHz mono WAV output
 */
async function convertToWhisperFormat(inputPath) {
  const tmpPath = path.join(
    config.stt.audioTempDir,
    `stt_${uuidv4()}.wav`,
  );

  await execFileAsync(ffmpeg.path, [
    '-i',  inputPath,               // Input: any format
    '-ar', String(WHISPER_SAMPLE_RATE), // Resample to 16kHz
    '-ac', '1',                     // Downmix to mono
    '-c:a', 'pcm_s16le',            // Codec: 16-bit little-endian PCM
    '-f', 'wav',                    // Container: WAV
    '-y',                           // Overwrite temp file if it exists
    tmpPath,
  ]);

  logger.debug('STT: audio converted to 16kHz mono WAV', { tmpPath });
  return tmpPath;
}

/**
 * Reads a 16kHz mono WAV file from disk and returns its audio data
 * as a Float32Array — the format @xenova/transformers expects.
 *
 * WHY FLOAT32:
 *   Neural network models work with normalised float values in [-1, 1].
 *   WaveFile.toBitDepth('32f') handles the integer → float conversion.
 *
 * @param {string} wavPath - Path to a 16kHz mono WAV file
 * @returns {Float32Array}  - Normalised audio samples
 */
function readWavAsFloat32(wavPath) {
  const buffer = fs.readFileSync(wavPath);
  const wav    = new WaveFile(buffer);

  // Convert sample integers → normalised 32-bit floats in [-1.0, 1.0]
  wav.toBitDepth('32f');

  /**
   * getSamples(interleaved, TypedArray):
   *   - Mono  → returns a single Float32Array
   *   - Stereo → returns an array of Float32Array (one per channel)
   * Since ffmpeg already downmixed to mono above, we always get a single array.
   */
  const samples = wav.getSamples(false, Float32Array);
  return Array.isArray(samples) ? samples[0] : samples;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transcribes an audio file to text.
 *
 * This is the main function the voice pipeline calls after Asterisk records
 * the caller's speech. It handles the full pipeline:
 * audio file → ffmpeg conversion → Float32Array → Whisper → transcript.
 *
 * @param {string} audioFilePath - Path to audio file (any format Asterisk writes)
 * @returns {Promise<{ text: string, duration_ms: number }>}
 *
 * @example
 *   const { text } = await transcribe('/tmp/audio/call-abc123.wav');
 *   // text = "Please help me fill the name field"
 */
async function transcribe(audioFilePath) {
  const startTime  = Date.now();
  let   tmpWavPath = null;

  try {
    logger.debug('STT: transcription started', { file: audioFilePath });

    // ── 1. Ensure model is loaded ─────────────────────────────────────────
    const whisper = await getPipeline();

    // ── 2. Convert audio to Whisper-compatible format ─────────────────────
    tmpWavPath = await convertToWhisperFormat(audioFilePath);

    // ── 3. Load audio data as Float32Array ────────────────────────────────
    const audioData = readWavAsFloat32(tmpWavPath);

    // ── 4. Run Whisper inference ──────────────────────────────────────────
    const result = await whisper(audioData, {
      sampling_rate:  WHISPER_SAMPLE_RATE,

      /**
       * chunk_length_s: Process audio in 30-second windows.
       * stride_length_s: 5-second overlap between chunks to avoid
       * cutting words at boundaries (prevents truncated transcripts).
       */
      chunk_length_s:  30,
      stride_length_s: 5,

      language: config.stt.language,
      task:     'transcribe',
    });

    const duration_ms = Date.now() - startTime;
    const text        = (result?.text ?? '').trim();

    logger.info('STT: transcription complete', {
      text,
      duration_ms,
      chars: text.length,
    });

    return { text, duration_ms };

  } catch (err) {
    logger.error('STT: transcription failed', {
      file:  audioFilePath,
      error: err.message,
    });
    throw err;

  } finally {
    // ── Cleanup: delete temp WAV (fire-and-forget, don't block caller) ────
    if (tmpWavPath) {
      fsp.unlink(tmpWavPath).catch((e) => {
        logger.warn('STT: could not clean up temp file', { tmpWavPath, error: e.message });
      });
    }
  }
}

/**
 * Pre-loads the Whisper model into memory.
 * Call this once at application startup to eliminate cold-start latency
 * on the first real call — important for a smooth demo experience.
 *
 * @returns {Promise<void>}
 */
async function warmup() {
  logger.info('STT: warming up Whisper model...');
  await getPipeline();
  logger.info('STT: warmup complete — ready to transcribe');
}

/**
 * Returns true if the Whisper model is fully loaded and ready.
 * Used by health-check endpoints.
 *
 * @returns {boolean}
 */
function isReady() {
  return _pipe !== null;
}

module.exports = { transcribe, warmup, isReady };
