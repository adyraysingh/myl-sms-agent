const express = require('express');
const router = express.Router();
const { handleNewLead } = require('./handlers/zohoWebhook');
const { handleInboundSMS } = require('./handlers/twilioWebhook');
const { handleOnboardingCompleted } = require('./handlers/onboardingWebhook');
const { verifyZohoWebhook } = require('../middleware/webhookVerification');
const { verifyTwilioWebhook } = require('../middleware/twilioVerification');
const logger = require('../utils/logger');

router.post('/zoho/new-lead', verifyZohoWebhook, async (req, res) => {
  try {
      logger.info('Zoho new lead webhook received');
          res.status(200).json({ status: 'received', timestamp: new Date().toISOString() });
              setImmediate(() => handleNewLead(req.body));
                } catch (error) {
                    logger.error('Zoho webhook error:', error);
                        res.status(500).json({ error: 'Internal server error' });
                          }
                          });

                          router.post('/twilio/inbound', verifyTwilioWebhook, async (req, res) => {
                            try {
                                logger.info('Twilio inbound SMS', { from: req.body.From });
                                    res.set('Content-Type', 'text/xml');
                                        res.send('<Response></Response>');
                                            setImmediate(() => handleInboundSMS(req.body));
                                              } catch (error) {
                                                  logger.error('Twilio webhook error:', error);
                                                      res.set('Content-Type', 'text/xml');
                                                          res.send('<Response></Response>');
                                                            }
                                                            });

                                                            router.post('/onboarding-completed', verifyZohoWebhook, async (req, res) => {
                                                              try {
                                                                  logger.info('Onboarding completed');
                                                                      res.status(200).json({ status: 'received', timestamp: new Date().toISOString() });
                                                                          setImmediate(() => handleOnboardingCompleted(req.body));
                                                                            } catch (error) {
                                                                                logger.error('Onboarding webhook error:', error);
                                                                                    res.status(500).json({ error: 'Internal server error' });
                                                                                      }
                                                                                      });

                                                                                      const webhookRoutes = router;
                                                                                      module.exports = { webhookRoutes };
