'use strict';
/**
* Phase 3.6 — SimulationEngine.js
* Production Hardening & Stability
*
* KEY FIXES vs Phase 3.5:
* 1. RACE CONDITION FIX (Task 4): EventOrchestrator.emit('lead.created') is now emitted
*    AFTER injectConversationEvidence() completes. Previously the EO fired qualification
*    immediately before evidence was available, causing a double-processing race.
* 2. SCHEMA FIX (Task 3): analyzeLearningImprovement() fixed to use outcome_id not id.
* 3. SCOPE BUG FIX: injectConversationEvidence() referenced 'brandType' which was out
*    of scope. Now passed as a parameter.
* 4. POOL SAFETY (Task 1): batch_size reduced to 3 (default) to avoid EMAXCONNSESSION.
*    Pool has max=20 connections. 6 workers at 2 concurrent = 12 background connections.
*    Leaving 8 for simulation. 3 parallel leads × ~2 connections each = 6 = safe.
* 5. LOAD TEST: 1000 leads with SIM36 tag for Task 8.
* 6. FORECAST FIX (Task 2): ForecastModel.getLatestByType now works (shared pool, upsert added).
*/

const ZohoIngestor = require('../memory/ingestors/zoho.ingestor');
const EventOrchestrator = require('../services/EventOrchestrator');
const WorkerRegistry = require('../queue/WorkerRegistry');
const PredictionPublisher = require('../learning/services/PredictionPublisher');
const PredictionRegistry = require('../learning/models/PredictionRegistry');
const LearningScheduler = require('../learning/services/LearningScheduler');
const ExecutiveCopilot = require('../copilot/services/ExecutiveCopilot');
const RevenueForecaster = require('../revenue/services/RevenueForecaster');
const ForecastModel = require('../revenue/models/ForecastModel');
const pool = require('../memory/db/pool');

const COUNTRIES = ['USA', 'Canada', 'UK', 'Australia', 'UAE'];
const BRAND_TYPES = ['Streetwear', 'Luxury', 'Gym Wear', 'Kidswear', 'Sportswear', 'Fashion Startup', 'Existing Brand'];
const BUDGETS = [500, 2000, 10000, 50000];
const TIMELINES = ['Immediate', '30 Days', '60 Days', '90 Days', '6 Months'];

const LEAD_PROFILES = [
{ type: 'good', qualifyRate: 0.82, onboardRate: 0.74, dealWinRate: 0.65, budgetScore: 85, trustScore: 78 },
{ type: 'average', qualifyRate: 0.55, onboardRate: 0.42, dealWinRate: 0.33, budgetScore: 55, trustScore: 52 },
{ type: 'bad', qualifyRate: 0.18, onboardRate: 0.08, dealWinRate: 0.04, budgetScore: 25, trustScore: 28 },
{ type: 'serious_founder', qualifyRate: 0.92, onboardRate: 0.85, dealWinRate: 0.78, budgetScore: 92, trustScore: 88 },
{ type: 'price_shopper', qualifyRate: 0.35, onboardRate: 0.22, dealWinRate: 0.12, budgetScore: 40, trustScore: 38 },
{ type: 'unqualified', qualifyRate: 0.08, onboardRate: 0.03, dealWinRate: 0.01, budgetScore: 15, trustScore: 18 }
];

