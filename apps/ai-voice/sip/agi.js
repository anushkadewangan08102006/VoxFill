'use strict';

/**
 * sip/agi.js — FastAGI Server (Per-Call Audio Control)
 *
 * WHAT IS FASTAGI:
 *   AGI (Asterisk Gateway Interface) lets an external program control
 *   a live call. "Fast" AGI = a persistent TCP server instead of spawning
 *   a new process per call. Asterisk connects to us for every incoming call.
 *
 * HOW IT WORKS:
 *   1. extensions.conf routes an incoming call to: agi://127.0.0.1:4573
 *   2. Asterisk opens a TCP connection to our server (one per call)
 *   3. Asterisk sends a header block with channel variables (who's calling, etc.)
 *   4. We take control: ANSWER the call, STREAM audio, RECORD speech
 *   5. When done (or caller hangs up), the connection closes
 *
 * PROTOCOL:
 *   Text-based, line-by-line, synchronous request-response.
 *   We send a command → Asterisk executes it → Asterisk sends a result line.
 *
 *   Our command :  STREAM FILE /path/to/greeting ""\n
 *   Asterisk reply: 200 result=0 endpos=12345\n
 *
 * THE Call CLASS:
 *   For each incoming TCP connection, we create a Call instance.
 *   It wraps the raw socket with clean async methods the voice pipeline
 *   can await without knowing anything about the AGI protocol:
 *
 *   await call.answer()            → picks up the call
 *   await call.play('/tmp/a.wav')  → plays audio, awaits completion
 *   await call.record()            → records until silence, returns file path
 *   await call.hangup()            → ends the call
 *   call.on('hangup', fn)          → fired if caller hangs up mid-session
 *
 * AGI COMMANDS USED:
 *   ANSWER              → answer the incoming call
 *   STREAM FILE         → play a WAV/GSM file, wait for it to finish
 *   RECORD FILE         → record audio with silence detection
 *   GET VARIABLE        → read a channel variable (e.g. UNIQUEID, CALLERID)
 *   VERBOSE             → log a message to Asterisk's console (for debugging)
 *   HANGUP              → terminate the call from our side
 */

const net          = require('net');
const path         = require('path');
const { v4: uuid } = require('uuid');
const EventEmitter = require('events');

const config = require('../config');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FASTAGI_PORT = 4573;       // Standard FastAGI port
const FASTAGI_HOST = '127.0.0.1';

/** Record until this many seconds of silence → auto-stop */
const SILENCE_DETECT_SEC = 2;

/** Max recording duration in ms (safety cap — avoids runaway recordings) */
const MAX_RECORD_MS = 10000;

/** AGI response code for success */
const AGI_SUCCESS = '200';

// ─────────────────────────────────────────────────────────────────────────────
// Call Class — Per-call control object
// ─────────────────────────────────────────────────────────────────────────────

class Call extends EventEmitter {
  /**
   * @param {net.Socket} socket - The TCP socket from Asterisk
   */
  constructor(socket) {
    super();

    this.socket   = socket;
    this.vars     = {};        // parsed AGI environment variables
    this.id       = uuid();    // internal unique ID for this call
    this._alive   = true;      // false after hangup
    this._buffer  = '';        // incoming data buffer
    this._lineResolvers = [];  // queue of Promise resolvers waiting for a response line

    // ── Socket wiring ──────────────────────────────────────────────────────

    socket.setEncoding('utf8');

    socket.on('data', (chunk) => {
      this._buffer += chunk;
      // Process complete lines (AGI protocol is line-delimited)
      let nl;
      while ((nl = this._buffer.indexOf('\n')) !== -1) {
        const line = this._buffer.slice(0, nl).trimEnd();
        this._buffer = this._buffer.slice(nl + 1);
        this._onLine(line);
      }
    });

    socket.on('end',   () => this._onHangup('socket_end'));
    socket.on('close', () => this._onHangup('socket_close'));
    socket.on('error', (err) => {
      logger.error('AGI: socket error', { callId: this.id, error: err.message });
      this.emit('error', err);
      this._onHangup('socket_error');
    });
  }

  // ── Internal: Line Processing ─────────────────────────────────────────────

