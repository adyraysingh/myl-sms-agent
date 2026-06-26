'use strict';
const OpenAI = require('openai');
const { Pool } = require('pg');
const ForecastModel = require('../models/ForecastModel');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MODEL_VERSION = '1.0';

// Data Collection
async function collectBusinessData(periodStart, periodEnd) {
  const start = new Date(periodStart).toISOString();
  const end = new Date(periodEnd).toISOString();

  const [leads, qualifications, decisions, conversations, briefings, workflows, learningEvents] = await Promise.all([
    pool.query('SELECT * FROM leads WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM onboarding_qualifications WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM decisions WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 100', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM conversation_analysis WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 100', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM executive_briefings ORDER BY created_at DESC LIMIT 5').catch(() => ({ rows: [] })),
    pool.query('SELECT status, COUNT(*) as count, AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/3600)::NUMERIC(8,2) AS avg_hours FROM automation_workflows WHERE created_at BETWEEN $1 AND $2 GROUP BY status', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT source_module, prediction_type, AVG(accuracy_score)::NUMERIC(5,2) AS avg_accuracy FROM learning_events WHERE created_at BETWEEN $1 AND $2 GROUP BY source_module, prediction_type', [start, end]).catch(() => ({ rows: [] }))
  ]);

  const historicalWinRateSQL = "SELECT COUNT(*) FILTER (WHERE category = $1) AS onboarded, COUNT(*) AS total FROM onboarding_qualifications WHERE created_at >= NOW() - INTERVAL '90 days'";
  const historicalWinRate = await pool.query(historicalWinRateSQL, ['Onboarded']).catch(() => ({ rows: [{ onboarded: 0, total: 1 }] }));
  const winRateRow = historicalWinRate.rows[0] || { onboarded: 0, total: 1 };
  const historicalWinRatePct = winRateRow.total > 0 ? (parseFloat(winRateRow.onboarded) / parseFloat(winRateRow.total)) * 100 : 0;

  const avgDealSQL = "SELECT AVG((conversation_data->>'budget')::NUMERIC) AS avg_deal FROM conversation_analysis WHERE created_at >= NOW() - INTERVAL '90 days' AND conversation_data->>'budget' IS NOT NULL";
  const avgDealVal = await pool.query(avgDealSQL).catch(() => ({ rows: [{ avg_deal: 0 }] }));

  return {
    period: { start, end },
    leads: leads.rows,
    qualifications: qualifications.rows,
    decisions: decisions.rows,
    conversations: conversations.rows,
    latestBriefings: briefings.rows,
    workflowSummary: workflows.rows,
    learningAccuracy: learningEvents.rows,
    historicalWinRate: historicalWinRatePct.toFixed(2),
    avgDealValue: parseFloat(avgDealVal.rows[0] && avgDealVal.rows[0].avg_deal || 5000),
    dataCollectedAt: new Date().toISOString()
  };
}

// Pipeline Calculator
function calculatePipelineMetrics(data) {
  const quals = data.qualifications;
  const total = quals.length;
  const hot = quals.filter(function(q) { return q.category === 'Hot'; }).length;
  const warm = quals.filter(function(q) { return q.category === 'Warm'; }).length;
  const cold = quals.filter(function(q) { return q.category === 'Cold'; }).length;
  const onboarded = quals.filter(function(q) { return q.category === 'Onboarded'; }).length;
  const dead = quals.filter(function(q) { return q.category === 'Dead' || q.category === 'Unqualified'; }).length;
  const avgDeal = data.avgDealValue || 5000;
  const weightedPipeline = (hot * avgDeal * 0.70) + (warm * avgDeal * 0.30) + (cold * avgDeal * 0.10);
  const pipelineValue = (hot + warm + cold) * avgDeal;
  const expectedOnboardings = Math.round(hot * 0.70 + warm * 0.30 + cold * 0.10);
  const expectedRevenue = expectedOnboardings * avgDeal;
  const revenueAtRisk = (hot * avgDeal * 0.30) + (warm * avgDeal * 0.70);
  const avgScoreRaw = quals.reduce(function(sum, q) { return sum + (parseFloat(q.onboarding_score) || 0); }, 0) / (total || 1);
  const confidence = Math.min(95, Math.max(20, avgScoreRaw));
  return {
    pipeline_value: Math.round(pipelineValue * 100) / 100,
    weighted_pipeline: Math.round(weightedPipeline * 100) / 100,
    expected_onboardings: expectedOnboardings,
    expected_revenue: Math.round(expectedRevenue * 100) / 100,
    revenue_at_risk: Math.round(revenueAtRisk * 100) / 100,
    avg_deal_value: Math.round(avgDeal * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    breakdown: { hot: hot, warm: warm, cold: cold, onboarded: onboarded, dead: dead, total: total }
  };
}

// AI Forecast Generator
async function generateAIForecast(forecastType, periodStart, periodEnd, data, metrics) {
  var prompt = 'You are the Revenue Intelligence Engine for MakeYourLabel, a clothing manufacturer specializing in Oversized T-Shirts, Hoodies, Tracksuits, Streetwear, Gym Wear, and Activewear.' +
    ' You generate evidence-based revenue and onboarding forecasts. You never invent numbers.' +
    ' Every forecast must include assumptions, confidence, risks, opportunities, and factors.' +
    ' Respond ONLY with valid JSON.';
  var userMsg = 'Generate a ' + forecastType + ' revenue and onboarding forecast for MakeYourLabel.' +
    ' Period: ' + periodStart + ' to ' + periodEnd + '.' +
    ' Pipeline metrics: ' + JSON.stringify(metrics) + '.' +
    ' Lead count: ' + data.leads.length + '.' +
    ' Historical win rate: ' + data.historicalWinRate + '%.' +
    ' Average deal value: $' + data.avgDealValue + '.' +
    ' Return JSON with fields: executive_summary, expected_onboardings (number), expected_revenue (number),' +
    ' pipeline_value (number), revenue_at_risk (number), weighted_pipeline (number), confidence (0-100 number),' +
    ' avg_deal_value (number), avg_sales_cycle_days (number), target_progress (0-100 number),' +
    ' forecast_variance (number),' +
    ' factors (object with factor_name->impact_description pairs),' +
    ' assumptions (array of strings),' +
    ' risks (array of {risk, severity, mitigation} objects),' +
    ' opportunities (array of {opportunity, impact, action} objects),' +
    ' top_revenue_opportunities (array of strings),' +
    ' top_revenue_risks (array of strings),' +
    ' suggested_executive_actions (array of strings),' +
    ' revenue_outlook (string),' +
    ' expected_target_achievement (string).';
  var response = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.2
  });
  return JSON.parse(response.choices[0].message.content);
}

