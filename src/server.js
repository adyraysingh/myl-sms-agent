require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;
const app = express();

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: process.env.DATABASE_URL ? 'configured' : 'not configured'
  });
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'MYL SMS Agent - Maya is ready', status: 'ok' });
});

let fullApp = null;
try {
  fullApp = require('./app');
  logger.info('Full app loaded successfully');
} catch (err) {
  logger.error('Failed to load full app:', err.message);
}

if (fullApp) {
  app.use(fullApp);
}

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('MYL SMS Agent running on port ' + PORT);
  logger.info('Environment: ' + (process.env.NODE_ENV || 'development'));
  logger.info('Service URL: https://maya-ai-sales-production.up.railway.app');
});

async function initializeServices() {
  if (!process.env.DATABASE_URL) {
    logger.warn('DATABASE_URL not set - running without database');
    return;
  }
  try {
    const { connectDatabase } = require('./database/connection');
    await connectDatabase();
    logger.info('Database connected successfully');
    const { startFollowUpScheduler } = require('./workflows/followUpScheduler');
    startFollowUpScheduler();
    logger.info('Follow-up scheduler started');
    const { startSMSPoller } = require('./workflows/smsPoller');
    startSMSPoller();
    logger.info('SMS poller started');
  } catch (error) {
    logger.error('Services init failed:', error.message);
    logger.warn('Running in degraded mode');
  }
}

initializeServices();

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});
