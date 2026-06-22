const OpenAI = require('openai');
const { getMayaSystemPrompt } = require('../prompts/mayaPrompt');
const { getConversationMessages, updateConversationSummary } = require('../database/conversations');
const { updateLeadStatus, updateLeadScore } = require('../database/leads');
const { saveMessage } = require('../database/messages');
const { sendSMS } = require('../services/twilioService');
const { calculateLeadScore } = require('./leadScorer');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateMayaResponse({ lead, messages, latestMessage }) {
    try {
          const systemPrompt = getMayaSystemPrompt(lead);
          const conversationHistory = buildConversationHistory(messages);

      const response = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: [
                { role: 'system', content: systemPrompt },
                        ...conversationHistory,
                { role: 'user', content: latestMessage }
                      ],
              max_tokens: 300,
              temperature: 0.8,
              response_format: { type: 'json_object' }
      });

      const content = JSON.parse(response.choices[0].message.content);
          logger.info('Maya generated response', { leadId: lead.id, intent: content.intent });

      return {
              message: content.message,
              summary: content.summary || '',
              suggestedStatus: content.suggestedStatus || null,
              sentOnboardingLink: content.sentOnboardingLink || false,
              extractedData: content.extractedData || {},
              intent: content.intent || 'conversation'
      };
    } catch (error) {
          logger.error('Error generating Maya response:', error);
          return {
                  message: 'Hey! Thanks for your message. Let me get back to you shortly.',
                  summary: '',
                  suggestedStatus: null,
                  sentOnboardingLink: false,
                  extractedData: {},
                  intent: 'fallback'
          };
    }
}

async function processInboundSMS(lead, conversation, messageBody) {
    try {
          // Get conversation history
      const messages = await getConversationMessages(conversation.id);

      // Generate Maya's response
      const response = await generateMayaResponse({
              lead,
              messages,
              latestMessage: messageBody
      });

      // Send SMS reply
      if (response.message) {
              const sent = await sendSMS(lead.phone, response.message);

            // Save outbound message
            await saveMessage({
                      conversationId: conversation.id,
                      leadId: lead.id,
                      direction: 'outbound',
                      content: response.message,
                      twilioSid: sent.sid,
                      status: 'sent'
            });
      }

      // Update conversation summary
      if (response.summary) {
              await updateConversationSummary(conversation.id, response.summary);
      }

      // Update lead status if suggested
      if (response.suggestedStatus) {
              await updateLeadStatus(lead.id, response.suggestedStatus);
      }

      // Update lead score
      const allMessages = await getConversationMessages(conversation.id);
          const score = calculateLeadScore(lead, allMessages);
          await updateLeadScore(lead.id, score);

      logger.info('Processed inbound SMS successfully', { leadId: lead.id, intent: response.intent });
    } catch (error) {
          logger.error('Error processing inbound SMS:', error);
    }
}

function buildConversationHistory(messages) {
    if (!messages || messages.length === 0) return [];
    return messages.slice(-10).map(msg => ({
          role: msg.direction === 'inbound' ? 'user' : 'assistant',
          content: msg.content
    }));
}

module.exports = { generateMayaResponse, processInboundSMS };
