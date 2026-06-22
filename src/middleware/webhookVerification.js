const crypto = require('crypto');
const logger = require('../utils/logger');

function verifyZohoWebhook(req, res, next) {
  const webhookSecret = process.env.WEBHOOK_SECRET;

    // If no secret configured, allow in development
      if (!webhookSecret) {
          if (process.env.NODE_ENV === 'production') {
                logger.warn('WEBHOOK_SECRET not configured in production!');
                      return res.status(401).json({ error: 'Webhook verification failed' });
                          }
                              logger.warn('WEBHOOK_SECRET not set - skipping verification in development');
                                  return next();
                                    }

                                      const signature = req.headers['x-webhook-signature'] || req.headers['x-zoho-webhook-token'] || '';

                                        // Allow requests with correct secret in header
                                          if (signature === webhookSecret) {
                                              return next();
                                                }

                                                  // Also support HMAC verification
                                                    const body = JSON.stringify(req.body);
                                                      const expectedSig = crypto
                                                          .createHmac('sha256', webhookSecret)
                                                              .update(body)
                                                                  .digest('hex');

                                                                    if (signature === expectedSig || signature === `sha256=${expectedSig}`) {
                                                                        return next();
                                                                          }

                                                                            logger.warn('Webhook verification failed', { signature: signature.substring(0, 20) });
                                                                              res.status(401).json({ error: 'Webhook verification failed' });
                                                                              }

                                                                              module.exports = { verifyZohoWebhook };
