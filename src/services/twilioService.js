const axios = require('axios');
const { saveMessage } = require('../database/messages');
const logger = require('../utils/logger');

const CALLHIPPO_API_KEY = process.env.CALLHIPPO_API_KEY;
const CALLHIPPO_VIRTUAL_NUMBER = process.env.CALLHIPPO_VIRTUAL_NUMBER;
const CALLHIPPO_API_URL = 'https://api.callhippo.com/v2';

async function sendSMS(to, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(
        `${CALLHIPPO_API_URL}/sms/send`,
        {
          from: CALLHIPPO_VIRTUAL_NUMBER,
          to: to,
          message: body
        },
        {
          headers: {
            'Authorization': CALLHIPPO_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = response.data;
      logger.info('SMS sent via CallHippo', { to, messageId: data.data?.id });

      await saveMessage({
        phone_number: to,
        direction: 'outbound',
        body: body,
        status: 'sent',
        external_id: data.data?.id || null
      });

      return data;
    } catch (error) {
      logger.error(`SMS send attempt ${attempt} failed`, {
        error: error.response?.data || error.message,
        to
      });
      if (attempt === retries) throw error;
      await sleep(1000 * attempt);
    }
  }
}

async function getMessageStatus(messageId) {
  try {
    const response = await axios.get(
      `${CALLHIPPO_API_URL}/sms/${messageId}`,
      {
        headers: {
          'Authorization': CALLHIPPO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to get message status', { error: error.message, messageId });
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendSMS, getMessageStatus };
