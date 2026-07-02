// AI DISABLED - OpenAI removed to stop credit usage
// mayaAgent.js - SMS agent - OpenAI replaced with rule-based responses
// Onboarded client guard: does NOT send AI SMS to converted clients/accounts

const { sendSMS } = require('../services/twilioService');
const { findLeadByPhone, createOrUpdateLead, updateLeadStatus, updateLead } = require('../database/leads');
const { saveMessage, getConversationHistory } = require('../database/messages');
const { updateZohoLead, addZohoNote } = require('../services/zohoService');
const logger = require('../utils/logger');

const ONBOARDING_URL = process.env.ONBOARDING_URL || 'https://start.makeyourlabel.com';

function extractPhone(phoneOrLead) {
        if (!phoneOrLead) return '';
        if (typeof phoneOrLead === 'string') return phoneOrLead;
        if (typeof phoneOrLead === 'object') return phoneOrLead.phone || phoneOrLead.phone_number || '';
        return String(phoneOrLead);
}

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

async function buildTranscript(phoneNumber, history, newInbound, newReply) {
        var lines = [];
        history.forEach(function(msg) {
                  var who = msg.direction === 'inbound' ? 'Customer' : 'Maya (AI)';
                  var ts = msg.created_at ? new Date(msg.created_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) : '';
                  lines.push('[' + ts + '] ' + who + ': ' + (msg.body || msg.content || ''));
        });
        lines.push('[' + new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + '] Customer: ' + newInbound);
        lines.push('[' + new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }) + '] Maya: ' + newReply);
        return 'SMS Conversation Transcript\n' + '='.repeat(40) + '\n' + lines.join('\n');
}

async function processInboundSMS(from, body, to) {
        logger.info('Processing inbound SMS', { from: from, body: body });
        try {
                  var lead = await getOrCreateLead(from);
                  await saveMessage({ phone_number: from, direction: 'inbound', body: body, status: 'received' });

          // GUARD: Do NOT respond to onboarded clients - they are real customers, not leads
          var clientStatuses = ['Onboarded', 'Client', 'Active Client', 'Converted'];
                  if (lead.is_onboarded === true || (lead.lead_status && clientStatuses.includes(lead.lead_status))) {
                              logger.info('Inbound SMS from onboarded client - not sending AI response', { from: from, leadId: lead.id });
                              return { success: true, reply: null, skipped: 'onboarded_client' };
                  }

          // Rule-based responses (AI DISABLED)
          var name = lead.first_name || 'there';
                  var bodyLower = body.toLowerCase().trim();
                  var reply;

          if (bodyLower === 'stop' || bodyLower === 'unsubscribe' || bodyLower === 'opt out') {
                      await updateLead(lead.id, { optedOut: true });
                      if (lead.zoho_lead_id) await updateZohoLead(lead.zoho_lead_id, { Lead_Status: 'Unqualified' });
                      reply = 'You have been unsubscribed and will no longer receive messages from us.';
          } else if (bodyLower.includes('yes') || bodyLower.includes('link') || bodyLower.includes('start')) {
                      reply = 'Great ' + name + '! Here is your onboarding link: ' + ONBOARDING_URL + ' - our team will reach out within 24 hours!';
                      await updateLeadStatus(lead.id, 'onboarding_sent');
          } else if (bodyLower.includes('price') || bodyLower.includes('cost') || bodyLower.includes('how much')) {
                      reply = 'Hi ' + name + '! Pricing depends on your requirements. Book a call at ' + ONBOARDING_URL + ' for a custom quote!';
          } else if (bodyLower.includes('no') || bodyLower.includes('not interested')) {
                      reply = 'No problem ' + name + '! When ready to launch your brand, we are here: ' + ONBOARDING_URL;
          } else {
                      reply = 'Hi ' + name + '! Thanks for your message. To get started with your clothing brand, visit: ' + ONBOARDING_URL;
          }

          logger.info('Maya rule-based reply', { from: from, reply: reply });
                  await sendSMS(from, reply);
                  await saveMessage({ phone_number: from, direction: 'outbound', body: reply, status: 'sent' });

          if (lead.zoho_lead_id) {
                      var history = await getConversationHistory(from, 20);
                      var transcript = await buildTranscript(from, history, body, reply);
                      await addZohoNote(lead.zoho_lead_id, transcript);
          }

          return { success: true, reply: reply };
        } catch (error) {
                  logger.error('Error processing inbound SMS', { error: error.message, from: from });
                  throw error;
        }
}

async function sendInitialOutreach(phoneNumber, leadName, leadInfo) {
        var phone = extractPhone(phoneNumber);
        leadInfo = leadInfo || {};
        logger.info('Sending initial outreach', { phoneNumber: phone, leadName: leadName });
        try {
                  // AI DISABLED - static template (no OpenAI call)
          var firstName = leadName ? leadName.split(' ')[0] : 'there';
                  var message = 'Hi ' + firstName + '! I am Maya from MakeYourLabel. Saw you are interested in launching your clothing brand - I would love to help! Reply YES to get started or visit: ' + ONBOARDING_URL;
                  await sendSMS(phone, message);
                  await saveMessage({ phone_number: phone, direction: 'outbound', body: message, status: 'sent' });
                  logger.info('Initial outreach sent', { phoneNumber: phone });
                  return { success: true, message: message };
        } catch (error) {
                  logger.error('Error sending initial outreach', { error: error.message, phoneNumber: phone });
                  throw error;
        }
}

async function analyzeIntent(message) {
        // AI DISABLED - keyword-based intent detection
  var lower = message.toLowerCase();
        if (lower.includes('stop') || lower.includes('unsubscribe')) return 'stop,unsubscribe';
        if (lower.includes('yes') || lower.includes('interested')) return 'interested';
        if (lower.includes('price') || lower.includes('cost')) return 'question';
        if (lower.includes('no') || lower.includes('not interested')) return 'not_interested';
        if (lower.includes('onboard') || lower.includes('start') || lower.includes('link')) return 'onboarding';
        return 'other';
}

module.exports = { processInboundSMS, sendInitialOutreach, analyzeIntent };
