'use strict';

const axios = require('axios');

/**
 * ZohoQualificationSync
 * Updates ONLY AI qualification fields in Zoho CRM.
 * NEVER modifies: owner, pipeline stage, manual data.
 * Phase 4 - Onboarding Qualification Engine
 */

const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

let cachedToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
    params: {
      refresh_token: ZOHO_REFRESH_TOKEN,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token'
    }
  });
  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
  return cachedToken;
}

class ZohoQualificationSync {

  /**
   * Sync AI qualification data to Zoho CRM.
   * Only writes to AI_Qualification_* fields.
   * NEVER modifies owner, pipeline stage, or manual fields.
   */
  static async sync(zohoLeadId, qualificationId, qual) {
    console.log(`[ZohoQualificationSync] Syncing qualification to Zoho lead ${zohoLeadId}`);

    const token = await getAccessToken();

    // Build gap summary string
    const gapSummary = Array.isArray(qual.qualification_gaps)
      ? qual.qualification_gaps.map(g => g.gap).join('; ')
      : '';

    // Build positive signals string
    const positiveStr = Array.isArray(qual.positive_signals)
      ? qual.positive_signals.map(s => s.signal).join('; ')
      : '';

    const aiFields = {
      'AI_Qualification_Category':      qual.category || '',
      'AI_Onboarding_Score':            qual.onboarding_score || 0,
      'AI_Onboarding_Probability':      qual.onboarding_probability || 0,
      'AI_Readiness_Score':             qual.readiness_score || 0,
      'AI_Qualification_Trust_Score':   qual.trust_score || 0,
      'AI_Engagement_Score':            qual.engagement_score || 0,
      'AI_Budget_Confidence':           qual.budget_confidence || 0,
      'AI_Timeline_Confidence':         qual.timeline_confidence || 0,
      'AI_Brand_Readiness':             qual.brand_readiness || 0,
      'AI_Manufacturing_Readiness':     qual.manufacturing_readiness || 0,
      'AI_Decision_Confidence':         qual.decision_confidence || 0,
      'AI_Qualification_Confidence':    qual.confidence_score || 0,
      'AI_Qualification_Reasoning':     qual.overall_reasoning || '',
      'AI_Qualification_Gaps':          gapSummary,
      'AI_Positive_Signals':            positiveStr,
      'AI_Recommended_Next_Action':     qual.recommended_next_action || '',
      'AI_Urgency_Level':               qual.urgency_level || 'normal',
      'AI_Qualification_ID':            qualificationId,
      'AI_Qualification_Updated_At':    new Date().toISOString()
    };

    try {
      const response = await axios.put(
        `${ZOHO_API_DOMAIN}/crm/v3/Leads`,
        { data: [{ id: zohoLeadId, ...aiFields }] },
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const result = response.data?.data?.[0];
      if (result?.status === 'success') {
        console.log(`[ZohoQualificationSync] Updated Zoho lead ${zohoLeadId} with qualification data`);
        return { success: true };
      } else {
        console.warn(`[ZohoQualificationSync] Unexpected status:`, result);
        return { success: false, error: JSON.stringify(result) };
      }
    } catch (err) {
      const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error(`[ZohoQualificationSync] Failed for lead ${zohoLeadId}:`, errMsg);
      return { success: false, error: errMsg };
    }
  }
}

module.exports = ZohoQualificationSync;
