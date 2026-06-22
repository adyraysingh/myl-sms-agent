const axios = require('axios');
const { saveMessage } = require('../database/messages');
const logger = require('../utils/logger');

const CALLHIPPO_API_KEY = process.env.CALLHIPPO_API_KEY;
const CALLHIPPO_VIRTUAL_NUMBER = process.env.CALLHIPPO_VIRTUAL_NUMBER;
const CALLHIPPO_NUMBER_ID = process.env.CALLHIPPO_NUMBER_ID;
const CALLHIPPO_API_URL = 'https://inbox-api.callhippo.com';

async function sendSMS(to, body, retries = 3) {
  if (!CALLHIPPO_NUMBER_ID) {
    throw new Error('CALLHIPPO_NUMBER_ID env var not set');
  }
  // Normalize phone number: ensure +countrycode format, convert to @c.us for CallHippo
  var phoneNum = to.replace(/[^0-9]/g, '');
  var chatId = phoneNum + '@c.us';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payload = {
        to: to,
        chatId: chatId,
        body: body,
        type: 'chat',
        fromNumber: CALLHIPPO_VIRTUAL_NUMBER
      };
      const response = await axios.post(
        CALLHIPPO_API_URL + '/sms/sendMessage/' + CALLHIPPO_NUMBER_ID,
        payload,
        { headers: { Authorization: CALLHIPPO_API_KEY, 'Content-Type': 'application/json' } }
      );
      const data = response.data;
      logger.info('SMS sent via CallHippo', { to: to, messageId: data && data._id });
      await saveMessage({ phone_number: to, direction: 'outbound', body: body, status: 'sent', external_id: (data && data._id) || null });
      return data;
    } catch (error) {
      logger.error('SMS send attempt ' + attempt + ' failed', { error: (error.response && error.response.data) || error.message, to: to });
      if (attempt === retries) throw error;
      await sleep(1000 * attempt);
    }
  }
}

async function getIncomingSMS(since) {
  if (!CALLHIPPO_NUMBER_ID) {
    logger.warn('CALLHIPPO_NUMBER_ID not set, cannot fetch incoming SMS');
    return [];
  }
  try {
    const response = await axios.post(
      CALLHIPPO_API_URL + '/chats/getChatList/' + CALLHIPPO_NUMBER_ID,
      { page: 1, limit: 50, type: 'sms' },
      { headers: { Authorization: CALLHIPPO_API_KEY, 'Content-Type': 'application/json' } }
    );
    const chats = (response.data && response.data.result) || [];
    return chats.map(function(chat) {
      return {
        id: chat._id,
        from: (chat.chatId || '').replace('@c.us', ''),
        message: chat.lastMessage || '',
        timestamp: chat.lastMessageTime || null
      };
    }).filter(function(m) { return m.from; });
  } catch (error) {
    logger.error('Failed to fetch incoming SMS', { error: (error.response && error.response.data) || error.message });
    return [];
  }
}

async function getConversationMessages(phoneNumber, limit) {
  if (!CALLHIPPO_NUMBER_ID) return [];
  limit = limit || 50;
  var phoneNum = phoneNumber.replace(/[^0-9]/g, '');
  var chatId = phoneNum + '@c.us';
  try {
    var response = await axios.get(
      CALLHIPPO_API_URL + '/chats/getChatUserConversations/' + CALLHIPPO_NUMBER_ID,
      {
        headers: { Authorization: CALLHIPPO_API_KEY, 'Content-Type': 'application/json' },
        params: { chatId: chatId, limit: limit }
      }
    );
    return (response.data && response.data.result) || [];
  } catch (error) {
    logger.error('Failed to fetch conversation messages', { error: error.message });
    return [];
  }
}

async function getMessageStatus(messageId) {
  return { id: messageId, status: 'sent' };
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

module.exports = { sendSMS, getMessageStatus, getIncomingSMS, getConversationMessages };
