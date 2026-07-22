'use strict';

/**
 * session/store.js — In-Memory Session Store with TTL Expiry
 *
 * WHAT IT DOES:
 *   Maintains a Map of active call sessions, keyed by a unique session ID
 *   (derived from the SIP Call-ID). Each session tracks:
 *   - Conversation history (messages[] for the LLM)
 *   - Active form field context (sent by the Chrome Extension)
 *   - Timestamps for TTL-based expiry
 *   - Call metadata (caller ID, form name, start time)
 *
 * WHY IN-MEMORY (not Redis/MongoDB):
 *   ┌───────────────┬───────────────────────────────────────────────┐
 *   │ Option        │ Why not chosen                                │
 *   ├───────────────┼───────────────────────────────────────────────┤
 *   │ Redis         │ Requires a separate process to install/run.  │
 *   │               │ Overkill for a demo. Adds network latency.   │
 *   │ MongoDB       │ Member 3's domain. Mixing concerns.          │
 *   │               │ Persistence isn't needed — calls are short.  │
 *   │ In-memory ✅  │ Zero dependencies. Microsecond reads.        │
 *   │               │ Sessions last ≤30 min — no persistence needed│
 *   └───────────────┴───────────────────────────────────────────────┘
 *
 * TTL EXPIRY:
 *   A setInterval runs every minute and purges sessions idle for longer
 *   than config.session.ttlSeconds. This prevents unbounded memory growth
 *   if calls drop without a proper hang-up event from Asterisk.
 *
 * SESSION SHAPE:
 *   {
 *     id:           string,   // unique session ID (= SIP Call-ID)
 *     callerId:     string,   // caller phone number or SIP URI
 *     formName:     string,   // name of the form being filled
 *     history:      Array,    // [{role, content}, ...] for LLM context
 *     activeField:  object,   // current form field from Chrome Extension
 *     filledFields: object,   // { fieldLabel: value } collected so far
 *     startedAt:    Date,     // when the call connected
 *     lastActiveAt: Date,     // last time session was accessed (for TTL)
 *     turnCount:    number,   // total conversation turns so far
 *   }
 */

const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} sessionId → session object */
const _store = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// TTL Expiry Engine
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS      = config.session.ttlSeconds * 1000;
const SWEEP_MS    = 60_000; // run expiry sweep every 60 seconds

/**
 * Purges sessions that have been idle longer than TTL_MS.
 * Called automatically by the interval below.
 */
function sweepExpiredSessions() {
  const now     = Date.now();
  let   expired = 0;

  for (const [id, session] of _store.entries()) {
    const idleMs = now - session.lastActiveAt.getTime();
    if (idleMs > TTL_MS) {
      _store.delete(id);
      expired++;
      logger.debug('Session: expired and removed', {
        sessionId: id,
        idleSeconds: Math.round(idleMs / 1000),
        turnCount: session.turnCount,
      });
    }
  }

  if (expired > 0) {
    logger.info('Session: sweep complete', {
      expired,
      remaining: _store.size,
    });
  }
}

/**
 * Start the background expiry sweep.
 * unref() prevents this interval from keeping the Node.js process alive
 * if everything else has shut down — important for clean test exits.
 */
const _sweepInterval = setInterval(sweepExpiredSessions, SWEEP_MS).unref();

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Touches the lastActiveAt timestamp — resets the TTL clock.
 * Called on every get/update operation.
 */
