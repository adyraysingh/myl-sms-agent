'use strict';
/**
* dealWebhook.js — Phase 3.2 Outcome Linking
*
* Handles Deal Won and Deal Lost webhook events from Zoho CRM.
* Auto-links qualification, decision, and revenue predictions to outcomes.
* Uses the existing PredictionPublisher.autoLinkOutcome() infrastructure.
*
* Routes registered in webhooks.js:
*   POST /webhooks/deal-won
*   POST /webhooks/deal-lost
*
* Security: uses verifySharedSecret('WEBHOOK_SECRET') — same as onboarding webhook.
*/

const logger = require('../../utils/logger');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');

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
const lost_reason = null;

if (!lead_id && !zoho_lead_id) {
logger.warn('[DealWebhook] Deal won: no lead_id or zoho_lead_id in payload');
}

// Link qualification prediction: deal won = onboarding probability was correct
setImmediate(() => PredictionPublisher.autoLinkOutcome({
module: 'qualification_engine',
lead_id: lead_id,
outcome_type: 'deal_won',
outcome_value: { deal_value, deal_name, close_date, zoho_lead_id, source: 'deal_won_webhook' },
is_correct: true,
accuracy_score: 1.0,
notes: 'Deal won: ' + (deal_name || zoho_lead_id || lead_id)
}).catch(e => logger.error('[OutcomeLinker] deal_won qualification failed:', e.message)));

// Link decision prediction: decisions that recommended follow-up were correct
setImmediate(() => PredictionPublisher.autoLinkOutcome({
module: 'decision_engine',
lead_id: lead_id,
outcome_type: 'deal_won',
outcome_value: { deal_value, deal_name, close_date, zoho_lead_id, source: 'deal_won_webhook' },
is_correct: true,
accuracy_score: 1.0,
notes: 'Deal won — decision recommendations were effective'
}).catch(e => logger.error('[OutcomeLinker] deal_won decision failed:', e.message)));

// Link revenue forecaster prediction: deal contributes to actual revenue
setImmediate(() => PredictionPublisher.autoLinkOutcome({
module: 'revenue_forecaster',
lead_id: null,
outcome_type: 'deal_won',
outcome_value: { deal_value, deal_name, close_date, zoho_lead_id, lead_id, source: 'deal_won_webhook' },
is_correct: true,
accuracy_score: deal_value > 0 ? 1.0 : null,
notes: 'Deal won: $' + deal_value + (deal_name ? ' — ' + deal_name : '')
}).catch(e => logger.error('[OutcomeLinker] deal_won revenue failed:', e.message)));

logger.info('[DealWebhook] Deal won outcome linking complete', { lead_id, zoho_lead_id, deal_value });
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

// Link decision prediction: decisions did not prevent churn
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