// Scenario Generator
function generateScenarios(metrics, aiResult) {
  var base = aiResult.expected_revenue || metrics.expected_revenue;
  var baseOnboard = aiResult.expected_onboardings || metrics.expected_onboardings;
  var conf = aiResult.confidence || 60;
  return [
    { scenario_type: 'best_case', expected_revenue: Math.round(base * 1.35 * 100) / 100, expected_onboardings: Math.ceil(baseOnboard * 1.35), confidence: Math.min(95, conf * 0.75), assumptions: ['All hot leads convert', 'Follow-up completion 100%', 'No objections'], primary_risks: ['Execution risk', 'Market demand shift'], primary_opportunities: ['Convert all warm leads', 'Reduce sales cycle'], explanation: 'Best case: all high-probability leads convert, optimal execution.' },
    { scenario_type: 'expected_case', expected_revenue: base, expected_onboardings: baseOnboard, confidence: conf, assumptions: aiResult.assumptions || ['Historical win rates apply', 'Current pipeline maintained'], primary_risks: (aiResult.risks || []).map(function(r) { return typeof r === 'object' ? r.risk : r; }), primary_opportunities: (aiResult.opportunities || []).map(function(o) { return typeof o === 'object' ? o.opportunity : o; }), explanation: 'Expected case based on current pipeline health and historical win rates.' },
    { scenario_type: 'worst_case', expected_revenue: Math.round(base * 0.55 * 100) / 100, expected_onboardings: Math.floor(baseOnboard * 0.55), confidence: Math.min(95, conf * 1.1), assumptions: ['Only confirmed leads convert', 'High churn', 'Follow-up delays'], primary_risks: ['Revenue below target', 'Cash flow pressure'], primary_opportunities: ['Early warning to adjust strategy'], explanation: 'Worst case: significant friction, only committed leads convert.' },
    { scenario_type: 'aggressive_growth', expected_revenue: Math.round(base * 1.60 * 100) / 100, expected_onboardings: Math.ceil(baseOnboard * 1.60), confidence: Math.min(95, conf * 0.6), assumptions: ['Significant lead volume increase', 'New campaigns active', 'Team expansion'], primary_risks: ['Requires additional resources', 'Quality risk at scale'], primary_opportunities: ['Market expansion', 'New product categories'], explanation: 'Aggressive growth requires additional investment in pipeline and team.' },
    { scenario_type: 'conservative_growth', expected_revenue: Math.round(base * 0.80 * 100) / 100, expected_onboardings: Math.floor(baseOnboard * 0.80), confidence: Math.min(95, conf * 0.95), assumptions: ['Conservative conversion', 'Some leads lost to competitors', 'Typical delays'], primary_risks: ['Below target revenue', 'Pipeline shrink'], primary_opportunities: ['Stable foundation', 'Quality focus'], explanation: 'Conservative: accounts for typical pipeline attrition and conversion friction.' }
  ];
}

