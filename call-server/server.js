/**
 * VoxFill call-server/server.js
 *
 * Isolated Express application for outbound phone calls. This server is kept
 * separate from the Chrome extension so existing chatbot, voice assistant, and
 * autofill code continue to run through their current extension paths.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const callRoutes = require('./routes/call');

const app = express();
const port = Number(process.env.PORT || 5001);

app.use(cors());
app.use(express.json({ limit: '16kb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'voxfill-call-server' });
});

app.use('/api/call', callRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found.',
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled call server error:', err);
  res.status(500).json({
    success: false,
    error: 'Unexpected server error.',
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`VoxFill call server listening on http://localhost:${port}`);
  });
}

module.exports = app;
