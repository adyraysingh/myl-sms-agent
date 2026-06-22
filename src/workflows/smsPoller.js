const cron = require('node-cron');
const axios = require('axios');
const { processInboundSMS } = require('../agents/mayaAgent');
const { query } = require('../database/connection');
const logger = require('../utils/logger');

const CALLHIPPO_API_KEY = process.env.CALLHIPPO_API_KEY;
const CALLHIPPO_VIRTUAL_NUMBER = process.env.CALLHIPPO_VIRTUAL_NUMBER;
const CALLHIPPO_API_URL = 'https://api.callhippo.com/v2';

let lastPolledAt = new Date(Date.now() - 5 * 60 * 1000);

async function pollIncomingSMS() {
  if (!CALLHIPPO_API_KEY) {
    logger.warn('CALLHIPPO_API_KEY not set, skipping SMS poll');
    return;
  }
  try {
    const sinceIso = lastPolledAt.toISOString();
    const response = await axios.get(CALLHIPPO_API_URL + '/sms/list', {
      headers: { Authorization: CALLHIPPO_API_KEY },
      params: { type: 'received', since: sinceIso, limit: 50 }
    });
    const messages = (response.data && response.data.data) || [];
    if (messages.length > 0) {
      logger.info('Polled ' + messages.length + ' incoming SMS');
    }
    lastPolledAt = new Date();
    for (const msg of messages) {
      try {
        const from = msg.from || msg.sender;
        const body = msg.message || msg.text || msg.body;
        const msgId = msg.id || msg._id;
        if (!from || !body) continue;
        const existing = await query(
          'SELECT id FROM messages WHERE external_id = $1',
          [msgId]
        );
        if (existing.rows.length > 0) continue;
        logger.info('Processing inbound SMS via poll', { from: from, msgId: msgId });
        await processInboundSMS(from, body, CALLHIPPO_VIRTUAL_NUMBER);
      } catch (err) {
        logger.error('Error processing polled SMS', { error: err.message });
      }
    }
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
