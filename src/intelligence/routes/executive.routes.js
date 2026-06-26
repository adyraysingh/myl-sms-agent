'use strict';
const express = require('express');
const router = express.Router();
const ExecutiveBriefing = require('../models/ExecutiveBriefing');
const BusinessInvestigation = require('../models/BusinessInvestigation');
const SalesPerformance = require('../models/SalesPerformance');
const ExecutiveBriefingEngine = require('../services/ExecutiveBriefingEngine');
const BusinessInvestigationEngine = require('../services/BusinessInvestigationEngine');
const IntelligenceProcessor = require('../services/IntelligenceProcessor');
const pool = require('../../memory/db/pool');

// GET /api/executive/summary
// Returns live lead counts from Business Memory + briefing data
router.get('/summary', async (req, res) => {
  try {
    const [morningBriefing, investigations, salesPerf, liveLeadStats, qualStats] = await Promise.allSettled([
      ExecutiveBriefing.findLatest('morning'),
      BusinessInvestigation.findRecent(24),
      SalesPerformance.findLatestAll(),
      // LIVE counts from Business Memory (authoritative source)
      pool.query(
        'SELECT COUNT(*) as total_leads, ' +
        'COUNT(*) FILTER (WHERE is_onboarded = true) as leads_onboarded, ' +
        'COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as new_today ' +
        'FROM lead_memory'
      ),
      // Live qualification breakdown
      pool.query(
        'SELECT category, COUNT(*) as count FROM lead_qualification GROUP BY category'
      )
    ]);

    const briefing = morningBriefing.status === 'fulfilled' ? morningBriefing.value : null;
    const invs = investigations.status === 'fulfilled' ? investigations.value : [];
    const perf = salesPerf.status === 'fulfilled' ? salesPerf.value : [];
    const liveStats = liveLeadStats.status === 'fulfilled' ? liveLeadStats.value.rows[0] : {};
    const qualRows = qualStats.status === 'fulfilled' ? qualStats.value.rows : [];

    // Build qualification map
    const qualMap = {};
    for (const row of qualRows) {
      qualMap[row.category] = parseInt(row.count) || 0;
    }

    // Live counts from Business Memory take precedence over briefing
    const totalLeads = parseInt(liveStats.total_leads) || 0;
    const hotLeads = qualMap['hot'] || 0;
    const warmLeads = qualMap['warm'] || 0;
    const coldLeads = qualMap['cold'] || 0;
    const deadLeads = qualMap['dead'] || 0;
    const newToday = parseInt(liveStats.new_today) || 0;
    const leadsOnboarded = parseInt(liveStats.leads_onboarded) || 0;

    res.json({
      success: true,
      summary: {
        // Health scores from briefing (computed) — null until first briefing generated
        overall_health_score: briefing ? briefing.overall_health_score : null,
        business_health_score: briefing ? briefing.business_health_score : null,
        sales_health_score: briefing ? briefing.sales_health_score : null,
        followup_health_score: briefing ? briefing.followup_health_score : null,
        conversation_health_score: briefing ? briefing.conversation_health_score : null,
        qualification_health_score: briefing ? briefing.qualification_health_score : null,
        decision_execution_health_score: briefing ? briefing.decision_execution_health_score : null,
        // Lead counts — LIVE from Business Memory (authoritative)
        total_leads: totalLeads,
        hot_leads: hotLeads,
        warm_leads: warmLeads,
        cold_leads: coldLeads,
        dead_leads: deadLeads,
        new_leads_today: newToday,
        leads_onboarded_today: leadsOnboarded,
        critical_decisions_pending: briefing ? briefing.critical_decisions_pending : 0,
        active_investigations: invs.length,
        // Pipeline summary
        pipeline_value: totalLeads > 0 ? totalLeads * 50000 : 0,
        business_health: totalLeads > 0 ? 'operational' : 'no_data'
      },
      latest_briefing: briefing,
      recent_investigations: invs.slice(0, 5),
      sales_performance: perf,
      // Expose raw live counts for frontend convenience
      live_lead_counts: {
        total: totalLeads,
        hot: hotLeads,
        warm: warmLeads,
        cold: coldLeads,
        dead: deadLeads,
        new_today: newToday,
        onboarded: leadsOnboarded,
        source: 'business_memory'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/executive/briefing
router.get('/briefing', async (req, res) => {
  try {
    const { type, limit } = req.query;
    const briefings = await ExecutiveBriefing.findAll(parseInt(limit) || 5, type || null);
    res.json({ success: true, briefings, count: briefings.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/executive/investigations
router.get('/investigations', async (req, res) => {
  try {
    const { type, limit } = req.query;
    const investigations = await BusinessInvestigation.findAll(parseInt(limit) || 20, type || null);
    res.json({ success: true, investigations, count: investigations.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/executive/investigate
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

// POST /api/executive/generate-briefing
router.post('/generate-briefing', async (req, res) => {
  try {
    const { briefing_type } = req.body;
    res.status(202).json({ success: true, message: 'Briefing generation started', briefing_type: briefing_type || 'morning' });
    ExecutiveBriefingEngine.generate(briefing_type || 'morning').catch(e =>
      console.error('[executive.routes] Briefing generation failed:', e.message)
    );
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/executive/status
router.get('/status', async (req, res) => {
  try {
    const status = await IntelligenceProcessor.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
