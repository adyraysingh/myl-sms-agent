const { processInboundSMS } = require('../../agents/mayaAgent');
const { findOrCreateConversation } = require('../../database/conversations');
const { findLeadByPhone } = require('../../database/leads');
const { saveMessage } = require('../../database/messages');
const logger = require('../../utils/logger');

async function handleInboundSMS(body) {
    const { From, To, Body, MessageSid } = body;

  try {
        logger.info('Processing inbound SMS', { from: From, to: To, messageSid: MessageSid });

      // Handle STOP/UNSUBSCRIBE opt-out
      const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
        if (stopKeywords.includes(Body.trim().toUpperCase())) {
                logger.info('Opt-out received', { from: From });
                // TODO: Mark lead as opted out in database
          return;
        }

      // Find the lead by phone
      const lead = await findLeadByPhone(From);
        if (!lead) {
                logger.warn('Inbound SMS from unknown number', { from: From });
                return;
        }

      // Get or create conversation
      const conversation = await findOrCreateConversation(lead.id);

      // Save inbound message
      await saveMessage({
              conversationId: conversation.id,
              leadId: lead.id,
              direction: 'inbound',
              content: Body,
              twilioSid: MessageSid,
              status: 'received'
      });

      // Process with Maya AI agent
      await processInboundSMS(lead, conversation, Body);

  } catch (error) {
        logger.error('Error handling inbound SMS:', { error: error.message, from: From });
  }
}

module.exports = { handleInboundSMS };
