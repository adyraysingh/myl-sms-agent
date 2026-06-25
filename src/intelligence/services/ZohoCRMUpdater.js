'use strict';

const axios = require('axios');
const pool = require('../../memory/db/pool');

/**
 * ZohoCRMUpdater
 * Updates only AI-generated fields in Zoho CRM.
 * NEVER modifies: owner, pipeline stage, manual notes.
 * Only writes to designated AI fields.
 * Phase 3 - Conversation Intelligence Engine
 */

// Zoho CRM API credentials (same as existing system)
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

let cachedToken = null;
let tokenExpiry = null;

/**
 * Get a valid Zoho access token
 */
async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

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

class ZohoCRMUpdater {

  /**
   * Sync AI analysis results to Zoho CRM AI fields
   * ONLY updates AI-designated fields. Never touches owner, stage, or manual fields.
   * @param {string} zohoLeadId - Zoho Lead ID
   * @param {string} analysisId - Internal analysis UUID
   * @param {object} analysis - Sanitized analysis data
   */
  static async syncAnalysis(zohoLeadId, analysisId, analysis) {
    console.log(`[ZohoCRMUpdater] Syncing analysis ${analysisId} to Zoho lead ${zohoLeadId}`);

    const token = await getAccessToken();

    // Map AI analysis to Zoho CRM AI fields
    // These are custom fields prefixed with AI_ to clearly distinguish from manual fields
    const aiFields = {
      'AI_Conversation_Summary': analysis.summary || '',
      'AI_Customer_Intent': analysis.customer_intent || '',
      'AI_Conversation_Stage': analysis.conversation_stage || '',
      'AI_Brand_Stage': analysis.brand_stage || '',
      'AI_Sentiment': analysis.sentiment || '',
      'AI_Trust_Score': analysis.trust_score || 0,
      'AI_Buying_Intent_Score': analysis.buying_intent_score || 0,
      'AI_Conversation_Quality': analysis.conversation_quality || '',
      'AI_Conversation_Outcome': analysis.conversation_outcome || '',
      'AI_Recommended_Next_Step': analysis.recommended_next_step || '',
      'AI_Recommended_Follow_Up': analysis.recommended_follow_up || '',
      'AI_Budget_Detected': analysis.budget_detected || false,
      'AI_Timeline_Detected': analysis.timeline_detected || false,
      'AI_Manufacturing_Stage': analysis.manufacturing_stage || '',
      'AI_Shopify_Status': analysis.shopify_status || '',
      'AI_Experience_Level': analysis.experience_level || '',
      'AI_Brand_Readiness': analysis.brand_readiness || '',
      'AI_Country_Detected': analysis.country || '',
      'AI_Topics_Detected': Array.isArray(analysis.topics_detected) ? analysis.topics_detected.join(', ') : '',
      'AI_Product_Interest': Array.isArray(analysis.product_interest) ? analysis.product_interest.join(', ') : '',
      'AI_Confidence_Score': analysis.confidence_score || 0,
      'AI_Analysis_ID': analysisId,
      'AI_Last_Analyzed': new Date().toISOString()
    };

    // Add budget value as string if detected
    if (analysis.budget_detected && analysis.budget_value) {
      const bv = analysis.budget_value;
      let budgetStr = '';
      if (bv.amount) budgetStr = `${bv.currency || ''} ${bv.amount}`.trim();
      else if (bv.range_min || bv.range_max) budgetStr = `${bv.currency || ''} ${bv.range_min || ''}-${bv.range_max || ''}`.trim();
      if (bv.notes) budgetStr += ` (${bv.notes})`;
      aiFields['AI_Budget_Value'] = budgetStr;
    }

    // Add timeline as string if detected
    if (analysis.timeline_detected && analysis.timeline_value) {
      const tv = analysis.timeline_value;
      let timelineStr = tv.notes || '';
      if (tv.weeks) timelineStr = `${tv.weeks} weeks`;
      else if (tv.months) timelineStr = `${tv.months} months`;
      if (tv.urgency) timelineStr += ` (${tv.urgency} urgency)`;
      aiFields['AI_Timeline_Value'] = timelineStr;
    }

    const updatePayload = { data: [{ id: zohoLeadId, ...aiFields }] };

    let success = false;
    let errorMessage = null;

    try {
      const response = await axios.put(
        `${ZOHO_API_DOMAIN}/crm/v3/Leads`,
        updatePayload,
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data?.data?.[0];
      if (result?.status === 'success') {
        success = true;
        console.log(`[ZohoCRMUpdater] Successfully updated Zoho lead ${zohoLeadId}`);
      } else {
        errorMessage = JSON.stringify(result);
        console.warn(`[ZohoCRMUpdater] Zoho update returned unexpected status:`, result);
      }
    } catch (err) {
      errorMessage = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error(`[ZohoCRMUpdater] Failed to update Zoho lead ${zohoLeadId}:`, errorMessage);
    }

    // Log sync attempt to DB
    try {
      await pool.query(
        `INSERT INTO zoho_ai_sync_log (analysis_id, zoho_lead_id, fields_updated, success, error_message)`,
        [analysisId, zohoLeadId, JSON.stringify(aiFields), success, errorMessage]
      );
    } catch (dbErr) {
      console.error('[ZohoCRMUpdater] Failed to log sync:', dbErr.message);
    }

    return { success, errorMessage };
  }
}

module.exports = ZohoCRMUpdater;
