'use strict';
/**
 * Phase 3.4 — SimulationEngine.js
 * Production-Aligned Synthetic Business Simulation
 *
 * FIXED: Uses ZohoIngestor.ingestLead() + EventOrchestrator.emit()
 * exactly as the real production Zoho CRM webhook does.
 * No direct DB inserts. All leads flow through the real pipeline.
 * All lead_memory IDs are UUIDs — no integer ID / UUID type mismatch.
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
  'How confident is the AI in its recommendations?'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function maybe(prob) { return Math.random() < prob; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ingestLeadViaProduction(index, profile) {
  const country = pick(COUNTRIES);
  const brandType = pick(BRAND_TYPES);
  const budget = pick(BUDGETS);
  const timeline = pick(TIMELINES);
  const zohoLeadId = 'SIM34_' + Date.now() + '_' + index + '_' + rand(1000, 9999);

  const zohoPayload = {
    leadId: zohoLeadId, zohoLeadId, id: zohoLeadId,
    First_Name: 'Sim' + index,
    Last_Name: profile.type.replace(/_/g, ' '),
    email: 'sim34_' + index + '_' + rand(100, 999) + '@' + country.toLowerCase().replace(/\s/g, '') + '-sim34.com',
    phone: '+1555' + String(rand(1000000, 9999999)),
    Lead_Source: 'Simulation_34',
    company: brandType + ' Brand ' + index,
    Company: brandType + ' Brand ' + index,
    Description: 'Phase 3.4 simulation. Profile: ' + profile.type + '. Country: ' + country + '. Budget: $' + budget + '. Timeline: ' + timeline,
    budget, timeline, country, brand_type: brandType,
    Owner: { id: 'owner_sim34', name: 'Simulation Manager' }
  };

  const memory = await ZohoIngestor.ingestLead(zohoPayload);

  EventOrchestrator.emit('lead.created', {
    lead_id: memory.id,
    zoho_lead_id: zohoLeadId,
    lead_name: 'Sim' + index + ' ' + profile.type,
    email: zohoPayload.email,
    phone: zohoPayload.phone
  });

  return { memory, profile, country, brandType, budget, timeline };
}

async function injectConversationSignal(memory, profile, isQualified) {
  const transcript = [
    'Customer: Hi, I am interested in manufacturing services.',
    'Agent: Tell me about your brand.',
    'Customer: We are a ' + profile.type + ' brand.',
    'Agent: Budget and timeline?',
    'Customer: Budget $' + pick(BUDGETS) + ', timeline ' + pick(TIMELINES) + '.',
    isQualified ? 'Customer: Ready to move forward.' : 'Customer: Just exploring.'
  ].join('\n');

  const convId = 'sim34_conv_' + memory.id + '_' + Date.now();
  try {
    await WorkerRegistry.enqueueConversation({
      conversationId: convId, leadId: memory.id,
      zohoLeadId: memory.zoho_lead_id, sourceType: 'retell',
      sourceRef: convId, transcript,
      leadInfo: { name: memory.full_name, email: memory.email, phone: memory.phone }
    });
    return convId;
  } catch (e) {
    console.error('[Sim34] Conversation enqueue error:', e.message);
    return null;
  }
}

function linkOutcome(module, leadId, outcomeType, isCorrect, value, notes) {
  setImmediate(() =>
    PredictionPublisher.autoLinkOutcome({
      module, lead_id: leadId, outcome_type: outcomeType,
      outcome_value: { ...value, simulated: true },
      is_correct: isCorrect, accuracy_score: isCorrect ? 1.0 : 0.0,
      notes: 'Sim34: ' + notes
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
  } catch (e) { console.error('[Sim34] Onboarding error:', e.message); return false; }
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
    const forecast = await ForecastModel.getLatestByType('monthly');
    if (!forecast) return null;
    const actualRevenue = dealValue * (0.88 + Math.random() * 0.24);
    const result = await RevenueForecaster.evaluateForecast(forecast.forecast_id, {
      actual_revenue: actualRevenue, actual_onboardings: 1,
      notes: 'Sim34: revenue event ' + memory.id
    });
    setImmediate(() =>
      PredictionPublisher.linkOutcome({
        module: 'revenue_forecaster', lead_id: memory.id,
        outcome_type: 'revenue_received',
        outcome_value: { forecast_id: forecast.forecast_id, actual_revenue: actualRevenue, simulated: true },
        is_correct: result && result.revenue_accuracy >= 70,
        accuracy_score: result ? (result.revenue_accuracy || 0) / 100 : null,
        notes: 'Sim34: revenue received', source: 'simulation'
      }).catch(() => {})
    );
    return { actual_revenue: actualRevenue, result };
  } catch (e) { console.error('[Sim34] Revenue error:', e.message); return null; }
}

async function runSimulation(config = {}) {
  const totalLeads = config.total_leads || 100;
  const copilotCount = config.copilot_questions || 25;
  const batchSize = config.batch_size || 5;
  const delayMs = config.delay_ms !== undefined ? config.delay_ms : 200;

  const stats = {
    leads_ingested: 0, conversations_queued: 0, qualification_events: 0,
    decision_events: 0, onboardings_completed: 0, deals_won: 0, deals_lost: 0,
    revenue_events: 0, copilot_questions_asked: 0, errors: 0,
    started_at: new Date().toISOString()
  };

  console.log('[Sim34] Phase 3.4 starting:', totalLeads, 'leads via production pipeline');

  try {
    for (const t of ['monthly', 'weekly', 'quarterly']) {
      const ex = await ForecastModel.getLatestByType(t);
      if (!ex) { const b = RevenueForecaster.getPeriodBounds(t); await RevenueForecaster.runForecast(t, b.start, b.end); }
    }
  } catch (e) { console.error('[Sim34] Forecast init error:', e.message); }

  for (let i = 0; i < totalLeads; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, totalLeads); j++) {
      batch.push({ index: j, profile: pick(LEAD_PROFILES) });
    }

    await Promise.all(batch.map(async ({ index, profile }) => {
      try {
        const { memory } = await ingestLeadViaProduction(index, profile);
        stats.leads_ingested++;

        const isQualified = maybe(profile.qualifyRate);
        await injectConversationSignal(memory, profile, isQualified);
        stats.conversations_queued++;

        await sleep(100);

        if (isQualified) {
          EventOrchestrator.emit('qualification.updated', {
            lead_id: memory.id, zoho_lead_id: memory.zoho_lead_id,
            category: pick(['hot', 'warm', 'qualified']),
            qualification_score: rand(65, 98), category_changed: true
          });
          stats.qualification_events++;
          stats.decision_events++;
        }

        const onboarded = await simulateOnboarding(memory, profile);
        if (onboarded) stats.onboardings_completed++;

        const { won, lost, dealValue } = await simulateDealOutcome(memory, profile, onboarded);
        if (won) { stats.deals_won++; const rev = await simulateRevenueEvent(memory, dealValue); if (rev) stats.revenue_events++; }
        if (lost) stats.deals_lost++;

      } catch (e) { stats.errors++; console.error('[Sim34] Lead', index, 'error:', e.message); }
    }));

    if (delayMs > 0) await sleep(delayMs);
    console.log('[Sim34] Progress:', Math.min(i + batchSize, totalLeads), '/', totalLeads);
  }

  console.log('[Sim34] Running', copilotCount, 'CEO Copilot questions...');
  const sessionId = 'sim34_session_' + Date.now();
  for (let q = 0; q < copilotCount; q++) {
    try {
      await ExecutiveCopilot.ask({ question: pick(COPILOT_QUESTIONS), session_id: sessionId, context: { source: 'simulation_34' } });
      stats.copilot_questions_asked++;
      await sleep(50);
    } catch (_) { stats.errors++; }
  }

  console.log('[Sim34] Triggering learning cycle...');
  try { await LearningScheduler.runManual('daily'); } catch (e) { console.error('[Sim34] Learning error:', e.message); }

  try {
    const predCounts = await PredictionRegistry.countByModule();
    const accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 });
    stats.prediction_counts_by_module = predCounts;
    stats.accuracy_by_module = accSummary;
    stats.total_predictions = Array.isArray(predCounts) ? predCounts.reduce((s, r) => s + parseInt(r.count || 0), 0) : 0;
  } catch (_) {}

  try { stats.queue_stats = await WorkerRegistry.getFullStats(); } catch (_) {}

  stats.completed_at = new Date().toISOString();
  stats.duration_seconds = Math.round((new Date(stats.completed_at) - new Date(stats.started_at)) / 1000);
  console.log('[Sim34] COMPLETE. Duration:', stats.duration_seconds, 's. Leads:', stats.leads_ingested);
  return stats;
}

async function validateSimulation() {
  const results = { checks: {}, phase: '3.4' };
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

    const r8 = await pool.query("SELECT COUNT(*) as cnt FROM lead_memory WHERE zoho_lead_id LIKE 'SIM34_%'");
    results.checks.sim34_lead_memory = parseInt(r8.rows[0].cnt);
    results.dashboard_populated = results.checks.sim34_lead_memory > 0;

    try {
      const r9 = await pool.query('SELECT queue_name, status, COUNT(*) as cnt FROM job_queue GROUP BY queue_name, status ORDER BY queue_name, status');
      results.checks.queue_by_status = r9.rows;
    } catch (_) {}

    const accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 });
    results.checks.accuracy_summary = accSummary;
    results.accuracy_recalculated = accSummary && accSummary.length > 0;

  } catch (e) { results.validation_error = e.message; }

  const keyChecks = [results.predictions_exist, results.outcomes_exist, results.dashboard_populated, results.accuracy_recalculated];
  results.passed_checks = keyChecks.filter(Boolean).length;
  results.total_checks = keyChecks.length;
  results.overall_pass = results.passed_checks >= 3;
  return results;
}

async function analyzeLearningImprovement() {
  const analysis = {};
  try {
    const r = await pool.query('SELECT id, is_correct, accuracy_score, module, created_at FROM ai_outcomes ORDER BY created_at ASC');
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

    const modules = [...new Set(rows.map(r => r.module))];
    analysis.by_module = {};
    for (const mod of modules) {
      const modRows = rows.filter(r => r.module === mod);
      const first = calc(modRows.slice(0, Math.ceil(modRows.length / 2)));
      const last = calc(modRows.slice(Math.floor(modRows.length / 2)));
      analysis.by_module[mod] = { first_half: first, second_half: last, improvement_pct: last.accuracy_pct - first.accuracy_pct };
    }
  } catch (e) { analysis.error = e.message; }
  return analysis;
}

module.exports = { runSimulation, validateSimulation, analyzeLearningImprovement };
