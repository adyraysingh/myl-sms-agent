'use strict';
const express = require('express');
const router = express.Router();
const ExecutiveBriefing = require('../models/ExecutiveBriefing');
const BusinessInvestigation = require('../models/BusinessInvestigation');
const SalesPerformance = require('../models/SalesPerformance');
const ExecutiveBriefingEngine = require('../services/ExecutiveBriefingEngine');
const BusinessInvestigationEngine = require('../services/BusinessInvestigationEngine');
const IntelligenceProcessor = require('../services/IntelligenceProcessor');

router.get('/summary', async (req, res) => {
  try {
    const [morningBriefing, investigations, salesPerf] = await Promise.allSettled([
      ExecutiveBriefing.findLatest('morning'),
      BusinessInvestigation.findRecent(24),
      SalesPerformance.findLatestAll()
    ]);
    const briefing = morningBriefing.status === 'fulfilled' ? morningBriefing.value : null;
    const invs = investigations.status === 'fulfilled' ? investigations.value : [];
    const perf = salesPerf.status === 'fulfilled' ? salesPerf.value : [];
    res.json({
      success: true,
      summary: {
        overall_health_score: briefing ? briefing.overall_health_score : null,
        business_health_score: briefing ? briefing.business_health_score : null,
        sales_health_score: briefing ? briefing.sales_health_score : null,
        followup_health_score: briefing ? briefing.followup_health_score : null,
        conversation_health_score: briefing ? briefing.conversation_health_score : null,
        qualification_health_score: briefing ? briefing.qualification_health_score : null,
        decision_execution_health_score: briefing ? briefing.decision_execution_health_score : null,
        total_leads: briefing ? briefing.total_leads : 0,
        hot_leads: briefing ? briefing.hot_leads : 0,
        warm_leads: briefing ? briefing.warm_leads : 0,
        leads_onboarded_today: briefing ? briefing.leads_onboarded_period : 0,
        critical_decisions_pending: briefing ? briefing.critical_decisions_pending : 0,
        active_investigations: invs.length
      },
      latest_briefing: briefing,
      recent_investigations: invs.slice(0, 5),
      sales_performance: perf
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/briefing', async (req, res) => {
  try {
    const { type, limit } = req.query;
    const briefings = await ExecutiveBriefing.findAll(parseInt(limit) || 5, type || null);
    res.json({ success: true, briefings, count: briefings.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/investigations', async (req, res) => {
  try {
    const { type, limit } = req.query;
    const investigations = await BusinessInvestigation.findAll(parseInt(limit) || 20, type || null);
    res.json({ success: true, investigations, count: investigations.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/investigate', async (req, res) => {
  try {
    const { question, investigation_type } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });
    res.status(202).json({ success: true, message: 'Investigation started', question });
    BusinessInvestigationEngine.investigate(question, 'manual_api', investigation_type).catch(e =>
      console.error('[executive.routes] Investigation failed:', e.message)
    );
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const status = await IntelligenceProcessor.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
