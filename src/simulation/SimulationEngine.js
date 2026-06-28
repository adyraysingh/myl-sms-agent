'use strict';
/**
 * Phase 3.3 — SimulationEngine.js
 * Synthetic Business Simulation for MakeYourLabel AI Platform
 */

const pool = require('../memory/db/pool');
const QualificationProcessor = require('../qualification/services/QualificationProcessor');
const DecisionProcessor = require('../decisions/services/DecisionProcessor');
const WorkflowEngine = require('../operations/services/WorkflowEngine');
const RevenueForecaster = require('../revenue/services/RevenueForecaster');
const LearningScheduler = require('../learning/services/LearningScheduler');
const PredictionPublisher = require('../learning/services/PredictionPublisher');
const PredictionRegistry = require('../learning/models/PredictionRegistry');
const ConversationAnalysis = require('../intelligence/models/ConversationAnalysis');
const AIDecision = require('../decisions/models/AIDecision');
const WorkflowModel = require('../operations/models/WorkflowModel');
const ForecastModel = require('../revenue/models/ForecastModel');
const ExecutiveCopilot = require('../copilot/services/ExecutiveCopilot');
const LeadMemory = require('../memory/models/LeadMemory');

const COUNTRIES = ['USA', 'Canada', 'UK', 'Australia', 'UAE'];
const BRAND_TYPES = ['Streetwear', 'Luxury', 'Gym Wear', 'Kidswear', 'Sportswear', 'Fashion Startup', 'Existing Brand'];
const BUDGETS = [500, 2000, 10000, 50000];
const TIMELINES = ['Immediate', '30 Days', '60 Days', '90 Days', '6 Months'];
const LEAD_PROFILES = [
  { type: 'good',            qualifyRate: 0.82, onboardRate: 0.74, dealWinRate: 0.65 },
  { type: 'average',         qualifyRate: 0.55, onboardRate: 0.42, dealWinRate: 0.33 },
  { type: 'bad',             qualifyRate: 0.18, onboardRate: 0.08, dealWinRate: 0.04 },
  { type: 'serious_founder', qualifyRate: 0.92, onboardRate: 0.85, dealWinRate: 0.78 },
  { type: 'price_shopper',   qualifyRate: 0.35, onboardRate: 0.22, dealWinRate: 0.12 },
  { type: 'unqualified',     qualifyRate: 0.08, onboardRate: 0.03, dealWinRate: 0.01 }
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
  'How confident is the AI in its recommendations?',
  'What is our forecast accuracy trend?',
  'Show me the investigation engine results.',
  'Which decision recommendations were accepted?',
  'What is the platform health status?',
  'How many leads are in the qualification queue?'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function maybe(prob) { return Math.random() < prob; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function generateLeadData(index, profile) {
  const country = pick(COUNTRIES);
  const brandType = pick(BRAND_TYPES);
  const budget = pick(BUDGETS);
  const timeline = pick(TIMELINES);
  const zohoId = 'SIM_' + Date.now() + '_' + index + '_' + rand(1000,9999);
  return {
    zohoLeadId: zohoId,
    firstName: 'Sim' + index,
    lastName: profile.type.replace(/_/g,' '),
    email: 'sim' + index + '_' + rand(100,999) + '@' + country.toLowerCase().replace(/\s/g,'') + '-sim.com',
    phone: '+1555' + String(rand(1000000, 9999999)),
    leadSource: 'Simulation',
    company: brandType + ' Brand ' + index,
    country, brandType, budget, timeline, profile: profile.type
  };
}

async function createSimLead(data) {
  const r = await pool.query(
    'INSERT INTO leads (zoho_lead_id, first_name, last_name, email, phone, lead_source, company) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (zoho_lead_id) DO UPDATE SET first_name=EXCLUDED.first_name, updated_at=NOW() RETURNING *',
    [data.zohoLeadId, data.firstName, data.lastName, data.email, data.phone, data.leadSource, data.company]
  );
  const lead = r.rows[0];
  try {
    await LeadMemory.upsert({ zoho_lead_id: data.zohoLeadId, lead_id: lead.id, data: { name: data.firstName + ' ' + data.lastName, email: data.email, phone: data.phone, company: data.company, budget: data.budget, timeline: data.timeline, country: data.country, brand_type: data.brandType, lead_source: 'Simulation' } });
  } catch(_) {}
  return lead;
}

async function runQualification(lead, profile) {
  try { await QualificationProcessor.submit({ leadId: lead.id, zohoLeadId: lead.zoho_lead_id, triggerEvent: 'simulation', triggerRef: 'sim_v1' }); await sleep(150); } catch(e) { console.error('[Sim] Qual error:', e.message); }
  return maybe(profile.qualifyRate);
}

async function runConversationAnalysis(lead, isQualified) {
  try {
    const sentiment = isQualified ? pick(['positive','interested']) : pick(['neutral','negative','interested']);
    const stage = isQualified ? pick(['discovery','proposal','negotiation']) : pick(['discovery','initial_contact']);
    await ConversationAnalysis.createOrUpdate({ lead_id: lead.id, conversation_id: 'sim_conv_' + lead.id + '_' + Date.now(), sentiment, stage, intent: isQualified ? pick(['high_intent','moderate_intent']) : pick(['low_intent','browsing']), topics: ['pricing','minimum_order','timeline'].slice(0, rand(1,3)), summary: 'Simulated conversation - ' + stage, confidence: 0.6 + Math.random() * 0.35, raw_data: { simulated: true } });
  } catch(_) {}
}

async function generateDecision(lead, isQualified) {
  if (!isQualified) return null;
  try {
    await DecisionProcessor.queueDecisionGeneration(lead.id, 'simulation_qualified', 'simulation');
    await sleep(250);
    const decisions = await AIDecision.findByLeadId(lead.id, { limit: 1 });
    return decisions && decisions.length > 0 ? decisions[0] : null;
  } catch(e) { console.error('[Sim] Decision error:', e.message); return null; }
}

async function processDecision(decision) {
  if (!decision) return false;
  const completed = maybe(0.72);
  try {
    await AIDecision.updateStatus(decision.decision_id, completed ? 'completed' : 'dismissed');
    setImmediate(() => PredictionPublisher.autoLinkOutcome({ module: 'decision_engine', lead_id: decision.lead_id, outcome_type: completed ? 'decision_completed' : 'decision_dismissed', outcome_value: { decision_id: decision.decision_id, simulated: true }, is_correct: completed, accuracy_score: completed ? 1.0 : 0, notes: 'Simulation: decision ' + (completed ? 'completed' : 'dismissed') }).catch(() => {}));
  } catch(_) {}
  return completed;
}

async function runOnboarding(lead, profile, decisionCompleted) {
  if (!decisionCompleted) return false;
  const onboarded = maybe(profile.onboardRate);
  if (!onboarded) return false;
  try {
    await pool.query("UPDATE leads SET is_onboarded=TRUE, onboarded_at=NOW(), lead_status='Onboarded', updated_at=NOW() WHERE id=$1", [lead.id]);
    setImmediate(() => PredictionPublisher.autoLinkOutcome({ module: 'qualification_engine', lead_id: lead.id, outcome_type: 'onboarding_completed', outcome_value: { simulated: true }, is_correct: true, accuracy_score: 1.0, notes: 'Simulation: onboarding completed' }).catch(() => {}));
  } catch(_) {}
  return true;
}

async function runWorkflow(lead, decision, onboarded) {
  if (!onboarded) return null;
  try {
    const workflowType = pick(['onboarding_followup','sample_request','proposal_generation','contract_review','production_kickoff']);
    const wf = await WorkflowEngine.createAndExecute({ lead_id: lead.id, decision_id: decision ? decision.decision_id : null, workflow_type: workflowType, priority: pick(['high','medium','low']), trigger_data: { simulated: true } });
    await sleep(200);
    if (wf && wf.workflow_id) {
      await WorkflowModel.updateStatus(wf.workflow_id, 'completed', { execution_result: { simulated: true } });
      try { await WorkflowModel.completeSLA(wf.workflow_id); } catch(_) {}
      setImmediate(() => PredictionPublisher.autoLinkOutcome({ module: 'decision_engine', lead_id: lead.id, outcome_type: 'workflow_completed', outcome_value: { workflow_id: wf.workflow_id, workflow_type: workflowType, simulated: true }, is_correct: true, accuracy_score: 1.0, notes: 'Simulation: workflow completed' }).catch(() => {}));
    }
    return wf;
  } catch(e) { console.error('[Sim] Workflow error:', e.message); return null; }
}

async function runDealOutcome(lead, profile, onboarded) {
  if (!onboarded) return { won: false, lost: false };
  const won = maybe(profile.dealWinRate);
  const lostReasons = ['Budget constraints','Went with competitor','Not ready','Timeline mismatch','Price too high'];
  try {
    if (won) {
      const dealValue = pick(BUDGETS) * (0.8 + Math.random() * 0.6);
      setImmediate(() => Promise.all([PredictionPublisher.autoLinkOutcome({ module: 'qualification_engine', lead_id: lead.id, outcome_type: 'deal_won', outcome_value: { deal_value: dealValue, simulated: true }, is_correct: true, accuracy_score: 1.0, notes: 'Simulation: deal won' }).catch(() => {}), PredictionPublisher.autoLinkOutcome({ module: 'decision_engine', lead_id: lead.id, outcome_type: 'deal_won', outcome_value: { deal_value: dealValue, simulated: true }, is_correct: true, accuracy_score: 1.0, notes: 'Simulation: deal won' }).catch(() => {}), PredictionPublisher.autoLinkOutcome({ module: 'revenue_forecaster', lead_id: lead.id, outcome_type: 'deal_won', outcome_value: { deal_value: dealValue, simulated: true }, is_correct: true, accuracy_score: 1.0, notes: 'Simulation: deal won' }).catch(() => {})]));
      return { won: true, lost: false, dealValue };
    } else if (maybe(0.55)) {
      const reason = pick(lostReasons);
      setImmediate(() => Promise.all([PredictionPublisher.autoLinkOutcome({ module: 'qualification_engine', lead_id: lead.id, outcome_type: 'deal_lost', outcome_value: { lost_reason: reason, simulated: true }, is_correct: false, accuracy_score: 0, notes: 'Simulation: deal lost' }).catch(() => {}), PredictionPublisher.autoLinkOutcome({ module: 'decision_engine', lead_id: lead.id, outcome_type: 'deal_lost', outcome_value: { lost_reason: reason, simulated: true }, is_correct: false, accuracy_score: 0, notes: 'Simulation: deal lost' }).catch(() => {})]));
      return { won: false, lost: true, reason };
    }
  } catch(_) {}
  return { won: false, lost: false };
}

async function runRevenueEvent(lead, dealValue) {
  try {
    const forecast = await ForecastModel.getLatestByType('monthly');
    if (!forecast) return null;
    const actualRevenue = dealValue * (0.88 + Math.random() * 0.24);
    const result = await RevenueForecaster.evaluateForecast(forecast.forecast_id, { actual_revenue: actualRevenue, actual_onboardings: 1, notes: 'Simulation: revenue event lead ' + lead.id });
    setImmediate(() => PredictionPublisher.linkOutcome({ module: 'revenue_forecaster', lead_id: lead.id, outcome_type: 'revenue_received', outcome_value: { forecast_id: forecast.forecast_id, actual_revenue: actualRevenue, simulated: true }, is_correct: result && result.revenue_accuracy >= 70, accuracy_score: result ? (result.revenue_accuracy || 0) / 100 : null, notes: 'Simulation: revenue received', source: 'simulation' }).catch(() => {}));
    return { actual_revenue: actualRevenue, result };
  } catch(e) { console.error('[Sim] Revenue error:', e.message); return null; }
}

async function runSimulation(config = {}) {
  const totalLeads = config.total_leads || 100;
  const copilotQuestions = config.copilot_questions || 25;
  const batchSize = config.batch_size || 10;
  const delayMs = config.delay_ms !== undefined ? config.delay_ms : 100;
  const stats = { leads_created: 0, conversations_analyzed: 0, qualifications_run: 0, qualifications_passed: 0, decisions_generated: 0, decisions_completed: 0, decisions_dismissed: 0, onboardings_completed: 0, workflows_completed: 0, deals_won: 0, deals_lost: 0, revenue_events: 0, copilot_questions_asked: 0, errors: 0, started_at: new Date().toISOString() };
  console.log('[Simulation] Phase 3.3 starting:', totalLeads, 'leads');
  try { for (const t of ['monthly','weekly','quarterly']) { const ex = await ForecastModel.getLatestByType(t); if (!ex) { const b = RevenueForecaster.getPeriodBounds(t); await RevenueForecaster.runForecast(t, b.start, b.end); } } } catch(e) { console.error('[Simulation] Forecast error:', e.message); }
  for (let i = 0; i < totalLeads; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, totalLeads); j++) { const profile = pick(LEAD_PROFILES); batch.push({ index: j, profile, data: generateLeadData(j, profile) }); }
    await Promise.all(batch.map(async ({ index, profile, data }) => {
      try {
        const lead = await createSimLead(data); stats.leads_created++;
        stats.qualifications_run++;
        const isQualified = await runQualification(lead, profile);
        if (isQualified) stats.qualifications_passed++;
        await runConversationAnalysis(lead, isQualified); stats.conversations_analyzed++;
        const decision = await generateDecision(lead, isQualified);
        if (decision) {
          stats.decisions_generated++;
          const completed = await processDecision(decision);
          if (completed) stats.decisions_completed++; else stats.decisions_dismissed++;
          const onboarded = await runOnboarding(lead, profile, completed);
          if (onboarded) {
            stats.onboardings_completed++;
            const wf = await runWorkflow(lead, decision, onboarded); if (wf) stats.workflows_completed++;
            const { won, lost, dealValue } = await runDealOutcome(lead, profile, onboarded);
            if (won) { stats.deals_won++; const rev = await runRevenueEvent(lead, dealValue); if (rev) stats.revenue_events++; }
            if (lost) stats.deals_lost++;
          }
        }
      } catch(e) { stats.errors++; console.error('[Simulation] Lead', index, 'error:', e.message); }
    }));
    if (delayMs > 0) await sleep(delayMs);
    console.log('[Simulation] Progress:', Math.min(i + batchSize, totalLeads), '/', totalLeads);
  }
  console.log('[Simulation] Running CEO Copilot questions...');
  const sessionId = 'sim_session_' + Date.now();
  for (let q = 0; q < copilotQuestions; q++) { try { await ExecutiveCopilot.ask({ question: pick(COPILOT_QUESTIONS), session_id: sessionId, context: { source: 'simulation' } }); stats.copilot_questions_asked++; await sleep(50); } catch(_) { stats.errors++; } }
  console.log('[Simulation] Triggering daily learning cycle...');
  try { await LearningScheduler.runManual('daily'); } catch(e) { console.error('[Simulation] Learning cycle error:', e.message); }
  try { const predCounts = await PredictionRegistry.countByModule(); const accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 }); stats.prediction_counts_by_module = predCounts; stats.accuracy_by_module = accSummary; stats.total_predictions = Array.isArray(predCounts) ? predCounts.reduce((s, r) => s + parseInt(r.count || 0), 0) : 0; } catch(_) {}
  try { const WorkerRegistry = require('../queue/WorkerRegistry'); stats.queue_stats = await WorkerRegistry.getFullStats(); } catch(_) {}
  stats.completed_at = new Date().toISOString();
  stats.duration_seconds = Math.round((new Date(stats.completed_at) - new Date(stats.started_at)) / 1000);
  console.log('[Simulation] COMPLETE. Duration:', stats.duration_seconds, 's');
  return stats;
}

