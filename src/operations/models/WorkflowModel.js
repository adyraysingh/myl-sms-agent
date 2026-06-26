'use strict';
const pool = require('../../memory/db/pool');

class WorkflowModel {

  static async create({ lead_id, decision_id, workflow_type, priority, assigned_owner,
    trigger_event, trigger_data, actions, conditions, sla_hours, notes, idempotency_key }) {
    // Idempotency: don't create duplicate workflows for same decision+type
    const ikey = idempotency_key || (decision_id + ':' + workflow_type);
    const r = await pool.query(
      'INSERT INTO automation_workflows (lead_id,decision_id,workflow_type,priority,assigned_owner,' +
      'trigger_event,trigger_data,actions,conditions,sla_hours,notes,idempotency_key) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ' +
      'ON CONFLICT (idempotency_key) DO NOTHING RETURNING *',
      [lead_id||null, decision_id||null, workflow_type, priority||'medium', assigned_owner||null,
       trigger_event||null, JSON.stringify(trigger_data||{}), JSON.stringify(actions||[]),
       JSON.stringify(conditions||{}), sla_hours||24, notes||null, ikey]
    );
    return r.rows[0] || null;
  }

  static async findById(workflow_id) {
    const r = await pool.query('SELECT * FROM automation_workflows WHERE workflow_id=$1', [workflow_id]);
    return r.rows[0] || null;
  }

