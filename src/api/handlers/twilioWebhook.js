const { processInboundSMS } = require('../../agents/mayaAgent');
const logger = require('../../utils/logger');

// Twilio inbound SMS webhook handler
// Twilio sends: From, Body, To, MessageSid, AccountSid, etc.
async function handleTwilioInbound(req, res) {
  try {
    const from = req.body.From || req.body.from;
    const body = req.body.Body || req.body.body || req.body.text;
    const to = req.body.To || req.body.to;

    logger.info('Twilio inbound SMS received', { from: from, body: body, to: to });

    if (!from || !body) {
      logger.warn('Twilio inbound webhook missing From/Body', { body: req.body });
      return res.status(200).send('<Response></Response>');
    }

    // Respond to Twilio immediately with empty TwiML (no auto-reply)
    res.status(200).set('Content-Type', 'text/xml').send('<Response></Response>');

    // Process asynchronously - Maya generates and sends reply via sendSMS
    setImmediate(async () => {
      try {
        await processInboundSMS(from, body, to);
      } catch (err) {
        logger.error('Error processing inbound SMS', { error: err.message, from: from });
      }
    });

  } catch (error) {
    logger.error('Twilio inbound webhook error', { error: error.message, stack: error.stack });
    return res.status(200).set('Content-Type', 'text/xml').send('<Response></Response>');
  }
}

// Legacy alias for backward compatibility
async function handleCallHippoWebhook(req, res) {
  return handleTwilioInbound(req, res);
}

module.exports = { handleTwilioInbound: handleTwilioInbound, handleCallHippoWebhook: handleCallHippoWebhook };