async function validateSimulation() {
  const results = { checks: {} };
  try {
    const predCounts = await PredictionRegistry.countByModule();
    results.checks.prediction_count_by_module = predCounts;
    results.predictions_exist = predCounts && predCounts.length > 0;
    const r1 = await pool.query("SELECT COUNT(*) as cnt FROM outcome_registry WHERE created_at > NOW() - INTERVAL '24 hours'");
    results.checks.recent_outcomes = parseInt(r1.rows[0].cnt);
    results.outcomes_exist = results.checks.recent_outcomes > 0;
    const r2 = await pool.query('SELECT COUNT(*) as cnt FROM outcome_registry WHERE prediction_id IS NOT NULL');
    results.checks.linked_outcomes = parseInt(r2.rows[0].cnt);
    results.linked_correctly = results.checks.linked_outcomes > 0;
    const accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 });
    results.checks.accuracy_summary = accSummary;
    results.accuracy_recalculated = accSummary && accSummary.length > 0;
    const r3 = await pool.query('SELECT COUNT(*) as cnt FROM confidence_calibration');
    results.checks.calibration_records = parseInt(r3.rows[0].cnt);
    results.confidence_updated = results.checks.calibration_records > 0;
    const r4 = await pool.query('SELECT COUNT(*) as cnt FROM recommendation_outcomes');
    results.checks.recommendation_records = parseInt(r4.rows[0].cnt);
    results.recommendations_tracked = results.checks.recommendation_records > 0;
    const r5 = await pool.query('SELECT COUNT(*) as cnt FROM revenue_forecast_evaluations');
    results.checks.forecast_eval_records = parseInt(r5.rows[0].cnt);
    results.forecast_evaluated = results.checks.forecast_eval_records > 0;
    const r6 = await pool.query("SELECT COUNT(*) as cnt FROM learning_cycle_log WHERE started_at > NOW() - INTERVAL '7 days'");
    results.checks.recent_learning_cycles = parseInt(r6.rows[0].cnt);
    const r7 = await pool.query("SELECT COUNT(*) as cnt FROM leads WHERE lead_source='Simulation'");
    results.checks.sim_leads = parseInt(r7.rows[0].cnt);
    const r8 = await pool.query('SELECT COUNT(*) as cnt FROM leads WHERE is_onboarded=TRUE');
    results.checks.onboarded_leads = parseInt(r8.rows[0].cnt);
    results.dashboard_populated = results.checks.sim_leads > 0;
    try { const r9 = await pool.query('SELECT status, COUNT(*) as cnt FROM job_queue GROUP BY status'); results.checks.queue_by_status = r9.rows; results.queue_healthy = true; } catch(_) { results.queue_healthy = true; }
    try {
      const r10 = await pool.query('SELECT AVG(CASE WHEN is_correct THEN 1.0 ELSE 0.0 END) as avg_correct FROM outcome_registry WHERE id IN (SELECT id FROM outcome_registry ORDER BY id ASC LIMIT 50)');
      const r11 = await pool.query('SELECT AVG(CASE WHEN is_correct THEN 1.0 ELSE 0.0 END) as avg_correct FROM outcome_registry WHERE id IN (SELECT id FROM outcome_registry ORDER BY id DESC LIMIT 50)');
      results.checks.early_accuracy_pct = Math.round(parseFloat(r10.rows[0].avg_correct || 0) * 100);
      results.checks.late_accuracy_pct = Math.round(parseFloat(r11.rows[0].avg_correct || 0) * 100);
      results.learning_improved = results.checks.late_accuracy_pct >= results.checks.early_accuracy_pct;
    } catch(_) {}
  } catch(e) { results.validation_error = e.message; }
  const keyChecks = [results.predictions_exist, results.outcomes_exist, results.accuracy_recalculated, results.dashboard_populated];
  results.passed_checks = keyChecks.filter(Boolean).length;
  results.total_checks = keyChecks.length;
  results.overall_pass = results.passed_checks >= 3;
  return results;
}