  static async findAll({ status, priority, lead_id, workflow_type, limit = 50, offset = 0 }) {
    const args = [];
    const conditions = [];
    if (status) { args.push(status); conditions.push('status=$' + args.length); }
    if (priority) { args.push(priority); conditions.push('priority=$' + args.length); }
    if (lead_id) { args.push(lead_id); conditions.push('lead_id=$' + args.length); }
    if (workflow_type) { args.push(workflow_type); conditions.push('workflow_type=$' + args.length); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    args.push(limit); args.push(offset);
    const r = await pool.query(
      'SELECT * FROM automation_workflows ' + where +
      ' ORDER BY CASE priority WHEN $1 THEN 1 WHEN $2 THEN 2 WHEN $3 THEN 3 ELSE 4 END, created_at DESC' +
      ' LIMIT $' + (args.length - 1) + ' OFFSET $' + args.length,
      ['critical', 'high', 'medium', ...args]
    );
    return r.rows;
  }

  static async updateStatus(workflow_id, status, extra = {}) {
    const sets = ['status=$2', 'updated_at=NOW()'];
    const args = [workflow_id, status];
    if (status === 'running' && !extra.executed_at) { sets.push('executed_at=NOW()'); }
    if (status === 'completed') { sets.push('completed_at=NOW()'); }
    if (status === 'cancelled') { sets.push('cancelled_at=NOW()'); }
    if (extra.error_message) { args.push(extra.error_message); sets.push('error_message=$' + args.length); }
    if (extra.execution_result) { args.push(JSON.stringify(extra.execution_result)); sets.push('execution_result=$' + args.length); }
    if (extra.retry_count !== undefined) { args.push(extra.retry_count); sets.push('retry_count=$' + args.length); }
    const r = await pool.query(
      'UPDATE automation_workflows SET ' + sets.join(',') + ' WHERE workflow_id=$1 RETURNING *',
      args
    );
    return r.rows[0];
  }

  static async logExecution({ workflow_id, action, status, result, processing_time_ms, retry_count, error_message }) {
    const r = await pool.query(
      'INSERT INTO workflow_execution (workflow_id,action,status,result,processing_time_ms,retry_count,error_message) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [workflow_id, action, status, JSON.stringify(result||{}), processing_time_ms||null, retry_count||0, error_message||null]
    );
    return r.rows[0];
  }

  static async audit(workflow_id, event, details = {}, performed_by = 'system') {
    const r = await pool.query(
      'INSERT INTO workflow_audit (workflow_id,event,performed_by,details) VALUES ($1,$2,$3,$4) RETURNING *',
      [workflow_id, event, performed_by, JSON.stringify(details)]
    );
    return r.rows[0];
  }

  static async getAudit(workflow_id) {
    const r = await pool.query(
      'SELECT * FROM workflow_audit WHERE workflow_id=$1 ORDER BY timestamp ASC', [workflow_id]
    );
    return r.rows;
  }

  static async getExecutions(workflow_id) {
    const r = await pool.query(
      'SELECT * FROM workflow_execution WHERE workflow_id=$1 ORDER BY executed_at ASC', [workflow_id]
    );
    return r.rows;
  }

  static async createSLA({ lead_id, workflow_id, sla_type, sla_hours }) {
    const required = new Date(Date.now() + (sla_hours || 24) * 60 * 60 * 1000).toISOString();
    const r = await pool.query(
      'INSERT INTO sla_monitor (lead_id,workflow_id,sla_type,required_completion_time) VALUES ($1,$2,$3,$4) RETURNING *',
      [lead_id||null, workflow_id, sla_type, required]
    );
    return r.rows[0];
  }

  static async completeSLA(workflow_id) {
    const r = await pool.query(
      'UPDATE sla_monitor SET sla_status=$1, actual_completion_time=NOW(), updated_at=NOW() ' +
      'WHERE workflow_id=$2 AND sla_status=$3 RETURNING *',
      ['completed', workflow_id, 'pending']
    );
    return r.rows;
  }

  static async getBreachedSLAs() {
    const r = await pool.query(
      'SELECT s.*, w.workflow_type, w.assigned_owner, w.lead_id as wf_lead_id, ' +
      'EXTRACT(EPOCH FROM (NOW() - s.required_completion_time))/60 as breach_minutes ' +
      'FROM sla_monitor s LEFT JOIN automation_workflows w ON s.workflow_id=w.workflow_id ' +
      'WHERE s.sla_status=$1 AND s.required_completion_time < NOW() AND s.escalated=false ' +
      'ORDER BY s.required_completion_time ASC',
      ['pending']
    );
    return r.rows;
  }

  static async markSLAEscalated(sla_id, escalated_to, level = 1) {
    const r = await pool.query(
      'UPDATE sla_monitor SET escalated=true, escalation_level=$1, escalated_at=NOW(), escalated_to=$2, ' +
      'sla_status=$3, updated_at=NOW() WHERE sla_id=$4 RETURNING *',
      [level, escalated_to, 'breached', sla_id]
    );
    return r.rows[0];
  }

  static async getMetrics() {
    const r = await pool.query(
      'SELECT ' +
      'COUNT(*) as total, ' +
      'COUNT(*) FILTER (WHERE status=$1) as pending, ' +
      'COUNT(*) FILTER (WHERE status=$2) as running, ' +
      'COUNT(*) FILTER (WHERE status=$3) as completed, ' +
      'COUNT(*) FILTER (WHERE status=$4) as failed, ' +
      'COUNT(*) FILTER (WHERE status=$5) as cancelled, ' +
      'ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - executed_at))*1000) FILTER (WHERE completed_at IS NOT NULL AND executed_at IS NOT NULL),0) as avg_exec_ms, ' +
      'COUNT(*) FILTER (WHERE status=$3) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE status IN ($3,$4)),0) as success_rate ' +
      'FROM automation_workflows',
      ['pending','running','completed','failed','cancelled']
    );
    const sla = await pool.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE sla_status=$1) as breached, ' +
      'COUNT(*) FILTER (WHERE escalated=true) as escalated FROM sla_monitor',
      ['breached']
    );
    return { workflows: r.rows[0], sla: sla.rows[0] };
  }

  static async getPendingForRetry() {
    const r = await pool.query(
      'SELECT * FROM automation_workflows WHERE status=$1 AND retry_count < max_retries ' +
      'ORDER BY priority DESC, created_at ASC LIMIT 20',
      ['failed']
    );
    return r.rows;
  }

  static async getEscalations() {
    const r = await pool.query(
      'SELECT s.*, w.workflow_type, w.assigned_owner, w.priority, w.lead_id as wf_lead_id ' +
      'FROM sla_monitor s LEFT JOIN automation_workflows w ON s.workflow_id=w.workflow_id ' +
      'WHERE s.escalated=true ORDER BY s.escalated_at DESC LIMIT 50'
    );
    return r.rows;
  }
}

module.exports = WorkflowModel;