// Main Forecasting Orchestrator
async function runForecast(forecastType, periodStart, periodEnd) {
  var startTime = Date.now();
  try {
    await ForecastModel.logEvent({ event_type: 'FORECAST_STARTED', details: { forecast_type: forecastType, period_start: periodStart, period_end: periodEnd }, model_version: MODEL_VERSION });
    var data = await collectBusinessData(periodStart, periodEnd);
    var metrics = calculatePipelineMetrics(data);
    var aiResult = {};
    try {
      aiResult = await generateAIForecast(forecastType, periodStart, periodEnd, data, metrics);
    } catch (aiErr) {
      console.error('[RevenueForecaster] AI generation failed:', aiErr.message);
      aiResult = { expected_onboardings: metrics.expected_onboardings, expected_revenue: metrics.expected_revenue, confidence: metrics.confidence, factors: { pipeline_health: 'Based on qualification scores', historical_win_rate: data.historicalWinRate + '%' }, assumptions: ['Based on historical win rates'], risks: [{ risk: 'AI analysis unavailable', severity: 'medium', mitigation: 'Using statistical calculations' }], opportunities: [], top_revenue_opportunities: ['Convert hot leads'], top_revenue_risks: ['Follow-up delays'], suggested_executive_actions: ['Review hot leads daily'], revenue_outlook: 'Based on pipeline data', expected_target_achievement: 'Calculated from pipeline' };
    }
    var forecast = await ForecastModel.createForecast({
      forecast_type: forecastType, period_start: periodStart, period_end: periodEnd,
      expected_onboardings: aiResult.expected_onboardings || metrics.expected_onboardings,
      expected_revenue: aiResult.expected_revenue || metrics.expected_revenue,
      confidence: aiResult.confidence || metrics.confidence,
      pipeline_value: aiResult.pipeline_value || metrics.pipeline_value,
      revenue_at_risk: aiResult.revenue_at_risk || metrics.revenue_at_risk,
      weighted_pipeline: aiResult.weighted_pipeline || metrics.weighted_pipeline,
      avg_deal_value: aiResult.avg_deal_value || metrics.avg_deal_value,
      avg_sales_cycle_days: aiResult.avg_sales_cycle_days || 21,
      target_progress: aiResult.target_progress || 0,
      forecast_variance: aiResult.forecast_variance || 0,
      factors: aiResult.factors || {},
      assumptions: aiResult.assumptions || [],
      risks: aiResult.risks || [],
      opportunities: aiResult.opportunities || [],
      model_version: MODEL_VERSION
    });
    var scenarioInputs = generateScenarios(metrics, aiResult);
    var scenarios = [];
    for (var i = 0; i < scenarioInputs.length; i++) {
      var s = scenarioInputs[i];
      s.forecast_id = forecast.forecast_id;
      var created = await ForecastModel.createScenario(s);
      scenarios.push(created);
    }
    var processingTime = Date.now() - startTime;
    await ForecastModel.logEvent({ forecast_id: forecast.forecast_id, event_type: 'FORECAST_CREATED', details: { expected_onboardings: forecast.expected_onboardings, expected_revenue: forecast.expected_revenue, confidence: forecast.confidence, scenarios_generated: scenarios.length }, processing_time_ms: processingTime, model_version: MODEL_VERSION });
    return { forecast: forecast, scenarios: scenarios, ai_result: aiResult, data_summary: { leads_analyzed: data.leads.length, qualifications_analyzed: data.qualifications.length, historical_win_rate: data.historicalWinRate, avg_deal_value: data.avgDealValue, pipeline_breakdown: metrics.breakdown }, processing_time_ms: processingTime };
  } catch (err) {
    await ForecastModel.logEvent({ event_type: 'FORECAST_ERROR', details: { forecast_type: forecastType, error: err.message }, error_message: err.message, processing_time_ms: Date.now() - startTime, model_version: MODEL_VERSION });
    throw err;
  }
}

// Period Calculators
function getPeriodBounds(forecastType) {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var start, end;
  if (forecastType === 'daily') { start = new Date(today); end = new Date(today); end.setDate(end.getDate() + 1); }
  else if (forecastType === 'weekly') { start = new Date(today); end = new Date(today); end.setDate(end.getDate() + 7); }
  else if (forecastType === 'monthly') { start = new Date(today); end = new Date(today); end.setMonth(end.getMonth() + 1); }
  else if (forecastType === 'quarterly') { start = new Date(today); end = new Date(today); end.setMonth(end.getMonth() + 3); }
  else if (forecastType === 'yearly') { start = new Date(today); end = new Date(today); end.setFullYear(end.getFullYear() + 1); }
  else if (forecastType === 'rolling_30') { start = new Date(today); end = new Date(today); end.setDate(end.getDate() + 30); }
  else if (forecastType === 'rolling_90') { start = new Date(today); end = new Date(today); end.setDate(end.getDate() + 90); }
  else { start = new Date(today); end = new Date(today); end.setDate(end.getDate() + 30); }
  return { start: start.toISOString(), end: end.toISOString() };
}

