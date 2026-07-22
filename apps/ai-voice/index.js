'use strict';

/**
 * index.js — FormPilot AI Voice & Intelligence Service Entry Point
 *
 * WHAT THIS FILE DOES:
 *   1. Loads centralised configuration & Winston logger.
 *   2. Launches Express HTTP server for integration APIs (Member 2 Chrome Extension & Member 3 Backend).
 *   3. Starts FastAGI TCP server (port 4573) and wires incoming SIP calls to the AI Voice Pipeline.
 *   4. Connects to Asterisk AMI (port 5038) for system-wide telephony event monitoring.
 *   5. Triggers eager warmup for Whisper STT and verifies local Ollama LLM readiness.
 *   6. Handles SIGINT / SIGTERM for graceful application shutdown.
 */

const express  = require('express');
const config   = require('./config');
const logger   = require('./utils/logger');
const stt      = require('./stt');
const tts      = require('./tts');
const { llm }  = require('./services');
const sessions = require('./session');
const { agiServer, ami } = require('./sip');
const voice    = require('./voice');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Express Application Setup
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`HTTP ${req.method} ${req.path}`);
  next();
});

// ── REST API Endpoints ───────────────────────────────────────────────────────

/**
 * GET /health — Complete system readiness and diagnostics endpoint
 */
app.get('/health', async (req, res) => {
  const ollamaStatus = await llm.ping();

  const status = {
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'formpilot-ai-voice',
    version: '1.0.0',
    components: {
      stt: { ready: stt.isReady(), model: config.stt.model },
      tts: { ready: tts.isAvailable(), binary: config.tts.piperBinaryPath },
      llm: ollamaStatus,
      sip: {
        fastAgiListening: agiServer.isListening(),
        amiConnected: ami.isConnected(),
      },
      sessions: { activeCount: sessions.count() },
    },
  };

  const isHealthy = status.components.stt.ready && ollamaStatus.reachable && status.components.sip.fastAgiListening;
  res.status(isHealthy ? 200 : 503).json(status);
});

/**
 * POST /api/session/field — Update active field for a session
 * Called by Member 3 Backend when user focuses a new form field in Chrome Extension
 *
 * Body: { sessionId: string, label: string, type?: string, required?: boolean, placeholder?: string }
 */
app.post('/api/session/field', (req, res) => {
  const { sessionId, label, type, required, placeholder, currentValue } = req.body;

  if (!sessionId || !label) {
    return res.status(400).json({ error: 'sessionId and label are required' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: `Session '${sessionId}' not found` });
  }

  sessions.setActiveField(sessionId, {
    label,
    type: type || 'text',
    required: !!required,
    placeholder: placeholder || '',
    currentValue: currentValue || '',
  });

  logger.info('API: session active field updated', { sessionId, label });
  res.json({ success: true, sessionId, activeField: label });
});

/**
 * GET /api/session/active — List all currently active call sessions
 */
app.get('/api/session/active', (req, res) => {
  res.json({
    count: sessions.count(),
    sessions: sessions.listActive(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Main Boot Sequence
// ─────────────────────────────────────────────────────────────────────────────

async function startServer() {
  logger.info('====================================================');
  logger.info('Starting FormPilot AI Voice & Intelligence Service');
  logger.info('====================================================');

  // 1. Wire FastAGI events to Voice Pipeline
  voice.wireAGIServer(agiServer);

  // 2. Start FastAGI Server
  try {
    await agiServer.start(4573, '127.0.0.1');
  } catch (err) {
    logger.error('Failed to start FastAGI server', { error: err.message });
    process.exit(1);
  }

  // 3. Connect to Asterisk AMI (Non-fatal if PBX is offline)
  ami.connect().catch((err) => {
    logger.warn('AMI connection deferred — Asterisk PBX may not be running yet', { error: err.message });
  });

  // 4. Start HTTP API Server
  const server = app.listen(config.server.port, () => {
    logger.info(`HTTP Server listening on port ${config.server.port}`, {
      env: config.server.env,
      healthUrl: `http://localhost:${config.server.port}/health`,
    });
  });

  // 5. Eager Warmup for STT (Whisper model loading)
  stt.warmup().catch((err) => {
    logger.warn('Background STT warmup encountered error', { error: err.message });
  });

  // 6. Check Ollama LLM status
  llm.ping().then((status) => {
    if (!status.reachable) {
      logger.warn('Ollama LLM is unreachable. Ensure "ollama serve" is running.');
    } else if (!status.modelInstalled) {
      logger.warn(`Ollama model ${config.ollama.model} not found. Run "ollama pull ${config.ollama.model}".`);
    } else {
      logger.info('Ollama LLM verified and ready.');
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Graceful Shutdown
  // ───────────────────────────────────────────────────────────────────────────

  async function shutdown(signal) {
    logger.info(`Received ${signal} — initiating graceful shutdown...`);

    server.close(() => {
      logger.info('HTTP server closed');
    });

    await agiServer.stop();
    ami.disconnect();
    sessions.shutdown();

    logger.info('Shutdown complete. Goodbye!');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer();
