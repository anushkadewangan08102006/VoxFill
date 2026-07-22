'use strict';

/**
 * utils/logger.js — Production-Grade Logger (Winston)
 *
 * WHY WINSTON OVER console.log:
 *   - Log levels (error, warn, info, debug) let us filter noise in production
 *   - Rotating file transport prevents disk from filling up
 *   - JSON file logs can be ingested by monitoring tools (Grafana, ELK)
 *   - Colourised console output is readable during development
 *   - Error stack traces are automatically captured
 *
 * WHY NOT alternatives:
 *   - pino: faster but less configurable transport system
 *   - bunyan: abandoned, outdated
 *   - morgan: HTTP-only, not general purpose
 *
 * USAGE:
 *   const logger = require('./utils/logger');
 *   logger.info('STT transcription complete', { duration_ms: 340 });
 *   logger.error('Ollama unreachable', { url: config.ollama.baseUrl });
 *   logger.warn('Session TTL approaching', { sessionId });
 *   logger.debug('Raw AMI event', { event });   // only shown at LOG_LEVEL=debug
 */

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const { combine, timestamp, colorize, printf, errors, json, splat } = format;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_NAME = 'formpilot-ai';
const LOG_DIR      = path.resolve(process.cwd(), 'logs');
const LOG_LEVEL    = process.env.LOG_LEVEL || 'info';

// ─────────────────────────────────────────────────────────────────────────────
// Formats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Human-readable format for the console during development.
 * Example output:
 *   2025-01-15 10:30:22 [formpilot-ai] info: STT ready { model: 'base.en' }
 */
const consoleFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length
    ? `\n  ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}`
    : '';
  return `${ts} [${SERVICE_NAME}] ${level}: ${stack || message}${metaStr}`;
});

/**
 * Shared base format applied to all transports.
 * Captures Error stack traces, adds a timestamp, supports printf args (%s, %d).
 */
const baseFormat = combine(
  errors({ stack: true }),   // capture .stack on Error objects
  splat(),                   // support logger.info('msg %s', value)
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Logger Instance
// ─────────────────────────────────────────────────────────────────────────────

const logger = createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: SERVICE_NAME },
  format: baseFormat,

  transports: [

    // ── Console ──────────────────────────────────────────────────────────────
    // Colourised, human-readable. Used in development and visible in server logs.
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        consoleFormat,
      ),
    }),

    // ── Combined Log File (all levels, JSON) ─────────────────────────────────
    // Rotates daily. Keeps 14 days of logs. JSON format for easy parsing.
    new transports.DailyRotateFile({
      filename:    path.join(LOG_DIR, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '14d',
      format:      combine(json()),
      auditFile:   path.join(LOG_DIR, '.combined-audit.json'),
    }),

    // ── Error Log File (errors only, JSON) ───────────────────────────────────
    // Kept for 30 days — errors need longer retention for debugging.
    new transports.DailyRotateFile({
      level:       'error',
      filename:    path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '30d',
      format:      combine(json()),
      auditFile:   path.join(LOG_DIR, '.error-audit.json'),
    }),

  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: log unhandled exceptions and rejections to the error file
// ─────────────────────────────────────────────────────────────────────────────
logger.exceptions.handle(
  new transports.DailyRotateFile({
    filename:    path.join(LOG_DIR, 'exceptions-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles:    '14d',
    format:      combine(json()),
  }),
);

logger.rejections.handle(
  new transports.DailyRotateFile({
    filename:    path.join(LOG_DIR, 'rejections-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles:    '14d',
    format:      combine(json()),
  }),
);

module.exports = logger;
