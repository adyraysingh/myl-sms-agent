const OpenAI = require('openai');
const { getMayaSystemPrompt } = require('../prompts/mayaPrompt');
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

function buildConversationHistory(messages) {
  if (!messages || messages.length === 0) return [];
  return messages.slice(-10).map(msg => ({
    role: msg.direction === 'inbound' ? 'user' : 'assistant',
    content: msg.content
  }));
}

module.exports = { generateMayaResponse };
