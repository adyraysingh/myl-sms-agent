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

            logger.info('Zoho access token refreshed', { service: 'myl-sms-agent' });
                return accessToken;
    } catch (error) {
                logger.error('Failed to refresh Zoho token:', {
                                message: error.message,
                                response: error.response && error.response.data
                });
                throw error;
    }
}

async function getLeadByPhone(phone) {
        try {
                    const token = await getAccessToken();
                    const baseUrl = process.env.ZOHO_BASE_URL || 'https://www.zohoapis.in/crm/v2';

            const response = await axios.get(
                            `${baseUrl}/Leads/search`,
                {
                                    params: { phone },
                                    headers: { Authorization: `Zoho-oauthtoken ${token}` }
                }
                        );

            return response.data && response.data.data && response.data.data[0];
        } catch (error) {
                    logger.error('Failed to get lead by phone:', { phone, error: error.message });
                    return null;
        }
}

async function updateLead(zohoLeadId, data) {
        if (!zohoLeadId) return null;

    try {
                const token = await getAccessToken();
                const baseUrl = process.env.ZOHO_BASE_URL || 'https://www.zohoapis.in/crm/v2';

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
                                                            Parent_Id: { id: zohoLeadId },
                                                            se_module: 'Leads'
                                    }]
                },
                { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
                        );

            logger.info('Zoho note added', { service: 'myl-sms-agent', zohoLeadId });
                return response.data;
    } catch (error) {
                logger.error('Failed to add Zoho note:', {
                                zohoLeadId,
                                message: error.message,
                                status: error.response && error.response.status,
                                data: error.response && error.response.data
                });
                return null;
    }
}

module.exports = {
        getAccessToken,
        getLeadByPhone,
        updateLead,
        addZohoNote
};
