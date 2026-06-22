const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
  };

  // Check if DATABASE_URL is configured
  if (process.env.DATABASE_URL) {
    healthData.database = 'configured';
  } else {
    healthData.database = 'not configured';
  }

  res.status(200).json(healthData);
});

router.get('/', (req, res) => {
    res.status(200).json({ message: 'MYL SMS Agent is running', status: 'ok' });
});

module.exports = { healthRoutes: router };
