'use strict';

const express = require('express');
const router = express.Router();
const LeadQualification = require('../models/LeadQualification');
const QualificationHistory = require('../models/QualificationHistory');
const QualificationProcessor = require('../services/QualificationProcessor');

/**
 * Qualification API Routes
 * Phase 4 - Onboarding Qualification Engine
 *
 * GET  /api/qualification               - List all qualifications
 * GET  /api/qualification/status        - Queue status
 * GET  /api/qualification/summary       - Category breakdown
 * GET  /api/qualification/:leadId       - Get qualification for a lead
 * GET  /api/qualification/history/:leadId - Qualification history for a lead
 * POST /api/qualification/recalculate   - Trigger recalculation for a lead
 * POST /api/qualification/bulk-recalculate - Trigger bulk recalculation
 */

// ============================================================
// GET /api/qualification
// List all lead qualifications (sorted by score desc)
// ============================================================
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const category = req.query.category || null;

    const [qualifications, total] = await Promise.all([
      LeadQualification.list(limit, offset, category),
      LeadQualification.count(category)
    ]);

    res.json({
      success: true,
      qualifications,
      count: qualifications.length,
      total,
      limit,
      offset,
      filter: { category }
    });
  } catch (err) {
    console.error('[qualification.routes] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/qualification/status
// Processor queue status
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    success: true,
    queue: QualificationProcessor.status()
  });
});

// ============================================================
// GET /api/qualification/summary
// Category breakdown and averages
// ============================================================
router.get('/summary', async (req, res) => {
  try {
    const summary = await LeadQualification.getCategoryCounts();
    res.json({
      success: true,
      summary,
      categories: ['hot', 'warm', 'cold', 'dead', 'unqualified', 'onboarded']
    });
  } catch (err) {
    console.error('[qualification.routes] GET /summary error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/qualification/:leadId
// Get current qualification for a specific lead
// ============================================================
router.get('/:leadId', async (req, res) => {
  try {
    const qual = await LeadQualification.findByLeadId(req.params.leadId);
    if (!qual) {
      return res.status(404).json({
        success: false,
        error: 'No qualification found for this lead',
        lead_id: req.params.leadId
      });
    }
    res.json({ success: true, qualification: qual });
  } catch (err) {
    console.error('[qualification.routes] GET /:leadId error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/qualification/history/:leadId
// Full qualification history timeline for a lead
// ============================================================
router.get('/history/:leadId', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [history, total] = await Promise.all([
      QualificationHistory.getByLeadId(req.params.leadId, limit),
      QualificationHistory.countForLead(req.params.leadId)
    ]);

    res.json({
      success: true,
      lead_id: req.params.leadId,
      history,
      count: history.length,
      total
    });
  } catch (err) {
    console.error('[qualification.routes] GET /history/:leadId error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/qualification/recalculate
// Trigger qualification recalculation for a lead
// ============================================================
router.post('/recalculate', async (req, res) => {
  try {
    const { lead_id, zoho_lead_id, trigger_event, trigger_ref } = req.body;

    if (!lead_id) {
      return res.status(400).json({ success: false, error: 'lead_id is required' });
    }

    await QualificationProcessor.submit({
      leadId: lead_id,
      zohoLeadId: zoho_lead_id || null,
      triggerEvent: trigger_event || 'manual',
      triggerRef: trigger_ref || null
    });

    res.status(202).json({
      success: true,
      message: 'Qualification recalculation queued',
      lead_id,
      trigger_event: trigger_event || 'manual',
      check_url: `/api/qualification/${lead_id}`
    });
  } catch (err) {
    console.error('[qualification.routes] POST /recalculate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/qualification/bulk-recalculate
// Trigger recalculation for multiple leads
// ============================================================
router.post('/bulk-recalculate', async (req, res) => {
  try {
    const { lead_ids, trigger_event } = req.body;

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'lead_ids array is required' });
    }
    if (lead_ids.length > 50) {
      return res.status(400).json({ success: false, error: 'Maximum 50 leads per bulk request' });
    }

    const queued = [];
    for (const leadId of lead_ids) {
      await QualificationProcessor.submit({
        leadId,
        triggerEvent: trigger_event || 'bulk_recalculate',
        triggerRef: null
      });
      queued.push(leadId);
    }

    res.status(202).json({
      success: true,
      message: 'Bulk recalculation queued',
      queued_count: queued.length,
      lead_ids: queued
    });
  } catch (err) {
    console.error('[qualification.routes] POST /bulk-recalculate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
