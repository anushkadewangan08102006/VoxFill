'use strict';

/**
 * voice/pipeline.js — AI Voice Call Orchestrator
 *
 * WHAT IT DOES:
 *   This is the heart of FormPilot AI. It receives a live Call object
 *   from the FastAGI server and runs the full AI voice loop:
 *
 *     1. Create session        (track conversation state)
 *     2. Answer the call       (pick up the phone)
 *     3. Greet the user        (LLM → TTS → play)
 *     4. LOOP until hangup:
 *        a. Record user speech  (Asterisk captures audio → WAV file)
 *        b. Transcribe (STT)    (Whisper → text)
 *        c. Build prompt        (session history + field context + transcript)
 *        d. LLM inference       (Ollama → response text)
 *        e. Synthesize (TTS)    (Piper → WAV file)
 *        f. Play response       (Asterisk streams audio to caller)
 *     5. Cleanup               (destroy session, delete TTS files)
 *
 * ERROR PHILOSOPHY:
 *   - STT empty/unclear  → prompt user to repeat (non-fatal)
 *   - STT/LLM/TTS error  → speak apology, retry once, then graceful hangup
 *   - Unexpected hangup  → session.destroy() fires via event listener
 *   - Never crash        → all errors are caught and handled
 *
 * CONCURRENCY:
 *   Each call runs in its own async execution context.
 *   Multiple concurrent calls are naturally isolated — each has its
 *   own Call object, its own session, its own loop iteration.
 *   No shared mutable state between calls.
 */

const stt      = require('../stt');
const tts      = require('../tts');
const { llm }  = require('../services');
const prompt   = require('../prompts');
const sessions = require('../session');
const logger   = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Safety cap: hang up after this many turns (prevents runaway calls on demo day) */
const MAX_TURNS = 30;

/**
 * Min transcript length to be considered a real utterance.
 * Whisper sometimes returns "." or "the" on silence/noise.
 */
const MIN_TRANSCRIPT_CHARS = 3;

/** How many consecutive clarification attempts before we give up */
const MAX_CLARIFICATION_ATTEMPTS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synthesizes text and plays it on the call, then deletes the TTS file.
 * The finally block guarantees cleanup even if playback throws
 * (e.g. caller hangs up mid-playback).
 *
 * @param {import('../sip/agi').Call} call
 * @param {string} text - Text to speak
 */
async function speak(call, text) {
  const audioFile = await tts.synthesize(text);
  try {
    await call.play(audioFile);
  } finally {
    await tts.cleanup(audioFile);
  }
}

/**
 * Gets an LLM response for the given messages array and speaks it.
 * Returns the response text so the caller can update session history.
 *
 * @param {import('../sip/agi').Call} call
 * @param {Array}  messages  - Full messages array from prompt builder
 * @param {string} sessionId - For logging
 * @returns {Promise<string>} The LLM response text
 */
async function thinkAndSpeak(call, messages, sessionId) {
  const { text, duration_ms } = await llm.chat(messages);

  logger.debug('Pipeline: LLM responded', {
    sessionId,
    duration_ms,
    preview: text.slice(0, 60),
  });

  await speak(call, text);
  return text;
}

/**
 * Speaks a graceful error message before hanging up.
 * TTS is attempted once — if TTS itself fails, we just hang up silently.
 *
 * @param {import('../sip/agi').Call} call
 * @param {string} reason - Short internal reason (for logging only)
 */
