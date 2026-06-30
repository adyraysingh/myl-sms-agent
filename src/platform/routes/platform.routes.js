'use strict';
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../../memory/db/pool');

const PlatformModel = require('../models/PlatformModel');
const PlatformMonitor = require('../services/PlatformMonitor');

// ── Migration ─────────────────────────────────────────────────────────────────

router.post('/migrate', async function(req, res) {
try {
var migPath = path.join(__dirname, '../db/migrations/011_platform_operations.sql');
var sql = fs.readFileSync(migPath, 'utf8');
await pool.query(sql);
res.json({ success: true, message: 'Phase 12 Platform Operations migration complete', timestamp: new Date().toISOString() });
} catch (err) {
console.error('[Platform] Migration error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/health ──────────────────────────────────────────────────

router.get('/health', async function(req, res) {
try {
var result = await PlatformMonitor.runFullHealthCheck();
var alerts = await PlatformMonitor.generateSystemAlerts();
res.json({ success: true, health: result, alerts: alerts, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /health error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/modules ─────────────────────────────────────────────────

router.get('/modules', async function(req, res) {
try {
var latest = await PlatformModel.getModuleHealthLatest();
var summary = {
total: latest.length,
healthy: latest.filter(function(m) { return m.status === 'healthy'; }).length,
degraded: latest.filter(function(m) { return m.status === 'degraded'; }).length,
unhealthy: latest.filter(function(m) { return m.status === 'unhealthy'; }).length
};
res.json({ success: true, modules: latest, summary: summary, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /modules error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/queues ──────────────────────────────────────────────────

router.get('/queues', async function(req, res) {
try {
var queues = await PlatformModel.getAllQueues();
var summary = {
total: queues.length,
running: queues.filter(function(q) { return q.status === 'running'; }).length,
paused: queues.filter(function(q) { return q.status === 'paused'; }).length,
total_pending: queues.reduce(function(s, q) { return s + (parseInt(q.pending_jobs) || 0); }, 0),
total_failed: queues.reduce(function(s, q) { return s + (parseInt(q.failed_jobs) || 0); }, 0)
};
res.json({ success: true, queues: queues, summary: summary, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /queues error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/integrations ───────────────────────────────────────────

router.get('/integrations', async function(req, res) {
try {
var integrations = await PlatformModel.getAllIntegrations();
var summary = {
total: integrations.length,
healthy: integrations.filter(function(i) { return i.status === 'healthy'; }).length,
degraded: integrations.filter(function(i) { return i.status === 'degraded'; }).length,
unhealthy: integrations.filter(function(i) { return i.status === 'unhealthy'; }).length
};
res.json({ success: true, integrations: integrations, summary: summary, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /integrations error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/models ──────────────────────────────────────────────────

router.get('/models', async function(req, res) {
try {
var models = await PlatformModel.getAllModels();
res.json({ success: true, models: models, count: models.length, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /models error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/prompts ─────────────────────────────────────────────────

router.get('/prompts', async function(req, res) {
try {
var prompts = await PlatformModel.getAllPrompts();
var active = prompts.filter(function(p) { return p.status === 'active'; });
res.json({ success: true, prompts: prompts, active_count: active.length, total_count: prompts.length, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /prompts error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/costs ───────────────────────────────────────────────────

router.get('/costs', async function(req, res) {
try {
var summary = await PlatformModel.getCostSummary();
var byModule = await PlatformModel.getCostByModule();
var trend = await PlatformModel.getCostTrend(30);
res.json({
success: true,
summary: summary,
by_module: byModule,
trend_30_days: trend,
retrieved_at: new Date().toISOString()
});
} catch (err) {
console.error('[Platform] GET /costs error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/errors ──────────────────────────────────────────────────

router.get('/errors', async function(req, res) {
try {
var errors = await PlatformModel.listErrors({
module_name: req.query.module_name,
severity: req.query.severity,
resolution_status: req.query.resolution_status,
limit: parseInt(req.query.limit || '50'),
offset: parseInt(req.query.offset || '0')
});
var errorSummary = await PlatformModel.getErrorSummary();
res.json({
success: true,
errors: errors,
summary: errorSummary,
count: errors.length,
retrieved_at: new Date().toISOString()
});
} catch (err) {
console.error('[Platform] GET /errors error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/config ──────────────────────────────────────────────────

router.get('/config', async function(req, res) {
try {
var configs = await PlatformModel.getConfig(req.query.key || null);
res.json({ success: true, config: configs, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /config error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/audit ───────────────────────────────────────────────────

router.get('/audit', async function(req, res) {
try {
var audit = await PlatformModel.listAudit({
module_affected: req.query.module,
limit: parseInt(req.query.limit || '100'),
offset: parseInt(req.query.offset || '0')
});
res.json({ success: true, audit: audit, count: audit.length, retrieved_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] GET /audit error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── POST /api/platform/config ─────────────────────────────────────────────────

router.post('/config', async function(req, res) {
try {
var key = req.body.key;
var value = req.body.value;
var performed_by = req.body.performed_by || 'admin';

if (!key || value === undefined) {
return res.status(400).json({ success: false, error: 'key and value are required' });
}

var before = await PlatformModel.getConfig(key);
var updated = await PlatformModel.setConfig(key, value, performed_by);

await PlatformModel.logAudit({
action: 'CONFIG_CHANGED',
performed_by: performed_by,
role: 'admin',
module_affected: 'platform_config',
before_state: before ? { key: key, value: before.config_value } : {},
after_state: { key: key, value: value },
details: 'Configuration key updated: ' + key
});

res.json({ success: true, config: updated, updated_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] POST /config error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── POST /api/platform/retry ──────────────────────────────────────────────────

router.post('/retry', async function(req, res) {
try {
var error_id = req.body.error_id;
var performed_by = req.body.performed_by || 'admin';

if (!error_id) return res.status(400).json({ success: false, error: 'error_id is required' });

var resolved = await PlatformModel.resolveError(error_id, performed_by);

await PlatformModel.logAudit({
action: 'MANUAL_RETRY',
performed_by: performed_by,
role: 'admin',
module_affected: resolved ? resolved.module_name : 'unknown',
after_state: { error_id: error_id, status: 'resolved' },
details: 'Manual retry triggered for error: ' + error_id
});

res.json({ success: true, error: resolved, retried_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] POST /retry error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── POST /api/platform/pause ──────────────────────────────────────────────────

router.post('/pause', async function(req, res) {
try {
var queue_name = req.body.queue_name;
var performed_by = req.body.performed_by || 'admin';

if (!queue_name) return res.status(400).json({ success: false, error: 'queue_name is required' });

var updated = await PlatformModel.updateQueueStatus(queue_name, 'paused');

await PlatformModel.logAudit({
action: 'QUEUE_PAUSED',
performed_by: performed_by,
role: 'admin',
module_affected: queue_name,
before_state: { status: 'running' },
after_state: { status: 'paused' },
details: 'Queue paused: ' + queue_name
});

res.json({ success: true, queue: updated, paused_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] POST /pause error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── POST /api/platform/resume ─────────────────────────────────────────────────

router.post('/resume', async function(req, res) {
try {
var queue_name = req.body.queue_name;
var performed_by = req.body.performed_by || 'admin';

if (!queue_name) return res.status(400).json({ success: false, error: 'queue_name is required' });

var updated = await PlatformModel.updateQueueStatus(queue_name, 'running');

await PlatformModel.logAudit({
action: 'QUEUE_RESUMED',
performed_by: performed_by,
role: 'admin',
module_affected: queue_name,
before_state: { status: 'paused' },
after_state: { status: 'running' },
details: 'Queue resumed: ' + queue_name
});

res.json({ success: true, queue: updated, resumed_at: new Date().toISOString() });
} catch (err) {
console.error('[Platform] POST /resume error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── POST /api/platform/health-check ──────────────────────────────────────────

router.post('/health-check', async function(req, res) {
try {
var performed_by = req.body.performed_by || 'admin';

res.status(202).json({
success: true,
message: 'Full platform health check started',
started_at: new Date().toISOString()
});

setImmediate(async function() {
try {
var result = await PlatformMonitor.runFullHealthCheck();
await PlatformModel.logAudit({
action: 'HEALTH_CHECK_RUN',
performed_by: performed_by,
role: 'admin',
module_affected: 'all',
after_state: { overall_status: result.overall_status, modules_checked: result.modules_checked },
details: 'Manual full health check completed. Status: ' + result.overall_status
});
console.log('[Platform] Health check complete:', result.overall_status);
} catch (err) {
console.error('[Platform] Health check error:', err.message);
}
});
} catch (err) {
console.error('[Platform] POST /health-check error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/dashboard ───────────────────────────────────────────────

router.get('/dashboard', async function(req, res) {
try {
var [modules, queues, integrations, models, prompts, costs, errors, audit, perf, backup] = await Promise.all([
PlatformModel.getModuleHealthLatest().catch(function() { return []; }),
PlatformModel.getAllQueues().catch(function() { return []; }),
PlatformModel.getAllIntegrations().catch(function() { return []; }),
PlatformModel.getAllModels().catch(function() { return []; }),
PlatformModel.getAllPrompts().catch(function() { return []; }),
PlatformModel.getCostSummary().catch(function() { return {}; }),
PlatformModel.listErrors({ resolution_status: 'open', limit: 10 }).catch(function() { return []; }),
PlatformModel.listAudit({ limit: 10 }).catch(function() { return []; }),
PlatformModel.getLatestPerformance().catch(function() { return null; }),
PlatformModel.getLatestBackupStatus().catch(function() { return null; })
]);

var alerts = await PlatformMonitor.generateSystemAlerts().catch(function() { return []; });

var overallHealth = modules.every(function(m) { return m.status === 'healthy'; }) &&
integrations.every(function(i) { return i.status !== 'unhealthy'; }) ? 'healthy' : 'degraded';

res.json({
success: true,
dashboard: {
overall_health: overallHealth,
module_summary: {
total: modules.length,
healthy: modules.filter(function(m) { return m.status === 'healthy'; }).length,
degraded: modules.filter(function(m) { return m.status === 'degraded'; }).length,
unhealthy: modules.filter(function(m) { return m.status === 'unhealthy'; }).length
},
modules: modules,
queue_summary: {
total: queues.length,
running: queues.filter(function(q) { return q.status === 'running'; }).length,
paused: queues.filter(function(q) { return q.status === 'paused'; }).length
},
queues: queues,
integration_summary: {
total: integrations.length,
healthy: integrations.filter(function(i) { return i.status === 'healthy'; }).length
},
integrations: integrations,
active_models: models.filter(function(m) { return m.status === 'active'; }),
active_prompts: prompts.filter(function(p) { return p.status === 'active'; }).length,
cost_today: costs.today_cost || 0,
cost_this_week: costs.week_cost || 0,
open_errors: errors.length,
alerts: alerts,
recent_audit: audit,
performance: perf,
backup_status: backup
},
retrieved_at: new Date().toISOString()
});
} catch (err) {
console.error('[Platform] GET /dashboard error:', err.message);
res.status(500).json({ success: false, error: err.message });
}
});

// ── POST /api/platform/log-error ──────────────────────────────────────────────

router.post('/log-error', async function(req, res) {
try {
var err = await PlatformModel.logError(req.body);
res.json({ success: true, error_record: err });
} catch (e) {
res.status(500).json({ success: false, error: e.message });
}
});

// ── POST /api/platform/log-cost ───────────────────────────────────────────────

router.post('/log-cost', async function(req, res) {
try {
var cost = await PlatformModel.logCostEvent(req.body);
res.json({ success: true, cost_record: cost });
} catch (e) {
res.status(500).json({ success: false, error: e.message });
}
});

// ── GET /api/platform/deployments ────────────────────────────────────────────

router.get('/deployments', async function(req, res) {
try {
var deploys = await PlatformModel.listDeployments(parseInt(req.query.limit || '20'));
res.json({ success: true, deployments: deploys, count: deploys.length, retrieved_at: new Date().toISOString() });
} catch (err) {
res.status(500).json({ success: false, error: err.message });
}
});

// ── GET /api/platform/performance ────────────────────────────────────────────

router.get('/performance', async function(req, res) {
try {
var perf = await PlatformMonitor.capturePerformance();
res.json({ success: true, performance: perf, retrieved_at: new Date().toISOString() });
} catch (err) {
res.status(500).json({ success: false, error: err.message });
}
});

module.exports = router;

// ── GET /api/platform/ai-metrics ─────────────────────────────────────────────
// Task 7: Expose existing production AI metrics for business execution dashboard

router.get('/ai-metrics', async function(req, res) {
    try {
          var [decisionStats, recStats, qualStats, predStats, convStats, agentStats, wfStats] = await Promise.all([
                  // Decision execution rate
                                                                                                                        pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='executed') as executed, COUNT(*) FILTER (WHERE status='expired') as expired, COUNT(*) FILTER (WHERE status='created') as pending FROM ai_decisions").catch(function() { return { rows: [{}] }; }),
                  // Recommendation acceptance rate
                  pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='accepted') as accepted, COUNT(*) FILTER (WHERE status='rejected') as rejected, COUNT(*) FILTER (WHERE status='expired') as expired, COUNT(*) FILTER (WHERE status='open') as open, COUNT(*) FILTER (WHERE status='in_progress') as in_progress FROM agent_recommendations").catch(function() { return { rows: [{}] }; }),
                  // Qualification accuracy
                  pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE calculation_status='completed') as completed, COUNT(*) FILTER (WHERE calculation_status='failed') as failed, ROUND(AVG(onboarding_probability),1) as avg_probability, COUNT(*) FILTER (WHERE category='hot') as hot, COUNT(*) FILTER (WHERE category='warm') as warm, COUNT(*) FILTER (WHERE category='cold') as cold FROM lead_qualification").catch(function() { return { rows: [{}] }; }),
                  // Prediction evaluation coverage
                  pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE evaluation_status='evaluated') as evaluated, COUNT(*) FILTER (WHERE evaluation_status='pending') as pending, COUNT(*) FILTER (WHERE evaluation_status='expired') as expired, module, prediction_type FROM ai_predictions GROUP BY module, prediction_type").catch(function() { return { rows: [] }; }),
                  // Conversation confidence distribution
                  pool.query("SELECT COUNT(*) as total, ROUND(AVG(confidence_score),3) as avg_confidence, MIN(confidence_score) as min_confidence, MAX(confidence_score) as max_confidence, COUNT(*) FILTER (WHERE confidence_score >= 0.8) as high_confidence, COUNT(*) FILTER (WHERE confidence_score BETWEEN 0.5 AND 0.8) as medium_confidence, COUNT(*) FILTER (WHERE confidence_score < 0.5) as low_confidence FROM conversation_analysis WHERE analysis_status='completed'").catch(function() { return { rows: [{}] }; }),
                  // Agent ROI and acceptance rate by agent_name
                  pool.query("SELECT agent_name, COUNT(*) as total, COUNT(*) FILTER (WHERE status='accepted') as accepted, COUNT(*) FILTER (WHERE status='rejected') as rejected, COUNT(*) FILTER (WHERE status='open') as open FROM agent_recommendations GROUP BY agent_name ORDER BY agent_name").catch(function() { return { rows: [] }; }),
                  // Workflow execution stats
                  pool.query("SELECT status, COUNT(*) as cnt FROM automation_workflows GROUP BY status").catch(function() { return { rows: [] }; })
                ]);

      var dec = decisionStats.rows[0] || {};
          var rec = recStats.rows[0] || {};
          var qual = qualStats.rows[0] || {};
          var conv = convStats.rows[0] || {};

      var decTotal = parseInt(dec.total || 0);
          var decExecuted = parseInt(dec.executed || 0);
          var recTotal = parseInt(rec.total || 0);
          var recAccepted = parseInt(rec.accepted || 0);
          var qualTotal = parseInt(qual.total || 0);
          var qualCompleted = parseInt(qual.completed || 0);

      var predTotal = 0; var predEvaluated = 0;
          predStats.rows.forEach(function(r) { predTotal += parseInt(r.total || 0); predEvaluated += parseInt(r.evaluated || 0); });

      var wfByStatus = {};
          wfStats.rows.forEach(function(r) { wfByStatus[r.status] = parseInt(r.cnt || 0); });

      res.json({
              success: true,
              ai_metrics: {
                        decision_execution: {
                                    total: decTotal,
                                    executed: decExecuted,
                                    execution_rate: decTotal > 0 ? Math.round(decExecuted / decTotal * 1000) / 10 : 0,
                                    pending: parseInt(dec.pending || 0),
                                    expired: parseInt(dec.expired || 0)
                        },
                        recommendation_lifecycle: {
                                    total: recTotal,
                                    open: parseInt(rec.open || 0),
                                    in_progress: parseInt(rec.in_progress || 0),
                                    accepted: recAccepted,
                                    rejected: parseInt(rec.rejected || 0),
                                    expired: parseInt(rec.expired || 0),
                                    acceptance_rate: recTotal > 0 ? Math.round(recAccepted / recTotal * 1000) / 10 : 0,
                                    by_agent: agentStats.rows
                        },
                        qualification_accuracy: {
                                    total: qualTotal,
                                    completed: qualCompleted,
                                    failed: parseInt(qual.failed || 0),
                                    completion_rate: qualTotal > 0 ? Math.round(qualCompleted / qualTotal * 1000) / 10 : 0,
                                    avg_onboarding_probability: parseFloat(qual.avg_probability || 0),
                                    categories: { hot: parseInt(qual.hot || 0), warm: parseInt(qual.warm || 0), cold: parseInt(qual.cold || 0) }
                        },
                        prediction_evaluation: {
                                    total: predTotal,
                                    evaluated: predEvaluated,
                                    pending: predTotal - predEvaluated,
                                    evaluation_rate: predTotal > 0 ? Math.round(predEvaluated / predTotal * 1000) / 10 : 0,
                                    by_module: predStats.rows
                        },
                        conversation_confidence: {
                                    total: parseInt(conv.total || 0),
                                    avg_confidence: parseFloat(conv.avg_confidence || 0),
                                    min_confidence: parseFloat(conv.min_confidence || 0),
                                    max_confidence: parseFloat(conv.max_confidence || 0),
                                    high_confidence: parseInt(conv.high_confidence || 0),
                                    medium_confidence: parseInt(conv.medium_confidence || 0),
                                    low_confidence: parseInt(conv.low_confidence || 0)
                        },
                        workflow_execution: wfByStatus
              },
              retrieved_at: new Date().toISOString()
      });
    } catch (err) {
          console.error('[Platform] GET /ai-metrics error:', err.message);
          res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
