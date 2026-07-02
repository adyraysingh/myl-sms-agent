use strict';
/**
   * dealWebhook.js — Phase 3.2 Outcome Linking + Onboarded Lead Guard
   *
   * FIX: When deal is WON, mark lead as is_onboarded=true and cancel all
   * pending follow-ups so onboarded clients no longer receive AI emails/SMS.
   *
   * Routes:
   *   POST /webhooks/deal-won
   *   POST /webhooks/deal-lost
   */

const logger = require('../../utils/logger');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');
const { findLeadByZohoId, updateLead } = require('../../database/leads');
const { cancelFollowUps } = require('../../workflows/followUpScheduler');
const { updateConversationStatus, getConversationByLeadId } = require('../../database/conversations');
const { updateZohoLead } = require('../../services/zohoService');

// ─── Express route handler: Deal Won ─────────────────────────────────────────

async function handleDealWonWebhook(req, res) {
    try {
          res.status(200).json({ success: true, message: 'Deal won event received' });
          setImmediate(async () => {
                  try {
                            await handleDealWon(req.body);
                  } catch (err) {
                            logger.error('[DealWebhook] Error processing deal won', { error: err.message });
                  }
          });
    } catch (error) {
          logger.error('[DealWebhook] Deal won webhook error', { error: error.message });
          return res.status(500).json({ success: false, error: error.message });
    }
}

// ─── Express route handler: Deal Lost ────────────────────────────────────────

async function handleDealLostWebhook(req, res) {
    try {
          res.status(200).json({ success: true, message: 'Deal lost event received' });
          setImmediate(async () => {
                  try {
                            await handleDealLost(req.body);
                  } catch (err) {
                            logger.error('[DealWebhook] Error processing deal lost', { error: err.message });
                  }
          });
    } catch (error) {
          logger.error('[DealWebhook] Deal lost webhook error', { error: error.message });
          return res.status(500).json({ success: false, error: error.message });
    }
}

// ─── Business logic: Deal Won ─────────────────────────────────────────────────

async function handleDealWon(data) {
    logger.info('[DealWebhook] Processing deal won', { data });

  const lead_id = data.lead_id || data.leadId || data.id || null;
    const zoho_lead_id = data.zohoLeadId || data.zoho_lead_id || data.deal_id || null;
    const deal_value = parseFloat(data.deal_value || data.amount || data.Amount || 0);
    const deal_name = data.deal_name || data.Deal_Name || data.name || null;
    const close_date = data.close_date || data.Close_Date || new Date().toISOString();

  // ─── CRITICAL FIX: Mark lead as onboarded + cancel all follow-ups ─────────
  // When a lead converts to Account/Contact in Zoho (deal won), they must NOT
  // receive any more AI emails or SMS sequences.
  let resolvedLeadId = lead_id;

  if (!resolvedLeadId && zoho_lead_id) {
        try {
                const lead = await findLeadByZohoId(zoho_lead_id);
                if (lead) resolvedLeadId = lead.id;
        } catch (e) {
                logger.error('[DealWebhook] Could not find lead by zoho_id', { zoho_lead_id, error: e.message });
        }
  }

  if (resolvedLeadId) {
        try {
                // Mark as onboarded so followUpScheduler WHERE clause (is_onboarded = false) excludes them
          await updateLead(resolvedLeadId, {
                    isOnboarded: true,
                    onboardedAt: new Date().toISOString(),
                    leadStatus: 'Onboarded'
          });
                logger.info('[DealWebhook] Lead marked as onboarded', { lead_id: resolvedLeadId });

          // Cancel all pending follow-up SMS/email sequences
          await cancelFollowUps(resolvedLeadId);
                logger.info('[DealWebhook] Follow-ups cancelled for onboarded lead', { lead_id: resolvedLeadId });

          // Close the active conversation
          try {
                    const conversation = await getConversationByLeadId(resolvedLeadId);
                    if (conversation) {
                                await updateConversationStatus(conversation.id, 'closed', 'Deal won - lead converted to client');
                    }
          } catch (e) {
                    logger.warn('[DealWebhook] Could not close conversation', { error: e.message });
          }

          // Update Zoho lead status
          if (zoho_lead_id) {
                    try {
                                await updateZohoLead(zoho_lead_id, { leadStatus: 'Onboarded' });
                    } catch (e) {
                                logger.warn('[DealWebhook] Could not update Zoho lead status', { error: e.message });
                    }
          }
        } catch (e) {
                logger.error('[DealWebhook] Failed to mark lead as onboarded', { lead_id: resolvedLeadId, error: e.message });
        }
  } else {
        logger.warn('[DealWebhook] Deal won: could not resolve lead_id — follow-ups NOT cancelled', { lead_id, zoho_lead_id });
  }
    // ─── END CRITICAL FIX ─────────────────────────────────────────────────────

  if (!lead_id && !zoho_lead_id) {
        logger.warn('[DealWebhook] Deal won: no lead_id or zoho_lead_id in payload');
  }

  // Link qualification prediction: deal won = onboarding probability was correct
  setImmediate(() => PredictionPublisher.autoLinkOutcome({
        module: 'qualification_engine',
        lead_id: resolvedLeadId || lead_id,
        outcome_type: 'deal_won',
        outcome_value: { deal_value, deal_name, close_date, zoho_lead_id, source: 'deal_won_webhook' },
        is_correct: true,
        accuracy_score: 1.0,
        notes: 'Deal won: ' + (deal_name || zoho_lead_id || lead_id)
  }).catch(e => logger.error('[OutcomeLinker] deal_won qualification failed:', e.message)));

  // Link decision prediction
  setImmediate(() => PredictionPublisher.autoLinkOutcome({
        module: 'decision_engine',
        lead_id: resolvedLeadId || lead_id,
        outcome_type: 'deal_won',
        outcome_value: { deal_value, deal_name, close_date, zoho_lead_id, source: 'deal_won_webhook' },
        is_correct: true,
        accuracy_score: 1.0,
        notes: 'Deal won — decision recommendations were effective'
  }).catch(e => logger.error('[OutcomeLinker] deal_won decision failed:', e.message)));

  // Link revenue forecaster prediction
  setImmediate(() => PredictionPublisher.autoLinkOutcome({
        module: 'revenue_forecaster',
        lead_id: null,
        outcome_type: 'deal_won',
        outcome_value: { deal_value, deal_name, close_date, zoho_lead_id, lead_id: resolvedLeadId || lead_id, source: 'deal_won_webhook' },
        is_correct: true,
        accuracy_score: deal_value > 0 ? 1.0 : null,
        notes: 'Deal won: $' + deal_value + (deal_name ? ' — ' + deal_name : '')
  }).catch(e => logger.error('[OutcomeLinker] deal_won revenue failed:', e.message)));

  logger.info('[DealWebhook] Deal won processing complete', { lead_id: resolvedLeadId, zoho_lead_id, deal_value });
}

