const { getLeadByPhone, updateLead } = require('../../database/leads');
const { getConversationByLeadId, updateConversationStatus } = require('../../database/conversations');
const { cancelFollowUps } = require('../../workflows/followUpScheduler');
const { updateZohoLead } = require('../../services/zohoService');
const { sendSMS } = require('../../services/twilioService');
const logger = require('../../utils/logger');

async function handleOnboardingCompleted(data) {
  try {
    logger.info('Processing onboarding completion', { data });

    // Extract lead identifier
    const phone = data.phone || data.Phone;
    const zohoLeadId = data.zohoLeadId || data.lead_id || data.id;
    const email = data.email || data.Email;

    let lead = null;

    if (phone) {
      lead = await getLeadByPhone(normalizePhone(phone));
    }

    if (!lead && zohoLeadId) {
      const { query } = require('../../database/connection');
      const result = await query('SELECT * FROM leads WHERE zoho_lead_id = $1', [zohoLeadId]);
      lead = result.rows[0];
  }

    if (!lead) {
      logger.warn('Lead not found for onboarding completion', { phone, zohoLeadId });
      return;
  }

    // Update local database
    await updateLead(lead.id, {
      isOnboarded: true,
      onboardedAt: new Date().toISOString(),
      leadStatus: 'Onboarded'
});

    // Cancel all pending follow-ups
    await cancelFollowUps(lead.id);

    // Close conversation
    const conversation = await getConversationByLeadId(lead.id);
    if (conversation) {
      await updateConversationStatus(conversation.id, 'closed', 'Lead successfully onboarded');
    }

    // Update Zoho CRM
    await updateZohoLead(lead.zoho_lead_id, {
      leadStatus: 'Onboarded',
      isOnboarded: true,
      onboardedAt: new Date().toISOString()
});

    // Send welcome SMS
    const firstName = lead.first_name || 'there';
    const welcomeMessage = `Welcome to MakeYourLabel, ${firstName}! Your brand journey starts now. Our team will be in touch within 24 hours to kick things off. Excited to work with you!`;

    await sendSMS(lead.phone, welcomeMessage);

    logger.info('Onboarding completed successfully', { leadId: lead.id, phone: lead.phone });

} catch (error) {
    logger.error('Error handling onboarding completion:', error);
}
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

module.exports = { handleOnboardingCompleted };
