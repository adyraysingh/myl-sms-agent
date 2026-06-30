'use strict';
// WorkflowEngine — orchestrates autonomous operational workflows
// SECURITY: Never contacts customers, never changes CRM owner, never changes pipeline stage
const WorkflowModel = require('../models/WorkflowModel');
const pool = require('../../memory/db/pool');

// ─── Action Handlers ─────────────────────────────────────────────────────────
// Each handler performs ONE safe internal operational task

async function actionCreateInternalNote({ lead_id, decision_type, reason, owner }) {
  // Creates an internal AI note in business memory (never modifies CRM manual notes)
  try {
    await pool.query(
      'INSERT INTO lead_events (lead_memory_id, event_type, payload, source, actor_type) VALUES ($1,$2,$3,$4,$5)',
      [lead_id, 'ai_operational_note', JSON.stringify({ decision_type, reason, owner, source: 'workflow_engine' }), 'workflow_engine', 'ai']
    );
    return { success: true, action: 'internal_note_created', lead_id };
  } catch (e) { return { success: false, error: e.message }; }
}

async function actionSendSlackNotification({ owner, lead_id, lead_name, decision_type, priority, reason, due_time, status }) {
  // Sends Slack notification to assigned CRM owner only — never changes ownership
  try {
    const slackWebhook = process.env.SLACK_WEBHOOK_URL;
    if (!slackWebhook) return { success: false, error: 'SLACK_WEBHOOK_URL not configured' };
    const message = {
      text: '*MAYA AI — Operational Alert*',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*MAYA AI — Operational Alert*' } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: '*Lead:* ' + (lead_name || lead_id || 'Unknown') },
          { type: 'mrkdwn', text: '*Action Required:* ' + (decision_type || 'Follow-up') },
          { type: 'mrkdwn', text: '*Priority:* ' + (priority || 'medium').toUpperCase() },
          { type: 'mrkdwn', text: '*Assigned To:* ' + (owner || 'Unassigned') },
          { type: 'mrkdwn', text: '*Reason:* ' + (reason || 'AI Recommendation') },
          { type: 'mrkdwn', text: '*Due:* ' + (due_time || 'ASAP') }
        ]}
      ]
    };
    const resp = await fetch(slackWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
    return { success: resp.ok, action: 'slack_notification_sent', owner, lead_id };
  } catch (e) { return { success: false, error: e.message }; }
}

async function actionEscalateToManager({ lead_id, lead_name, owner, decision_type, priority, breach_minutes, workflow_id }) {
  // Notifies sales manager of SLA breach — never reassigns lead
  try {
    const slackWebhook = process.env.SLACK_WEBHOOK_URL;
    if (!slackWebhook) return { success: false, error: 'SLACK_WEBHOOK_URL not configured' };
    const message = {
      text: '*MAYA AI — SLA ESCALATION*',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '*:rotating_light: MAYA AI — SLA ESCALATION*' } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: '*Lead:* ' + (lead_name || lead_id || 'Unknown') },
          { type: 'mrkdwn', text: '*Overdue By:* ' + Math.round(breach_minutes || 0) + ' minutes' },
          { type: 'mrkdwn', text: '*Assigned Rep:* ' + (owner || 'Unassigned') },
          { type: 'mrkdwn', text: '*Task:* ' + (decision_type || 'Unknown') },
          { type: 'mrkdwn', text: '*Priority:* ' + (priority || 'high').toUpperCase() },
          { type: 'mrkdwn', text: '*Workflow ID:* ' + workflow_id }
        ]},
        { type: 'section', text: { type: 'mrkdwn', text: '_Note: No ownership changes have been made. The assigned rep remains responsible._' } }
      ]
    };
    const resp = await fetch(slackWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
    return { success: resp.ok, action: 'escalation_sent_to_manager', lead_id, owner };
  } catch (e) { return { success: false, error: e.message }; }
}

async function actionRefreshBusinessMemory({ lead_id }) {
  try {
    await pool.query(
      'UPDATE leads SET updated_at=NOW() WHERE lead_id=$1',
      [lead_id]
    );
    return { success: true, action: 'business_memory_refreshed', lead_id };
  } catch (e) { return { success: false, error: e.message }; }
}

