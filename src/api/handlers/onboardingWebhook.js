const { getLeadByPhone, updateLead, findLeadByZohoId } = require('../../database/leads');
const { getConversationByLeadId, updateConversationStatus } = require('../../database/conversations');
const { cancelFollowUps } = require('../../workflows/followUpScheduler');
const { updateZohoLead } = require('../../services/zohoService');
const { sendSMS } = require('../../services/twilioService');
const logger = require('../../utils/logger');

// Express route handler - called from webhooks.js as handleOnboardingWebhook
async function handleOnboardingWebhook(req, res) {
  try {
    res.status(200).json({ success: true, message: 'Onboarding event received' });
    setImmediate(async function() {
      try {
        await handleOnboardingCompleted(req.body);
      } catch (err) {
        logger.error('Error processing onboarding', { error: err.message });
      }
    });
  } catch (error) {
    logger.error('Onboarding webhook error', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function handleOnboardingCompleted(data) {
  logger.info('Processing onboarding completion', { data: data });

  const phone = data.phone || data.Phone;
  const zohoLeadId = data.zohoLeadId || data.lead_id || data.id;

  let lead = null;
  if (phone) {
    lead = await getLeadByPhone(normalizePhone(phone));
  }
  if (!lead && zohoLeadId) {
    lead = await findLeadByZohoId(zohoLeadId);
  }

  if (!lead) {
    logger.warn('Lead not found for onboarding completion', { phone: phone, zohoLeadId: zohoLeadId });
    return;
  }

  await updateLead(lead.id, {
    isOnboarded: true,
    onboardedAt: new Date().toISOString(),
    leadStatus: 'Onboarded'
  });

  await cancelFollowUps(lead.id);

  const conversation = await getConversationByLeadId(lead.id);
  if (conversation) {
    await updateConversationStatus(conversation.id, 'closed', 'Lead successfully onboarded');
  }

  if (lead.zoho_lead_id) {
    await updateZohoLead(lead.zoho_lead_id, { leadStatus: 'Onboarded' });
  }

  const firstName = lead.first_name || 'there';
  const welcomeMsg = 'Welcome to MakeYourLabel, ' + firstName + '! Your brand journey starts now. Our team will be in touch within 24 hours. Excited to work with you!';
  await sendSMS(lead.phone, welcomeMsg);

  logger.info('Onboarding completed successfully', { leadId: lead.id, phone: lead.phone });
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (phone.startsWith('+')) return phone;
  return '+' + digits;
}

module.exports = { handleOnboardingWebhook: handleOnboardingWebhook, handleOnboardingCompleted: handleOnboardingCompleted };