function _touch(session) {
  session.lastActiveAt = new Date();
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new session for an incoming call.
 *
 * Called by the SIP handler (Step 7) when Asterisk fires a call-connect event.
 *
 * @param {object} opts
 * @param {string} [opts.callerId]  - Caller's phone number or SIP URI
 * @param {string} [opts.formName] - Name of the form (from Chrome Extension handshake)
 * @param {string} [opts.id]       - Override session ID (default: auto-generated UUID)
 *
 * @returns {object} The newly created session
 */
function create({ callerId = 'unknown', formName = '', id } = {}) {
  const sessionId = id ?? uuidv4();

  if (_store.has(sessionId)) {
    logger.warn('Session: create() called with duplicate ID — returning existing', { sessionId });
    return _store.get(sessionId);
  }

  const session = {
    id:           sessionId,
    callerId,
    formName,
    history:      [],       // conversation history for LLM
    activeField:  null,     // current form field being filled
    filledFields: {},       // collected form values { label: value }
    startedAt:    new Date(),
    lastActiveAt: new Date(),
    turnCount:    0,
  };

  _store.set(sessionId, session);

  logger.info('Session: created', {
    sessionId,
    callerId,
    formName,
    totalActive: _store.size,
  });

  return session;
}

/**
 * Retrieves an existing session by ID.
 * Returns null if not found or expired.
 * Automatically touches lastActiveAt on access.
 *
 * @param {string} sessionId
 * @returns {object|null}
 */
function get(sessionId) {
  const session = _store.get(sessionId);
  if (!session) return null;
  return _touch(session);
}

/**
 * Appends a user message + assistant response to the session's history.
 * Also increments turnCount.
 *
 * Called by the voice pipeline after each LLM completion.
 *
 * @param {string} sessionId
 * @param {string} userText      - What the user said (from STT)
 * @param {string} assistantText - What FormPilot replied (from LLM)
 * @returns {object} Updated session
 */
function appendTurn(sessionId, userText, assistantText) {
  const session = get(sessionId);
  if (!session) {
    throw new Error(`[Session] appendTurn: session '${sessionId}' not found`);
  }

  session.history.push(
    { role: 'user',      content: userText       },
    { role: 'assistant', content: assistantText  },
  );
  session.turnCount++;

  logger.debug('Session: turn appended', {
    sessionId,
    turnCount:   session.turnCount,
    historyLen:  session.history.length,
  });

  return session;
}

/**
 * Updates the active form field for a session.
 * Called when the Chrome Extension (via Member 3's backend) signals that
 * the user focused a new form field.
 *
 * @param {string} sessionId
 * @param {object} fieldContext - { label, type, required, placeholder, pattern, currentValue }
 * @returns {object} Updated session
 */
function setActiveField(sessionId, fieldContext) {
  const session = get(sessionId);
  if (!session) {
    throw new Error(`[Session] setActiveField: session '${sessionId}' not found`);
  }

  const previousField = session.activeField?.label ?? 'none';
  session.activeField = fieldContext;

  logger.info('Session: active field changed', {
    sessionId,
    from:  previousField,
    to:    fieldContext?.label ?? 'unknown',
  });

  return session;
}

/**
 * Records a successfully collected form field value.
 * Called when the LLM (or the voice pipeline) confirms a valid value.
 *
 * @param {string} sessionId
 * @param {string} fieldLabel - The field name (e.g. "Full Name")
 * @param {string} value      - The collected value (e.g. "John Doe")
 * @returns {object} Updated session
 */
function recordFilledField(sessionId, fieldLabel, value) {
  const session = get(sessionId);
  if (!session) {
    throw new Error(`[Session] recordFilledField: session '${sessionId}' not found`);
  }

  session.filledFields[fieldLabel] = value;

  logger.info('Session: field value recorded', {
    sessionId,
    field:        fieldLabel,
    value,
    totalFilled:  Object.keys(session.filledFields).length,
  });

  return session;
}

/**
 * Destroys a session — called when a call hangs up.
 *
 * @param {string} sessionId
 * @returns {boolean} true if deleted, false if it didn't exist
 */
function destroy(sessionId) {
  const existed = _store.has(sessionId);

  if (existed) {
    const session = _store.get(sessionId);
    const durationSec = Math.round(
      (Date.now() - session.startedAt.getTime()) / 1000
    );

    logger.info('Session: destroyed (call ended)', {
      sessionId,
      turnCount:    session.turnCount,
      filledFields: Object.keys(session.filledFields).length,
      durationSec,
    });

    _store.delete(sessionId);
  }

  return existed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a snapshot of all active sessions (for health/debug endpoints).
 * Strips the full history array to keep the response compact.
 *
 * @returns {Array<object>}
 */
function listActive() {
  return Array.from(_store.values()).map(({ history: _h, ...rest }) => ({
    ...rest,
    historyLength: _h.length,
  }));
}

/**
 * Returns the count of currently active sessions.
 * @returns {number}
 */
function count() {
  return _store.size;
}

/**
 * Stops the background TTL sweep interval.
 * Call this during graceful shutdown to allow the process to exit cleanly.
 */
function shutdown() {
  clearInterval(_sweepInterval);
  logger.info('Session: TTL sweep stopped', { remainingSessions: _store.size });
}

module.exports = {
  create,
  get,
  appendTurn,
  setActiveField,
  recordFilledField,
  destroy,
  listActive,
  count,
  shutdown,
};
