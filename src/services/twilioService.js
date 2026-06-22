const twilio = require('twilio');
const { saveMessage } = require('../database/messages');
const logger = require('../utils/logger');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

function getClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN env vars not set');
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendSMS(to, body, retries) {
  retries = retries || 3;
  if (!TWILIO_PHONE_NUMBER) {
    throw new Error('TWILIO_PHONE_NUMBER env var not set');
  }
  var cleanPhone = to.replace(/[^0-9+]/g, '');
  if (!cleanPhone.startsWith('+')) {
    cleanPhone = '+' + cleanPhone;
  }

  for (var attempt = 1; attempt <= retries; attempt++) {
    try {
      var client = getClient();
      var message = await client.messages.create({
        body: body,
        from: TWILIO_PHONE_NUMBER,
        to: cleanPhone
      });
      logger.info('SMS sent via Twilio', { to: cleanPhone, messageSid: message.sid, status: message.status });
      try {
        await saveMessage({
          phone_number: cleanPhone,
          direction: 'outbound',
          body: body,
          status: 'sent',
          external_id: message.sid || null
        });
      } catch (dbErr) {
        logger.warn('Failed to save outbound message to DB', { error: dbErr.message });
      }
      return message;
    } catch (error) {
      var errData = (error.message) || error;
      logger.error('SMS send attempt ' + attempt + ' failed', { error: errData, to: cleanPhone, code: error.code });
      if (attempt === retries) throw error;
      await sleep(1000 * attempt);
    }
  }
}

async function getIncomingSMS(since) {
  if (!TWILIO_PHONE_NUMBER) {
    logger.warn('TWILIO_PHONE_NUMBER not set, cannot fetch incoming SMS');
    return [];
  }
  try {
    var client = getClient();
    var messages = await client.messages.list({ to: TWILIO_PHONE_NUMBER, limit: 50 });
    return messages.map(function(msg) {
      return { id: msg.sid, from: msg.from, message: msg.body, timestamp: msg.dateSent };
    }).filter(function(m) { return m.from; });
  } catch (error) {
    logger.error('Failed to fetch incoming SMS', { error: error.message });
    return [];
  }
}

async function getConversationMessages(phoneNumber, limit) {
  if (!TWILIO_PHONE_NUMBER) return [];
  limit = limit || 50;
  try {
    var client = getClient();
    var messages = await client.messages.list({ from: phoneNumber, to: TWILIO_PHONE_NUMBER, limit: limit });
    return messages;
  } catch (error) {
    logger.error('Failed to fetch conversation messages', { error: error.message });
    return [];
  }
}

async function getMessageStatus(messageId) {
  try {
    var client = getClient();
    var message = await client.messages(messageId).fetch();
    return { id: messageId, status: message.status };
  } catch (error) {
    return { id: messageId, status: 'unknown' };
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

module.exports = { sendSMS: sendSMS, getMessageStatus: getMessageStatus, getIncomingSMS: getIncomingSMS, getConversationMessages: getConversationMessages };