async function gracefulHangup(call, reason) {
  logger.warn('Pipeline: graceful hangup triggered', { callId: call.id, reason });

  if (call.isAlive()) {
    try {
      await speak(
        call,
        'I am sorry, I ran into a problem. Please try calling again. Goodbye.',
      );
    } catch (_) {
      // TTS or playback failed — caller probably already hung up
    }
  }

  if (call.isAlive()) {
    await call.hangup().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Greeting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Greets the caller at the start of the call.
 * This is the first thing the caller hears.
 *
 * Unlike normal turns, there is no user input — we inject a
 * 'greeting' intent override so the LLM generates an opening message.
 *
 * @param {import('../sip/agi').Call} call
 * @param {object} session
 */
async function greetCaller(call, session) {
  const messages = prompt.buildGreeting(session.activeField);
  const reply    = await thinkAndSpeak(call, messages, session.id);

  // Push the greeting into history as an assistant message (no user turn)
  session.history.push({ role: 'assistant', content: reply });

  logger.info('Pipeline: greeting delivered', { sessionId: session.id });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Main Conversation Loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a single conversation turn:
 *   record → STT → prompt → LLM → TTS → play
 *
 * @param {import('../sip/agi').Call} call
 * @param {object} session
 * @returns {Promise<'ok'|'clarify'|'hangup'>}
 *   'ok'      → turn completed successfully
 *   'clarify' → transcript was empty/too short, need to ask again
 *   'hangup'  → caller hung up, stop the loop
 */
async function runTurn(call, session) {
  // ── 1. Record the caller's voice ─────────────────────────────────────────
  let audioPath;
  try {
    audioPath = await call.record();
  } catch (err) {
    if (!call.isAlive()) return 'hangup';
    throw err;
  }

  if (!call.isAlive()) return 'hangup';

  // ── 2. Transcribe audio → text ───────────────────────────────────────────
  let transcript;
  try {
    const result = await stt.transcribe(audioPath);
    transcript   = result.text;
  } catch (err) {
    logger.error('Pipeline: STT failed', { sessionId: session.id, error: err.message });
    return 'clarify';
  }

  logger.info('Pipeline: user said', {
    sessionId:  session.id,
    transcript,
    turnCount:  session.turnCount + 1,
  });

  // ── 3. Handle empty/noise transcription ──────────────────────────────────
  if (!transcript || transcript.length < MIN_TRANSCRIPT_CHARS) {
    logger.warn('Pipeline: transcript too short — requesting clarification', {
      sessionId:  session.id,
      transcript: `"${transcript}"`,
    });
    return 'clarify';
  }

  // ── 4. Build the prompt with full context ────────────────────────────────
  const messages = prompt.buildMessages({
    transcript,
    fieldContext: session.activeField ?? {},
    history:      session.history,
  });

  // ── 5. Get LLM response and speak it ────────────────────────────────────
  let reply;
  try {
    reply = await thinkAndSpeak(call, messages, session.id);
  } catch (err) {
    logger.error('Pipeline: LLM/TTS failed', { sessionId: session.id, error: err.message });
    if (!call.isAlive()) return 'hangup';
    throw err;
  }

  if (!call.isAlive()) return 'hangup';

  // ── 6. Update session history ─────────────────────────────────────────────
  sessions.appendTurn(session.id, transcript, reply);

  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles a complete call from answer to hangup.
 *
 * This function is called by voice/index.js every time the FastAGI server
 * emits a 'call' event (i.e. every time a SIP call comes in).
 *
 * It is intentionally self-contained — all error handling is internal.
 * Crashes inside this function should NEVER bubble up to the AGI server.
 *
 * @param {import('../sip/agi').Call} call - Live Call object from FastAGI server
 */
async function handleCall(call) {
  const startTime = Date.now();

  logger.info('Pipeline: call received', {
    callId:   call.id,
    channel:  call.channel,
    callerId: call.callerId,
  });

  // ── Create session ────────────────────────────────────────────────────────
  const session = sessions.create({
    id:       call.uniqueId, // tie session to Asterisk's unique call ID
    callerId: call.callerId,
  });

  // ── Handle unexpected hangup ──────────────────────────────────────────────
  // If the caller drops mid-call (before our loop checks isAlive()),
  // this ensures the session is still cleaned up.
  call.once('hangup', () => {
    if (sessions.get(session.id)) {
      sessions.destroy(session.id);
    }
  });

  try {
    // ── Answer the call ───────────────────────────────────────────────────
    await call.answer();

    // ── Warm up STT model while we could still be setting up ─────────────
    // (non-blocking — we don't await; it runs in background)
    if (!stt.isReady()) {
      stt.warmup().catch((err) =>
        logger.warn('Pipeline: STT warmup failed', { error: err.message })
      );
    }

    // ── Greet the caller ──────────────────────────────────────────────────
    await greetCaller(call, session);

    // ── Main conversation loop ─────────────────────────────────────────────
    let turnCount            = 0;
    let clarificationStreak  = 0; // consecutive unclear inputs

    while (call.isAlive() && turnCount < MAX_TURNS) {
      turnCount++;

      logger.debug('Pipeline: starting turn', {
        sessionId: session.id,
        turn:      turnCount,
      });

      const outcome = await runTurn(call, session);

      if (outcome === 'hangup') {
        logger.info('Pipeline: caller hung up', { sessionId: session.id, turn: turnCount });
        break;
      }

      if (outcome === 'clarify') {
        clarificationStreak++;

        if (clarificationStreak >= MAX_CLARIFICATION_ATTEMPTS) {
          logger.warn('Pipeline: too many failed clarifications — ending call', {
            sessionId: session.id,
            streak:    clarificationStreak,
          });
          await speak(
            call,
            'I am sorry, I am having trouble hearing you. Please try calling again. Goodbye.',
          ).catch(() => {});
          break;
        }

        // Ask the user to repeat
        const clarifyMessages = prompt.buildClarification(
          session.activeField ?? {},
          session.history,
        );
        const clarifyReply = await thinkAndSpeak(call, clarifyMessages, session.id)
          .catch(() => '');

        if (clarifyReply) {
          session.history.push({ role: 'assistant', content: clarifyReply });
        }

        continue;
      }

      // Successful turn — reset clarification streak
      clarificationStreak = 0;

      if (turnCount >= MAX_TURNS) {
        logger.warn('Pipeline: MAX_TURNS reached — ending call', { sessionId: session.id });
        await speak(call, 'We have reached the time limit. Please call back to continue.').catch(() => {});
        break;
      }
    }

  } catch (err) {
    // Unexpected error in the pipeline — speak apology and hang up
    logger.error('Pipeline: unhandled error in call', {
      sessionId: session.id,
      error:     err.message,
      stack:     err.stack,
    });
    await gracefulHangup(call, err.message);

  } finally {
    // ── Always cleanup ────────────────────────────────────────────────────
    const durationMs = Date.now() - startTime;

    // Destroy session if it wasn't already destroyed by the hangup event
    if (sessions.get(session.id)) {
      sessions.destroy(session.id);
    }

    if (call.isAlive()) {
      await call.hangup().catch(() => {});
    }

    logger.info('Pipeline: call complete', {
      callId:     call.id,
      sessionId:  session.id,
      durationMs,
      turns:      session.turnCount,
      fieldsFilled: Object.keys(session.filledFields ?? {}).length,
    });
  }
}

module.exports = { handleCall };
