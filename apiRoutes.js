// ============================================================================
// apiRoutes.js
// ============================================================================

const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'Server is running!',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Get server stats (optional)
router.get('/stats', (req, res) => {
  res.status(200).json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;