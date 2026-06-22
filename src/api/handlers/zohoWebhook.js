const { createOrUpdateLead } = require('../../database/leads');
const { createConversation } = require('../../database/conversations');
const { sendInitialSMS } = require('../../services/twilioService');
const { scheduleFollowUps } = require('../../workflows/followUpScheduler');
const logger = require('../../utils/logger');

async function handleNewLead(webhookData) {
  try {
    logger.info('Processing new lead from Zoho CRM', { webhookData });

    // Extract lead data from Zoho webhook payload
    const leadData = extractLeadData(webhookData);

    if (!leadData.phone) {
      logger.warn('Lead has no phone number, skipping SMS', { leadId: leadData.zohoLeadId });
      return;
    }

    // Normalize phone number
    leadData.phone = normalizePhone(leadData.phone);

    // Create or update lead in local DB
    const lead = await createOrUpdateLead(leadData);
    logger.info('Lead saved to database', { leadId: lead.id, phone: lead.phone });

    // Create conversation record
    const conversation = await createConversation({
      leadId: lead.id,
      channel: 'sms',
      status: 'active'
    });

    // Send initial SMS within 1 minute
    await sendInitialSMS(lead, conversation.id);
    logger.info('Initial SMS sent', { leadId: lead.id, phone: lead.phone });

    // Schedule follow-ups
    await scheduleFollowUps(lead.id, conversation.id);
    logger.info('Follow-ups scheduled', { leadId: lead.id });

  } catch (error) {
    logger.error('Error handling new lead webhook:', error);
  }
}

function extractLeadData(webhookData) {
  // Handle both direct data and Zoho's nested format
  const data = webhookData.data?.[0] || webhookData;

  return {
    zohoLeadId: data.id || data.lead_id || data.ID,
    firstName: data.First_Name || data.first_name || '',
    lastName: data.Last_Name || data.last_name || '',
    email: data.Email || data.email || '',
    phone: data.Phone || data.Mobile || data.phone || data.mobile || '',
    leadSource: data.Lead_Source || data.lead_source || 'Zoho CRM',
    company: data.Company || data.company || '',
    description: data.Description || data.description || '',
    leadStatus: data.Lead_Status || 'New',
    pipeline: 'SMS Pipeline'
  };
}

function normalizePhone(phone) {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');

  // Add country code if missing
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  } else if (phone.startsWith('+')) {
    return phone;
  }
  return `+${digits}`;
}

module.exports = { handleNewLead };
