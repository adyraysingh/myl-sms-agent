'use strict';
const express = require('express');
const router = express.Router();
const LearningEvent = require('../models/LearningEvent');
const LearningEngine = require('../services/LearningEngine');
const AccuracyEvaluator = require('../services/AccuracyEvaluator');
const pool = require('../../memory/db/pool');
const path = require('path');
const fs = require('fs');

// POST /api/learning/migrate — run Phase 9 migration
router.post('/migrate', async (req, res) => {
  try {
    const sqlPath = path.join(__dirname, '../db/migrations/008_continuous_learning.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    res.json({ success: true, message: 'Phase 9 migration completed successfully' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/learning/summary — overall AI accuracy dashboard
router.get('/summary', async (req, res) => {
  try {
    const summary = await LearningEngine.getSummary();
    res.json({ success: true, summary });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/learning/performance — model performance history
router.get('/performance', async (req, res) => {
  try {
    const { model_name, limit } = req.query;
    const performance = await LearningEvent.getPerformanceHistory(model_name, parseInt(limit) || 30);
    // Also get module-level accuracy
    const moduleAccuracy = await LearningEvent.getModuleAccuracy(null, 30);
    res.json({ success: true, performance, module_accuracy: moduleAccuracy, count: performance.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/learning/trends — discovered business patterns
router.get('/trends', async (req, res) => {
  try {
    const { category, limit } = req.query;
    const trends = await LearningEvent.getTrends(category, parseInt(limit) || 30);
    res.json({ success: true, trends, count: trends.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/learning/optimizations — optimization suggestions
router.get('/optimizations', async (req, res) => {
  try {
    const { status, limit } = req.query;
    const optimizations = await LearningEvent.getOptimizations(status || 'open', parseInt(limit) || 50);
    res.json({ success: true, optimizations, count: optimizations.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/learning/history — snapshot history over time
router.get('/history', async (req, res) => {
  try {
    const { limit } = req.query;
    const history = await LearningEvent.getSnapshotHistory(parseInt(limit) || 30);
    // Also include learning event counts per module
    const moduleCounts = await LearningEvent.countByModule();
    res.json({ success: true, history, module_counts: moduleCounts, count: history.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/learning/evaluate — trigger a full evaluation cycle (async)
router.post('/evaluate', async (req, res) => {
  try {
    res.status(202).json({ success: true, message: 'Full learning evaluation started', status: 'processing' });
    setImmediate(async () => {
      try {
        const result = await LearningEngine.runFullEvaluation();
        console.log('[learning.routes] Evaluation completed:', result.processing_time_ms, 'ms,', result.trends_discovered, 'trends,', result.optimizations_generated, 'optimizations');
      } catch (e) { console.error('[learning.routes] Evaluation failed:', e.message); }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/learning/recalculate — recalculate a specific module accuracy (sync, returns result)
router.post('/recalculate', async (req, res) => {
  try {
    const { module } = req.body;
    let result;
    if (!module || module === 'all') {
      result = await AccuracyEvaluator.runAll();
    } else if (module === 'qualification') {
      result = await AccuracyEvaluator.evaluateQualification();
    } else if (module === 'decisions') {
      result = await AccuracyEvaluator.evaluateDecisions();
    } else if (module === 'investigations') {
      result = await AccuracyEvaluator.evaluateInvestigations();
    } else if (module === 'conversations') {
      result = await AccuracyEvaluator.evaluateConversations();
    } else if (module === 'coaching') {
      result = await AccuracyEvaluator.evaluateSalesCoaching();
    } else {
      return res.status(400).json({ success: false, error: 'Unknown module. Use: all, qualification, decisions, investigations, conversations, coaching' });
    }
    res.json({ success: true, module: module || 'all', result, evaluated_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
