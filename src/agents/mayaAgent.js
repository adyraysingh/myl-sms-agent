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

async function getOrCreateLead(phone, extraData) {
  extraData = extraData || {};
  var lead = await findLeadByPhone(phone);
  if (!lead) {
    var phoneDigits = phone.replace(/\D/g, '');
    lead = await createOrUpdateLead({
      phone: phone,
      zohoLeadId: 'sms_' + phoneDigits,
      firstName: extraData.name ? extraData.name.split(' ')[0] : '',
      lastName: extraData.name ? extraData.name.split(' ').slice(1).join(' ') : '',
      email: extraData.email || '',
      leadSource: 'SMS Inbound',
      company: extraData.company || ''
    });
  }
  return lead;
}

async function processInboundSMS(from, body, to) {
  logger.info('Processing inbound SMS', { from: from, body: body });
  try {
    var lead = await getOrCreateLead(from);
    await saveMessage({ phone_number: from, direction: 'inbound', body: body, status: 'received' });
    var history = await getConversationHistory(from, 10);
    var messages = [
      { role: 'system', content: getMayaSystemPrompt(lead) }
    ].concat(history.map(function(msg) {
      return { role: msg.direction === 'inbound' ? 'user' : 'assistant', content: msg.content || msg.body || '' };
    })).concat([{ role: 'user', content: body }]);

    var completion = await openai.chat.completions.create({ model: MODEL, messages: messages, max_tokens: 300, temperature: 0.7 });
    var rawReply = completion.choices[0].message.content.trim();
    var reply = rawReply;
    try { var p = JSON.parse(rawReply); reply = p.message || rawReply; } catch(e) {}
    logger.info('Maya reply generated', { from: from, reply: reply });
    await sendSMS(from, reply);
    await saveMessage({ phone_number: from, direction: 'outbound', body: reply, status: 'sent' });

    var intent = await analyzeIntent(body);
    if (intent.includes('interested') || intent.includes('qualified')) {
      await updateLeadStatus(lead.id, 'qualified');
      if (lead.zoho_lead_id) await updateZohoLead(lead.zoho_lead_id, { Lead_Status: 'Qualified' });
    } else if (body.toLowerCase().includes('yes') || body.toLowerCase().includes('link') || intent.includes('onboarding')) {
      await sendSMS(from, 'Here is your onboarding link: ' + ONBOARDING_URL);
      await updateLeadStatus(lead.id, 'onboarding_sent');
    } else if (intent.includes('stop') || intent.includes('unsubscribe')) {
      await updateLead(lead.id, { optedOut: true });
      if (lead.zoho_lead_id) await updateZohoLead(lead.zoho_lead_id, { Lead_Status: 'Unqualified' });
    }
    return { success: true, reply: reply };
  } catch (error) {
    logger.error('Error processing inbound SMS', { error: error.message, from: from });
    throw error;
  }
}

async function sendInitialOutreach(phoneNumber, leadName, leadInfo) {
  leadInfo = leadInfo || {};
  logger.info('Sending initial outreach', { phoneNumber: phoneNumber, leadName: leadName });
  try {
    var completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are Maya, a friendly brand strategist from MakeYourLabel - a private label clothing manufacturing company. Send a warm, personalized initial SMS to a new lead. Keep it under 160 characters. Be conversational and mention you can help them launch their clothing brand. Do not include any JSON, just the message text.' },
        { role: 'user', content: 'Send initial outreach SMS to ' + leadName + ' who just submitted a lead form for private label clothing manufacturing.' }
      ],
      max_tokens: 200,
      temperature: 0.7
    });
    var rawReply = completion.choices[0].message.content.trim();
    var message = rawReply;
    try { var p = JSON.parse(rawReply); message = p.message || rawReply; } catch(e) {}
    logger.info('Sending SMS to', { phoneNumber: phoneNumber, message: message });
    await sendSMS(phoneNumber, message);
    await saveMessage({ phone_number: phoneNumber, direction: 'outbound', body: message, status: 'sent' });
    logger.info('Initial outreach SMS sent successfully', { phoneNumber: phoneNumber });
    return { success: true, message: message };
  } catch (error) {
    logger.error('Error sending initial outreach', { error: error.message, phoneNumber: phoneNumber });
    throw error;
  }
}

async function analyzeIntent(message) {
  try {
    var completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Analyze SMS intent. Return comma-separated from: interested, not_interested, qualified, unsubscribe, stop, onboarding, question, other.' },
        { role: 'user', content: message }
      ],
      max_tokens: 50
    });
    return completion.choices[0].message.content.trim().toLowerCase();
  } catch(e) { return 'other'; }
}

module.exports = { processInboundSMS: processInboundSMS, sendInitialOutreach: sendInitialOutreach };
