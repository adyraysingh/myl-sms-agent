'use strict';

const express = require('express');
const router = express.Router();
const ConversationAnalysis = require('../models/ConversationAnalysis');
const ConversationProcessor = require('../services/ConversationProcessor');
const { v4: uuidv4 } = require('uuid');

/**
 * Conversation Intelligence API Routes
 * Phase 3 - Conversation Intelligence Engine
 *
 * GET  /api/conversations              - List all conversation analyses
 * GET  /api/conversations/status       - Queue status
 * GET  /api/conversations/:id          - Get analysis by ID
 * GET  /api/conversations/:id/analysis - Get full analysis for a conversation
 * GET  /api/leads/:id/conversations    - All analyses for a lead
 * POST /api/conversations/analyze      - Submit a new conversation for analysis
 * POST /api/conversations/reanalyze    - Re-trigger analysis for existing record
 */

// ============================================================
// GET /api/conversations
// List recent conversation analyses
// ============================================================
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const [analyses, total] = await Promise.all([
      ConversationAnalysis.list(limit, offset),
      ConversationAnalysis.count()
    ]);

    res.json({
      success: true,
      conversations: analyses,
      count: analyses.length,
      total,
      limit,
      offset
    });
  } catch (err) {
    console.error('[conversation.routes] GET / error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/conversations/status
// Queue and processor status
// ============================================================
router.get('/status', (req, res) => {
  res.json({
    success: true,
    queue: ConversationProcessor.status()
  });
});

// ============================================================
// GET /api/conversations/:id
// Get a specific conversation analysis
// ============================================================
router.get('/:id', async (req, res) => {
  try {
    const analysis = await ConversationAnalysis.findById(req.params.id);
    if (!analysis) {
      return res.status(404).json({ success: false, error: 'Analysis not found' });
    }
    res.json({ success: true, conversation: analysis });
  } catch (err) {
    console.error('[conversation.routes] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// GET /api/conversations/:id/analysis
// Get full analysis for a conversation_id
// ============================================================
router.get('/:id/analysis', async (req, res) => {
  try {
    const analyses = await ConversationAnalysis.findByConversationId(req.params.id);
    res.json({
      success: true,
      conversation_id: req.params.id,
      analyses,
      count: analyses.length
    });
  } catch (err) {
    console.error('[conversation.routes] GET /:id/analysis error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/conversations/analyze
// Submit a conversation for AI analysis
// ============================================================
router.post('/analyze', async (req, res) => {
  try {
    const {
      conversation_id,
      lead_id,
      zoho_lead_id,
      source_type,
      source_ref,
      transcript,
      lead_info
    } = req.body;

    // Validation
    if (!transcript) {
      return res.status(400).json({ success: false, error: 'transcript is required' });
    }
    if (!source_type || !['salesiq', 'retell', 'email', 'crm_note'].includes(source_type)) {
      return res.status(400).json({ success: false, error: 'source_type must be: salesiq | retell | email | crm_note' });
    }
    if (!lead_id) {
      return res.status(400).json({ success: false, error: 'lead_id is required' });
    }

    const conversationId = conversation_id || uuidv4();

    // Submit for async processing - returns immediately
    const analysisId = await ConversationProcessor.submit({
      conversationId,
      leadId: lead_id,
      zohoLeadId: zoho_lead_id || null,
      sourceType: source_type,
      sourceRef: source_ref || null,
      transcript,
      leadInfo: lead_info || {}
    });

    console.log(`[conversation.routes] Submitted for analysis: ${analysisId}`);

    res.status(202).json({
      success: true,
      message: 'Conversation submitted for analysis',
      analysis_id: analysisId,
      conversation_id: conversationId,
      status: 'pending',
      check_url: `/api/conversations/${analysisId}`
    });
  } catch (err) {
    console.error('[conversation.routes] POST /analyze error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// POST /api/conversations/reanalyze
// Re-trigger AI analysis on an existing record
// ============================================================
router.post('/reanalyze', async (req, res) => {
  try {
    const { analysis_id, transcript, lead_info, zoho_lead_id } = req.body;

    if (!analysis_id) {
      return res.status(400).json({ success: false, error: 'analysis_id is required' });
    }
    if (!transcript) {
      return res.status(400).json({ success: false, error: 'transcript is required for reanalysis' });
    }

    const id = await ConversationProcessor.reanalyze({
      analysisId: analysis_id,
      transcript,
      leadInfo: lead_info || {},
      zohoLeadId: zoho_lead_id || null
    });

    res.status(202).json({
      success: true,
      message: 'Reanalysis queued',
      analysis_id: id,
      status: 'pending'
    });
  } catch (err) {
    console.error('[conversation.routes] POST /reanalyze error:', err.message);
    res.status(err.message === 'Analysis record not found' ? 404 : 500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
