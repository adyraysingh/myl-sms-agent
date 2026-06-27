'use strict';
const express = require('express');
const router = express.Router();
const LearningEvent = require('../models/LearningEvent');
const LearningEngine = require('../services/LearningEngine');
const AccuracyEvaluator = require('../services/AccuracyEvaluator');
const LearningScheduler = require('../services/LearningScheduler');
const PredictionRegistry = require('../models/PredictionRegistry');
const pool = require('../../memory/db/pool');
const path = require('path');
const fs = require('fs');

// ─── Migrations ───────────────────────────────────────────────────────────────
router.post('/migrate', async (req, res) => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/008_continuous_learning.sql'), 'utf8');
    await pool.query(sql);
    res.json({ success: true, message: 'Phase 9 migration completed' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/migrate3', async (req, res) => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/013_phase3_learning.sql'), 'utf8');
    await pool.query(sql);
    res.json({ success: true, message: 'Phase 3 learning migration completed' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Existing endpoints (Phase 9) ────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try { res.json({ success: true, summary: await LearningEngine.getSummary() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/performance', async (req, res) => {
  try {
    const { model_name, limit } = req.query;
    const performance = await LearningEvent.getPerformanceHistory(model_name, parseInt(limit) || 30);
    const moduleAccuracy = await LearningEvent.getModuleAccuracy(null, 30);
    res.json({ success: true, performance, module_accuracy: moduleAccuracy, count: performance.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/trends', async (req, res) => {
  try {
    const trends = await LearningEvent.getTrends(req.query.category, parseInt(req.query.limit) || 30);
    res.json({ success: true, trends, count: trends.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/optimizations', async (req, res) => {
  try {
    const opts = await LearningEvent.getOptimizations(req.query.status || 'open', parseInt(req.query.limit) || 50);
    res.json({ success: true, optimizations: opts, count: opts.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/history', async (req, res) => {
  try {
    const history = await LearningEvent.getSnapshotHistory(parseInt(req.query.limit) || 30);
    const moduleCounts = await LearningEvent.countByModule();
    res.json({ success: true, history, module_counts: moduleCounts, count: history.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/evaluate', async (req, res) => {
  try {
    res.status(202).json({ success: true, message: 'Full learning evaluation started' });
    setImmediate(async () => {
      try { await LearningEngine.runFullEvaluation(); }
      catch (e) { console.error('[learning.routes] Evaluation failed:', e.message); }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/recalculate', async (req, res) => {
  try {
    const { module } = req.body;
    let result;
    if (!module || module === 'all') result = await AccuracyEvaluator.runAll();
    else if (module === 'qualification') result = await AccuracyEvaluator.evaluateQualification();
    else if (module === 'decisions') result = await AccuracyEvaluator.evaluateDecisions();
    else if (module === 'investigations') result = await AccuracyEvaluator.evaluateInvestigations();
    else if (module === 'conversations') result = await AccuracyEvaluator.evaluateConversations();
    else if (module === 'coaching') result = await AccuracyEvaluator.evaluateSalesCoaching();
    else return res.status(400).json({ success: false, error: 'Unknown module' });
    res.json({ success: true, module: module || 'all', result, evaluated_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Prediction Registry ────────────────────────────────────────────
router.post('/predictions', async (req, res) => {
  try {
    const { module, lead_id, prediction_type, prediction, confidence, evidence, expires_days } = req.body;
    if (!module || !prediction_type) return res.status(400).json({ success: false, error: 'module and prediction_type required' });
    const pred = await PredictionRegistry.record({ module, lead_id, prediction_type, prediction, confidence, evidence, expires_days });
    res.status(201).json({ success: true, prediction: pred });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/predictions', async (req, res) => {
  try {
    const { module, limit, days } = req.query;
    const preds = await PredictionRegistry.getRecent({ module, limit: parseInt(limit) || 50, days: parseInt(days) || 30 });
    const counts = await PredictionRegistry.countByModule();
    res.json({ success: true, predictions: preds, counts, count: preds.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/predictions/accuracy', async (req, res) => {
  try {
    const summary = await PredictionRegistry.getAccuracySummary({ days: parseInt(req.query.days) || 30 });
    res.json({ success: true, accuracy_summary: summary, count: summary.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/outcomes', async (req, res) => {
  try {
    const { prediction_id, module, lead_id, outcome_type, outcome_value, is_correct, accuracy_score, notes, source } = req.body;
    if (!module || !outcome_type) return res.status(400).json({ success: false, error: 'module and outcome_type required' });
    const outcome = await PredictionRegistry.recordOutcome({ prediction_id, module, lead_id, outcome_type, outcome_value, is_correct, accuracy_score, notes, source });
    res.status(201).json({ success: true, outcome });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Confidence Calibration ─────────────────────────────────────────
router.get('/calibration', async (req, res) => {
  try {
    const { module, limit } = req.query;
    const args = [];
    let q = 'SELECT * FROM confidence_calibration';
    if (module) { q += ' WHERE module=$1'; args.push(module); }
    q += ' ORDER BY evaluated_at DESC LIMIT $' + (args.length + 1);
    args.push(parseInt(limit) || 100);
    const r = await pool.query(q, args);
    res.json({ success: true, calibration: r.rows, count: r.rowCount });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Prompt Performance ─────────────────────────────────────────────
router.get('/prompts', async (req, res) => {
  try {
    const { module } = req.query;
    const args = [];
    let q = 'SELECT * FROM prompt_versions';
    if (module) { q += ' WHERE module=$1'; args.push(module); }
    q += ' ORDER BY module, version_tag DESC';
    const r = await pool.query(q, args);
    res.json({ success: true, prompts: r.rows, count: r.rowCount });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Recommendation Outcomes ────────────────────────────────────────
router.post('/recommendations', async (req, res) => {
  try {
    const { module, lead_id, prediction_id, recommendation_type, recommendation, outcome, outcome_detail, confidence } = req.body;
    if (!module || !recommendation_type) return res.status(400).json({ success: false, error: 'module and recommendation_type required' });
    const r = await pool.query(
      'INSERT INTO recommendation_outcomes (module, lead_id, prediction_id, recommendation_type, recommendation, outcome, outcome_detail, confidence, actioned_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *',
      [module, lead_id || null, prediction_id || null, recommendation_type, JSON.stringify(recommendation || {}), outcome || 'pending', outcome_detail || null, confidence || null]
    );
    res.status(201).json({ success: true, outcome: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/recommendations', async (req, res) => {
  try {
    const { module } = req.query;
    const args = [];
    let q = 'SELECT module, recommendation_type, outcome, COUNT(*) as total, COUNT(*) FILTER (WHERE outcome=$1) as accepted, COUNT(*) FILTER (WHERE outcome=$2) as rejected, COUNT(*) FILTER (WHERE outcome=$3) as ignored, ROUND(COUNT(*) FILTER (WHERE outcome=$1)::NUMERIC / NULLIF(COUNT(*),0), 4) as acceptance_rate FROM recommendation_outcomes';
    args.push('accepted', 'rejected', 'ignored');
    if (module) { q += ' WHERE module=$4'; args.push(module); }
    q += ' GROUP BY module, recommendation_type, outcome ORDER BY module LIMIT 50';
    const r = await pool.query(q, args);
    res.json({ success: true, effectiveness: r.rows, count: r.rowCount });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Revenue Forecast Evaluation ────────────────────────────────────
router.post('/forecast-eval', async (req, res) => {
  try {
    const { forecast_id, period_type, period_start, period_end, predicted_revenue, actual_revenue, predicted_onboardings, actual_onboardings, notes } = req.body;
    if (!period_type || !period_start || !period_end) return res.status(400).json({ success: false, error: 'period_type, period_start, period_end required' });
    const predicted = parseFloat(predicted_revenue || 0);
    const actual = parseFloat(actual_revenue || 0);
    const variance = actual - predicted;
    const mape = predicted > 0 ? Math.abs(variance / predicted) : null;
    const bias = predicted > 0 ? variance / predicted : null;
    const accuracy = predicted > 0 ? Math.max(0, 100 - Math.abs(variance / predicted * 100)) : 0;
    const r = await pool.query(
      'INSERT INTO revenue_forecast_evaluations (forecast_id, period_type, period_start, period_end, predicted_revenue, actual_revenue, predicted_onboardings, actual_onboardings, revenue_variance, revenue_mape, revenue_bias, accuracy_pct, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [forecast_id || null, period_type, period_start, period_end, predicted, actual, predicted_onboardings || 0, actual_onboardings || 0, variance, mape ? Math.round(mape * 10000) / 10000 : null, bias ? Math.round(bias * 10000) / 10000 : null, Math.round(accuracy * 100) / 100, notes || null]
    );
    res.status(201).json({ success: true, evaluation: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/forecast-eval', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM revenue_forecast_evaluations ORDER BY period_start DESC LIMIT $1', [parseInt(req.query.limit) || 30]);
    const avgMape = r.rows.length > 0 ? r.rows.reduce((s, row) => s + parseFloat(row.revenue_mape || 0), 0) / r.rows.length : 0;
    res.json({ success: true, evaluations: r.rows, avg_mape: Math.round(avgMape * 10000) / 10000, count: r.rows.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Copilot Quality ─────────────────────────────────────────────────
router.get('/copilot-quality', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM copilot_quality_snapshots ORDER BY period_start DESC LIMIT $1', [parseInt(req.query.limit) || 30]);
    res.json({ success: true, snapshots: r.rows, count: r.rowCount });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Learning Cycle ──────────────────────────────────────────────────
router.post('/cycle', async (req, res) => {
  try {
    const cycle_type = req.body.cycle_type || 'daily';
    if (!['daily', 'weekly', 'monthly'].includes(cycle_type)) return res.status(400).json({ success: false, error: 'cycle_type must be daily|weekly|monthly' });
    res.status(202).json({ success: true, message: cycle_type + ' cycle started' });
    setImmediate(async () => {
      try { await LearningScheduler.runManual(cycle_type); }
      catch (e) { console.error('[learning.routes] Manual cycle failed:', e.message); }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/cycle', async (req, res) => {
  try {
    const history = await LearningScheduler.getCycleHistory(parseInt(req.query.limit) || 20);
    res.json({ success: true, cycles: history, count: history.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ─── Phase 3: Full Learning Dashboard ────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const [summary, performance, trends, optimizations, history, accuracySummary, calibration, prompts, cycleHistory, forecastEvals, copilotQuality, recommendations] = await Promise.allSettled([
      LearningEngine.getSummary(),
      LearningEvent.getPerformanceHistory(null, 10),
      LearningEvent.getTrends(null, 10),
      LearningEvent.getOptimizations('open', 5),
      LearningEvent.getSnapshotHistory(30),
      PredictionRegistry.getAccuracySummary({ days: 30 }),
      pool.query('SELECT module, confidence_bucket, actual_accuracy, calibration_error, calibration_factor, evaluated_at FROM confidence_calibration ORDER BY evaluated_at DESC LIMIT 60'),
      pool.query('SELECT * FROM prompt_versions WHERE is_active=TRUE ORDER BY module'),
      pool.query('SELECT * FROM learning_cycle_log ORDER BY started_at DESC LIMIT 5'),
      pool.query('SELECT * FROM revenue_forecast_evaluations ORDER BY period_start DESC LIMIT 5'),
      pool.query('SELECT * FROM copilot_quality_snapshots ORDER BY period_start DESC LIMIT 7'),
      pool.query('SELECT module, recommendation_type, COUNT(*) as total, COUNT(*) FILTER (WHERE outcome=$1) as accepted, COUNT(*) FILTER (WHERE outcome=$2) as rejected, COUNT(*) FILTER (WHERE outcome=$3) as ignored FROM recommendation_outcomes GROUP BY module, recommendation_type ORDER BY module LIMIT 20', ['accepted','rejected','ignored'])
    ]);
    const get = (s) => s.status === 'fulfilled' ? s.value : null;
    res.json({
      success: true, retrieved_at: new Date().toISOString(),
      summary: get(summary), performance: get(performance), trends: get(trends),
      optimizations: get(optimizations), snapshot_history: get(history),
      accuracy_by_module: get(accuracySummary),
      calibration: get(calibration)?.rows || [],
      prompt_versions: get(prompts)?.rows || [],
      cycle_history: get(cycleHistory)?.rows || [],
      forecast_evaluations: get(forecastEvals)?.rows || [],
      copilot_quality: get(copilotQuality)?.rows || [],
      recommendation_effectiveness: get(recommendations)?.rows || []
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
