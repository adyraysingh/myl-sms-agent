require('dotenv').config();
const app = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

// Start HTTP server immediately so healthcheck passes
const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`MYL SMS Agent running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Then attempt database connection and scheduler (non-blocking)
async function initializeServices() {
    if (!process.env.DATABASE_URL) {
          logger.warn('DATABASE_URL not set - running without database. Some features will be unavailable.');
          return;
    }

  try {
        const { connectDatabase } = require('./database/connection');
        await connectDatabase();
        logger.info('Database connected successfully');

      const { startFollowUpScheduler } = require('./workflows/followUpScheduler');
        startFollowUpScheduler();
        logger.info('Follow-up scheduler started');
  } catch (error) {
        logger.error('Failed to initialize services:', error.message);
        logger.warn('Server running in degraded mode - database unavailable');
  }
}

initializeServices();

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
          logger.info('Process terminated');
          process.exit(0);
    });
});
