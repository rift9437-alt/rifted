/**
 * Riftted Realities - Simple Express Server
 * Ready for Render (binds 0.0.0.0 + process.env.PORT)
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check (needed for Render)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Riftted Realities',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║     RIFTTED REALITIES — ONLINE           ║
║  → http://localhost:${PORT}                 ║
║  → Health: /health                       ║
╚══════════════════════════════════════════╝
  `);
});
