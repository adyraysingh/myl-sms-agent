const cron = require('node-cron');
const { query } = require('../database/connection');
const { sendSMS } = require('../services/twilioService');
const { updateZohoLead } = require('../services/zohoService');
const logger = require('../utils/logger');

const FOLLOW_UP_SCHEDULE = [
  { sequence: 1, delayMinutes: 120, label: '2 hours' },
  { sequence: 2, delayMinutes: 1440, label: '24 hours' },
  { sequence: 3, delayMinutes: 4320, label: '3 days' },
  { sequence: 4, delayMinutes: 10080, label: '7 days' }
];

const FOLLOW_UP_MESSAGES = [
  (name) => 'Hey ' + name + '! Just checking in - have you had a chance to think about launching your clothing brand? Happy to answer any questions. - Maya from MakeYourLabel',
  (name) => 'Hi ' + name + ', Maya here from MakeYourLabel. I'd love to help you get your brand off the ground. What questions do you have?',
  (name) => name + ', still thinking about launching? We help founders launch without manufacturing headaches. Worth exploring? https://start.makeyourlabel.com',
  (name) => 'Last check-in from me, ' + name + '. When you're ready to start your clothing brand, I'm here. https://start.makeyourlabel.com'
];

async function scheduleFollowUps(leadId, conversationId, type = 'no_response') {
  try {
    await query(
      'UPDATE follow_ups SET status = 'cancelled' WHERE lead_id = $1 AND status = 'pending'',
      [leadId]
    );
    for (const schedule of FOLLOW_UP_SCHEDULE) {
      const scheduledAt = new Date(Date.now() + schedule.delayMinutes * 60 * 1000);
      await query(
        'INSERT INTO follow_ups (lead_id, conversation_id, scheduled_at, sequence_number, status, type) VALUES ($1, $2, $3, $4, 'pending', $5)',
        [leadId, conversationId, scheduledAt, schedule.sequence, type]
      );
    }
    logger.info('Follow-ups scheduled', { leadId, count: FOLLOW_UP_SCHEDULE.length });
  } catch (error) {
    logger.error('Error scheduling follow-ups', { error: error.message });
  }
}

async function cancelFollowUps(leadId) {
  try {
    await query(
      'UPDATE follow_ups SET status = 'cancelled' WHERE lead_id = $1 AND status = 'pending'',
      [leadId]
    );
    logger.info('Follow-ups cancelled', { leadId });
  } catch (error) {
    logger.error('Error cancelling follow-ups', { error: error.message });
  }
}

async function processFollowUps() {
  try {
    const result = await query(
      'SELECT f.*, l.phone, l.first_name, l.zoho_lead_id, l.opted_out, l.is_onboarded FROM follow_ups f JOIN leads l ON l.id = f.lead_id WHERE f.status = 'pending' AND f.scheduled_at <= NOW() AND l.opted_out = false AND l.is_onboarded = false ORDER BY f.scheduled_at ASC LIMIT 10'
    );
    for (const followUp of result.rows) {
      try {
        const name = followUp.first_name || 'there';
        const msgIdx = Math.min(followUp.sequence_number - 1, FOLLOW_UP_MESSAGES.length - 1);
        const message = FOLLOW_UP_MESSAGES[msgIdx](name);
        await sendSMS(followUp.phone, message);
        await query('UPDATE follow_ups SET status = 'sent', executed_at = NOW() WHERE id = $1', [followUp.id]);
        if (followUp.sequence_number >= FOLLOW_UP_SCHEDULE.length) {
          await query('UPDATE leads SET lead_status = 'Cold Lead', updated_at = NOW() WHERE id = $1', [followUp.lead_id]);
          await updateZohoLead(followUp.zoho_lead_id, { leadStatus: 'Cold Lead' });
          logger.info('Lead marked cold', { leadId: followUp.lead_id });
        }
        logger.info('Follow-up sent', { leadId: followUp.lead_id, sequence: followUp.sequence_number });
      } catch (err) {
        logger.error('Error sending follow-up', { id: followUp.id, error: err.message });
        await query('UPDATE follow_ups SET status = 'failed' WHERE id = $1', [followUp.id]);
      }
    }
  } catch (error) {
    logger.error('Error processing follow-ups', { error: error.message });
  }
}

function startFollowUpScheduler() {
  cron.schedule('* * * * *', async () => { await processFollowUps(); });
  logger.info('Follow-up scheduler started');
}

module.exports = { scheduleFollowUps, cancelFollowUps, startFollowUpScheduler };
