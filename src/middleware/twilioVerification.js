const twilio = require('twilio');
const logger = require('../utils/logger');

function verifyTwilioWebhook(req, res, next) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Skip verification in development or if no auth token configured
  if (!authToken || process.env.NODE_ENV !== 'production') {
        return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'];
    const url = process.env.BASE_URL + req.originalUrl;

  const requestIsValid = twilio.validateRequest(
        authToken,
        twilioSignature,
        url,
        req.body
      );

  if (requestIsValid) {
        next();
  } else {
        logger.warn('Invalid Twilio webhook signature', { url, signature: twilioSignature });
        res.status(403).json({ error: 'Invalid Twilio signature' });
  }
}

module.exports = { verifyTwilioWebhook };
