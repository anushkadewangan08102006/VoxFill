'use strict';

/**
 * voice/index.js — Public Entry Point for Voice Module & FastAGI Listener Wiring
 *
 * WHAT IT DOES:
 *   Subscribes to the FastAGI server's 'call' event and routes incoming calls
 *   directly into the voice pipeline orchestrator (pipeline.handleCall).
 *
 * PUBLIC INTERFACE:
 *   - handleCall(call)   → manual entry point for processing a Call object
 *   - wireAGIServer(agi) → hooks the FastAGI server events to the pipeline
 */

const { handleCall } = require('./pipeline');
const logger         = require('../utils/logger');

/**
 * Hooks an AGIServer instance to automatically process incoming calls.
 *
 * @param {import('../sip/agi')} agiServerInstance
 */
function wireAGIServer(agiServerInstance) {
  agiServerInstance.on('call', async (call) => {
    logger.info('Voice: new incoming SIP/AGI call routed to pipeline', {
      callId:   call.id,
      callerId: call.callerId,
    });

    try {
      await handleCall(call);
    } catch (err) {
      logger.error('Voice: uncaught pipeline error', {
        callId: call.id,
        error:  err.message,
      });
    }
  });

  logger.info('Voice: FastAGI event handler attached');
}

module.exports = {
  handleCall,
  wireAGIServer,
};