async function actionArchiveExpiredDecision({ decision_id }) {
  try {
    if (!decision_id) return { success: true, action: 'no_decision_to_archive' };
    await pool.query(
      'UPDATE decisions SET status=$1, updated_at=NOW() WHERE decision_id=$2 AND status=$3',
      ['archived', decision_id, 'pending']
    );
    return { success: true, action: 'decision_archived', decision_id };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─── Action Dispatcher ───────────────────────────────────────────────────────

const ACTION_HANDLERS = {
  create_internal_note: actionCreateInternalNote,
  send_slack_notification: actionSendSlackNotification,
  escalate_to_manager: actionEscalateToManager,
  refresh_business_memory: actionRefreshBusinessMemory,
  archive_expired_decision: actionArchiveExpiredDecision
};

// ─── Workflow Types → Actions mapping ────────────────────────────────────────

const WORKFLOW_ACTIONS = {
  notify_owner: ['send_slack_notification', 'create_internal_note'],
  escalate_overdue: ['escalate_to_manager', 'create_internal_note'],
  create_follow_up_reminder: ['send_slack_notification', 'create_internal_note'],
  archive_expired: ['archive_expired_decision', 'create_internal_note'],
  refresh_memory: ['refresh_business_memory'],
  sync_dashboard: ['refresh_business_memory', 'create_internal_note'],
  high_priority_alert: ['send_slack_notification', 'create_internal_note'],
  sla_breach_escalation: ['escalate_to_manager', 'create_internal_note']
};

// ─── WorkflowEngine class ────────────────────────────────────────────────────

class WorkflowEngine {

  // Create a workflow from an AI decision and start executing it
  static async triggerFromDecision(decision) {
    const { decision_id, lead_id, decision_type, priority, reason, crm_owner, recommended_execution_time } = decision;

    // Determine workflow type based on decision
    let workflow_type = 'notify_owner';
    let sla_hours = 24;
    if (priority === 'critical') { workflow_type = 'high_priority_alert'; sla_hours = 2; }
    else if (priority === 'high') { workflow_type = 'notify_owner'; sla_hours = 4; }
    else if (decision_type?.toLowerCase().includes('follow')) { workflow_type = 'create_follow_up_reminder'; sla_hours = 8; }

    // Create workflow (idempotent — won't duplicate)
    const workflow = await WorkflowModel.create({
      lead_id, decision_id, workflow_type, priority,
      assigned_owner: crm_owner,
      trigger_event: 'decision_generated',
      trigger_data: { decision_type, reason, recommended_execution_time },
      actions: WORKFLOW_ACTIONS[workflow_type] || ['send_slack_notification'],
      sla_hours
    });

    if (!workflow) return null; // Already exists (idempotent)

    // Create SLA record
    await WorkflowModel.createSLA({ lead_id, workflow_id: workflow.workflow_id, sla_type: workflow_type, sla_hours });
    await WorkflowModel.audit(workflow.workflow_id, 'workflow_created', { decision_id, workflow_type, priority });

    // Execute asynchronously
    setImmediate(() => WorkflowEngine.execute(workflow.workflow_id, decision).catch(e => console.error('[WorkflowEngine] Execute failed:', e.message)));

    return workflow;
  }

  // Execute a workflow — runs all its actions sequentially
  static async execute(workflow_id, contextData = {}) {
    const workflow = await WorkflowModel.findById(workflow_id);
    if (!workflow || workflow.status === 'completed' || workflow.status === 'cancelled') return;

    await WorkflowModel.updateStatus(workflow_id, 'running');
    await WorkflowModel.audit(workflow_id, 'execution_started', { workflow_type: workflow.workflow_type });

    const actions = (typeof workflow.actions === 'string' ? JSON.parse(workflow.actions) : workflow.actions) || [];
    const results = [];
    let allSuccess = true;

    for (const action of actions) {
      const handler = ACTION_HANDLERS[action];
      if (!handler) { results.push({ action, skipped: true }); continue; }

      const start = Date.now();
      try {
        const payload = {
          lead_id: workflow.lead_id,
          decision_id: workflow.decision_id,
          owner: workflow.assigned_owner,
          lead_name: contextData.lead_name || workflow.lead_id,
          decision_type: contextData.decision_type || workflow.workflow_type,
          priority: workflow.priority,
          reason: contextData.reason || 'AI Recommendation',
          due_time: contextData.recommended_execution_time || 'ASAP',
          status: workflow.status,
          workflow_id
        };
        const result = await handler(payload);
        const ms = Date.now() - start;
        await WorkflowModel.logExecution({ workflow_id, action, status: result.success ? 'completed' : 'failed', result, processing_time_ms: ms });
        results.push({ action, ...result, processing_time_ms: ms });
        if (!result.success) allSuccess = false;
      } catch (e) {
        allSuccess = false;
        results.push({ action, success: false, error: e.message });
        await WorkflowModel.logExecution({ workflow_id, action, status: 'failed', result: { error: e.message }, processing_time_ms: Date.now() - start });
      }
    }

    const finalStatus = allSuccess ? 'completed' : 'failed';
    await WorkflowModel.updateStatus(workflow_id, finalStatus, { execution_result: results, error_message: allSuccess ? null : 'One or more actions failed' });
    if (finalStatus === 'completed') await WorkflowModel.completeSLA(workflow_id);
    await WorkflowModel.audit(workflow_id, finalStatus === 'completed' ? 'execution_completed' : 'execution_failed', { results, all_success: allSuccess });

    return { workflow_id, status: finalStatus, results };
  }

  // Retry a failed workflow
  static async retry(workflow_id) {
    const workflow = await WorkflowModel.findById(workflow_id);
    if (!workflow) throw new Error('Workflow not found');
    if (workflow.retry_count >= workflow.max_retries) throw new Error('Max retries exceeded');
    if (workflow.status !== 'failed') throw new Error('Only failed workflows can be retried');

    await WorkflowModel.updateStatus(workflow_id, 'pending', { retry_count: (workflow.retry_count || 0) + 1 });
    await WorkflowModel.audit(workflow_id, 'retry_initiated', { attempt: workflow.retry_count + 1 });
    return WorkflowEngine.execute(workflow_id);
  }

  // SLA Monitor: detect breaches and escalate
  static async checkSLABreaches() {
    const breached = await WorkflowModel.getBreachedSLAs();
    const escalated = [];

    for (const sla of breached) {
      try {
        const escalationResult = await actionEscalateToManager({
          lead_id: sla.lead_id || sla.wf_lead_id,
          lead_name: sla.lead_id,
          owner: sla.assigned_owner,
          decision_type: sla.workflow_type,
          priority: 'high',
          breach_minutes: sla.breach_minutes,
          workflow_id: sla.workflow_id
        });
        await WorkflowModel.markSLAEscalated(sla.sla_id, 'sales_manager', 1);
        if (sla.workflow_id) await WorkflowModel.audit(sla.workflow_id, 'sla_breached_escalated', { breach_minutes: sla.breach_minutes });
        escalated.push({ sla_id: sla.sla_id, workflow_id: sla.workflow_id, result: escalationResult });
      } catch (e) { console.error('[WorkflowEngine] SLA escalation failed:', e.message); }
    }
    return { breached_count: breached.length, escalated_count: escalated.length, escalated };
  }

  // Auto-retry failed workflows
  static async retryFailed() {
    const pending = await WorkflowModel.getPendingForRetry();
    const results = [];
    for (const w of pending) {
      try {
        await WorkflowEngine.retry(w.workflow_id);
        results.push({ workflow_id: w.workflow_id, status: 'retried' });
      } catch (e) { results.push({ workflow_id: w.workflow_id, error: e.message }); }
    }
    return results;
  }

  // Create a workflow for any ad-hoc operational need
  static async createAndExecute({ lead_id, decision_id, workflow_type, priority, assigned_owner, trigger_data, sla_hours }) {
    const actions = WORKFLOW_ACTIONS[workflow_type] || ['create_internal_note'];
    const workflow = await WorkflowModel.create({ lead_id, decision_id, workflow_type, priority, assigned_owner, trigger_event: 'manual', trigger_data, actions, sla_hours });
    if (!workflow) return { message: 'Workflow already exists (idempotent)', workflow_type };
    await WorkflowModel.createSLA({ lead_id, workflow_id: workflow.workflow_id, sla_type: workflow_type, sla_hours: sla_hours || 24 });
    await WorkflowModel.audit(workflow.workflow_id, 'workflow_created_manual', { workflow_type, priority });
    setImmediate(() => WorkflowEngine.execute(workflow.workflow_id, trigger_data || {}).catch(e => console.error('[WorkflowEngine] Execute failed:', e.message)));
    return workflow;
  }

  static getWorkflowTypes() { return Object.keys(WORKFLOW_ACTIONS); }
}

module.exports = WorkflowEngine;
