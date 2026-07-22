'use strict';

/**
 * sip/index.js — Public Interface for the SIP Layer
 *
 * EXPORTS:
 *   ami        → AmiClient singleton  (EventEmitter, call monitoring)
 *   agiServer  → AGIServer singleton  (EventEmitter, call control)
 *
 * STARTUP SEQUENCE (called from index.js):
 *   1. agiServer.start()  → bind TCP 4573, ready to receive Asterisk connections
 *   2. ami.connect()      → connect to Asterisk AMI on TCP 5038
 *      (AMI connect is non-fatal — system works without it, just loses monitoring)
 *
 * SHUTDOWN SEQUENCE (called from index.js SIGTERM handler):
 *   1. agiServer.stop()   → stop accepting new calls
 *   2. ami.disconnect()   → close AMI TCP connection
 *
 * HOW THE VOICE PIPELINE USES THIS:
 *   const { agiServer, ami } = require('../sip');
 *
 *   agiServer.on('call', async (call) => {
 *     // call is a Call instance with .answer() .play() .record() .hangup()
 *     await call.answer();
 *     // ... full AI loop (Step 8)
 *   });
 *
 *   ami.on('call:hangup', ({ uniqueid }) => {
 *     // Destroy session for this call
 *   });
 */

const ami       = require('./ami');
const agiServer = require('./agi');

module.exports = { ami, agiServer };
