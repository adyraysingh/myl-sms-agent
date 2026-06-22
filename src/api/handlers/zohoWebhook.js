const { createOrUpdateLead, updateLeadStatus } = require('../../database/leads');
const { createConversation } = require('../../database/conversations');
const { sendInitialOutreach } = require('../../agents/mayaAgent');
const { scheduleFollowUps } = require('../../workflows/followUpScheduler');
const logger = require('../../utils/logger');

async function handleZohoWebhook(req, res) {
  try {
    const webhookData = req.body;
    logger.info('Zoho new-lead webhook received', { webhookData });

    // Respond immediately
    res.status(200).json({ success: true, message: 'Lead processing initiated' });

    // Process asynchronously
    setImmediate(async () => {
      try {
        await handleNewLead(webhookData);
      } catch (err) {
        logger.error('Error handling Zoho lead', { error: err.message });
      }
    });
  } catch (error) {
    logger.error('Zoho webhook error', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
}

async function handleNewLead(webhookData) {
  const leadData = extractLeadData(webhookData);

  if (!leadData.phone) {
    logger.warn('Lead has no phone number, skipping SMS', { leadId: leadData.zohoLeadId });
    return;
  }

  leadData.phone = normalizePhone(leadData.phone);

  const lead = await createOrUpdateLead(leadData);
  logger.info('Lead saved', { leadId: lead.id, phone: lead.phone });

  const conversation = await createConversation({ leadId: lead.id, channel: 'sms', status: 'active' });

  // Send initial outreach via CallHippo SMS
  const fullName = (leadData.firstName + ' ' + leadData.lastName).trim() || 'there';
  await sendInitialOutreach(lead.phone, fullName, leadData);
  logger.info('Initial SMS sent', { leadId: lead.id, phone: lead.phone });

  // Schedule follow-ups
  await scheduleFollowUps(lead.id, conversation.id);
  logger.info('Follow-ups scheduled', { leadId: lead.id });
}

function extractLeadData(webhookData) {
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
    leadStatus: data.Lead_Status || 'New'
  };
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (phone.startsWith('+')) return phone;
  return '+' + digits;
}

module.exports = { handleZohoWebhook };
