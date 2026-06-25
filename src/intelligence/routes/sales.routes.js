'use strict';
const express = require('express');
const router = express.Router();
const SalesPerformance = require('../models/SalesPerformance');
const SalesCoachingEngine = require('../services/SalesCoachingEngine');
const SalesPerformanceEngine = require('../services/SalesPerformanceEngine');
const IntelligenceProcessor = require('../services/IntelligenceProcessor');
const pool = require('../../memory/db/pool');

// GET /api/sales/performance - all or specific owner
router.get('/performance', async (req, res) => {
  try {
    const { owner_id, date, limit } = req.query;
    let data;
    if (owner_id) {
      data = await SalesPerformance.findByOwner(owner_id, parseInt(limit) || 30);
    } else if (date) {
      data = await SalesPerformance.findByDate(date);
    } else {
      data = await SalesPerformance.findLatestAll();
    }
    res.json({ success: true, performance: data, count: data.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/coaching - coaching suggestions
router.get('/coaching', async (req, res) => {
  try {
    const { owner_id, limit } = req.query;
    const coaching = await SalesCoachingEngine.getActiveCoaching(owner_id || null, parseInt(limit) || 20);
    res.json({ success: true, coaching, count: coaching.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/trends - metric trends over time
router.get('/trends', async (req, res) => {
  try {
    const { owner_id, days } = req.query;
    const d = parseInt(days) || 14;
    let data;
    if (owner_id) {
      data = await SalesPerformance.getTrend(owner_id, d);
    } else {
      const result = await pool.query(
        'SELECT * FROM sales_performance WHERE period_type = $1 AND period_date >= CURRENT_DATE - $2 ORDER BY period_date DESC, owner_id',
        ['daily', d]
      );
      data = result.rows;
    }
    res.json({ success: true, trends: data, count: data.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/top-performers - today's top performers
router.get('/top-performers', async (req, res) => {
  try {
    const { date, limit } = req.query;
    const d = date || new Date().toISOString().split('T')[0];
    const performers = await SalesPerformance.getTopPerformers(d, parseInt(limit) || 5);
    res.json({ success: true, top_performers: performers, count: performers.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/sales/needs-attention
router.get('/needs-attention', async (req, res) => {
  try {
    const { date } = req.query;
    const d = date || new Date().toISOString().split('T')[0];
    const attention = await SalesPerformance.getNeedsAttention(d);
    res.json({ success: true, needs_attention: attention, count: attention.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sales/recalculate - trigger recalculation
router.post('/recalculate', async (req, res) => {
  try {
    const { date } = req.body;
    res.status(202).json({ success: true, message: 'Performance recalculation started', date: date || 'today' });
    setImmediate(async () => {
      await SalesPerformanceEngine.recalculateAll(date || null).catch(e =>
        console.error('[sales.routes] Recalculate error:', e.message)
      );
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sales/coaching/:id/resolve
router.post('/coaching/:coaching_id/resolve', async (req, res) => {
  try {
    const { coaching_id } = req.params;
    const result = await SalesCoachingEngine.resolveCoaching(coaching_id);
    if (!result) return res.status(404).json({ success: false, error: 'Coaching suggestion not found' });
    res.json({ success: true, coaching: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
