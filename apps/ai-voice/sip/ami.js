'use strict';

/**
 * sip/ami.js — Asterisk Manager Interface (AMI) Client
 *
 * WHAT IT DOES:
 *   Connects to Asterisk's Manager Interface over TCP (default port 5038).
 *   Listens for call lifecycle events (Hangup, Newchannel, etc.) and emits
 *   them as Node.js EventEmitter events so the voice pipeline can react.
 *   Auto-reconnects if the connection drops.
 *
 * WHAT IS AMI:
 *   AMI is a text-based TCP protocol built into Asterisk. It lets external
 *   programs monitor and control Asterisk — like a management API.
 *   Asterisk sends events ("a call just hung up") and we send actions
 *   ("originate a call", "get channel info").
 *
 * WHY WE NEED AMI ALONGSIDE FASTAGI:
 *   FastAGI (agi.js) controls the audio for each call.
 *   AMI complements it by giving us system-wide visibility:
 *   - Detecting unexpected hangups before our AGI script ends
 *   - Getting channel variables not passed to AGI
 *   - Sending commands outside the AGI call flow
 *
 * AMI EVENTS WE CARE ABOUT:
 *   Hangup      → destroy session, cleanup TTS files
 *   Newchannel  → log new call for observability
 *   UserEvent   → custom events from extensions.conf (e.g. field changes)
 *
 * CONFIGURATION (.env):
 *   AMI_HOST     = 127.0.0.1
 *   AMI_PORT     = 5038
 *   AMI_USERNAME = formpilot          ← set in /etc/asterisk/manager.conf
 *   AMI_PASSWORD = <password>
 */

const Manager      = require('asterisk-manager');
const EventEmitter = require('events');
const config       = require('../config');
const logger       = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// AMI Client Class
// ─────────────────────────────────────────────────────────────────────────────

class AmiClient extends EventEmitter {
  constructor() {
    super();
    this._ami        = null;
    this._connected  = false;
    this._intentionalDisconnect = false;
  }

  // ── Connect ──────────────────────────────────────────────────────────────

  /**
   * Establishes the AMI connection.
   * Uses asterisk-manager's built-in keepConnected() for auto-reconnect.
   *
   * @returns {Promise<void>} Resolves when successfully connected and authenticated
   */
  connect() {
    return new Promise((resolve, reject) => {
      logger.info('AMI: connecting...', {
        host: config.asterisk.host,
        port: config.asterisk.port,
        user: config.asterisk.username,
      });

      this._ami = new Manager(
        config.asterisk.port,
        config.asterisk.host,
        config.asterisk.username,
        config.asterisk.password,
        true,   // true = subscribe to all events
      );

      // Auto-reconnect on disconnect
      this._ami.keepConnected();

      // ── Event Handlers ─────────────────────────────────────────────────

      this._ami.on('connect', () => {
        this._connected = true;
        logger.info('AMI: connected and authenticated', {
          host: config.asterisk.host,
          port: config.asterisk.port,
        });
        this.emit('connected');
        resolve();
      });

      this._ami.on('error', (err) => {
        logger.error('AMI: connection error', { error: err.message });
        this._connected = false;
        this.emit('error', err);

        // Only reject on first connect — after that keepConnected handles it
        reject(err);
      });

      this._ami.on('close', () => {
        this._connected = false;
        if (!this._intentionalDisconnect) {
          logger.warn('AMI: connection closed — will auto-reconnect', {
            delayMs: config.asterisk.reconnectDelayMs,
          });
          this.emit('disconnected');
        }
      });

      // ── Forward AMI Events ─────────────────────────────────────────────

      /**
       * Hangup: A call has ended.
       * We forward this so the voice pipeline can destroy the session
       * even if the caller hung up mid-AGI (before our script ended).
       */
      this._ami.on('hangup', (event) => {
        logger.info('AMI: call hangup', {
          channel:  event.channel,
          uniqueid: event.uniqueid,
          cause:    event.cause,
          causetxt: event['cause-txt'],
        });
        this.emit('call:hangup', {
          channel:  event.channel,
          uniqueid: event.uniqueid,
          cause:    event.cause,
        });
      });

      /**
       * Newchannel: A new call channel was created.
       * Useful for logging and early session preparation.
       */
      this._ami.on('newchannel', (event) => {
        logger.info('AMI: new channel', {
          channel:   event.channel,
          callerid:  event.calleridnum,
          uniqueid:  event.uniqueid,
        });
        this.emit('call:new', {
          channel:  event.channel,
          callerId: event.calleridnum,
          uniqueid: event.uniqueid,
        });
      });

      /**
       * UserEvent: Custom events sent from the Asterisk dialplan.
       * We use this to receive field-change signals from extensions.conf.
       *
       * Dialplan syntax to trigger from extensions.conf:
       *   UserEvent(FieldChange,UniqueID: ${UNIQUEID},Field: ${FIELD_NAME})
       */
      this._ami.on('userevent', (event) => {
        logger.debug('AMI: UserEvent received', { event });
        this.emit('userevent', event);
      });

    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Sends an AMI action to Asterisk.
   * Wraps the callback-based asterisk-manager API with a Promise.
   *
   * @param {object} action - AMI action object (must include `action` key)
   * @returns {Promise<object>} AMI response
   */
  sendAction(action) {
    return new Promise((resolve, reject) => {
      if (!this._connected) {
        return reject(new Error('AMI: cannot send action — not connected'));
      }
      this._ami.action(action, (err, response) => {
        if (err) return reject(err);
        resolve(response);
      });
    });
  }

  /**
   * Gets the value of a channel variable.
   *
   * @param {string} channel  - Asterisk channel name (e.g. 'SIP/1001-00000001')
   * @param {string} variable - Variable name
   * @returns {Promise<string>} Variable value
   */
  async getVariable(channel, variable) {
    const response = await this.sendAction({
      action:   'Getvar',
      channel,
      variable,
    });
    return response.value ?? '';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Gracefully disconnects from AMI.
   */
  disconnect() {
    this._intentionalDisconnect = true;
    this._ami?.disconnect?.();
    this._connected = false;
    logger.info('AMI: disconnected (intentional)');
  }

  /** @returns {boolean} */
  isConnected() {
    return this._connected;
  }
}

module.exports = new AmiClient(); // export singleton instance