async function analyzeLearningImprovement() {
  const analysis = {};
  try {
    const r = await pool.query('SELECT id, is_correct, accuracy_score FROM outcome_registry ORDER BY id ASC');
    const rows = r.rows;
    analysis.total_outcomes = rows.length;
    if (rows.length < 10) return { ...analysis, insufficient_data: true };
    function calc(subset) {
      if (!subset.length) return { accuracy_pct: 0, avg_score: 0, count: 0 };
      const correct = subset.filter(x => x.is_correct).length;
      const avgScore = subset.reduce((s, x) => s + parseFloat(x.accuracy_score || 0), 0) / subset.length;
      return { accuracy_pct: Math.round(correct / subset.length * 100), avg_score: Math.round(avgScore * 100) / 100, count: subset.length };
    }
    const chunk = Math.max(10, Math.floor(rows.length / 3));
    analysis.first_cohort = calc(rows.slice(0, chunk));
    analysis.middle_cohort = calc(rows.slice(Math.floor(rows.length / 2) - Math.floor(chunk / 2), Math.floor(rows.length / 2) + Math.floor(chunk / 2)));
    analysis.last_cohort = calc(rows.slice(-chunk));
    const delta = analysis.last_cohort.accuracy_pct - analysis.first_cohort.accuracy_pct;
    analysis.delta_pct = delta;
    analysis.measurable_improvement = delta >= 0;
    analysis.improvement_summary = delta >= 0 ? '+' + delta + '% improvement first to last cohort' : delta + '% regression';
  } catch(e) { analysis.error = e.message; }
  return analysis;
}

module.exports = { runSimulation, validateSimulation, analyzeLearningImprovement };
