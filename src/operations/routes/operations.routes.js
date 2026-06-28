'use strict';
const express = require('express');
const router = express.Router();
const WorkflowModel = require('../models/WorkflowModel');
const WorkflowEngine = require('../services/WorkflowEngine');
const pool = require('../../memory/db/pool');
const path = require('path');
const fs = require('fs');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');

// POST /api/operations/migrate
router.post('/migrate', async (req, res) => {
try {
const sqlPath = path.join(__dirname, '../db/migrations/009_autonomous_operations.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
await pool.query(sql);
res.json({ success: true, message: 'Phase 10 migration completed successfully' });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/operations/workflows — list workflows with filters
router.get('/workflows', async (req, res) => {
try {
const { status, priority, lead_id, workflow_type, limit, offset } = req.query;
const workflows = await WorkflowModel.findAll({ status, priority, lead_id, workflow_type,
limit: parseInt(limit)||50, offset: parseInt(offset)||0 });
const metrics = await WorkflowModel.getMetrics();
res.json({ success: true, workflows, count: workflows.length, metrics });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/operations/workflows/:id — single workflow with executions and audit
router.get('/workflows/:id', async (req, res) => {
try {
const workflow = await WorkflowModel.findById(req.params.id);
if (!workflow) return res.status(404).json({ success: false, error: 'Workflow not found' });
const [executions, audit] = await Promise.all([
WorkflowModel.getExecutions(req.params.id),
WorkflowModel.getAudit(req.params.id)
]);
res.json({ success: true, workflow, executions, audit });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/operations/sla — SLA status overview
router.get('/sla', async (req, res) => {
try {
const breached = await WorkflowModel.getBreachedSLAs();
const metrics = await WorkflowModel.getMetrics();
res.json({ success: true, breached_slas: breached, breached_count: breached.length, sla_metrics: metrics.sla });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/operations/escalations — active escalations
router.get('/escalations', async (req, res) => {
try {
const escalations = await WorkflowModel.getEscalations();
res.json({ success: true, escalations, count: escalations.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/operations/history — recent completed/failed workflows
router.get('/history', async (req, res) => {
try {
const { limit, offset } = req.query;
const completed = await WorkflowModel.findAll({ status: 'completed', limit: parseInt(limit)||20, offset: parseInt(offset)||0 });
const failed = await WorkflowModel.findAll({ status: 'failed', limit: 10, offset: 0 });
res.json({ success: true, completed, failed, completed_count: completed.length, failed_count: failed.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/operations/metrics — full operational metrics
router.get('/metrics', async (req, res) => {
try {
const metrics = await WorkflowModel.getMetrics();
const workflow_types = WorkflowEngine.getWorkflowTypes();
const [pending, running, active_sla] = await Promise.all([
WorkflowModel.findAll({ status: 'pending', limit: 5 }),
WorkflowModel.findAll({ status: 'running', limit: 5 }),
WorkflowModel.getBreachedSLAs()
]);
res.json({ success: true, metrics, workflow_types, pending_count: pending.length,
running_count: running.length, active_sla_breaches: active_sla.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/operations/execute — create and execute a workflow
router.post('/execute', async (req, res) => {
try {
const { lead_id, decision_id, workflow_type, priority, assigned_owner, trigger_data, sla_hours } = req.body;
if (!workflow_type) return res.status(400).json({ success: false, error: 'workflow_type is required' });
const validTypes = WorkflowEngine.getWorkflowTypes();
if (!validTypes.includes(workflow_type)) {
return res.status(400).json({ success: false, error: 'Invalid workflow_type. Valid: ' + validTypes.join(', ') });
}
// Return 202 immediately — execution is async
const workflow = await WorkflowEngine.createAndExecute({ lead_id, decision_id, workflow_type, priority: priority||'medium', assigned_owner, trigger_data, sla_hours });
res.status(202).json({ success: true, workflow_id: workflow?.workflow_id, workflow_type, status: 'executing', message: 'Workflow created and executing asynchronously' });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/operations/retry — retry a failed workflow
router.post('/retry', async (req, res) => {
try {
const { workflow_id } = req.body;
if (!workflow_id) return res.status(400).json({ success: false, error: 'workflow_id is required' });
res.status(202).json({ success: true, workflow_id, message: 'Retry initiated' });
setImmediate(async () => { try { await WorkflowEngine.retry(workflow_id); } catch (e) { console.error('[operations] retry failed:', e.message); } });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/operations/complete — manually mark workflow complete
router.post('/complete', async (req, res) => {
try {
const { workflow_id, notes, performed_by } = req.body;
if (!workflow_id) return res.status(400).json({ success: false, error: 'workflow_id is required' });
const workflow = await WorkflowModel.updateStatus(workflow_id, 'completed', { execution_result: { manual: true, notes } });
await WorkflowModel.completeSLA(workflow_id);
await WorkflowModel.audit(workflow_id, 'manually_completed', { notes, performed_by: performed_by||'user' });
// Phase 3.2: Auto-link workflow prediction outcome (fire-and-forget)
if (workflow) {
setImmediate(() => PredictionPublisher.autoLinkOutcome({
module: 'decision_engine',
lead_id: workflow.lead_id || null,
outcome_type: 'workflow_completed',
outcome_value: { workflow_id: workflow.workflow_id, workflow_type: workflow.workflow_type, decision_id: workflow.decision_id || null, notes: notes || null, completed_at: new Date().toISOString() },
is_correct: true,
accuracy_score: 1.0,
notes: 'Workflow manually completed: ' + (workflow.workflow_type || workflow_id)
}).catch(e => console.error('[OutcomeLinker] workflow_completed failed:', e.message)));
}
res.json({ success: true, workflow });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/operations/cancel — cancel a pending/running workflow
router.post('/cancel', async (req, res) => {
try {
const { workflow_id, reason, performed_by } = req.body;
if (!workflow_id) return res.status(400).json({ success: false, error: 'workflow_id is required' });
const workflow = await WorkflowModel.updateStatus(workflow_id, 'cancelled');
await WorkflowModel.audit(workflow_id, 'cancelled', { reason, performed_by: performed_by||'user' });
res.json({ success: true, workflow });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/operations/check-sla — trigger SLA breach check (async)
router.post('/check-sla', async (req, res) => {
try {
res.status(202).json({ success: true, message: 'SLA breach check started' });
setImmediate(async () => {
try {
const result = await WorkflowEngine.checkSLABreaches();
console.log('[operations] SLA check:', result.breached_count, 'breached,', result.escalated_count, 'escalated');
} catch (e) { console.error('[operations] SLA check failed:', e.message); }
});
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
