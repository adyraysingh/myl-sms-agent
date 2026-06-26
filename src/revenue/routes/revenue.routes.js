'use strict';
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const ForecastModel = require('../models/ForecastModel');
const RevenueForecaster = require('../services/RevenueForecaster');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ─── Migration Endpoint ───────────────────────────────────────────────────────

router.post('/migrate', async (req, res) => {
  try {
    const migrationPath = path.join(__dirname, '../db/migrations/010_revenue_intelligence.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    res.json({ success: true, message: 'Phase 11 Revenue Intelligence migration complete', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[Revenue] Migration error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/forecast ─────────────────────────────────────────────
// Returns latest forecasts for all types

router.get('/forecast', async (req, res) => {
  try {
    const types = ['daily', 'weekly', 'monthly', 'quarterly', 'rolling_30', 'rolling_90'];
    const results = {};

    for (const t of types) {
      const latest = await ForecastModel.getLatestByType(t);
      if (latest) results[t] = latest;
    }

    const pipelineSummary = await ForecastModel.getPipelineSummary();
    const varianceSummary = await ForecastModel.getVarianceSummary();

    res.json({
      success: true,
      forecasts: results,
      pipeline_summary: pipelineSummary,
      historical_accuracy: varianceSummary,
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /forecast error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/forecast/:period ─────────────────────────────────────
// Fetch forecast for a specific period type

router.get('/forecast/:period', async (req, res) => {
  const { period } = req.params;
  const valid = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'rolling_30', 'rolling_90'];

  if (!valid.includes(period)) {
    return res.status(400).json({ success: false, error: 'Invalid period. Valid: ' + valid.join(', ') });
  }

  try {
    const forecast = await ForecastModel.getLatestByType(period);

    if (!forecast) {
      // Auto-generate if none exists
      const { start, end } = RevenueForecaster.getPeriodBounds(period);
      const result = await RevenueForecaster.runForecast(period, start, end);
      const scenarios = await ForecastModel.getScenariosForForecast(result.forecast.forecast_id);
      return res.json({
        success: true,
        forecast: result.forecast,
        scenarios,
        data_summary: result.data_summary,
        generated_fresh: true
      });
    }

    const scenarios = await ForecastModel.getScenariosForForecast(forecast.forecast_id);

    res.json({
      success: true,
      forecast,
      scenarios,
      generated_fresh: false
    });
  } catch (err) {
    console.error('[Revenue] GET /forecast/:period error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/scenarios ──────────────────────────────────────────────

router.get('/scenarios', async (req, res) => {
  try {
    const { scenario_type, forecast_id } = req.query;

    let scenarios;
    if (forecast_id) {
      scenarios = await ForecastModel.getScenariosForForecast(forecast_id);
    } else {
      scenarios = await ForecastModel.listScenarios({
        scenario_type,
        limit: parseInt(req.query.limit || '50'),
        offset: parseInt(req.query.offset || '0')
      });
    }

    res.json({
      success: true,
      scenarios,
      count: scenarios.length,
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /scenarios error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/history ─────────────────────────────────────────────

router.get('/history', async (req, res) => {
  try {
    const history = await ForecastModel.listHistory({
      forecast_type: req.query.forecast_type,
      limit: parseInt(req.query.limit || '30'),
      offset: parseInt(req.query.offset || '0')
    });

    const variance = await ForecastModel.getVarianceSummary();

    res.json({
      success: true,
      history,
      variance_summary: variance,
      count: history.length,
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /history error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/variance ────────────────────────────────────────────

router.get('/variance', async (req, res) => {
  try {
    const variance = await ForecastModel.getVarianceSummary();
    const history = await ForecastModel.listHistory({ limit: 10 });

    res.json({
      success: true,
      variance_by_type: variance,
      recent_evaluations: history,
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /variance error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/opportunities ──────────────────────────────────────────

router.get('/opportunities', async (req, res) => {
  try {
    const opportunities = await RevenueForecaster.getOpportunities();

    res.json({
      success: true,
      opportunities,
      count: opportunities.length,
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /opportunities error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/risks ───────────────────────────────────────────────

router.get('/risks', async (req, res) => {
  try {
    const risks = await RevenueForecaster.getRisks();

    res.json({
      success: true,
      risks,
      count: risks.length,
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /risks error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/revenue/recalculate ────────────────────────────────────────
// Trigger a fresh forecast for one or all period types

router.post('/recalculate', async (req, res) => {
  try {
    const { forecast_type, period_start, period_end } = req.body;
    const types = forecast_type
      ? [forecast_type]
      : ['daily', 'weekly', 'monthly', 'quarterly', 'rolling_30', 'rolling_90'];

    res.status(202).json({
      success: true,
      message: 'Forecast recalculation started for: ' + types.join(', '),
      types,
      started_at: new Date().toISOString()
    });

    // Run async
    setImmediate(async () => {
      for (const t of types) {
        try {
          const bounds = RevenueForecaster.getPeriodBounds(t);
          const start = period_start || bounds.start;
          const end = period_end || bounds.end;
          await RevenueForecaster.runForecast(t, start, end);
          console.log('[Revenue] Recalculated forecast: ' + t);
        } catch (err) {
          console.error('[Revenue] Recalculation error for ' + t + ':', err.message);
        }
      }
    });
  } catch (err) {
    console.error('[Revenue] POST /recalculate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/revenue/evaluate ──────────────────────────────────────────────
// Evaluate a past forecast against actual results

router.post('/evaluate', async (req, res) => {
  try {
    const { forecast_id, actual_revenue, actual_onboardings, notes } = req.body;

    if (!forecast_id) return res.status(400).json({ success: false, error: 'forecast_id is required' });
    if (actual_revenue === undefined && actual_onboardings === undefined) {
      return res.status(400).json({ success: false, error: 'actual_revenue or actual_onboardings is required' });
    }

    const result = await RevenueForecaster.evaluateForecast(forecast_id, {
      actual_revenue: parseFloat(actual_revenue || 0),
      actual_onboardings: parseInt(actual_onboardings || 0),
      notes: notes || ''
    });

    res.json({
      success: true,
      evaluation: result,
      evaluated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] POST /evaluate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/revenue/dashboard ────────────────────────────────────────────
// Aggregated dashboard data for the CEO / executive dashboard

router.get('/dashboard', async (req, res) => {
  try {
    const [monthly, weekly, quarterly] = await Promise.all([
      ForecastModel.getLatestByType('monthly'),
      ForecastModel.getLatestByType('weekly'),
      ForecastModel.getLatestByType('quarterly')
    ]);

    const [opportunities, risks, variance, history] = await Promise.all([
      RevenueForecaster.getOpportunities(),
      RevenueForecaster.getRisks(),
      ForecastModel.getVarianceSummary(),
      ForecastModel.listHistory({ limit: 5 })
    ]);

    const pipelineSummary = await ForecastModel.getPipelineSummary();

    // Get scenarios for monthly forecast
    let monthlyScenarios = [];
    if (monthly) {
      monthlyScenarios = await ForecastModel.getScenariosForForecast(monthly.forecast_id);
    }

    const bestCase = monthlyScenarios.find(s => s.scenario_type === 'best_case');
    const expectedCase = monthlyScenarios.find(s => s.scenario_type === 'expected_case');
    const worstCase = monthlyScenarios.find(s => s.scenario_type === 'worst_case');

    res.json({
      success: true,
      dashboard: {
        revenue_forecast: monthly ? {
          expected_revenue: monthly.expected_revenue,
          expected_onboardings: monthly.expected_onboardings,
          confidence: monthly.confidence,
          period_start: monthly.period_start,
          period_end: monthly.period_end
        } : null,
        weekly_forecast: weekly ? {
          expected_revenue: weekly.expected_revenue,
          expected_onboardings: weekly.expected_onboardings,
          confidence: weekly.confidence
        } : null,
        quarterly_forecast: quarterly ? {
          expected_revenue: quarterly.expected_revenue,
          expected_onboardings: quarterly.expected_onboardings,
          confidence: quarterly.confidence
        } : null,
        pipeline_summary: pipelineSummary,
        forecast_confidence: monthly ? monthly.confidence : null,
        revenue_at_risk: monthly ? monthly.revenue_at_risk : null,
        target_progress: monthly ? monthly.target_progress : null,
        scenarios: {
          best_case: bestCase ? { expected_revenue: bestCase.expected_revenue, expected_onboardings: bestCase.expected_onboardings, confidence: bestCase.confidence } : null,
          expected_case: expectedCase ? { expected_revenue: expectedCase.expected_revenue, expected_onboardings: expectedCase.expected_onboardings, confidence: expectedCase.confidence } : null,
          worst_case: worstCase ? { expected_revenue: worstCase.expected_revenue, expected_onboardings: worstCase.expected_onboardings, confidence: worstCase.confidence } : null
        },
        historical_accuracy: variance,
        recent_variance: history,
        top_opportunities: opportunities.slice(0, 5),
        top_risks: risks.slice(0, 5),
        assumptions: monthly ? (monthly.assumptions || []) : [],
        suggested_executive_actions: monthly ? (monthly.opportunities || []).slice(0, 3) : []
      },
      retrieved_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Revenue] GET /dashboard error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
