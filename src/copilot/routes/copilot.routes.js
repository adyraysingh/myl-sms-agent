'use strict';
const express = require('express');
const router = express.Router();
const CopilotSession = require('../models/CopilotSession');
const ExecutiveCopilot = require('../services/ExecutiveCopilot');
const pool = require('../../memory/db/pool');
const path = require('path');
const fs = require('fs');

// POST /api/copilot/migrate — run Phase 8 DB migration
router.post('/migrate', async (req, res) => {
  try {
    const sqlPath = path.join(__dirname, '../db/migrations/007_ceo_copilot.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    res.json({ success: true, message: 'Phase 8 migration completed successfully' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/copilot/suggestions — suggested questions for dashboard
router.get('/suggestions', async (req, res) => {
  try {
    const suggestions = ExecutiveCopilot.getSuggestedQuestions();
    res.json({ success: true, suggestions, count: suggestions.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/copilot/history — recent chat sessions for a user
router.get('/history', async (req, res) => {
  try {
    const user_id = req.query.user_id || 'ceo';
    const limit = parseInt(req.query.limit) || 20;
    const history = await CopilotSession.getRecentHistory(user_id, limit);
    res.json({ success: true, history, count: history.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/copilot/context — get session context and messages
router.get('/context', async (req, res) => {
  try {
    const { session_id, user_id } = req.query;
    if (!session_id) return res.status(400).json({ success: false, error: 'session_id required' });
    const session = await CopilotSession.getSession(session_id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const messages = await CopilotSession.getMessages(session_id);
    res.json({ success: true, session, messages, count: messages.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/copilot/chat — full chat (creates/continues session)
router.post('/chat', async (req, res) => {
  try {
    const { question, session_id, user_id, user_role } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });

    const uid = user_id || 'ceo';
    const role = user_role || 'ceo';

    // Get or create session
    let session;
    if (session_id) {
      session = await CopilotSession.getSession(session_id);
    }
    if (!session) {
      session = await CopilotSession.createSession({ user_id: uid, user_role: role, title: question.substring(0, 80) });
    }

    // Load conversation history for context
    const conversationHistory = await CopilotSession.getMessages(session.session_id, 20);

    // Save user message
    await CopilotSession.addMessage({ session_id: session.session_id, role: 'user', content: question });

    // Generate AI response
    const result = await ExecutiveCopilot.answer({ question, session_id: session.session_id, user_id: uid, user_role: role, conversationHistory });

    // Save assistant message
    const assistantMsg = await CopilotSession.addMessage({
      session_id: session.session_id,
      role: 'assistant',
      content: result.executive_summary,
      intent: result.intent,
      modules_queried: result.modules_queried,
      evidence_sources: result.evidence_sources,
      confidence: result.confidence,
      response_time_ms: result.response_time_ms,
      citations: result.citations,
      suggested_actions: result.recommended_actions,
      related_leads: result.related_leads,
      related_investigations: result.related_investigations,
      related_decisions: result.related_decisions,
      model_version: result.model_version
    });

    res.json({
      success: true,
      session_id: session.session_id,
      message_id: assistantMsg.message_id,
      intent: result.intent,
      executive_summary: result.executive_summary,
      evidence: result.evidence,
      reasoning: result.reasoning,
      confidence: result.confidence,
      recommended_actions: result.recommended_actions,
      related_leads: result.related_leads,
      related_investigations: result.related_investigations,
      related_decisions: result.related_decisions,
      citations: result.citations,
      modules_queried: result.modules_queried,
      response_time_ms: result.response_time_ms
    });

  } catch (err) {
    console.error('[copilot.routes] chat error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/copilot/question — stateless single question (no session)
router.post('/question', async (req, res) => {
  try {
    const { question, user_id, user_role } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });
    const result = await ExecutiveCopilot.answer({
      question,
      session_id: null,
      user_id: user_id || 'ceo',
      user_role: user_role || 'ceo',
      conversationHistory: []
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[copilot.routes] question error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/copilot/feedback — thumbs up/down on a response
router.post('/feedback', async (req, res) => {
  try {
    const { message_id, session_id, user_id, rating, helpful, comment } = req.body;
    if (!message_id || !session_id) return res.status(400).json({ success: false, error: 'message_id and session_id required' });
    const feedback = await CopilotSession.addFeedback({ message_id, session_id, user_id: user_id||'ceo', rating, helpful, comment });
    res.json({ success: true, feedback });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