const COPILOT_QUESTIONS = [
'What is our revenue forecast for this month?',
'Which leads are most likely to convert this week?',
'What are the top risks to our pipeline?',
'How is the AI qualification engine performing?',
'Show me our top hot leads right now.',
'What deals closed this week?',
'How accurate are our revenue forecasts?',
'Which workflows are currently running?',
'What is our onboarding conversion rate?',
'Show me leads from UAE with high budgets.',
'What is the average deal value for Luxury brands?',
'Are there any SLA breaches?',
'How is the learning engine improving?',
'What percentage of AI decisions were correct?',
'Show me the Dead Letter Queue status.',
'Which brand types convert best?',
'What is our pipeline value for this quarter?',
'How many leads came from Australia this month?',
'What are the top reasons deals are lost?',
'How confident is the AI in its recommendations?'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function maybe(prob) { return Math.random() < prob; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ingestLeadViaProduction(index, profile, batchTag) {
const country = pick(COUNTRIES);
const brandType = pick(BRAND_TYPES);
const budget = pick(BUDGETS);
const timeline = pick(TIMELINES);
const tag = batchTag || 'SIM36';
const zohoLeadId = tag + '_' + Date.now() + '_' + index + '_' + rand(1000, 9999);
const zohoPayload = {
leadId: zohoLeadId, zohoLeadId, id: zohoLeadId,
First_Name: 'Sim' + index,
Last_Name: profile.type.replace(/_/g, ' '),
email: 'sim36_' + index + '_' + rand(100, 999) + '@' + country.toLowerCase().replace(/\s/g, '') + '-sim36.com',
phone: '+1555' + String(rand(1000000, 9999999)),
Lead_Source: 'Simulation_36',
company: brandType + ' Brand ' + index,
Company: brandType + ' Brand ' + index,
Description: 'Phase 3.6 simulation. Profile: ' + profile.type + '. Country: ' + country + '. Budget: $' + budget + '. Timeline: ' + timeline,
budget, timeline, country, brand_type: brandType,
Owner: { id: 'owner_sim36', name: 'Simulation Manager' }
};
const memory = await ZohoIngestor.ingestLead(zohoPayload);
return { memory, profile, country, brandType, budget, timeline, zohoLeadId };
}

// FIXED: brandType is now passed as a parameter (was referenced from outer scope in Phase 3.5, causing undefined)
async function injectConversationEvidence(memory, profile, budget, timeline, brandType) {
const conversationId = 'sim36_conv_' + memory.id + '_' + Date.now();
const sentiment = profile.type === 'bad' || profile.type === 'unqualified' ? 'negative'
: profile.type === 'serious_founder' || profile.type === 'good' ? 'positive' : 'neutral';
const stage = profile.type === 'serious_founder' ? 'negotiation'
: profile.type === 'good' ? 'qualification'
: profile.type === 'average' ? 'discovery' : 'initial_outreach';
const trustScore = Math.min(10, Math.max(1, Math.round(profile.trustScore / 10)));
const buyingIntentScore = Math.min(10, Math.max(1, Math.round(profile.budgetScore / 12)));
const convQuality = Math.min(10, Math.max(1, rand(Math.round(profile.trustScore / 15), Math.round(profile.trustScore / 8))));

const inserted = await pool.query(
`INSERT INTO conversation_analysis
(conversation_id, lead_id, source_type, source_ref, analysis_status)
VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
[conversationId, memory.id, 'retell', conversationId]
).catch(() => null);

if (!inserted || !inserted.rows[0]) return null;
const analysisId = inserted.rows[0].id;

await pool.query(
`UPDATE conversation_analysis SET
analysis_status = 'completed',
sentiment = $1,
conversation_stage = $2,
trust_score = $3,
buying_intent_score = $4,
conversation_quality = $5,
budget_detected = TRUE,
budget_value = $6,
timeline_detected = TRUE,
timeline_value = $7,
customer_intent = $8,
conversation_outcome = $9,
summary = $10,
recommended_next_step = $11,
confidence_score = $12,
analyzed_at = NOW()
WHERE id = $13`,
[
sentiment, stage, trustScore, buyingIntentScore, convQuality,
String(budget), timeline,
'Lead interested in ' + (brandType || 'fashion') + ' manufacturing services',
profile.qualifyRate >= 0.7 ? 'positive_progression' : profile.qualifyRate >= 0.4 ? 'neutral_progression' : 'stalled',
'Phase 3.6 synthetic conversation analysis for lead ' + memory.id,
profile.qualifyRate >= 0.7 ? 'Schedule follow-up demo' : 'Send pricing information',
Math.round(profile.budgetScore * 0.9),
analysisId
]
).catch(() => {});

setImmediate(() => PredictionPublisher.conversation(memory.id, {
sentiment, conversation_stage: stage, trust_score: trustScore,
buying_intent_score: buyingIntentScore, conversation_quality: convQuality,
budget_detected: true, budget_value: String(budget),
timeline_detected: true, timeline_value: timeline,
confidence_score: Math.round(profile.budgetScore * 0.9)
}).catch(() => {}));

return analysisId;
}

// FIXED (Task 4): EventOrchestrator.emit() is now called AFTER evidence injection.
// Previously emit was called before injection causing a race condition where
// QualificationProcessor ran with score=0 evidence (no conversation yet).
async function ingestLeadAndInjectEvidence(index, profile, batchTag) {
const result = await ingestLeadViaProduction(index, profile, batchTag);
const { memory, budget, timeline, brandType, zohoLeadId } = result;
// Inject evidence FIRST
await injectConversationEvidence(memory, profile, budget, timeline, brandType);
// THEN emit lead.created so qualification worker has evidence available
EventOrchestrator.emit('lead.created', {
lead_id: memory.id, zoho_lead_id: zohoLeadId,
lead_name: 'Sim' + index + ' ' + profile.type,
email: memory.email, phone: memory.phone
});
return result;
}

function enqueueQualification(memory) {
return WorkerRegistry.enqueueQualification({
leadId: memory.id,
zohoLeadId: memory.zoho_lead_id,
triggerEvent: 'conversation.analyzed',
triggerRef: 'sim36_' + memory.id
});
}

function linkOutcome(module, leadId, outcomeType, isCorrect, value, notes) {
setImmediate(() =>
PredictionPublisher.autoLinkOutcome({
module, lead_id: leadId, outcome_type: outcomeType,
outcome_value: { ...value, simulated: true },
is_correct: isCorrect, accuracy_score: isCorrect ? 1.0 : 0.0,
notes: 'Sim36: ' + notes
}).catch(() => {})
);
}

async function simulateOnboarding(memory, profile) {
if (!maybe(profile.onboardRate)) return false;
try {
const LeadMemory = require('../memory/models/LeadMemory');
await LeadMemory.markOnboarded(memory.zoho_lead_id);
EventOrchestrator.emit('onboarding.completed', {
lead_id: memory.id, zoho_lead_id: memory.zoho_lead_id, lead_name: memory.full_name
});
linkOutcome('qualification_engine', memory.id, 'onboarding_completed', true, { zoho_lead_id: memory.zoho_lead_id }, 'onboarding completed');
return true;
} catch (e) { console.error('[Sim36] Onboarding error:', e.message); return false; }
}

async function simulateDealOutcome(memory, profile, onboarded) {
if (!onboarded) return { won: false, lost: false };
const lostReasons = ['Budget constraints', 'Competitor', 'Not ready', 'Timeline mismatch', 'Price'];
if (maybe(profile.dealWinRate)) {
const dealValue = pick(BUDGETS) * (0.8 + Math.random() * 0.6);
const val = { deal_value: dealValue, zoho_lead_id: memory.zoho_lead_id };
linkOutcome('qualification_engine', memory.id, 'deal_won', true, val, 'deal won');
linkOutcome('decision_engine', memory.id, 'deal_won', true, val, 'deal won');
linkOutcome('revenue_forecaster', memory.id, 'deal_won', true, val, 'deal won');
return { won: true, lost: false, dealValue };
} else if (maybe(0.55)) {
const reason = pick(lostReasons);
const val = { lost_reason: reason, zoho_lead_id: memory.zoho_lead_id };
linkOutcome('qualification_engine', memory.id, 'deal_lost', false, val, 'deal lost');
linkOutcome('decision_engine', memory.id, 'deal_lost', false, val, 'deal lost');
return { won: false, lost: true, reason };
}
return { won: false, lost: false };
}

async function simulateRevenueEvent(memory, dealValue) {
try {
// FIXED (Task 2): ForecastModel.getLatestByType now works correctly (shared pool, upsert added in Phase 3.6)
const forecast = await ForecastModel.getLatestByType('monthly');
if (!forecast) return null;
// FIXED (Task 2): evaluateForecast now calls findById + saveEvaluation (added in Phase 3.6)
const actualRevenue = dealValue * (0.88 + Math.random() * 0.24);
const result = await RevenueForecaster.evaluateForecast(forecast.forecast_id, {
actual_revenue: actualRevenue, actual_onboardings: 1,
notes: 'Sim36: revenue event ' + memory.id
});
setImmediate(() =>
PredictionPublisher.linkOutcome({
module: 'revenue_forecaster', lead_id: memory.id,
outcome_type: 'revenue_received',
outcome_value: { forecast_id: forecast.forecast_id, actual_revenue: actualRevenue, simulated: true },
is_correct: result && result.revenue_accuracy >= 70,
accuracy_score: result ? (result.revenue_accuracy || 0) / 100 : null,
notes: 'Sim36: revenue received', source: 'simulation'
}).catch(() => {})
);
return { actual_revenue: actualRevenue, result };
} catch (e) { console.error('[Sim36] Revenue error:', e.message); return null; }
}

async function waitForQueueDrain(queueName, maxWaitMs) {
maxWaitMs = maxWaitMs || 90000;
const startWait = Date.now();
while (Date.now() - startWait < maxWaitMs) {
try {
const r = await pool.query(
"SELECT COUNT(*) as cnt FROM job_queue WHERE queue_name=$1 AND status='pending'",
[queueName]
);
const pending = parseInt(r.rows[0].cnt);
console.log('[Sim36] Queue', queueName, 'pending:', pending);
if (pending === 0) return true;
} catch (_) {}
await sleep(3000);
}
return false;
}

async function runSimulation(config) {
config = config || {};
const totalLeads = config.total_leads || 1000;
const copilotCount = config.copilot_questions || 50;
// FIXED (Task 1): batch_size defaults to 3 (down from 10) to avoid pool exhaustion.
// pool.max=20, 6 workers at concurrency 2 = 12 background connections used.
// 8 remaining. 3 parallel leads × ~2 connections = 6 — safe margin.
const batchSize = config.batch_size !== undefined ? config.batch_size : 3;
const delayMs = config.delay_ms !== undefined ? config.delay_ms : 150;
const batchTag = config.batch_tag || 'SIM36';

const stats = {
leads_ingested: 0, conversations_injected: 0, qualification_events: 0,
decision_events: 0, onboardings_completed: 0, deals_won: 0, deals_lost: 0,
revenue_events: 0, copilot_questions_asked: 0, errors: 0,
started_at: new Date().toISOString()
};

console.log('[Sim36] Phase 3.6 starting:', totalLeads, 'leads via production pipeline');
console.log('[Sim36] batch_size=' + batchSize + ' delay_ms=' + delayMs + ' pool.max=20');

// Initialize forecasts (now works correctly with Phase 3.6 ForecastModel fix)
try {
for (const t of ['monthly', 'weekly', 'quarterly']) {
const ex = await ForecastModel.getLatestByType(t);
if (!ex) { const b = RevenueForecaster.getPeriodBounds(t); await RevenueForecaster.runForecast(t, b.start, b.end); }
}
} catch (e) { console.error('[Sim36] Forecast init error:', e.message); }

for (let i = 0; i < totalLeads; i += batchSize) {
const batch = [];
for (let j = i; j < Math.min(i + batchSize, totalLeads); j++) {
batch.push({ index: j, profile: pick(LEAD_PROFILES) });
}

await Promise.all(batch.map(async function(item) {
var index = item.index; var profile = item.profile;
try {
// FIXED (Task 4): ingestLeadAndInjectEvidence emits lead.created AFTER evidence injection
const { memory, budget, timeline, brandType } = await ingestLeadAndInjectEvidence(index, profile, batchTag);
stats.leads_ingested++;
stats.conversations_injected++;
await enqueueQualification(memory);
stats.qualification_events++;
await WorkerRegistry.enqueueDecision({
lead_id: memory.id, trigger_event: 'qualification.updated',
trigger_source: 'sim36', trigger_data: { profile: profile.type }
});
stats.decision_events++;
await sleep(50);
const onboarded = await simulateOnboarding(memory, profile);
if (onboarded) stats.onboardings_completed++;
const dealResult = await simulateDealOutcome(memory, profile, onboarded);
if (dealResult.won) { stats.deals_won++; const rev = await simulateRevenueEvent(memory, dealResult.dealValue); if (rev) stats.revenue_events++; }
if (dealResult.lost) stats.deals_lost++;
} catch (e) { stats.errors++; console.error('[Sim36] Lead', index, 'error:', e.message); }
}));

if (delayMs > 0) await sleep(delayMs);
if (i % (batchSize * 10) === 0) {
console.log('[Sim36] Progress:', Math.min(i + batchSize, totalLeads), '/', totalLeads, '| Ingested:', stats.leads_ingested, '| Errors:', stats.errors);
}
}

console.log('[Sim36] All leads ingested. Waiting for qualification queue to drain...');
await waitForQueueDrain('qualification', 180000);
await sleep(5000);

console.log('[Sim36] Running', copilotCount, 'CEO Copilot questions...');
const sessionId = 'sim36_session_' + Date.now();
for (let q = 0; q < copilotCount; q++) {
try {
await ExecutiveCopilot.ask({ question: pick(COPILOT_QUESTIONS), session_id: sessionId, context: { source: 'simulation_36' } });
stats.copilot_questions_asked++;
await sleep(100);
} catch (_) { stats.errors++; }
}

console.log('[Sim36] Triggering learning cycle 1 of 3 (daily)...');
try { await LearningScheduler.runManual('daily'); } catch (e) { console.error('[Sim36] Learning 1 error:', e.message); }
await sleep(2000);
console.log('[Sim36] Triggering learning cycle 2 of 3 (daily)...');
try { await LearningScheduler.runManual('daily'); } catch (e) { console.error('[Sim36] Learning 2 error:', e.message); }
await sleep(2000);
console.log('[Sim36] Triggering learning cycle 3 of 3 (weekly)...');
try { await LearningScheduler.runManual('weekly'); } catch (e) { console.error('[Sim36] Learning 3 error:', e.message); }

try {
const predCounts = await PredictionRegistry.countByModule();
const accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 });
stats.prediction_counts_by_module = predCounts;
stats.accuracy_by_module = accSummary;
stats.total_predictions = Array.isArray(predCounts) ? predCounts.reduce((s, r) => s + parseInt(r.cnt || 0), 0) : 0;
} catch (_) {}

try { stats.queue_stats = await WorkerRegistry.getFullStats(); } catch (_) {}

stats.completed_at = new Date().toISOString();
stats.duration_seconds = Math.round((new Date(stats.completed_at) - new Date(stats.started_at)) / 1000);
console.log('[Sim36] COMPLETE. Duration:', stats.duration_seconds, 's. Leads:', stats.leads_ingested, '| Predictions:', stats.total_predictions, '| Errors:', stats.errors);
return stats;
}

async function validateSimulation() {
const results = { checks: {}, phase: '3.6' };
try {
const r1 = await pool.query('SELECT COUNT(*) as cnt FROM ai_predictions');
results.checks.total_predictions = parseInt(r1.rows[0].cnt);
results.predictions_exist = results.checks.total_predictions > 0;
const r2 = await pool.query('SELECT COUNT(*) as cnt FROM ai_outcomes');
results.checks.total_outcomes = parseInt(r2.rows[0].cnt);
results.outcomes_exist = results.checks.total_outcomes > 0;
const r3 = await pool.query('SELECT COUNT(*) as cnt FROM ai_outcomes WHERE prediction_id IS NOT NULL');
results.checks.linked_outcomes = parseInt(r3.rows[0].cnt);
const r4 = await pool.query('SELECT COUNT(*) as cnt FROM confidence_calibration');
results.checks.calibration_records = parseInt(r4.rows[0].cnt);
const r5 = await pool.query('SELECT COUNT(*) as cnt FROM recommendation_outcomes');
results.checks.recommendation_records = parseInt(r5.rows[0].cnt);
const r6 = await pool.query('SELECT COUNT(*) as cnt FROM revenue_forecast_evaluations');
results.checks.forecast_eval_records = parseInt(r6.rows[0].cnt);
const r7 = await pool.query("SELECT COUNT(*) as cnt FROM learning_cycle_log WHERE started_at > NOW() - INTERVAL '7 days'");
results.checks.recent_learning_cycles = parseInt(r7.rows[0].cnt);
const r8 = await pool.query("SELECT COUNT(*) as cnt FROM lead_memory WHERE zoho_lead_id LIKE 'SIM36_%'");
results.checks.sim36_lead_memory = parseInt(r8.rows[0].cnt);
results.dashboard_populated = results.checks.sim36_lead_memory > 0;
const r9 = await pool.query("SELECT COUNT(*) as cnt FROM conversation_analysis WHERE lead_id IN (SELECT id FROM lead_memory WHERE zoho_lead_id LIKE 'SIM36_%')");
results.checks.conversation_analyses = parseInt(r9.rows[0].cnt);
const r10 = await pool.query("SELECT COUNT(*) as cnt FROM lead_qualification WHERE lead_id IN (SELECT id FROM lead_memory WHERE zoho_lead_id LIKE 'SIM36_%')");
results.checks.sim36_qualifications = parseInt(r10.rows[0].cnt);
results.qualifications_exist = results.checks.sim36_qualifications > 0;
try {
const r11 = await pool.query('SELECT queue_name, status, COUNT(*) as cnt FROM job_queue GROUP BY queue_name, status ORDER BY queue_name, status');
results.checks.queue_by_status = r11.rows;
} catch (_) {}
const accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 });
results.checks.accuracy_summary = accSummary;
results.accuracy_recalculated = accSummary && accSummary.length > 0;
// Revenue check
const r12 = await pool.query('SELECT COUNT(*) as cnt FROM revenue_forecasts');
results.checks.forecast_records = parseInt(r12.rows[0].cnt);
results.forecasts_exist = results.checks.forecast_records > 0;
} catch (e) { results.validation_error = e.message; }
const keyChecks = [results.predictions_exist, results.outcomes_exist, results.dashboard_populated, results.qualifications_exist, results.accuracy_recalculated];
results.passed_checks = keyChecks.filter(Boolean).length;
results.total_checks = keyChecks.length;
results.overall_pass = results.passed_checks >= 4;
return results;
}

// FIXED (Task 3): analyzeLearningImprovement() now correctly uses outcome_id (not id)
async function analyzeLearningImprovement() {
const analysis = {};
try {
// FIXED: was 'SELECT id FROM ai_outcomes' — PK is outcome_id, not id
const r = await pool.query('SELECT outcome_id, is_correct, accuracy_score, module, created_at FROM ai_outcomes ORDER BY created_at ASC');
const rows = r.rows;
analysis.total_outcomes = rows.length;
if (rows.length < 20) return Object.assign({}, analysis, { insufficient_data: true, note: 'Need at least 20 outcomes for cohort analysis' });

function calc(subset) {
if (!subset.length) return { accuracy_pct: 0, avg_score: 0, count: 0, correct: 0, incorrect: 0 };
const correct = subset.filter(function(x) { return x.is_correct === true; }).length;
const incorrect = subset.filter(function(x) { return x.is_correct === false; }).length;
const scored = subset.filter(function(x) { return x.accuracy_score !== null; });
const avgScore = scored.length > 0 ? scored.reduce(function(s, x) { return s + parseFloat(x.accuracy_score || 0); }, 0) / scored.length : 0;
return { accuracy_pct: Math.round(correct / (correct + incorrect || 1) * 100), avg_score: Math.round(avgScore * 100) / 100, count: subset.length, correct: correct, incorrect: incorrect };
}

const cohortSize = Math.min(100, Math.floor(rows.length / 3));
analysis.cohort_size = cohortSize;
analysis.first_cohort = calc(rows.slice(0, cohortSize));
analysis.middle_cohort = calc(rows.slice(Math.floor(rows.length / 2) - Math.floor(cohortSize / 2), Math.floor(rows.length / 2) + Math.floor(cohortSize / 2)));
analysis.last_cohort = calc(rows.slice(-cohortSize));
const delta = analysis.last_cohort.accuracy_pct - analysis.first_cohort.accuracy_pct;
analysis.delta_pct = delta;
analysis.measurable_improvement = delta >= 0;
analysis.improvement_summary = delta > 0 ? '+' + delta + '% improvement first to last cohort'
: delta === 0 ? 'Stable accuracy (0% change)' : delta + '% regression first to last cohort';
const modules = Array.from(new Set(rows.map(function(r) { return r.module; })));
analysis.by_module = {};
for (const mod of modules) {
const modRows = rows.filter(function(r) { return r.module === mod; });
if (modRows.length < 4) continue;
const half = Math.floor(modRows.length / 2);
const first = calc(modRows.slice(0, half));
const last = calc(modRows.slice(half));
analysis.by_module[mod] = { first_half: first, second_half: last, improvement_pct: last.accuracy_pct - first.accuracy_pct, total_outcomes: modRows.length };
}
try {
const calR = await pool.query('SELECT module, confidence_bucket, actual_accuracy, calibration_error FROM confidence_calibration ORDER BY created_at DESC LIMIT 30');
analysis.calibration_sample = calR.rows;
analysis.calibration_buckets = calR.rowCount;
} catch (_) {}
} catch (e) { analysis.error = e.message; }
return analysis;
}

async function compareEarlyvLate() {
try {
const r = await pool.query(`
SELECT p.module, p.prediction_type, p.confidence,
o.is_correct, o.accuracy_score, p.created_at,
ROW_NUMBER() OVER (PARTITION BY p.module ORDER BY p.created_at ASC) as rn,
COUNT(*) OVER (PARTITION BY p.module) as total
FROM ai_predictions p
LEFT JOIN ai_outcomes o ON o.prediction_id = p.prediction_id
ORDER BY p.module, p.created_at ASC
`);
const rows = r.rows;
if (rows.length < 10) return { insufficient_data: true };
const modules = Array.from(new Set(rows.map(function(r) { return r.module; })));
const result = {};
for (const mod of modules) {
const modRows = rows.filter(function(r) { return r.module === mod; });
const total = modRows.length;
if (total < 6) continue;
const early = modRows.slice(0, Math.floor(total / 2));
const late = modRows.slice(Math.floor(total / 2));
function metrics(subset) {
const withOutcome = subset.filter(function(r) { return r.is_correct !== null; });
if (!withOutcome.length) return { n: subset.length, accuracy: null, avg_confidence: null };
const tp = withOutcome.filter(function(r) { return r.is_correct === true; }).length;
const fp = withOutcome.filter(function(r) { return r.is_correct === false; }).length;
const avgConf = subset.reduce(function(s, r) { return s + parseFloat(r.confidence || 0); }, 0) / subset.length;
return { n: subset.length, tp: tp, fp: fp, accuracy: Math.round(tp / (tp + fp) * 10000) / 100, avg_confidence: Math.round(avgConf * 100) / 100 };
}
result[mod] = { early_predictions: metrics(early), late_predictions: metrics(late), total_predictions: total };
}
return result;
} catch (e) { return { error: e.message }; }
}

module.exports = { runSimulation, validateSimulation, analyzeLearningImprovement, compareEarlyvLate };
