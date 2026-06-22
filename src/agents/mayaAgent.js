const OpenAI = require('openai');
const { sendSMS } = require('../services/twilioService');
const { findLeadByPhone, createOrUpdateLead, updateLeadStatus, updateLead } = require('../database/leads');
const { saveMessage, getConversationHistory } = require('../database/messages');
const { updateZohoLead } = require('../services/zohoService');
const { getMayaSystemPrompt } = require('../prompts/mayaPrompt');
const logger = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ONBOARDING_URL = process.env.ONBOARDING_URL || 'https://start.makeyourlabel.com';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Get or create lead by phone number
async function getOrCreateLead(phone, extraData = {}) {
  let lead = await findLeadByPhone(phone);
  if (!lead) {
    const phoneDigits = phone.replace(/\D/g, '');
    lead = await createOrUpdateLead({
      phone,
      zohoLeadId: 'sms_' + phoneDigits,
      firstName: extraData.name ? extraData.name.split(' ')[0] : '',
      lastName: extraData.name ? extraData.name.split(' ').slice(1).join(' ') : '',
      email: extraData.email || '',
      leadSource: 'SMS Inbound',
      company: extraData.company || '',
      budget: null,
      timeline: null,
      productCategory: null,
      ...extraData
    });
  }
  return lead;
}

async function processInboundSMS(from, body, to) {
  logger.info('Processing inbound SMS', { from, body });
  try {
    const lead = await getOrCreateLead(from);
    await saveMessage({ phone_number: from, direction: 'inbound', body, status: 'received' });
    const history = await getConversationHistory(from, 10);
    const messages = [
      { role: 'system', content: getMayaSystemPrompt(lead) },
      ...history.map(function(msg) {
        return { role: msg.direction === 'inbound' ? 'user' : 'assistant', content: msg.content || msg.body };
      }),
      { role: 'user', content: body }
    ];
    const completion = await openai.chat.completions.create({ model: MODEL, messages, max_tokens: 300, temperature: 0.7 });
    const reply = completion.choices[0].message.content.trim();
    logger.info('Maya reply generated', { from, reply });
    await sendSMS(from, reply);
    await saveMessage({ phone_number: from, direction: 'outbound', body: reply, status: 'sent' });

    const intent = await analyzeIntent(body);
    if (intent.includes('interested') || intent.includes('qualified')) {
      await updateLeadStatus(lead.id, 'qualified');
      await updateZohoLead(lead.zoho_lead_id, { Lead_Status: 'Qualified', Description: 'Qualified via SMS - Maya AI' });
    } else if (body.toLowerCase().includes('yes') || body.toLowerCase().includes('link') || intent.includes('onboarding')) {
      await sendSMS(from, 'Here is your onboarding link: ' + ONBOARDING_URL);
      await updateLeadStatus(lead.id, 'onboarding_sent');
    } else if (intent.includes('stop') || intent.includes('unsubscribe')) {
      await updateLead(lead.id, { optedOut: true });
      if (lead.zoho_lead_id) {
        await updateZohoLead(lead.zoho_lead_id, { Lead_Status: 'Unqualified', Description: 'Opted out via SMS' });
      }
    }
    return { success: true, reply };
  } catch (error) {
    logger.error('Error processing inbound SMS', { error: error.message, from });
    throw error;
  }
}

async function sendInitialOutreach(phoneNumber, leadName, leadInfo) {
  leadInfo = leadInfo || {};
  logger.info('Sending initial outreach', { phoneNumber, leadName });
  try {
    const lead = await getOrCreateLead(phoneNumber, { name: leadName, ...leadInfo });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: getMayaSystemPrompt(lead) },
        { role: 'user', content: 'Send initial outreach SMS to ' + leadName + ' who just submitted a lead form for private label clothing.' }
      ],
      max_tokens: 200,
      temperature: 0.7
    });
    const rawReply = completion.choices[0].message.content.trim();
    // Extract message if JSON response
    let message = rawReply;
    try {
      const parsed = JSON.parse(rawReply);
      message = parsed.message || rawReply;
    } catch (e) { /* not JSON, use as-is */ }
    await sendSMS(phoneNumber, message);
    await saveMessage({ phone_number: phoneNumber, direction: 'outbound', body: message, status: 'sent' });
    await updateLeadStatus(lead.id, 'contacted');
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
  } catch (e) { return 'other'; }
}

module.exports = { processInboundSMS, sendInitialOutreach };
