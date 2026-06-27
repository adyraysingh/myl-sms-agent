require('dotenv').config();
const express = require('express');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;
const app = express();

// Health check FIRST - before anything else
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

// Start server immediately so health check works
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('MYL SMS Agent running on port ' + PORT);
  logger.info('Environment: ' + (process.env.NODE_ENV || 'development'));
  logger.info('Service URL: https://maya-ai-sales-production.up.railway.app');
});

// Load full app AFTER server is listening
let fullAppLoaded = false;
let WorkerRegistry = null;
try {
  const fullAppModule = require('./app');
  // app.js exports { app, WorkerRegistry }
  const fullApp = fullAppModule.app || fullAppModule;
  WorkerRegistry = fullAppModule.WorkerRegistry || null;
  app.use(fullApp);
  fullAppLoaded = true;
  logger.info('Full app loaded successfully');
} catch (err) {
  logger.error('Failed to load full app: ' + err.message);
  logger.error('Stack: ' + (err.stack || 'no stack'));
}

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
    logger.error('Services init failed: ' + error.message);
    logger.warn('Running in degraded mode');
  }
}

initializeServices();

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection: ' + reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception: ' + error.message);
  logger.error('Stack: ' + error.stack);
  process.exit(1);
});

// Phase 2: Graceful shutdown - stop workers before closing server
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received - starting graceful shutdown');
  // Stop accepting new HTTP requests
  server.close(() => {
    logger.info('HTTP server closed');
  });
  // Stop queue workers and wait for in-flight jobs
  if (WorkerRegistry && WorkerRegistry.isStarted()) {
    logger.info('Stopping queue workers...');
    try {
      await WorkerRegistry.stop();
      logger.info('Queue workers stopped cleanly');
    } catch (err) {
      logger.error('Error stopping workers: ' + err.message);
    }
  }
  logger.info('Graceful shutdown complete');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received - starting graceful shutdown');
  server.close(() => {});
  if (WorkerRegistry && WorkerRegistry.isStarted()) {
    await WorkerRegistry.stop().catch(() => {});
  }
  process.exit(0);
});
