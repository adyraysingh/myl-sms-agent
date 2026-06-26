'use strict';
const OpenAI = require('openai');
const { Pool } = require('pg');
const ForecastModel = require('../models/ForecastModel');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MODEL_VERSION = '1.0';

// ─── Data Collection ─────────────────────────────────────────────────────────

async function collectBusinessData(periodStart, periodEnd) {
  const start = new Date(periodStart).toISOString();
  const end = new Date(periodEnd).toISOString();

  const [leads, qualifications, decisions, conversations, briefings, workflows, learningEvents] = await Promise.all([
    pool.query(
      'SELECT * FROM leads WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC',
      [start, end]
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT * FROM onboarding_qualifications WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC',
      [start, end]
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT * FROM decisions WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 100',
      [start, end]
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT * FROM conversation_analysis WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 100',
      [start, end]
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT * FROM executive_briefings ORDER BY created_at DESC LIMIT 5'
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT status, COUNT(*) as count, AVG(EXTRACT(EPOCH FROM (completed_at - created_at))/3600)::NUMERIC(8,2) AS avg_hours FROM automation_workflows WHERE created_at BETWEEN $1 AND $2 GROUP BY status',
      [start, end]
    ).catch(() => ({ rows: [] })),
    pool.query(
      'SELECT source_module, prediction_type, AVG(accuracy_score)::NUMERIC(5,2) AS avg_accuracy FROM learning_events WHERE created_at BETWEEN $1 AND $2 GROUP BY source_module, prediction_type',
      [start, end]
    ).catch(() => ({ rows: [] }))
  ]);

  // Historical win rate
  const historicalWinRate = await pool.query(
    'SELECT COUNT(*) FILTER (WHERE category = $1) AS onboarded, COUNT(*) AS total FROM onboarding_qualifications WHERE created_at >= NOW() - INTERVAL '90 days'',
    ['Onboarded']
  ).catch(() => ({ rows: [{ onboarded: 0, total: 1 }] }));

  const winRateRow = historicalWinRate.rows[0] || { onboarded: 0, total: 1 };
  const historicalWinRatePct = winRateRow.total > 0
    ? (parseFloat(winRateRow.onboarded) / parseFloat(winRateRow.total)) * 100
    : 0;

  // Average deal value from onboarded leads
  const avgDealVal = await pool.query(
    'SELECT AVG((conversation_data->>'budget')::NUMERIC) AS avg_deal FROM conversation_analysis WHERE created_at >= NOW() - INTERVAL '90 days' AND conversation_data->>'budget' IS NOT NULL'
  ).catch(() => ({ rows: [{ avg_deal: 0 }] }));

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
    avgDealValue: parseFloat(avgDealVal.rows[0]?.avg_deal || 5000),
    dataCollectedAt: new Date().toISOString()
  };
}

// ─── Pipeline Calculator ─────────────────────────────────────────────────────

