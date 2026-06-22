const express = require('express');
const router = express.Router();
const { pool } = require('../database/connection');

router.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
    res.status(200).json({
            status: 'healthy',
            service: 'myl-sms-agent',
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            database: 'connected',
            uptime: process.uptime()
      });
} catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'myl-sms-agent',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
});
}
});

router.get('/', (req, res) => {
  res.status(200).json({ service: 'MYL SMS Agent - Maya', status: 'running', version: '1.0.0' });
});

const healthRoutes = router;
module.exports = { healthRoutes };