  /**
   * Dispatches incoming lines to either:
   * - The header parser (during initial AGI handshake), or
   * - Pending command-response resolvers (during call control)
   */
  _onLine(line) {
    // If there's a resolver waiting for a response line, give it this line
    if (this._lineResolvers.length > 0) {
      const resolve = this._lineResolvers.shift();
      resolve(line);
      return;
    }

    // Otherwise it's a header line from the initial AGI handshake
    if (line === '') {
      // Blank line = end of AGI headers
      this.emit('_headers_done');
      return;
    }

    // Parse: "agi_channel: SIP/1001-00000001"
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key   = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      this.vars[key] = value;
    }
  }

  /**
   * Waits for a single response line from Asterisk.
   * Used after sending every AGI command.
   *
   * @returns {Promise<string>} The raw response line (e.g. "200 result=0")
   */
  _waitLine() {
    return new Promise((resolve) => {
      this._lineResolvers.push(resolve);
    });
  }

  /**
   * Sends an AGI command to Asterisk.
   *
   * @param {string} command - AGI command string (without trailing newline)
   * @returns {Promise<{ code: string, result: string, extra: string }>}
   */
  async _send(command) {
    if (!this._alive) {
      throw new Error(`AGI: call ${this.id} is no longer active`);
    }

    logger.debug('AGI →', { callId: this.id, command });
    this.socket.write(command + '\n');

    const responseLine = await this._waitLine();
    logger.debug('AGI ←', { callId: this.id, response: responseLine });

    // Parse: "200 result=0 endpos=12345"
    const match = responseLine.match(/^(\d+)\s+result=(-?\d+)(.*)?$/);
    if (!match) {
      throw new Error(`AGI: unexpected response: "${responseLine}"`);
    }

    return {
      code:   match[1],           // "200"
      result: match[2],           // "0" or "-1" (error)
      extra:  (match[3] ?? '').trim(), // " endpos=12345" etc.
    };
  }

  _onHangup(reason) {
    if (!this._alive) return; // prevent double-emit
    this._alive = false;

    logger.info('AGI: call ended', {
      callId:   this.id,
      channel:  this.vars.agi_channel,
      uniqueid: this.vars.agi_uniqueid,
      reason,
    });

    // Resolve any pending command waiters with an empty line
    // (prevents them hanging forever on unexpected hangup)
    for (const resolve of this._lineResolvers) resolve('');
    this._lineResolvers = [];

    this.emit('hangup', { callId: this.id, reason });
  }

  // ── Public API — Call Control ─────────────────────────────────────────────

  /**
   * Parses the initial AGI header block that Asterisk sends on connect.
   * Must be awaited before calling any other method.
   *
   * @returns {Promise<object>} Parsed AGI variables (also stored in this.vars)
   */
  parseHeaders() {
    return new Promise((resolve) => {
      this.once('_headers_done', () => {
        logger.debug('AGI: headers parsed', {
          callId:   this.id,
          channel:  this.vars.agi_channel,
          callerid: this.vars.agi_callerid,
          uniqueid: this.vars.agi_uniqueid,
        });
        resolve(this.vars);
      });
    });
  }

  /**
   * Answers the incoming call.
   * Must be called before any audio operations.
   *
   * @returns {Promise<void>}
   */
  async answer() {
    const { code } = await this._send('ANSWER');
    if (code !== AGI_SUCCESS) {
      throw new Error(`AGI: ANSWER failed with code ${code}`);
    }
    logger.info('AGI: call answered', {
      callId:  this.id,
      channel: this.vars.agi_channel,
    });
  }

  /**
   * Plays an audio file on the call.
   * Asterisk automatically finds the right format (.wav, .gsm, .ulaw).
   * Pass the path WITHOUT extension.
   *
   * @param {string} filePath - Absolute path to audio file (without extension)
   * @returns {Promise<void>}
   */
  async play(filePath) {
    // Strip extension if caller passed one — Asterisk handles format selection
    const fileNoExt = filePath.replace(/\.[^.]+$/, '');

    const { code, result } = await this._send(
      `STREAM FILE ${fileNoExt} ""`
    );

    if (code !== AGI_SUCCESS || result === '-1') {
      throw new Error(`AGI: STREAM FILE failed — code=${code} result=${result}`);
    }

    logger.debug('AGI: playback complete', {
      callId: this.id,
      file:   path.basename(fileNoExt),
    });
  }

  /**
   * Records the caller's voice into a WAV file.
   * Stops automatically after SILENCE_DETECT_SEC seconds of silence.
   *
   * @returns {Promise<string>} Absolute path to the recorded .wav file
   */
  async record() {
    const recordingId   = uuid();
    const outputPath    = path.join(config.stt.audioTempDir, `rec_${recordingId}`);
    // Note: path WITHOUT extension — Asterisk appends .wav

    const { code, result } = await this._send(
      // RECORD FILE <file> <format> <escape_digits> <timeout_ms> <offset> BEEP s=<silence_sec>
      `RECORD FILE ${outputPath} wav "#0" ${MAX_RECORD_MS} 0 BEEP s=${SILENCE_DETECT_SEC}`
    );

    /**
     * RECORD FILE result codes:
     *   -1  = error or hangup during recording
     *    0  = timeout reached
     *    1  = escape digit pressed (# or 0)
     *    2  = silence detected (our expected case)
     */
    if (code !== AGI_SUCCESS) {
      throw new Error(`AGI: RECORD FILE failed — code=${code}`);
    }
    if (result === '-1') {
      throw new Error('AGI: RECORD FILE — caller hung up during recording');
    }

    const wavPath = `${outputPath}.wav`;

    logger.info('AGI: recording saved', {
      callId:  this.id,
      file:    path.basename(wavPath),
      result,  // 0=timeout, 1=digit, 2=silence
    });

    return wavPath;
  }

  /**
   * Reads the value of an Asterisk channel variable.
   *
   * @param {string} varName - Variable name (e.g. 'CALLERID(num)', 'UNIQUEID')
   * @returns {Promise<string>}
   */
  async getVar(varName) {
    const { result } = await this._send(`GET VARIABLE ${varName}`);
    return result ?? '';
  }

  /**
   * Logs a message to Asterisk's CLI/verbose output.
   * Useful for debugging the call flow in Asterisk logs.
   *
   * @param {string} message
   */
  async verbose(message) {
    await this._send(`VERBOSE "${message}" 1`);
  }

  /**
   * Hangs up the call from our side.
   * Also fires after this call.
   */
  async hangup() {
    try {
      await this._send('HANGUP');
    } catch (_) {
      // Socket may already be closed — that's OK
    }
    this._onHangup('local_hangup');
    this.socket.destroy();
  }

  /** @returns {boolean} true if the call is still active */
  isAlive() {
    return this._alive;
  }

  /** Convenience: caller's phone number */
  get callerId() {
    return this.vars.agi_callerid ?? 'unknown';
  }

  /** Convenience: Asterisk unique call ID */
  get uniqueId() {
    return this.vars.agi_uniqueid ?? this.id;
  }

  /** Convenience: Asterisk channel name */
  get channel() {
    return this.vars.agi_channel ?? 'unknown';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FastAGI Server
// ─────────────────────────────────────────────────────────────────────────────

class AGIServer extends EventEmitter {
  constructor() {
    super();
    this._server = null;
  }

  /**
   * Starts the FastAGI TCP server.
   * Emits 'call' event with a ready-to-use Call object for each incoming call.
   *
   * @param {number} [port] - TCP port (default 4573)
   * @param {string} [host] - Bind address (default 127.0.0.1)
   * @returns {Promise<void>} Resolves when server is listening
   */
  start(port = FASTAGI_PORT, host = FASTAGI_HOST) {
    return new Promise((resolve, reject) => {
      this._server = net.createServer((socket) => {
        this._handleConnection(socket);
      });

      this._server.on('error', (err) => {
        logger.error('FastAGI: server error', { error: err.message, port, host });
        reject(err);
      });

      this._server.listen(port, host, () => {
        logger.info('FastAGI: server listening — Asterisk can now route calls here', {
          address: `agi://${host}:${port}`,
          hint:    'In extensions.conf: same(n,AGI(agi://127.0.0.1:4573))',
        });
        resolve();
      });
    });
  }

  /**
   * Handles a new TCP connection from Asterisk (= one incoming call).
   * Parses AGI headers, then emits 'call' with the ready Call object.
   *
   * @param {net.Socket} socket
   */
  async _handleConnection(socket) {
    const call = new Call(socket);

    try {
      await call.parseHeaders();

      logger.info('FastAGI: call connected', {
        callId:   call.id,
        channel:  call.channel,
        callerId: call.callerId,
        uniqueId: call.uniqueId,
      });

      /**
       * Emit 'call' to the voice pipeline (Step 8).
       * The voice pipeline listener will receive this Call object and
       * take over: answering, greeting, recording, processing, responding.
       */
      this.emit('call', call);

    } catch (err) {
      logger.error('FastAGI: failed to handle connection', { error: err.message });
      socket.destroy();
    }
  }

  /**
   * Shuts down the FastAGI server — no new connections accepted.
   * Existing calls continue until they end naturally.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (!this._server) return resolve();
      this._server.close(() => {
        logger.info('FastAGI: server stopped');
        resolve();
      });
    });
  }

  /** @returns {boolean} */
  isListening() {
    return this._server?.listening ?? false;
  }
}

module.exports = new AGIServer(); // export singleton instance
