/**
 * VoxFill call-server/routes/call.js
 *
 * Defines the small public API surface for phone calling. Keeping routes in a
 * dedicated module lets future AI streaming or call-status endpoints be added
 * without touching extension voice/autofill files.
 */
const express = require('express');
const { startCall } = require('../controllers/callController');

const router = express.Router();

router.post('/', startCall);

module.exports = router;
