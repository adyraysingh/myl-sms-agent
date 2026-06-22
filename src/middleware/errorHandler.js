const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

      logger.error('Unhandled error:', {
          status,
              message,
                  stack: err.stack,
                      url: req.url,
                          method: req.method
                            });

                              // Don't expose internal errors in production
                                const responseMessage = process.env.NODE_ENV === 'production' && status === 500
                                    ? 'Internal Server Error'
                                        : message;

                                          res.status(status).json({
                                              error: responseMessage,
                                                  ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
                                                    });
                                                    }

                                                    module.exports = { errorHandler };
