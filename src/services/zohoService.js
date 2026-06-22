const axios = require('axios');
const logger = require('../utils/logger');

let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
          return accessToken;
    }

  try {
        // Use .in domain for India accounts
      const tokenUrl = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in/oauth/v2/token';
        const response = await axios.post(
                tokenUrl,
                null,
          {
                    params: {
                                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                                client_id: process.env.ZOHO_CLIENT_ID,
                                client_secret: process.env.ZOHO_CLIENT_SECRET,
                                grant_type: 'refresh_token'
                    }
          }
              );

      accessToken = response.data.access_token;
        tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
        logger.info('Zoho access token refreshed');
        return accessToken;
  } catch (error) {
        logger.error('Failed to get Zoho access token:', error.message);
        throw error;
  }
}

async function updateZohoLead(zohoLeadId, updates) {
    if (!zohoLeadId) {
          logger.warn('No Zoho lead ID provided, skipping CRM update');
          return null;
    }

  try {
        const token = await getAccessToken();
        const baseUrl = process.env.ZOHO_BASE_URL || 'https://www.zohoapis.in/crm/v2';

      const fieldMap = {
              leadScore: 'Lead_Score',
              leadStatus: 'Lead_Status',
              conversationSummary: 'Description',
              lastContactDate: 'Last_Activity_Time',
              budget: 'Budget__c',
              timeline: 'Launch_Timeline__c',
              productCategory: 'Product_Category__c',
              qualificationScore: 'Qualification_Score__c',
              isOnboarded: 'Is_Onboarded__c',
              onboardedAt: 'Onboarding_Date__c',
              optedOut: 'SMS_Opt_Out__c'
      };

      const data = {};
        for (const [jsKey, zohoField] of Object.entries(fieldMap)) {
                if (updates[jsKey] !== undefined) {
                          data[zohoField] = updates[jsKey];
                }
        }
        // Support direct Zoho field names too
      for (const [key, val] of Object.entries(updates)) {
              if (!fieldMap[key]) data[key] = val;
      }

      if (Object.keys(data).length === 0) return null;

      const response = await axios.put(
              `${baseUrl}/Leads/${zohoLeadId}`,
        { data: [{ id: zohoLeadId, ...data }] },
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
            );

      logger.info('Zoho lead updated', { zohoLeadId, fields: Object.keys(data) });
        return response.data;
  } catch (error) {
        logger.error('Failed to update Zoho lead:', { zohoLeadId, error: error.message });
        return null;
  }
}

async function addZohoNote(zohoLeadId, note) {
    if (!zohoLeadId) return null;

  try {
        const token = await getAccessToken();
        const baseUrl = process.env.ZOHO_BASE_URL || 'https://www.zohoapis.in/crm/v2';

      const response = await axios.post(
              `${baseUrl}/Notes`,
        {
                  data: [{
                              Note_Title: 'SMS Conversation Update',
                              Note_Content: note,
                              Parent_Id: zohoLeadId,
                              se_module: 'Leads'
                  }]
        },
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
            );

      logger.info('Zoho note added', { zohoLeadId });
        return response.data;
  } catch (error) {
        logger.error('Failed to add Zoho note:', { zohoLeadId, error: error.message, status: error.response && error.response.status, data: JSON.stringify(error.response && error.response.data) });
        return null;
  }
}

module.exports = { updateZohoLead, addZohoNote, getAccessToken };
