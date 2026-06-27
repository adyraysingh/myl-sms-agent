'use strict';

const LeadQualification = require('../models/LeadQualification');
const QualificationHistory = require('../models/QualificationHistory');
const QualificationEngine = require('./QualificationEngine');
const ZohoQualificationSync = require('./ZohoQualificationSync');
const pool = require('../../memory/db/pool');
const { ContextEngine, InsufficientContextError } = require('../../services/ContextEngine');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');

const queue = [];
let isProcessing = false;
let activeJobs = 0;
const MAX_CONCURRENT = 2;

class QualificationProcessor {

static async submit({ leadId, zohoLeadId, triggerEvent, triggerRef }) {
console.log('[QualificationProcessor] Queuing qualification for lead ' + leadId);
const existing = queue.find(j => j.leadId === leadId);
if (existing) {
existing.triggerEvent = triggerEvent;
existing.triggerRef = triggerRef;
return;
}
queue.push({ leadId, zohoLeadId, triggerEvent, triggerRef });
QualificationProcessor._processQueue().catch(err => {
console.error('[QualificationProcessor] Queue error:', err.message);
});
}

static async _processQueue() {
if (isProcessing && activeJobs >= MAX_CONCURRENT) return;
isProcessing = true;
while (queue.length > 0 && activeJobs < MAX_CONCURRENT) {
const job = queue.shift();
activeJobs++;
QualificationProcessor._processJob(job).finally(() => {
activeJobs--;
if (queue.length > 0) QualificationProcessor._processQueue().catch(() => {});
});
}
if (queue.length === 0 && activeJobs === 0) isProcessing = false;
}

static async _processJob({ leadId, zohoLeadId, triggerEvent, triggerRef }) {
const startTime = Date.now();
console.log('[QualificationProcessor] Processing qualification for lead ' + leadId);
try {
let contextResult;
try {
contextResult = await ContextEngine.requireContext(leadId, zohoLeadId, 'qualification');
} catch (ctxErr) {
if (ctxErr.code === 'INSUFFICIENT_CONTEXT') {
await QualificationProcessor._storeInsufficientRecord(leadId, zohoLeadId, triggerEvent, ctxErr, Date.now() - startTime);
return;
}
throw ctxErr;
}

const leadData = {
...contextResult.context,
lead_id: leadId,
zoho_lead_id: zohoLeadId,
recalculation_number: (await pool.query('SELECT COUNT(*) as count FROM qualification_history WHERE lead_id = $1', [leadId]).then(r => parseInt(r.rows[0].count || 0)).catch(() => 0)) + 1,
profile: contextResult.context.profile,
activity: {
total_conversations: contextResult.signal_counts.conversations,
total_calls: contextResult.signal_counts.calls,
total_emails: contextResult.signal_counts.emails,
total_tasks: contextResult.signal_counts.tasks,
total_notes: contextResult.signal_counts.notes,
total_events: contextResult.signal_counts.events
},
latest_analysis: contextResult.context.latest_conversation,
all_analyses_summary: contextResult.context.all_conversations,
calls_summary: contextResult.context.calls,
emails_summary: contextResult.context.emails,
tasks_summary: contextResult.context.tasks,
notes_summary: contextResult.context.notes
};

const previousQual = await LeadQualification.findByLeadId(leadId);
const rawQual = await QualificationEngine.qualify(leadData);
const sanitized = QualificationEngine.sanitize(rawQual);

const scoreDelta = sanitized.onboarding_score - (previousQual ? previousQual.onboarding_score : 0);
const probabilityDelta = sanitized.onboarding_probability - (previousQual ? previousQual.onboarding_probability : 0);
const categoryChanged = previousQual ? previousQual.category !== sanitized.category : false;

const saved = await LeadQualification.upsert({
...sanitized,
lead_id: leadId,
zoho_lead_id: zohoLeadId || null,
trigger_event: triggerEvent,
trigger_ref: triggerRef || null,
lead_snapshot: leadData
});

// Phase 3.1: Auto-publish prediction (fire-and-forget)
setImmediate(() => PredictionPublisher.qualification(leadId, sanitized, triggerEvent).catch(() => {}));

await QualificationHistory.record({
lead_id: leadId,
qualification_id: saved.id,
zoho_lead_id: zohoLeadId || null,
category: sanitized.category,
onboarding_score: sanitized.onboarding_score,
onboarding_probability: sanitized.onboarding_probability,
readiness_score: sanitized.readiness_score,
trust_score: sanitized.trust_score,
engagement_score: sanitized.engagement_score,
confidence_score: sanitized.confidence_score,
score_delta: scoreDelta,
probability_delta: probabilityDelta,
category_changed: categoryChanged,
previous_category: previousQual ? previousQual.category : null,
trigger_event: triggerEvent,
trigger_ref: triggerRef || null,
overall_reasoning: sanitized.overall_reasoning,
qualification_gaps: sanitized.qualification_gaps,
recommended_next_action: sanitized.recommended_next_action,
lead_snapshot: leadData,
model_version: sanitized.model_version,
processing_time_ms: Date.now() - startTime
});

const elapsed = Date.now() - startTime;
console.log('[QualificationProcessor] Completed lead ' + leadId + ': category=' + sanitized.category);

if (zohoLeadId) {
ZohoQualificationSync.sync(zohoLeadId, saved.id, sanitized).catch(err => {
console.error('[QualificationProcessor] Zoho sync failed:', err.message);
});
}

return saved;
} catch (err) {
console.error('[QualificationProcessor] Failed for lead ' + leadId + ':', err.message);
await LeadQualification.markFailed(leadId, err.message).catch(() => {});
}
}

static async _storeInsufficientRecord(leadId, zohoLeadId, triggerEvent, ctxErr, processingTimeMs) {
try {
await LeadQualification.upsert({
lead_id: leadId,
zoho_lead_id: zohoLeadId || null,
category: 'unqualified',
onboarding_score: 0,
onboarding_probability: 0,
readiness_score: 0,
trust_score: 0,
engagement_score: 0,
budget_confidence: 0,
timeline_confidence: 0,
brand_readiness: 0,
manufacturing_readiness: 0,
communication_quality: 0,
followup_health: 0,
decision_confidence: 0,
confidence_score: 0,
overall_reasoning: 'Insufficient information. Evidence score: ' + ctxErr.evidenceScore + '/20 required.',
score_breakdown: {},
factors: {},
qualification_gaps: ctxErr.missingSignals.map(s => ({ gap: s.signal, severity: s.severity, impact_on_score: s.description })),
positive_signals: [],
negative_signals: [],
recommended_next_action: ctxErr.missingSignals.length > 0 ? ctxErr.missingSignals[0].how_to_resolve : 'Gather more customer information',
recommended_questions: ctxErr.missingSignals.map(s => s.how_to_resolve),
urgency_level: 'normal',
trigger_event: triggerEvent,
trigger_ref: null,
model_version: 'context_engine_v1',
lead_snapshot: { evidence_score: ctxErr.evidenceScore, missing_signals: ctxErr.missingSignals },
insufficient_context: true
});
console.log('[QualificationProcessor] Stored insufficient context record for lead ' + leadId);
} catch (err) {
console.error('[QualificationProcessor] Failed to store insufficient record for ' + leadId + ':', err.message);
}
}

static status() {
return { queueSize: queue.length, activeJobs, isProcessing };
}
}

module.exports = QualificationProcessor;
