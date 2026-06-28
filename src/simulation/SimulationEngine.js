'use strict';
/**
 * Phase 3.7 — SimulationEngine.js
 * Infrastructure Completion: Shared Connection Architecture
 * SIM37 load test. All SQL uses regular strings (no template literals).
 * Pool consolidation: 8 isolated Pool() -> 1 shared Pool(max:20).
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
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function ingestLeadViaProduction(index, profile, batchTag) {
  var country = pick(COUNTRIES);
  var brandType = pick(BRAND_TYPES);
  var budget = pick(BUDGETS);
  var timeline = pick(TIMELINES);
  var tag = batchTag || 'SIM37';
  var zohoLeadId = tag + '_' + Date.now() + '_' + index + '_' + rand(1000, 9999);
  var zohoPayload = {
    leadId: zohoLeadId, zohoLeadId: zohoLeadId, id: zohoLeadId,
    First_Name: 'Sim' + index,
    Last_Name: profile.type.replace(/_/g, ' '),
    email: 'sim37_' + index + '_' + rand(100, 999) + '@' + country.toLowerCase().replace(/\s/g, '') + '-sim37.com',
    phone: '+1555' + String(rand(1000000, 9999999)),
    Lead_Source: 'Simulation_37',
    company: brandType + ' Brand ' + index,
    Company: brandType + ' Brand ' + index,
    Description: 'Phase 3.7 simulation. Profile: ' + profile.type + '. Country: ' + country + '. Budget: $' + budget + '. Timeline: ' + timeline,
    budget: budget, timeline: timeline, country: country, brand_type: brandType,
    Owner: { id: 'owner_sim37', name: 'Simulation Manager' }
  };
  var memory = await ZohoIngestor.ingestLead(zohoPayload);
  return { memory: memory, profile: profile, country: country, brandType: brandType, budget: budget, timeline: timeline, zohoLeadId: zohoLeadId };
}

async function injectConversationEvidence(memory, profile, budget, timeline, brandType) {
  var conversationId = 'sim37_conv_' + memory.id + '_' + Date.now();
  var sentiment = (profile.type === 'bad' || profile.type === 'unqualified') ? 'negative'
    : (profile.type === 'serious_founder' || profile.type === 'good') ? 'positive' : 'neutral';
  var stage = profile.type === 'serious_founder' ? 'negotiation'
    : profile.type === 'good' ? 'qualification'
    : profile.type === 'average' ? 'discovery' : 'initial_outreach';
  var trustScore = Math.min(10, Math.max(1, Math.round(profile.trustScore / 10)));
  var buyingIntentScore = Math.min(10, Math.max(1, Math.round(profile.budgetScore / 12)));
  var convQuality = Math.min(10, Math.max(1, rand(Math.round(profile.trustScore / 15), Math.round(profile.trustScore / 8))));

  var inserted = await pool.query(
    'INSERT INTO conversation_analysis (conversation_id, lead_id, source_type, source_ref, analysis_status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [conversationId, memory.id, 'retell', conversationId, 'pending']
  ).catch(function() { return null; });

  if (!inserted || !inserted.rows[0]) return null;
  var analysisId = inserted.rows[0].id;

  var outcome = profile.qualifyRate >= 0.7 ? 'positive_progression' : profile.qualifyRate >= 0.4 ? 'neutral_progression' : 'stalled';
  var nextStep = profile.qualifyRate >= 0.7 ? 'Schedule follow-up demo' : 'Send pricing information';
  var customerIntent = 'Lead interested in ' + (brandType || 'fashion') + ' manufacturing services';
  var summary = 'Phase 3.7 synthetic conversation analysis for lead ' + memory.id;

  await pool.query(
    'UPDATE conversation_analysis SET analysis_status=$1, sentiment=$2, conversation_stage=$3, trust_score=$4, buying_intent_score=$5, conversation_quality=$6, budget_detected=TRUE, budget_value=$7, timeline_detected=TRUE, timeline_value=$8, customer_intent=$9, conversation_outcome=$10, summary=$11, recommended_next_step=$12, confidence_score=$13, analyzed_at=NOW() WHERE id=$14',
    [
      'completed', sentiment, stage, trustScore, buyingIntentScore, convQuality,
      String(budget), timeline, customerIntent, outcome, summary, nextStep,
      Math.round(profile.budgetScore * 0.9), analysisId
    ]
  ).catch(function() {});

  setImmediate(function() {
    PredictionPublisher.conversation(memory.id, {
      sentiment: sentiment, conversation_stage: stage, trust_score: trustScore,
      buying_intent_score: buyingIntentScore, conversation_quality: convQuality,
      budget_detected: true, budget_value: String(budget),
      timeline_detected: true, timeline_value: timeline,
      confidence_score: Math.round(profile.budgetScore * 0.9)
    }).catch(function() {});
  });

  return analysisId;
}

async function ingestLeadAndInjectEvidence(index, profile, batchTag) {
  var result = await ingestLeadViaProduction(index, profile, batchTag);
  var memory = result.memory;
  var budget = result.budget;
  var timeline = result.timeline;
  var brandType = result.brandType;
  var zohoLeadId = result.zohoLeadId;
  await injectConversationEvidence(memory, profile, budget, timeline, brandType);
  EventOrchestrator.emit('lead.created', {
    lead_id: memory.id, zoho_lead_id: zohoLeadId,
    lead_name: 'Sim' + index + ' ' + profile.type,
    email: memory.email, phone: memory.phone
  });
  return result;
}

function enqueueQualification(memory) {
  return WorkerRegistry.enqueueQualification({
    leadId: memory.id, zohoLeadId: memory.zoho_lead_id,
    triggerEvent: 'conversation.analyzed', triggerRef: 'sim37_' + memory.id
  });
}

function linkOutcome(module, leadId, outcomeType, isCorrect, value, notes) {
  setImmediate(function() {
    PredictionPublisher.autoLinkOutcome({
      module: module, lead_id: leadId, outcome_type: outcomeType,
      outcome_value: Object.assign({}, value, { simulated: true }),
      is_correct: isCorrect, accuracy_score: isCorrect ? 1.0 : 0.0,
      notes: 'Sim37: ' + notes
    }).catch(function() {});
  });
}

async function simulateOnboarding(memory, profile) {
  if (!maybe(profile.onboardRate)) return false;
  try {
    var LeadMemory = require('../memory/models/LeadMemory');
    await LeadMemory.markOnboarded(memory.zoho_lead_id);
    EventOrchestrator.emit('onboarding.completed', {
      lead_id: memory.id, zoho_lead_id: memory.zoho_lead_id, lead_name: memory.full_name
    });
    linkOutcome('qualification_engine', memory.id, 'onboarding_completed', true, { zoho_lead_id: memory.zoho_lead_id }, 'onboarding completed');
    return true;
  } catch (e) { console.error('[Sim37] Onboarding error:', e.message); return false; }
}

async function simulateDealOutcome(memory, profile, onboarded) {
  if (!onboarded) return { won: false, lost: false };
  var lostReasons = ['Budget constraints', 'Competitor', 'Not ready', 'Timeline mismatch', 'Price'];
  if (maybe(profile.dealWinRate)) {
    var dealValue = pick(BUDGETS) * (0.8 + Math.random() * 0.6);
    var val = { deal_value: dealValue, zoho_lead_id: memory.zoho_lead_id };
    linkOutcome('qualification_engine', memory.id, 'deal_won', true, val, 'deal won');
    linkOutcome('decision_engine', memory.id, 'deal_won', true, val, 'deal won');
    linkOutcome('revenue_forecaster', memory.id, 'deal_won', true, val, 'deal won');
    return { won: true, lost: false, dealValue: dealValue };
  } else if (maybe(0.55)) {
    var reason = pick(lostReasons);
    var lostVal = { lost_reason: reason, zoho_lead_id: memory.zoho_lead_id };
    linkOutcome('qualification_engine', memory.id, 'deal_lost', false, lostVal, 'deal lost');
    linkOutcome('decision_engine', memory.id, 'deal_lost', false, lostVal, 'deal lost');
    return { won: false, lost: true, reason: reason };
  }
  return { won: false, lost: false };
}

async function simulateRevenueEvent(memory, dealValue) {
  try {
    var forecast = await ForecastModel.getLatestByType('monthly');
    if (!forecast) return null;
    var actualRevenue = dealValue * (0.88 + Math.random() * 0.24);
    var result = await RevenueForecaster.evaluateForecast(forecast.forecast_id, {
      actual_revenue: actualRevenue, actual_onboardings: 1,
      notes: 'Sim37: revenue event ' + memory.id
    });
    setImmediate(function() {
      PredictionPublisher.linkOutcome({
        module: 'revenue_forecaster', lead_id: memory.id,
        outcome_type: 'revenue_received',
        outcome_value: { forecast_id: forecast.forecast_id, actual_revenue: actualRevenue, simulated: true },
        is_correct: !!(result && result.revenue_accuracy >= 70),
        accuracy_score: result ? (result.revenue_accuracy || 0) / 100 : null,
        notes: 'Sim37: revenue received', source: 'simulation'
      }).catch(function() {});
    });
    return { actual_revenue: actualRevenue, result: result };
  } catch (e) { console.error('[Sim37] Revenue error:', e.message); return null; }
}

async function waitForQueueDrain(queueName, maxWaitMs) {
  maxWaitMs = maxWaitMs || 90000;
  var startWait = Date.now();
  while (Date.now() - startWait < maxWaitMs) {
    try {
      var r = await pool.query(
        "SELECT COUNT(*) as cnt FROM job_queue WHERE queue_name=$1 AND status='pending'",
        [queueName]
      );
      var pending = parseInt(r.rows[0].cnt);
      console.log('[Sim37] Queue', queueName, 'pending:', pending);
      if (pending === 0) return true;
    } catch (_) {}
    await sleep(3000);
  }
  return false;
}

async function runSimulation(config) {
  config = config || {};
  var totalLeads = config.total_leads || 1000;
  var copilotCount = config.copilot_questions || 50;
  var batchSize = config.batch_size !== undefined ? config.batch_size : 3;
  var delayMs = config.delay_ms !== undefined ? config.delay_ms : 150;
  var batchTag = config.batch_tag || 'SIM37';

  var stats = {
    leads_ingested: 0, conversations_injected: 0, qualification_events: 0,
    decision_events: 0, onboardings_completed: 0, deals_won: 0, deals_lost: 0,
    revenue_events: 0, copilot_questions_asked: 0, errors: 0,
    started_at: new Date().toISOString()
  };

  console.log('[Sim37] Phase 3.7 starting:', totalLeads, 'leads via production pipeline');
  console.log('[Sim37] batch_size=' + batchSize + ' delay_ms=' + delayMs + ' single shared pool');

  try {
    var fTypes = ['monthly', 'weekly', 'quarterly'];
    for (var fi = 0; fi < fTypes.length; fi++) {
      var ft = fTypes[fi];
      var ex = await ForecastModel.getLatestByType(ft);
      if (!ex) { var fb = RevenueForecaster.getPeriodBounds(ft); await RevenueForecaster.runForecast(ft, fb.start, fb.end); }
    }
  } catch (e) { console.error('[Sim37] Forecast init error:', e.message); }

  for (var i = 0; i < totalLeads; i += batchSize) {
    var batch = [];
    for (var j = i; j < Math.min(i + batchSize, totalLeads); j++) {
      batch.push({ index: j, profile: pick(LEAD_PROFILES) });
    }

    await Promise.all(batch.map(async function(item) {
      var index = item.index; var profile = item.profile;
      try {
        var ingestResult = await ingestLeadAndInjectEvidence(index, profile, batchTag);
        var memory = ingestResult.memory;
        stats.leads_ingested++;
        stats.conversations_injected++;
        await enqueueQualification(memory);
        stats.qualification_events++;
        await WorkerRegistry.enqueueDecision({
          lead_id: memory.id, trigger_event: 'qualification.updated',
          trigger_source: 'sim37', trigger_data: { profile: profile.type }
        });
        stats.decision_events++;
        await sleep(50);
        var onboarded = await simulateOnboarding(memory, profile);
        if (onboarded) stats.onboardings_completed++;
        var dealResult = await simulateDealOutcome(memory, profile, onboarded);
        if (dealResult.won) { stats.deals_won++; var rev = await simulateRevenueEvent(memory, dealResult.dealValue); if (rev) stats.revenue_events++; }
        if (dealResult.lost) stats.deals_lost++;
      } catch (e) { stats.errors++; console.error('[Sim37] Lead', index, 'error:', e.message); }
    }));

    if (delayMs > 0) await sleep(delayMs);
    if (i % (batchSize * 10) === 0) {
      console.log('[Sim37] Progress:', Math.min(i + batchSize, totalLeads), '/', totalLeads, '| Ingested:', stats.leads_ingested, '| Errors:', stats.errors);
    }
  }

  console.log('[Sim37] All leads ingested. Waiting for qualification queue to drain...');
  await waitForQueueDrain('qualification', 180000);
  await sleep(5000);

  console.log('[Sim37] Running', copilotCount, 'CEO Copilot questions...');
  var sessionId = 'sim37_session_' + Date.now();
  for (var q = 0; q < copilotCount; q++) {
    try {
      await ExecutiveCopilot.ask({ question: pick(COPILOT_QUESTIONS), session_id: sessionId, context: { source: 'simulation_37' } });
      stats.copilot_questions_asked++;
      await sleep(100);
    } catch (_) { stats.errors++; }
  }

  console.log('[Sim37] Triggering learning cycle 1 of 3 (daily)...');
  try { await LearningScheduler.runManual('daily'); } catch (e) { console.error('[Sim37] Learning 1 error:', e.message); }
  await sleep(2000);
  console.log('[Sim37] Triggering learning cycle 2 of 3 (daily)...');
  try { await LearningScheduler.runManual('daily'); } catch (e) { console.error('[Sim37] Learning 2 error:', e.message); }
  await sleep(2000);
  console.log('[Sim37] Triggering learning cycle 3 of 3 (weekly)...');
  try { await LearningScheduler.runManual('weekly'); } catch (e) { console.error('[Sim37] Learning 3 error:', e.message); }

  try {
    var predCounts = await PredictionRegistry.countByModule();
    var accSummary = await PredictionRegistry.getAccuracySummary({ days: 30 });
    stats.prediction_counts_by_module = predCounts;
    stats.accuracy_by_module = accSummary;
    stats.total_predictions = Array.isArray(predCounts) ? predCounts.reduce(function(s, r) { return s + parseInt(r.cnt || 0); }, 0) : 0;
  } catch (_) {}

  try { stats.queue_stats = await WorkerRegistry.getFullStats(); } catch (_) {}

  stats.completed_at = new Date().toISOString();
  stats.duration_seconds = Math.round((new Date(stats.completed_at) - new Date(stats.started_at)) / 1000);
  console.log('[Sim37] DONE {leads:' + stats.leads_ingested + ',convs:' + stats.conversations_injected + ',quals:' + stats.qualification_events + ',onboard:' + stats.onboardings_completed + ',won:' + stats.deals_won + ',lost:' + stats.deals_lost + ',revenue:' + stats.revenue_events + ',errors:' + stats.errors + ',duration:' + stats.duration_seconds + '}');
  return stats;
}

async function validateSimulation() {
  var results = { checks: {}, phase: '3.7' };
  try {
    var r1 = await pool.query('SELECT COUNT(*) as cnt FROM ai_predictions');
    results.checks.total_predictions = parseInt(r1.rows[0].cnt);
    results.predictions_exist = results.checks.total_predictions > 0;
    var r2 = await pool.query('SELECT COUNT(*) as cnt FROM ai_outcomes');
    results.checks.total_outcomes = parseInt(r2.rows[0].cnt);
    results.outcomes_exist = results.checks.total_outcomes > 0;
    var r3 = await pool.query('SELECT COUNT(*) as cnt FROM ai_outcomes WHERE prediction_id IS NOT NULL');
    results.checks.linked_outcomes = parseInt(r3.rows[0].cnt);
    var r4 = await pool.query('SELECT COUNT(*) as cnt FROM confidence_calibration');
    results.checks.calibration_records = parseInt(r4.rows[0].cnt);
    var r5 = await pool.query('SELECT COUNT(*) as cnt FROM recommendation_outcomes');
    results.checks.recommendation_records = parseInt(r5.rows[0].cnt);
    var r6 = await pool.query('SELECT COUNT(*) as cnt FROM revenue_forecast_evaluations');
    results.checks.forecast_eval_records = parseInt(r6.rows[0].cnt);
    var r7 = await pool.query("SELECT COUNT(*) as cnt FROM learning_cycle_log WHERE started_at > NOW() - INTERVAL '7 days'");
    results.checks.recent_learning_cycles = parseInt(r7.rows[0].cnt);
    var r8 = await pool.query("SELECT COUNT(*) as cnt FROM lead_memory WHERE zoho_lead_id LIKE 'SIM37_%'");
    results.checks.sim37_lead_memory = parseInt(r8.rows[0].cnt);
    results.dashboard_populated = results.checks.sim37_lead_memory > 0;
    var r9 = await pool.query("SELECT COUNT(*) as cnt FROM conversation_analysis WHERE lead_id IN (SELECT id FROM lead_memory WHERE zoho_lead_id LIKE 'SIM37_%')");
    results.checks.conversation_analyses = parseInt(r9.rows[0].cnt);
    var r10 = await pool.query("SELECT COUNT(*) as cnt FROM lead_qualification WHERE lead_id IN (SELECT id FROM lead_memory WHERE zoho_lead_id LIKE 'SIM37_%')");
    results.checks.sim37_qualifications = parseInt(r10.rows[0].cnt);
    results.qualifications_exist = results.checks.sim37_qualifications > 0;
    try {
      var r11 = await pool.query('SELECT queue_name, status, COUNT(*) as cnt FROM job_queue GROUP BY queue_name, status ORDER BY queue_name, status');
      results.checks.queue_by_status = r11.rows;
    } catch (_) {}
    var accSumV = await PredictionRegistry.getAccuracySummary({ days: 30 });
    results.checks.accuracy_summary = accSumV;
    results.accuracy_recalculated = !!(accSumV && accSumV.length > 0);
    var r12 = await pool.query('SELECT COUNT(*) as cnt FROM revenue_forecasts');
    results.checks.forecast_records = parseInt(r12.rows[0].cnt);
    results.forecasts_exist = results.checks.forecast_records > 0;
    try {
      var r13 = await pool.query("SELECT COUNT(*) FILTER (WHERE state='active') as active, COUNT(*) FILTER (WHERE state='idle') as idle FROM pg_stat_activity WHERE datname=current_database()");
      results.checks.db_connections = r13.rows[0];
    } catch (_) {}
  } catch (e) { results.validation_error = e.message; }
  var keyChecks = [results.predictions_exist, results.outcomes_exist, results.dashboard_populated, results.qualifications_exist, results.accuracy_recalculated];
  results.passed_checks = keyChecks.filter(Boolean).length;
  results.total_checks = keyChecks.length;
  results.overall_pass = results.passed_checks >= 4;
  return results;
}

async function analyzeLearningImprovement() {
  var analysis = {};
  try {
    var r = await pool.query('SELECT outcome_id, is_correct, accuracy_score, module, created_at FROM ai_outcomes ORDER BY created_at ASC');
    var rows = r.rows;
    analysis.total_outcomes = rows.length;
    if (rows.length < 20) return Object.assign({}, analysis, { insufficient_data: true, note: 'Need at least 20 outcomes' });

    function calc(subset) {
      if (!subset.length) return { accuracy_pct: 0, avg_score: 0, count: 0, correct: 0, incorrect: 0 };
      var correct = subset.filter(function(x) { return x.is_correct === true; }).length;
      var incorrect = subset.filter(function(x) { return x.is_correct === false; }).length;
      var scored = subset.filter(function(x) { return x.accuracy_score !== null; });
      var avgScore = scored.length > 0 ? scored.reduce(function(s, x) { return s + parseFloat(x.accuracy_score || 0); }, 0) / scored.length : 0;
      return { accuracy_pct: Math.round(correct / (correct + incorrect || 1) * 100), avg_score: Math.round(avgScore * 100) / 100, count: subset.length, correct: correct, incorrect: incorrect };
    }

    var cohortSize = Math.min(100, Math.floor(rows.length / 3));
    analysis.cohort_size = cohortSize;
    analysis.first_cohort = calc(rows.slice(0, cohortSize));
    analysis.last_cohort = calc(rows.slice(-cohortSize));
    var delta = analysis.last_cohort.accuracy_pct - analysis.first_cohort.accuracy_pct;
    analysis.delta_pct = delta;
    analysis.measurable_improvement = delta >= 0;
    analysis.improvement_summary = delta > 0 ? ('+' + delta + '% improvement') : delta === 0 ? 'Stable accuracy' : (delta + '% regression');
    try {
      var calR = await pool.query('SELECT module, confidence_bucket, actual_accuracy, calibration_error FROM confidence_calibration ORDER BY created_at DESC LIMIT 30');
      analysis.calibration_sample = calR.rows;
      analysis.calibration_buckets = calR.rowCount;
    } catch (_) {}
  } catch (e) { analysis.error = e.message; }
  return analysis;
}

async function compareEarlyvLate() {
  try {
    var r = await pool.query(
      'SELECT p.module, p.prediction_type, p.confidence, o.is_correct, o.accuracy_score, p.created_at,' +
      ' ROW_NUMBER() OVER (PARTITION BY p.module ORDER BY p.created_at ASC) as rn,' +
      ' COUNT(*) OVER (PARTITION BY p.module) as total' +
      ' FROM ai_predictions p' +
      ' LEFT JOIN ai_outcomes o ON o.prediction_id = p.prediction_id' +
      ' ORDER BY p.module, p.created_at ASC'
    );
    var rows = r.rows;
    if (rows.length < 10) return { insufficient_data: true };
    var modules = Array.from(new Set(rows.map(function(r) { return r.module; })));
    var result = {};
    for (var mi = 0; mi < modules.length; mi++) {
      var mod = modules[mi];
      var modRows = rows.filter(function(r) { return r.module === mod; });
      var total = modRows.length;
      if (total < 6) continue;
      var early = modRows.slice(0, Math.floor(total / 2));
      var late = modRows.slice(Math.floor(total / 2));
      function metrics(subset) {
        var withOutcome = subset.filter(function(r) { return r.is_correct !== null; });
        if (!withOutcome.length) return { n: subset.length, accuracy: null, avg_confidence: null };
        var tp = withOutcome.filter(function(r) { return r.is_correct === true; }).length;
        var fp = withOutcome.filter(function(r) { return r.is_correct === false; }).length;
        var avgConf = subset.reduce(function(s, r) { return s + parseFloat(r.confidence || 0); }, 0) / subset.length;
        return { n: subset.length, tp: tp, fp: fp, accuracy: Math.round(tp / (tp + fp) * 10000) / 100, avg_confidence: Math.round(avgConf * 100) / 100 };
      }
      result[mod] = { early_predictions: metrics(early), late_predictions: metrics(late), total_predictions: total };
    }
    return result;
  } catch (e) { return { error: e.message }; }
}

module.exports = { runSimulation: runSimulation, validateSimulation: validateSimulation, analyzeLearningImprovement: analyzeLearningImprovement, compareEarlyvLate: compareEarlyvLate };
