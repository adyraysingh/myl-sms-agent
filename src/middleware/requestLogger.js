const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
    const { method, url, ip } = req;

      res.on('finish', () => {
          const duration = Date.now() - start;
              const { statusCode } = res;
                  logger.info('HTTP Request', {
                        method,
                              url,
                                    statusCode,
                                          duration: `${duration}ms`,
                                                ip: req.headers['x-forwarded-for'] || ip
                                                    });
                                                      });

                                                        next();
                                                        }

                                                        module.exports = { requestLogger };
