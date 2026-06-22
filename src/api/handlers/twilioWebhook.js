const { processInboundSMS } = require('../../agents/mayaSmsAgent');
const logger = require('../../utils/logger');

// CallHippo webhook for inbound SMS events
async function handleCallHippoWebhook(req, res) {
  try {
    const event = req.body;
    logger.info('CallHippo webhook received', { event });

    // CallHippo sends SMS events with these fields
    const eventType = event.type || event.event_type;
    
    // Handle inbound SMS
    if (eventType === 'sms.received' || eventType === 'inbound_sms' || event.direction === 'inbound') {
      const from = event.from || event.caller || event.sender;
      const body = event.message || event.text || event.body;
      const to = event.to || event.receiver || process.env.CALLHIPPO_VIRTUAL_NUMBER;

      if (!from || !body) {
        logger.warn('CallHippo webhook missing from/body', { event });
        return res.status(200).json({ success: true, message: 'skipped - missing fields' });
      }

      logger.info('Inbound SMS received', { from, body, to });

      // Process asynchronously - respond to CallHippo immediately
      setImmediate(async () => {
        try {
          await processInboundSMS(from, body, to);
        } catch (err) {
          logger.error('Error processing inbound SMS', { error: err.message, from });
        }
      });

      return res.status(200).json({ success: true, message: 'SMS processing initiated' });
    }

    // Handle SMS delivery status updates
    if (eventType === 'sms.delivered' || eventType === 'sms.failed' || eventType === 'sms.sent') {
      logger.info('SMS status update', { 
        messageId: event.message_id || event.id, 
        status: eventType 
      });
      return res.status(200).json({ success: true });
    }

    logger.info('Unhandled CallHippo event type', { eventType });
    return res.status(200).json({ success: true, message: 'event acknowledged' });

  } catch (error) {
    logger.error('CallHippo webhook error', { error: error.message, stack: error.stack });
    return res.status(200).json({ success: false, error: error.message });
  }
}

module.exports = { handleCallHippoWebhook };