function calculatePipelineMetrics(data) {
  const quals = data.qualifications;
  const total = quals.length;

  const hot = quals.filter(q => q.category === 'Hot').length;
  const warm = quals.filter(q => q.category === 'Warm').length;
  const cold = quals.filter(q => q.category === 'Cold').length;
  const onboarded = quals.filter(q => q.category === 'Onboarded').length;
  const dead = quals.filter(q => q.category === 'Dead' || q.category === 'Unqualified').length;

  const avgDeal = data.avgDealValue || 5000;
  const winRate = parseFloat(data.historicalWinRate) / 100 || 0.15;

  // Weighted pipeline: Hot=70% probability, Warm=30%, Cold=10%
  const weightedPipeline = (hot * avgDeal * 0.70) + (warm * avgDeal * 0.30) + (cold * avgDeal * 0.10);
  const pipelineValue = (hot + warm + cold) * avgDeal;
  const expectedOnboardings = Math.round(hot * 0.70 + warm * 0.30 + cold * 0.10);
  const expectedRevenue = expectedOnboardings * avgDeal;
  const revenueAtRisk = (hot * avgDeal * 0.30) + (warm * avgDeal * 0.70);

  const avgScoreRaw = quals.reduce((sum, q) => sum + (parseFloat(q.onboarding_score) || 0), 0) / (total || 1);
  const confidence = Math.min(95, Math.max(20, avgScoreRaw));

  return {
    pipeline_value: Math.round(pipelineValue * 100) / 100,
    weighted_pipeline: Math.round(weightedPipeline * 100) / 100,
    expected_onboardings: expectedOnboardings,
    expected_revenue: Math.round(expectedRevenue * 100) / 100,
    revenue_at_risk: Math.round(revenueAtRisk * 100) / 100,
    avg_deal_value: Math.round(avgDeal * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    breakdown: { hot, warm, cold, onboarded, dead, total }
  };
}

// ─── AI Forecast Generator ────────────────────────────────────────────────────

async function generateAIForecast(forecastType, periodStart, periodEnd, data, metrics) {
  const prompt = 'You are the Revenue Intelligence Engine for MakeYourLabel, a clothing manufacturer specializing in Oversized T-Shirts, Hoodies, Tracksuits, Streetwear, Gym Wear, and Activewear.' +
    ' You generate evidence-based revenue and onboarding forecasts. You never invent numbers.' +
    ' Every forecast must include assumptions, confidence, risks, opportunities, and factors.' +
    ' Respond ONLY with valid JSON.';

  const userMsg = 'Generate a ' + forecastType + ' revenue and onboarding forecast for MakeYourLabel.' +
    ' Period: ' + periodStart + ' to ' + periodEnd + '.' +
    ' Pipeline metrics: ' + JSON.stringify(metrics) + '.' +
    ' Lead count: ' + data.leads.length + '.' +
    ' Historical win rate: ' + data.historicalWinRate + '%.' +
    ' Average deal value: $' + data.avgDealValue + '.' +
    ' Learning accuracy: ' + JSON.stringify(data.learningAccuracy) + '.' +
    ' Workflow summary: ' + JSON.stringify(data.workflowSummary) + '.' +
    ' Return JSON with fields: executive_summary (string), expected_onboardings (number), expected_revenue (number), ' +
    'pipeline_value (number), revenue_at_risk (number), weighted_pipeline (number), confidence (0-100 number), ' +
    'avg_deal_value (number), avg_sales_cycle_days (number), target_progress (0-100 number), ' +
    'forecast_variance (number), ' +
    'factors (object with factor_name->impact_description pairs), ' +
    'assumptions (array of assumption strings), ' +
    'risks (array of {risk, severity, mitigation} objects), ' +
    'opportunities (array of {opportunity, impact, action} objects), ' +
    'top_revenue_opportunities (array of strings), ' +
    'top_revenue_risks (array of strings), ' +
    'suggested_executive_actions (array of strings), ' +
    'revenue_outlook (string), ' +
    'expected_target_achievement (string).';

  const response = await openai.chat.completions.create({
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

// ─── Scenario Generator ───────────────────────────────────────────────────────

function generateScenarios(metrics, aiResult) {
  const base = aiResult.expected_revenue || metrics.expected_revenue;
  const baseOnboard = aiResult.expected_onboardings || metrics.expected_onboardings;

  const scenarios = [
    {
      scenario_type: 'best_case',
      expected_revenue: Math.round(base * 1.35 * 100) / 100,
      expected_onboardings: Math.ceil(baseOnboard * 1.35),
      confidence: Math.min(95, (aiResult.confidence || 60) * 0.75),
      assumptions: ['All hot leads convert', 'Follow-up completion 100%', 'No objections', 'Optimal sales execution'],
      primary_risks: ['Execution risk if team is understaffed', 'Market demand could shift'],
      primary_opportunities: ['Convert all warm leads', 'Reduce average sales cycle by 20%'],
      explanation: 'Best case assumes all high-probability leads convert and operational execution is optimal.'
    },
    {
      scenario_type: 'expected_case',
      expected_revenue: base,
      expected_onboardings: baseOnboard,
      confidence: aiResult.confidence || 60,
      assumptions: aiResult.assumptions || ['Historical win rates apply', 'Current pipeline health maintained'],
      primary_risks: (aiResult.risks || []).map(r => typeof r === 'object' ? r.risk : r),
      primary_opportunities: (aiResult.opportunities || []).map(o => typeof o === 'object' ? o.opportunity : o),
      explanation: 'Expected case based on current pipeline health, historical win rates, and operational performance.'
    },
    {
      scenario_type: 'worst_case',
      expected_revenue: Math.round(base * 0.55 * 100) / 100,
      expected_onboardings: Math.floor(baseOnboard * 0.55),
      confidence: Math.min(95, (aiResult.confidence || 60) * 1.1),
      assumptions: ['Only cold confirmed leads convert', 'High churn rate', 'Follow-up delays', 'Market downturn'],
      primary_risks: ['Revenue significantly below target', 'Sales team morale impact', 'Cash flow pressure'],
      primary_opportunities: ['Early warning to adjust strategy', 'Focus on highest probability leads only'],
      explanation: 'Worst case assumes significant operational friction and only the most committed leads convert.'
    },
    {
      scenario_type: 'aggressive_growth',
      expected_revenue: Math.round(base * 1.60 * 100) / 100,
      expected_onboardings: Math.ceil(baseOnboard * 1.60),
      confidence: Math.min(95, (aiResult.confidence || 60) * 0.6),
      assumptions: ['Significant increase in lead volume', 'New marketing campaigns active', 'Team expansion', 'Process optimization complete'],
      primary_risks: ['Requires additional resources', 'Quality risk at scale', 'Operational capacity constraints'],
      primary_opportunities: ['Market expansion', 'New product categories', 'Referral program activation'],
      explanation: 'Aggressive growth scenario requires additional investment in pipeline, team capacity, and marketing.'
    },
    {
      scenario_type: 'conservative_growth',
      expected_revenue: Math.round(base * 0.80 * 100) / 100,
      expected_onboardings: Math.floor(baseOnboard * 0.80),
      confidence: Math.min(95, (aiResult.confidence || 60) * 0.95),
      assumptions: ['Conservative conversion assumptions', 'Some leads lost to competitors', 'Normal follow-up delays', 'Typical seasonal patterns'],
      primary_risks: ['Below target revenue', 'Pipeline may shrink if not replenished'],
      primary_opportunities: ['Stable foundation to build from', 'Lower operational pressure allows quality focus'],
      explanation: 'Conservative growth scenario accounts for typical pipeline attrition and conversion friction.'
    }
  ];

  return scenarios;
}

// ─── Main Forecasting Orchestrator ────────────────────────────────────────────

async function runForecast(forecastType, periodStart, periodEnd) {
  const startTime = Date.now();

  try {
    await ForecastModel.logEvent({
      event_type: 'FORECAST_STARTED',
      details: { forecast_type: forecastType, period_start: periodStart, period_end: periodEnd },
      model_version: MODEL_VERSION
    });

    const data = await collectBusinessData(periodStart, periodEnd);
    const metrics = calculatePipelineMetrics(data);

    let aiResult = {};
    try {
      aiResult = await generateAIForecast(forecastType, periodStart, periodEnd, data, metrics);
    } catch (aiErr) {
      console.error('[RevenueForecaster] AI generation failed, using calculated metrics:', aiErr.message);
      aiResult = {
        expected_onboardings: metrics.expected_onboardings,
        expected_revenue: metrics.expected_revenue,
        confidence: metrics.confidence,
        factors: { pipeline_health: 'Based on current qualification scores', historical_win_rate: data.historicalWinRate + '%' },
        assumptions: ['Based on historical win rates', 'Current pipeline composition'],
        risks: [{ risk: 'AI analysis unavailable', severity: 'medium', mitigation: 'Using statistical calculations' }],
        opportunities: [],
        top_revenue_opportunities: ['Convert hot leads', 'Reduce sales cycle'],
        top_revenue_risks: ['Follow-up delays', 'Low pipeline volume'],
        suggested_executive_actions: ['Review hot leads daily', 'Monitor follow-up completion'],
        revenue_outlook: 'Based on pipeline data — AI narrative unavailable',
        expected_target_achievement: 'Unable to calculate without AI analysis'
      };
    }

    // Merge AI and calculated metrics (AI takes priority where populated)
    const forecast = await ForecastModel.createForecast({
      forecast_type: forecastType,
      period_start: periodStart,
      period_end: periodEnd,
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

    // Create scenarios
    const scenarioInputs = generateScenarios(metrics, aiResult);
    const scenarios = [];
    for (const s of scenarioInputs) {
      const created = await ForecastModel.createScenario({ forecast_id: forecast.forecast_id, ...s });
      scenarios.push(created);
    }

    const processingTime = Date.now() - startTime;

    await ForecastModel.logEvent({
      forecast_id: forecast.forecast_id,
      event_type: 'FORECAST_CREATED',
      details: {
        expected_onboardings: forecast.expected_onboardings,
        expected_revenue: forecast.expected_revenue,
        confidence: forecast.confidence,
        scenarios_generated: scenarios.length
      },
      processing_time_ms: processingTime,
      model_version: MODEL_VERSION
    });

    return {
      forecast,
      scenarios,
      ai_result: aiResult,
      data_summary: {
        leads_analyzed: data.leads.length,
        qualifications_analyzed: data.qualifications.length,
        historical_win_rate: data.historicalWinRate,
        avg_deal_value: data.avgDealValue,
        pipeline_breakdown: metrics.breakdown
      },
      processing_time_ms: processingTime
    };

  } catch (err) {
    await ForecastModel.logEvent({
      event_type: 'FORECAST_ERROR',
      details: { forecast_type: forecastType, error: err.message },
      error_message: err.message,
      processing_time_ms: Date.now() - startTime,
      model_version: MODEL_VERSION
    });
    throw err;
  }
}

// ─── Period Calculators ───────────────────────────────────────────────────────

function getPeriodBounds(forecastType) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (forecastType) {
    case 'daily': {
      const start = new Date(today);
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'weekly': {
      const start = new Date(today);
      const end = new Date(today);
      end.setDate(end.getDate() + 7);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'monthly': {
      const start = new Date(today);
      const end = new Date(today);
      end.setMonth(end.getMonth() + 1);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'quarterly': {
      const start = new Date(today);
      const end = new Date(today);
      end.setMonth(end.getMonth() + 3);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'yearly': {
      const start = new Date(today);
      const end = new Date(today);
      end.setFullYear(end.getFullYear() + 1);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'rolling_30': {
      const start = new Date(today);
      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'rolling_90': {
      const start = new Date(today);
      const end = new Date(today);
      end.setDate(end.getDate() + 90);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    default: {
      const start = new Date(today);
      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      return { start: start.toISOString(), end: end.toISOString() };
    }
  }
}

// ─── Variance / Evaluation ────────────────────────────────────────────────────

async function evaluateForecast(forecastId, actualResult) {
  const forecast = await ForecastModel.getForecastById(forecastId);
  if (!forecast) throw new Error('Forecast not found: ' + forecastId);

  const predictedRevenue = parseFloat(forecast.expected_revenue) || 0;
  const actualRevenue = parseFloat(actualResult.actual_revenue || 0);
  const predictedOnboardings = parseInt(forecast.expected_onboardings) || 0;
  const actualOnboardings = parseInt(actualResult.actual_onboardings || 0);

  const revenueVariance = predictedRevenue > 0
    ? ((actualRevenue - predictedRevenue) / predictedRevenue) * 100
    : 0;

  const onboardingVariance = predictedOnboardings > 0
    ? ((actualOnboardings - predictedOnboardings) / predictedOnboardings) * 100
    : 0;

  const avgVariance = (Math.abs(revenueVariance) + Math.abs(onboardingVariance)) / 2;
  const accuracy = Math.max(0, 100 - avgVariance);

  const confidenceCalibration = Math.abs(parseFloat(forecast.confidence) - accuracy);

  const prediction = {
    expected_revenue: predictedRevenue,
    expected_onboardings: predictedOnboardings,
    confidence: parseFloat(forecast.confidence),
    period: { start: forecast.period_start, end: forecast.period_end }
  };

  const historyRecord = await ForecastModel.createHistory({
    forecast_id: forecastId,
    forecast_type: forecast.forecast_type,
    period_start: forecast.period_start,
    period_end: forecast.period_end,
    prediction,
    actual_result: actualResult,
    variance: Math.round(avgVariance * 100) / 100,
    accuracy: Math.round(accuracy * 100) / 100,
    confidence_calibration: Math.round(confidenceCalibration * 100) / 100,
    evaluation_notes: 'Revenue variance: ' + revenueVariance.toFixed(2) + '%. Onboarding variance: ' + onboardingVariance.toFixed(2) + '%.'
  });

  await ForecastModel.updateForecast(forecastId, { status: 'evaluated' });

  await ForecastModel.logEvent({
    forecast_id: forecastId,
    event_type: 'FORECAST_EVALUATED',
    details: {
      accuracy: accuracy.toFixed(2),
      variance: avgVariance.toFixed(2),
      revenue_variance_pct: revenueVariance.toFixed(2),
      onboarding_variance_pct: onboardingVariance.toFixed(2)
    },
    model_version: MODEL_VERSION
  });

  return {
    history: historyRecord,
    accuracy: Math.round(accuracy * 100) / 100,
    variance: Math.round(avgVariance * 100) / 100,
    confidence_calibration: Math.round(confidenceCalibration * 100) / 100,
    revenue_variance_pct: Math.round(revenueVariance * 100) / 100,
    onboarding_variance_pct: Math.round(onboardingVariance * 100) / 100
  };
}

// ─── Opportunities & Risks ────────────────────────────────────────────────────

async function getOpportunities() {
  const latest = await ForecastModel.listForecasts({ status: 'active', limit: 5 });
  const opportunities = [];
  for (const f of latest) {
    const opps = Array.isArray(f.opportunities) ? f.opportunities : [];
    for (const o of opps) {
      opportunities.push({
        forecast_id: f.forecast_id,
        forecast_type: f.forecast_type,
        period_start: f.period_start,
        period_end: f.period_end,
        opportunity: typeof o === 'object' ? (o.opportunity || JSON.stringify(o)) : o,
        impact: typeof o === 'object' ? o.impact : 'Medium',
        action: typeof o === 'object' ? o.action : ''
      });
    }
  }
  return opportunities;
}

async function getRisks() {
  const latest = await ForecastModel.listForecasts({ status: 'active', limit: 5 });
  const risks = [];
  for (const f of latest) {
    const riskArr = Array.isArray(f.risks) ? f.risks : [];
    for (const r of riskArr) {
      risks.push({
        forecast_id: f.forecast_id,
        forecast_type: f.forecast_type,
        period_start: f.period_start,
        period_end: f.period_end,
        risk: typeof r === 'object' ? (r.risk || JSON.stringify(r)) : r,
        severity: typeof r === 'object' ? r.severity : 'medium',
        mitigation: typeof r === 'object' ? r.mitigation : ''
      });
    }
  }
  return risks;
}

module.exports = {
  runForecast,
  getPeriodBounds,
  evaluateForecast,
  getOpportunities,
  getRisks,
  collectBusinessData,
  calculatePipelineMetrics,
  generateScenarios
};