// Variance Evaluation
async function evaluateForecast(forecastId, actualResult) {
  var forecast = await ForecastModel.getForecastById(forecastId);
  if (!forecast) throw new Error('Forecast not found: ' + forecastId);
  var predictedRevenue = parseFloat(forecast.expected_revenue) || 0;
  var actualRevenue = parseFloat(actualResult.actual_revenue || 0);
  var predictedOnboardings = parseInt(forecast.expected_onboardings) || 0;
  var actualOnboardings = parseInt(actualResult.actual_onboardings || 0);
  var revenueVariance = predictedRevenue > 0 ? ((actualRevenue - predictedRevenue) / predictedRevenue) * 100 : 0;
  var onboardingVariance = predictedOnboardings > 0 ? ((actualOnboardings - predictedOnboardings) / predictedOnboardings) * 100 : 0;
  var avgVariance = (Math.abs(revenueVariance) + Math.abs(onboardingVariance)) / 2;
  var accuracy = Math.max(0, 100 - avgVariance);
  var confidenceCalibration = Math.abs(parseFloat(forecast.confidence) - accuracy);
  var prediction = { expected_revenue: predictedRevenue, expected_onboardings: predictedOnboardings, confidence: parseFloat(forecast.confidence), period: { start: forecast.period_start, end: forecast.period_end } };
  var historyRecord = await ForecastModel.createHistory({ forecast_id: forecastId, forecast_type: forecast.forecast_type, period_start: forecast.period_start, period_end: forecast.period_end, prediction: prediction, actual_result: actualResult, variance: Math.round(avgVariance * 100) / 100, accuracy: Math.round(accuracy * 100) / 100, confidence_calibration: Math.round(confidenceCalibration * 100) / 100, evaluation_notes: 'Revenue variance: ' + revenueVariance.toFixed(2) + '%. Onboarding variance: ' + onboardingVariance.toFixed(2) + '%.' });
  await ForecastModel.updateForecast(forecastId, { status: 'evaluated' });
  await ForecastModel.logEvent({ forecast_id: forecastId, event_type: 'FORECAST_EVALUATED', details: { accuracy: accuracy.toFixed(2), variance: avgVariance.toFixed(2) }, model_version: MODEL_VERSION });
  return { history: historyRecord, accuracy: Math.round(accuracy * 100) / 100, variance: Math.round(avgVariance * 100) / 100, confidence_calibration: Math.round(confidenceCalibration * 100) / 100, revenue_variance_pct: Math.round(revenueVariance * 100) / 100, onboarding_variance_pct: Math.round(onboardingVariance * 100) / 100 };
}

// Opportunities & Risks
async function getOpportunities() {
  var latest = await ForecastModel.listForecasts({ status: 'active', limit: 5 });
  var opportunities = [];
  for (var i = 0; i < latest.length; i++) {
    var f = latest[i];
    var opps = Array.isArray(f.opportunities) ? f.opportunities : [];
    for (var j = 0; j < opps.length; j++) {
      var o = opps[j];
      opportunities.push({ forecast_id: f.forecast_id, forecast_type: f.forecast_type, period_start: f.period_start, period_end: f.period_end, opportunity: typeof o === 'object' ? (o.opportunity || JSON.stringify(o)) : o, impact: typeof o === 'object' ? o.impact : 'Medium', action: typeof o === 'object' ? o.action : '' });
    }
  }
  return opportunities;
}

async function getRisks() {
  var latest = await ForecastModel.listForecasts({ status: 'active', limit: 5 });
  var risks = [];
  for (var i = 0; i < latest.length; i++) {
    var f = latest[i];
    var riskArr = Array.isArray(f.risks) ? f.risks : [];
    for (var j = 0; j < riskArr.length; j++) {
      var r = riskArr[j];
      risks.push({ forecast_id: f.forecast_id, forecast_type: f.forecast_type, period_start: f.period_start, period_end: f.period_end, risk: typeof r === 'object' ? (r.risk || JSON.stringify(r)) : r, severity: typeof r === 'object' ? r.severity : 'medium', mitigation: typeof r === 'object' ? r.mitigation : '' });
    }
  }
  return risks;
}

module.exports = { runForecast: runForecast, getPeriodBounds: getPeriodBounds, evaluateForecast: evaluateForecast, getOpportunities: getOpportunities, getRisks: getRisks, collectBusinessData: collectBusinessData, calculatePipelineMetrics: calculatePipelineMetrics, generateScenarios: generateScenarios };
