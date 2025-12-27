// ============================================================================
// server.js
// ============================================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const apiRoutes = require('./apiRoutes');
const { setupWebSocketServer } = require('./websocketHandler');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors({
  origin: '*', // Configure based on your frontend URL in production
  credentials: true
}));
app.use(express.json());

// Basic API routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'Chat Server Running',
    version: '2.0',
    timestamp: new Date().toISOString(),
    websocket: `ws://${req.get('host')}`,
    endpoints: {
      health: '/api/health'
    }
  });
});

const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });
setupWebSocketServer(wss);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║          🚀 CHAT SERVER STARTED SUCCESSFULLY 🚀          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  console.log(`📡 HTTP Server:      http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket Server: ws://0.0.0.0:${PORT}`);
  console.log(`⏰ Started at:       ${new Date().toLocaleString()}`);
  console.log('\n═══════════════════════════════════════════════════════════\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n\n🛑 SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});
