require('dotenv').config();
const app = require('./app');
const { connectDatabase } = require('./database/connection');
const { startFollowUpScheduler } = require('./workflows/followUpScheduler');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
      await connectDatabase();
          logger.info('Database connected successfully');

              startFollowUpScheduler();
                  logger.info('Follow-up scheduler started');

                      app.listen(PORT, '0.0.0.0', () => {
                            logger.info(`MYL SMS Agent running on port ${PORT}`);
                                  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
                                      });
                                        } catch (error) {
                                            logger.error('Failed to start server:', error);
                                                process.exit(1);
                                                  }
                                                  }

                                                  process.on('unhandledRejection', (reason, promise) => {
                                                    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
                                                    });

                                                    process.on('uncaughtException', (error) => {
                                                      logger.error('Uncaught Exception:', error);
                                                        process.exit(1);
                                                        });

                                                        startServer();
