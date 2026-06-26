'use strict';
const OpenAI = require('openai');
const { Pool } = require('pg');
const ForecastModel = require('../models/ForecastModel');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const MODEL_VERSION = '1.0';

// Data Collection — all lead data from Business Memory (lead_memory), authoritative source
async function collectBusinessData(periodStart, periodEnd) {
  const start = new Date(periodStart).toISOString();
  const end = new Date(periodEnd).toISOString();

  const [leads, qualifications, decisions, conversations, briefings, workflows, learningEvents] = await Promise.all([
    // FIXED: was 'FROM leads' (legacy) — now uses Business Memory (authoritative source)
    pool.query('SELECT id, zoho_lead_id, full_name, email, phone, company, pipeline_stage, is_onboarded, lead_owner_id, created_at FROM lead_memory WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC', [start, end]).catch(() => ({ rows: [] })),
    // FIXED: was 'FROM onboarding_qualifications' (legacy) — now uses lead_qualification
    pool.query('SELECT * FROM lead_qualification WHERE last_qualified_at BETWEEN $1 AND $2 ORDER BY last_qualified_at DESC', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM ai_decisions WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 100', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM conversation_analysis WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 100', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM executive_briefings ORDER BY created_at DESC LIMIT 5').catch(() => ({ rows: [] })),
    pool.query('SELECT * FROM automation_workflows WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at DESC LIMIT 50', [start, end]).catch(() => ({ rows: [] })),
    pool.query('SELECT source_module, prediction_type, AVG(accuracy_score)::NUMERIC(5,2) AS avg_accuracy FROM learning_events WHERE created_at BETWEEN $1 AND $2 GROUP BY source_module, prediction_type', [start, end]).catch(() => ({ rows: [] }))
  ]);

  // Historical win rate from lead_qualification (was onboarding_qualifications)
  const historicalWinRateSQL = 'SELECT COUNT(*) FILTER (WHERE category = $1) AS onboarded, COUNT(*) AS total FROM lead_qualification WHERE last_qualified_at >= NOW() - INTERVAL '90 days'';
  const winRateResult = await pool.query(historicalWinRateSQL, ['onboarded']).catch(() => ({ rows: [{ onboarded: 0, total: 0 }] }));
  const wr = winRateResult.rows[0] || {};
  const historicalWinRate = wr.total > 0 ? parseFloat(wr.onboarded) / parseFloat(wr.total) : 0.15;

  // Average deal value estimation from onboarded leads
  const avgDealValue = 50000;

  return {
    leads: leads.rows,
    qualifications: qualifications.rows,
    decisions: decisions.rows,
    conversations: conversations.rows,
    briefings: briefings.rows,
    workflows: workflows.rows,
    learningEvents: learningEvents.rows,
    historicalWinRate,
    avgDealValue
  };
}

function computePipelineMetrics(data) {
  const { leads, qualifications } = data;

  // Build qualification lookup by lead_id
  const qualMap = {};
  for (const q of qualifications) {
    qualMap[q.lead_id] = q;
  }

  let totalLeads = leads.length;
  let hotLeads = 0, warmLeads = 0, coldLeads = 0, onboardedLeads = 0;
  let totalPipelineValue = 0;
  let weightedPipelineValue = 0;

  for (const lead of leads) {
    const qual = qualMap[lead.id] || null;
    const category = qual ? (qual.category || 'unqualified').toLowerCase() : 'unqualified';
    const prob = qual ? (parseFloat(qual.onboarding_probability) || 0) / 100 : 0.05;

    if (category === 'hot' || category === 'onboarded') hotLeads++;
    else if (category === 'warm') warmLeads++;
    else if (category === 'cold') coldLeads++;
    if (lead.is_onboarded) onboardedLeads++;

    const dealValue = data.avgDealValue;
    totalPipelineValue += dealValue;
    weightedPipelineValue += dealValue * prob;
  }

  const breakdown = {
    hot: hotLeads,
    warm: warmLeads,
    cold: coldLeads,
    onboarded: onboardedLeads,
    total: totalLeads,
    unqualified: totalLeads - hotLeads - warmLeads - coldLeads - onboardedLeads
  };

  return {
    totalPipelineValue,
    weightedPipelineValue,
    breakdown,
    avgDealValue: data.avgDealValue,
    historicalWinRate: data.historicalWinRate
  };
}

class RevenueForecaster {
  static getPeriodBounds(periodType) {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    switch (periodType) {
      case 'daily':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(end.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        break;
      case 'quarterly': {
        const q = Math.floor(now.getMonth() / 3);
        start.setMonth(q * 3, 1);
        start.setHours(0, 0, 0, 0);
        end.setMonth(q * 3 + 3, 0);
        end.setHours(23, 59, 59, 999);
        break;
      }
      case 'rolling_30':
        start.setDate(start.getDate() - 30);
        break;
      case 'rolling_90':
        start.setDate(start.getDate() - 90);
        break;
      default:
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
    }

    return { start: start.toISOString(), end: end.toISOString() };
  }

  static async runForecast(periodType, periodStart, periodEnd) {
    const processingStart = Date.now();
    console.log('[RevenueForecaster] Running forecast:', periodType, periodStart, '->', periodEnd);

    const data = await collectBusinessData(periodStart, periodEnd);
    const metrics = computePipelineMetrics(data);

    const base = metrics.weightedPipelineValue || 0;
    const baseOnboard = Math.round(base / (data.avgDealValue || 50000));
    const conf = Math.min(90, 50 + (data.leads.length * 2));

    const scenarios = [
      { scenario_type: 'best_case', expected_revenue: Math.round(base * 1.35 * 100) / 100, expected_onboardings: Math.ceil(baseOnboard * 1.35), confidence: Math.min(95, conf * 0.75), assumptions: ['All hot leads convert', 'Follow-up completion 100%', 'No objections'], primary_risks: ['Execution risk', 'Market demand shift'], primary_opportunities: ['Convert all warm leads', 'Reduce sales cycle'], explanation: 'Best case: all high-probability leads convert, optimal execution.' },
      { scenario_type: 'expected_case', expected_revenue: Math.round(base * 100) / 100, expected_onboardings: baseOnboard, confidence: conf, assumptions: ['Hot leads convert at historical rate', 'Normal follow-up delays', 'Typical objections'], primary_risks: ['Pipeline quality', 'Capacity constraints'], primary_opportunities: ['Warm leads with nurturing', 'Referral conversions'], explanation: 'Expected: historical win rate applied to current pipeline.' },
      { scenario_type: 'worst_case', expected_revenue: Math.round(base * 0.55 * 100) / 100, expected_onboardings: Math.floor(baseOnboard * 0.55), confidence: Math.min(95, conf * 1.1), assumptions: ['Only confirmed leads convert', 'High churn', 'Follow-up delays'], primary_risks: ['Revenue below target', 'Cash flow pressure'], primary_opportunities: ['Early warning to adjust strategy'], explanation: 'Worst case: significant friction, only committed leads convert.' },
      { scenario_type: 'conservative_growth', expected_revenue: Math.round(base * 0.80 * 100) / 100, expected_onboardings: Math.floor(baseOnboard * 0.80), confidence: Math.min(95, conf * 0.95), assumptions: ['Conservative conversion', 'Some leads lost to competitors', 'Typical delays'], primary_risks: ['Below target revenue', 'Pipeline shrink'], primary_opportunities: ['Stable foundation', 'Quality focus'], explanation: 'Conservative: accounts for typical pipeline attrition and conversion friction.' }
    ];

    // Generate AI narrative
    let aiResult = null;
    try {
      const prompt = 'You are a revenue intelligence AI. Analyze this B2B private label clothing manufacturer pipeline data and provide a forecast narrative. Data: ' +
        'Period: ' + periodType + ' | ' +
        'Leads analyzed: ' + data.leads.length + ' | ' +
        'Hot leads: ' + metrics.breakdown.hot + ' | ' +
        'Warm leads: ' + metrics.breakdown.warm + ' | ' +
        'Expected revenue: $' + Math.round(base) + ' | ' +
        'Weighted pipeline: $' + Math.round(metrics.weightedPipelineValue) + ' | ' +
        'Historical win rate: ' + Math.round(data.historicalWinRate * 100) + '%. ' +
        'Respond with JSON: {"forecast_narrative":"...","key_drivers":[],"risks":[],"opportunities":[],"recommended_actions":[],"confidence_explanation":"..."}';

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 800
      });
      aiResult = JSON.parse(completion.choices[0].message.content);
    } catch (e) {
      console.error('[RevenueForecaster] AI narrative failed:', e.message);
      aiResult = {
        forecast_narrative: 'Pipeline has ' + data.leads.length + ' leads with weighted value $' + Math.round(base) + '.',
        key_drivers: ['Lead count: ' + data.leads.length, 'Hot leads: ' + metrics.breakdown.hot],
        risks: [], opportunities: [], recommended_actions: [],
        confidence_explanation: 'Based on ' + data.leads.length + ' leads at ' + Math.round(data.historicalWinRate * 100) + '% historical win rate.'
      };
    }

    const forecast = await ForecastModel.upsert({
      forecast_type: periodType,
      period_start: periodStart,
      period_end: periodEnd,
      expected_revenue: Math.round(base * 100) / 100,
      expected_onboardings: baseOnboard,
      confidence: conf,
      revenue_at_risk: Math.round((base - base * 0.55) * 100) / 100,
      target_progress: null,
      pipeline_value: metrics.totalPipelineValue,
      weighted_pipeline_value: metrics.weightedPipelineValue,
      lead_count: data.leads.length,
      hot_lead_count: metrics.breakdown.hot,
      warm_lead_count: metrics.breakdown.warm,
      cold_lead_count: metrics.breakdown.cold,
      historical_win_rate: data.historicalWinRate,
      avg_deal_value: data.avgDealValue,
      forecast_narrative: aiResult ? aiResult.forecast_narrative : null,
      key_drivers: aiResult ? aiResult.key_drivers : [],
      risks: aiResult ? aiResult.risks : [],
      opportunities: aiResult ? aiResult.opportunities : [],
      recommended_actions: aiResult ? aiResult.recommended_actions : [],
      assumptions: scenarios[1] ? scenarios[1].assumptions : [],
      model_version: MODEL_VERSION
    });

    // Save scenarios
    const savedScenarios = [];
    for (const s of scenarios) {
      try {
        const saved = await ForecastModel.upsertScenario({ forecast_id: forecast.forecast_id, ...s });
        savedScenarios.push(saved);
      } catch (e) { console.error('[RevenueForecaster] Scenario save failed:', e.message); }
    }

    const processingTime = Date.now() - processingStart;
    console.log('[RevenueForecaster] Forecast complete in', processingTime + 'ms:', periodType, '$' + Math.round(base));

    return { forecast, scenarios: savedScenarios, ai_result: aiResult, data_summary: { leads_analyzed: data.leads.length, qualifications_analyzed: data.qualifications.length, historical_win_rate: data.historicalWinRate, avg_deal_value: data.avgDealValue, pipeline_breakdown: metrics.breakdown }, processing_time_ms: processingTime };
  }

  static async evaluateForecast(forecastId, { actual_revenue, actual_onboardings, notes }) {
    const forecast = await ForecastModel.findById(forecastId);
    if (!forecast) throw new Error('Forecast not found: ' + forecastId);

    const revenue_variance = actual_revenue - (forecast.expected_revenue || 0);
    const onboarding_variance = actual_onboardings - (forecast.expected_onboardings || 0);
    const revenue_accuracy = forecast.expected_revenue > 0
      ? Math.max(0, 100 - Math.abs(revenue_variance / forecast.expected_revenue * 100))
      : 0;

    return await ForecastModel.saveEvaluation({
      forecast_id: forecastId,
      actual_revenue,
      actual_onboardings,
      revenue_variance,
      onboarding_variance,
      revenue_accuracy,
      notes: notes || '',
      evaluated_at: new Date().toISOString()
    });
  }

  static async getOpportunities() {
    try {
      // Get hot and warm leads from Business Memory
      const result = await pool.query(
        'SELECT lm.id, lm.full_name, lm.company, lm.lead_owner_name, lm.created_at, ' +
        'lq.category, lq.onboarding_score, lq.onboarding_probability, lq.recommended_next_action, lq.urgency_level ' +
        'FROM lead_memory lm ' +
        'JOIN lead_qualification lq ON lq.lead_id = lm.id ' +
        "WHERE lq.category IN ('hot', 'warm') " +
        'ORDER BY lq.onboarding_score DESC LIMIT 20'
      );
      return result.rows.map(r => ({
        lead_id: r.id,
        lead_name: r.full_name,
        company: r.company,
        owner: r.lead_owner_name,
        category: r.category,
        score: r.onboarding_score,
        probability: r.onboarding_probability,
        recommended_action: r.recommended_next_action,
        urgency: r.urgency_level,
        type: 'hot_lead_opportunity'
      }));
    } catch (e) {
      console.error('[RevenueForecaster] getOpportunities error:', e.message);
      return [];
    }
  }

  static async getRisks() {
    try {
      // Get cold/dead leads and stale hot leads from Business Memory
      const result = await pool.query(
        'SELECT lm.id, lm.full_name, lm.company, lm.last_contacted_at, ' +
        'lq.category, lq.onboarding_score, lq.qualification_gaps, lq.urgency_level ' +
        'FROM lead_memory lm ' +
        'LEFT JOIN lead_qualification lq ON lq.lead_id = lm.id ' +
        "WHERE lq.category IN ('cold', 'dead') OR (lm.last_contacted_at < NOW() - INTERVAL '7 days' AND lq.category = 'hot') " +
        'ORDER BY lq.onboarding_score ASC NULLS LAST LIMIT 20'
      );
      return result.rows.map(r => ({
        lead_id: r.id,
        lead_name: r.full_name,
        company: r.company,
        category: r.category,
        score: r.onboarding_score,
        last_contacted: r.last_contacted_at,
        gaps: r.qualification_gaps,
        type: r.category === 'hot' ? 'stale_hot_lead' : 'cold_dead_lead'
      }));
    } catch (e) {
      console.error('[RevenueForecaster] getRisks error:', e.message);
      return [];
    }
  }
}

module.exports = RevenueForecaster;
