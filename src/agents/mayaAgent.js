const OpenAI = require('openai');
const { sendSMS } = require('../services/twilioService');
const { getOrCreateLead, updateLeadStatus } = require('../database/leads');
const { saveMessage, getConversationHistory } = require('../database/messages');
const { updateZohoLead } = require('../services/zohoService');
const { getMayaPrompt } = require('../prompts/mayaPrompt');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ONBOARDING_URL = process.env.ONBOARDING_URL || 'https://start.makeyourlabel.com';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

async function processInboundSMS(from, body, to) {
  logger.info('Processing inbound SMS', { from, body });
  try {
    const lead = await getOrCreateLead(from);
    await saveMessage({ phone_number: from, direction: 'inbound', body, status: 'received' });
    const history = await getConversationHistory(from, 10);
    const messages = [
      { role: 'system', content: getMayaPrompt(lead) },
      ...history.map(msg => ({ role: msg.direction === 'inbound' ? 'user' : 'assistant', content: msg.body })),
      { role: 'user', content: body }
    ];
    const completion = await openai.chat.completions.create({ model: MODEL, messages, max_tokens: 300, temperature: 0.7 });
    const reply = completion.choices[0].message.content.trim();
    logger.info('Maya reply generated', { from, reply });
    await sendSMS(from, reply);
    const intent = await analyzeIntent(body);
    if (intent.includes('interested') || intent.includes('qualified')) {
      await updateLeadStatus(from, 'qualified');
      await updateZohoLead(lead.zoho_id, { Lead_Status: 'Qualified', Description: 'Qualified via SMS - Maya AI' });
    } else if (body.toLowerCase().includes('yes') || body.toLowerCase().includes('link') || intent.includes('onboarding')) {
      await sendSMS(from, 'Here is your onboarding link: ' + ONBOARDING_URL);
      await updateLeadStatus(from, 'onboarding_sent');
    } else if (intent.includes('stop') || intent.includes('unsubscribe')) {
      await updateLeadStatus(from, 'opted_out');
      await updateZohoLead(lead.zoho_id, { Lead_Status: 'Unqualified', Description: 'Opted out via SMS' });
    }
    return { success: true, reply };
  } catch (error) {
    logger.error('Error processing inbound SMS', { error: error.message, from });
    throw error;
  }
}

async function sendInitialOutreach(phoneNumber, leadName, leadInfo = {}) {
  logger.info('Sending initial outreach', { phoneNumber, leadName });
  try {
    const lead = await getOrCreateLead(phoneNumber, { name: leadName, ...leadInfo });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: getMayaPrompt(lead) },
        { role: 'user', content: 'Send initial outreach SMS to ' + leadName + ' who just submitted a lead form for private label clothing.' }
      ],
      max_tokens: 200,
      temperature: 0.7
    });
    const message = completion.choices[0].message.content.trim();
    await sendSMS(phoneNumber, message);
    await updateLeadStatus(phoneNumber, 'contacted');
    return { success: true, message };
  } catch (error) {
    logger.error('Error sending initial outreach', { error: error.message, phoneNumber });
    throw error;
  }
}

async function analyzeIntent(message) {
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Analyze SMS intent. Return comma-separated from: interested, not_interested, qualified, unsubscribe, stop, onboarding, question, other.' },
        { role: 'user', content: message }
      ],
      max_tokens: 50
    });
    return completion.choices[0].message.content.trim().toLowerCase();
  } catch { return 'other'; }
}

module.exports = { processInboundSMS, sendInitialOutreach };
