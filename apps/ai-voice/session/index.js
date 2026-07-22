'use strict';

/**
 * session/index.js — Public Interface for Session Management
 *
 * FAÇADE (same pattern as stt/ and tts/):
 *   All external code imports from here. If we ever migrate from in-memory
 *   to Redis for scalability, only store.js changes — this interface stays.
 *
 * PUBLIC API (what the voice pipeline and SIP handler call):
 *
 *   create({ callerId, formName, id })   → session object
 *   get(sessionId)                       → session | null
 *   appendTurn(id, userText, aiText)     → session
 *   setActiveField(id, fieldContext)     → session
 *   recordFilledField(id, label, value)  → session
 *   destroy(sessionId)                   → boolean
 *   listActive()                         → session[] (no history arrays)
 *   count()                              → number
 *   shutdown()                           → void
 *
 * TYPICAL CALL LIFECYCLE:
 *
 *   1. Asterisk fires call-connect event
 *      → session.create({ callerId: '+1555...', formName: 'Admission Form' })
 *
 *   2. Chrome Extension signals active field changed
 *      → session.setActiveField(id, { label: 'Full Name', type: 'text', required: true })
 *
 *   3. User speaks → STT → LLM → TTS, repeat
 *      → session.appendTurn(id, 'my name is john', 'Got it John! Date of birth?')
 *
 *   4. Field value confirmed
 *      → session.recordFilledField(id, 'Full Name', 'John Doe')
 *
 *   5. Call ends
 *      → session.destroy(id)
 */

module.exports = require('./store');
