const cron = require('node-cron');
const axios = require('axios');
const { processInboundSMS } = require('../agents/mayaAgent');
const { query } = require('../database/connection');
const logger = require('../utils/logger');

const CALLHIPPO_API_KEY = process.env.CALLHIPPO_API_KEY;
const CALLHIPPO_VIRTUAL_NUMBER = process.env.CALLHIPPO_VIRTUAL_NUMBER;
const CALLHIPPO_NUMBER_ID = process.env.CALLHIPPO_NUMBER_ID;
const CALLHIPPO_API_URL = 'https://inbox-api.callhippo.com';

let lastPolledAt = new Date(Date.now() - 5 * 60 * 1000);

async function pollIncomingSMS() {
  if (!CALLHIPPO_API_KEY) {
    logger.warn('CALLHIPPO_API_KEY not set, skipping SMS poll');
    return;
  }
  if (!CALLHIPPO_NUMBER_ID) {
    logger.warn('CALLHIPPO_NUMBER_ID not set, skipping SMS poll');
    return;
  }
  try {
    const response = await axios.post(
      CALLHIPPO_API_URL + '/chats/getChatList/' + CALLHIPPO_NUMBER_ID,
      { page: 1, limit: 50, type: 'sms' },
      { headers: { Authorization: CALLHIPPO_API_KEY, 'Content-Type': 'application/json' } }
    );
    const chats = (response.data && response.data.result) || [];
    if (chats.length > 0) {
      logger.info('Polled ' + chats.length + ' SMS chats from CallHippo');
    }
    // Process chats that have new messages since last poll
    for (const chat of chats) {
      try {
        const chatId = chat._id || chat.chatId;
        const phoneNum = (chat.chatId || '').replace('@c.us', '');
        const lastMsgTime = chat.lastMessageTime ? new Date(chat.lastMessageTime) : null;
        if (!phoneNum) continue;
        // Only process chats with messages newer than our last poll
        if (!lastMsgTime || lastMsgTime <= lastPolledAt) continue;
        // Check if this message was already processed
        const msgContent = chat.lastMessage || '';
        if (!msgContent) continue;
        // Avoid processing outbound messages sent by us
        if (chat.lastMessageFromMe) continue;
        const fromPhone = '+' + phoneNum;
        const msgId = chat._id + '_' + (chat.lastMessageTime || '');
        const existing = await query(
          'SELECT id FROM messages WHERE external_id = $1',
          [msgId]
        );
        if (existing.rows.length > 0) continue;
        logger.info('Processing inbound SMS via poll', { from: fromPhone, msgId: msgId });
        await processInboundSMS(fromPhone, msgContent, CALLHIPPO_VIRTUAL_NUMBER);
      } catch (err) {
        logger.error('Error processing polled SMS', { error: err.message });
      }
    }
    lastPolledAt = new Date();
  } catch (error) {
    const errData = (error.response && error.response.data) || error.message;
    if (error.response && error.response.status === 404) {
      logger.warn('CallHippo SMS list endpoint not available (404). Inbound SMS polling disabled.');
    } else {
      logger.error('SMS poll error', { error: errData });
    }
  }
}

function startSMSPoller() {
  cron.schedule('*/2 * * * *', async function() {
    await pollIncomingSMS();
  });
  logger.info('SMS poller started (polling every 2 minutes)');
}

module.exports = { startSMSPoller, pollIncomingSMS };
