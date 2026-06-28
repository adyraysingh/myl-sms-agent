'use strict';
const express = require('express');
const router = express.Router();
const { runSimulation, validateSimulation, analyzeLearningImprovement } = require('./SimulationEngine');

// State tracking for active simulation
let activeSimulation = null;

// POST /api/simulation/run — start a simulation
router.post('/run', async (req, res) => {
  try {
    if (activeSimulation && activeSimulation.status === 'running') {
      return res.status(409).json({ success: false, error: 'Simulation already running', started_at: activeSimulation.started_at });
    }
    const config = {
      total_leads: Math.min(parseInt(req.body.total_leads || 100), 1000),
      copilot_questions: Math.min(parseInt(req.body.copilot_questions || 25), 250),
      batch_size: Math.min(parseInt(req.body.batch_size || 10), 20),
      delay_ms: parseInt(req.body.delay_ms !== undefined ? req.body.delay_ms : 100)
    };
    activeSimulation = { status: 'running', started_at: new Date().toISOString(), config, stats: null, error: null };
    res.status(202).json({ success: true, message: 'Phase 3.3 simulation started', config, check_status_url: '/api/simulation/status' });
    // Run async
    setImmediate(async () => {
      try {
        activeSimulation.stats = await runSimulation(config);
        activeSimulation.status = 'completed';
        activeSimulation.completed_at = new Date().toISOString();
        console.log('[SimRoutes] Simulation completed. Leads:', activeSimulation.stats.leads_created);
      } catch(e) {
        activeSimulation.status = 'failed';
        activeSimulation.error = e.message;
        console.error('[SimRoutes] Simulation failed:', e.message);
      }
    });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/simulation/status — check running simulation
router.get('/status', (req, res) => {
  if (!activeSimulation) return res.json({ success: true, status: 'idle', message: 'No simulation has been run yet' });
  res.json({ success: true, ...activeSimulation });
});

// GET /api/simulation/validate — run validation checks
router.get('/validate', async (req, res) => {
  try {
    const validation = await validateSimulation();
    res.json({ success: true, validation, validated_at: new Date().toISOString() });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/simulation/learning — analyze AI learning improvement
router.get('/learning', async (req, res) => {
  try {
    const analysis = await analyzeLearningImprovement();
    res.json({ success: true, learning_analysis: analysis, analyzed_at: new Date().toISOString() });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/simulation/report — full Phase 3.3 report
router.get('/report', async (req, res) => {
  try {
    const [validation, learning] = await Promise.all([ validateSimulation(), analyzeLearningImprovement() ]);
    const sim = activeSimulation || {};
    const learningLoopClosed = validation.overall_pass && (validation.outcomes_exist || validation.predictions_exist);
    res.json({
      success: true,
      phase: '3.3',
      report_title: 'Phase 3.3 — Synthetic Business Simulation & AI Learning Validation',
      generated_at: new Date().toISOString(),
      simulation_run: { status: sim.status || 'not_run', config: sim.config || null, stats: sim.stats || null },
      dataset_statistics: sim.stats ? {
        leads_created: sim.stats.leads_created,
        conversations_analyzed: sim.stats.conversations_analyzed,
        qualifications_run: sim.stats.qualifications_run,
        qualifications_passed: sim.stats.qualifications_passed,
        qualification_rate: sim.stats.qualifications_run > 0 ? Math.round(sim.stats.qualifications_passed / sim.stats.qualifications_run * 100) + '%' : '0%',
        decisions_generated: sim.stats.decisions_generated,
        decisions_completed: sim.stats.decisions_completed,
        decisions_dismissed: sim.stats.decisions_dismissed,
        onboardings_completed: sim.stats.onboardings_completed,
        workflows_completed: sim.stats.workflows_completed,
        deals_won: sim.stats.deals_won,
        deals_lost: sim.stats.deals_lost,
        revenue_events: sim.stats.revenue_events,
        copilot_questions_asked: sim.stats.copilot_questions_asked,
        total_predictions: sim.stats.total_predictions || 0,
        errors: sim.stats.errors,
        duration_seconds: sim.stats.duration_seconds
      } : null,
      validation_results: validation,
      learning_improvement: learning,
      production_readiness_score: (() => {
        let score = 70;
        if (validation.predictions_exist) score += 5;
        if (validation.outcomes_exist) score += 5;
        if (validation.linked_correctly) score += 5;
        if (validation.accuracy_recalculated) score += 3;
        if (validation.confidence_updated) score += 3;
        if (validation.forecast_evaluated) score += 3;
        if (validation.dashboard_populated) score += 3;
        if (validation.queue_healthy) score += 3;
        return Math.min(score, 100);
      })(),
      ai_learning_loop_closed: learningLoopClosed
    });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