// ─── Business logic: Deal Lost ────────────────────────────────────────────────

async function handleDealLost(data) {
    logger.info('[DealWebhook] Processing deal lost', { data });

  const lead_id = data.lead_id || data.leadId || data.id || null;
    const zoho_lead_id = data.zohoLeadId || data.zoho_lead_id || data.deal_id || null;
    const deal_value = parseFloat(data.deal_value || data.amount || data.Amount || 0);
    const deal_name = data.deal_name || data.Deal_Name || data.name || null;
    const lost_reason = data.lost_reason || data.Lost_Reason || data.reason || 'Not specified';
    const close_date = data.close_date || data.Close_Date || new Date().toISOString();

  if (!lead_id && !zoho_lead_id) {
        logger.warn('[DealWebhook] Deal lost: no lead_id or zoho_lead_id in payload');
  }

  // Link qualification prediction: deal lost = onboarding probability was incorrect
  setImmediate(() => PredictionPublisher.autoLinkOutcome({
        module: 'qualification_engine',
        lead_id: lead_id,
        outcome_type: 'deal_lost',
        outcome_value: { deal_value, deal_name, lost_reason, close_date, zoho_lead_id, source: 'deal_lost_webhook' },
        is_correct: false,
        accuracy_score: 0,
        notes: 'Deal lost: ' + lost_reason
  }).catch(e => logger.error('[OutcomeLinker] deal_lost qualification failed:', e.message)));

  // Link decision prediction
  setImmediate(() => PredictionPublisher.autoLinkOutcome({
        module: 'decision_engine',
        lead_id: lead_id,
        outcome_type: 'deal_lost',
        outcome_value: { deal_value, deal_name, lost_reason, close_date, zoho_lead_id, source: 'deal_lost_webhook' },
        is_correct: false,
        accuracy_score: 0,
        notes: 'Deal lost — decision recommendations were not effective. Reason: ' + lost_reason
  }).catch(e => logger.error('[OutcomeLinker] deal_lost decision failed:', e.message)));

  logger.info('[DealWebhook] Deal lost outcome linking complete', { lead_id, zoho_lead_id, lost_reason });
}

module.exports = {
    handleDealWonWebhook,
    handleDealLostWebhook,
    handleDealWon,
    handleDealLost
};
