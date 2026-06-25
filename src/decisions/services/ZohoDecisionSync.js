'use strict';

const axios = require('axios');
const pool = require('../../memory/db/pool');

class ZohoDecisionSync {

  // Sync top AI decision to Zoho CRM AI fields only
  // NEVER changes owner, pipeline stage, or manual fields
  static async syncToZoho(lead_id, decision, result) {
    try {
      const token = await ZohoDecisionSync._getAccessToken();
      if (!token) {
        console.warn('[ZohoDecisionSync] No access token available, skipping sync for lead:', lead_id);
        return;
      }

      const fieldsToUpdate = {
        AI_Next_Best_Action: decision.decision_type || '',
        AI_Decision_Priority: (decision.priority || 'medium').toUpperCase(),
        AI_Decision_Reason: (decision.reason || '').substring(0, 500),
        AI_Expected_Impact: (decision.expected_business_impact || '').substring(0, 500),
        AI_Decision_Confidence: String(Math.round(decision.confidence_score || 0)) + '%',
        AI_Decision_Status: decision.status || 'created',
        AI_Overall_Situation: (result && result.overall_situation ? result.overall_situation : '').substring(0, 500),
        AI_Urgency_Level: (result && result.urgency_level ? result.urgency_level : 'medium').toUpperCase()
      };

      const zohoLeadId = await ZohoDecisionSync._resolveZohoLeadId(lead_id);
      if (!zohoLeadId) {
        console.warn('[ZohoDecisionSync] Could not resolve Zoho Lead ID for:', lead_id);
        return;
      }

      const response = await axios.put(
        'https://www.zohoapis.com/crm/v2/Leads/' + zohoLeadId,
        { data: [fieldsToUpdate] },
        { headers: { Authorization: 'Zoho-oauthtoken ' + token, 'Content-Type': 'application/json' } }
      );

      await ZohoDecisionSync._logSync(lead_id, decision.decision_id, fieldsToUpdate, 'success', null);
      console.log('[ZohoDecisionSync] Synced AI decision fields for lead:', lead_id);

    } catch (err) {
      console.error('[ZohoDecisionSync] Sync failed for lead:', lead_id, '|', err.message);
      await ZohoDecisionSync._logSync(lead_id, decision ? decision.decision_id : null, {}, 'failed', err.message);
    }
  }

  static async _getAccessToken() {
    try {
      const result = await pool.query(
        'SELECT access_token FROM zoho_tokens ORDER BY created_at DESC LIMIT 1'
      );
      return result.rows.length > 0 ? result.rows[0].access_token : null;
    } catch (err) {
      // Fallback to env var
      return process.env.ZOHO_ACCESS_TOKEN || null;
    }
  }

  static async _resolveZohoLeadId(lead_id) {
    try {
      const result = await pool.query(
        'SELECT zoho_lead_id FROM lead_memory WHERE zoho_lead_id = $1 LIMIT 1',
        [lead_id]
      );
      return result.rows.length > 0 ? result.rows[0].zoho_lead_id : lead_id;
    } catch (err) {
      return lead_id;
    }
  }

  static async _logSync(lead_id, decision_id, fields_updated, sync_status, error_message) {
    try {
      await pool.query(
        'INSERT INTO zoho_decision_sync_log (lead_id, decision_id, fields_updated, sync_status, error_message) VALUES ($1, $2, $3, $4, $5)',
        [lead_id, decision_id, JSON.stringify(fields_updated), sync_status, error_message]
      );
    } catch (err) {
      console.error('[ZohoDecisionSync] Log error:', err.message);
    }
  }
}

module.exports = ZohoDecisionSync;
