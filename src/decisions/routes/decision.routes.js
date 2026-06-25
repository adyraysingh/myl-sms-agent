'use strict';

const express = require('express');
const router = express.Router();
const AIDecision = require('../models/AIDecision');
const DecisionHistory = require('../models/DecisionHistory');
const DecisionProcessor = require('../services/DecisionProcessor');

// GET /api/decisions
// List all decisions (paginated)
router.get('/', async (req, res) => {
  try {
    const { status, priority, lead_id, limit = 50, offset = 0 } = req.query;
    const decisions = await AIDecision.list({ status, priority, lead_id, limit: parseInt(limit), offset: parseInt(offset) });
    res.json({ success: true, decisions, count: decisions.length });
  } catch (err) {
    console.error('[DecisionRoutes] GET /decisions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/decisions/status
// Get queue and processor status
router.get('/status', async (req, res) => {
  try {
    const queueStats = await AIDecision.getQueueStats();
    const processorStatus = DecisionProcessor.getQueueStatus();
    res.json({ success: true, queue: queueStats, processor: processorStatus });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/decisions/summary
// Get summary stats grouped by status and priority
router.get('/summary', async (req, res) => {
  try {
    const summary = await AIDecision.getSummary();
    const statuses = ['created','pending','acknowledged','executing','completed','dismissed','expired'];
    const priorities = ['critical','high','medium','low'];
    res.json({ success: true, summary, statuses, priorities });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/decisions/:id
// Get a specific decision with its history
router.get('/:id', async (req, res) => {
  try {
    const decision = await AIDecision.findById(req.params.id);
    if (!decision) return res.status(404).json({ success: false, error: 'Decision not found' });
    const history = await DecisionHistory.getByDecisionId(req.params.id);
    res.json({ success: true, decision, history });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/decisions/generate
// Manually trigger decision generation for a lead
router.post('/generate', async (req, res) => {
  try {
    const { lead_id, trigger_event, trigger_source } = req.body;
    if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id is required' });
    const queueItem = await DecisionProcessor.queueDecisionGeneration(
      lead_id,
      trigger_event || 'manual_trigger',
      trigger_source || 'api'
    );
    res.status(202).json({
      success: true,
      message: 'Decision generation queued',
      queue_id: queueItem ? queueItem.queue_id : null,
      lead_id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/decisions/:id/acknowledge
// Acknowledge a decision
router.post('/:id/acknowledge', async (req, res) => {
  try {
    const { changed_by } = req.body;
    const updated = await DecisionProcessor.updateDecisionStatus(req.params.id, 'acknowledged', {
      reason: 'Acknowledged by user',
      changed_by: changed_by || 'user'
    });
    res.json({ success: true, decision: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/decisions/:id/complete
// Mark a decision as completed
router.post('/:id/complete', async (req, res) => {
  try {
    const { execution_result, changed_by } = req.body;
    const updated = await DecisionProcessor.updateDecisionStatus(req.params.id, 'completed', {
      reason: 'Decision executed',
      execution_result: execution_result || 'Completed',
      changed_by: changed_by || 'user'
    });
    res.json({ success: true, decision: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/decisions/:id/dismiss
// Dismiss a decision
router.post('/:id/dismiss', async (req, res) => {
  try {
    const { dismissed_reason, changed_by } = req.body;
    const updated = await DecisionProcessor.updateDecisionStatus(req.params.id, 'dismissed', {
      reason: 'Dismissed by user',
      dismissed_reason: dismissed_reason || 'Not applicable',
      changed_by: changed_by || 'user'
    });
    res.json({ success: true, decision: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
