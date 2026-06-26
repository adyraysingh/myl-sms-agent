'use strict';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

class PlatformModel {

  // ── Module Health ────────────────────────────────────────────────────

  static async upsertModuleHealth(data) {
    var q = 'INSERT INTO platform_module_health' +
      ' (module_name, module_version, status, uptime_seconds, avg_response_ms,' +
      ' requests_processed, error_count, retry_count, queue_length, last_activity, last_error, metadata)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)' +
      ' RETURNING *';
    var vals = [
      data.module_name, data.module_version || '1.0', data.status || 'healthy',
      data.uptime_seconds || 0, data.avg_response_ms || 0,
      data.requests_processed || 0, data.error_count || 0, data.retry_count || 0,
      data.queue_length || 0, data.last_activity || null,
      data.last_error || null, JSON.stringify(data.metadata || {})
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getModuleHealthLatest() {
    var q = 'SELECT DISTINCT ON (module_name) * FROM platform_module_health' +
      ' ORDER BY module_name, checked_at DESC';
    var res = await pool.query(q);
    return res.rows;
  }

  static async getModuleHealthHistory(module_name, limit) {
    var res = await pool.query(
      'SELECT * FROM platform_module_health WHERE module_name = $1 ORDER BY checked_at DESC LIMIT $2',
      [module_name, limit || 20]
    );
    return res.rows;
  }

  // ── Queue Status ─────────────────────────────────────────────────────

  static async upsertQueueStatus(data) {
    var q = 'INSERT INTO platform_queue_status' +
      ' (queue_name, status, pending_jobs, running_jobs, completed_jobs, failed_jobs,' +
      ' retry_count, oldest_pending_job, avg_processing_ms, worker_count, worker_status, last_processed)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)' +
      ' ON CONFLICT (queue_name) DO UPDATE SET' +
      ' status = EXCLUDED.status, pending_jobs = EXCLUDED.pending_jobs,' +
      ' running_jobs = EXCLUDED.running_jobs, completed_jobs = EXCLUDED.completed_jobs,' +
      ' failed_jobs = EXCLUDED.failed_jobs, retry_count = EXCLUDED.retry_count,' +
      ' oldest_pending_job = EXCLUDED.oldest_pending_job,' +
      ' avg_processing_ms = EXCLUDED.avg_processing_ms,' +
      ' worker_count = EXCLUDED.worker_count, worker_status = EXCLUDED.worker_status,' +
      ' last_processed = EXCLUDED.last_processed, updated_at = NOW()' +
      ' RETURNING *';
    var vals = [
      data.queue_name, data.status || 'running',
      data.pending_jobs || 0, data.running_jobs || 0,
      data.completed_jobs || 0, data.failed_jobs || 0,
      data.retry_count || 0, data.oldest_pending_job || null,
      data.avg_processing_ms || 0, data.worker_count || 1,
      data.worker_status || 'active', data.last_processed || null
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getAllQueues() {
    var res = await pool.query('SELECT * FROM platform_queue_status ORDER BY queue_name');
    return res.rows;
  }

  static async updateQueueStatus(queue_name, status) {
    var res = await pool.query(
      'UPDATE platform_queue_status SET status = $1, updated_at = NOW() WHERE queue_name = $2 RETURNING *',
      [status, queue_name]
    );
    return res.rows[0] || null;
  }

  // ── Integration Health ───────────────────────────────────────────────

  static async upsertIntegration(data) {
    var q = 'INSERT INTO platform_integration_health' +
      ' (integration_name, integration_type, status, latency_ms, last_successful_sync,' +
      ' failure_count, retry_status, auth_status, error_message, metadata)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)' +
      ' ON CONFLICT (integration_name) DO UPDATE SET' +
      ' status = EXCLUDED.status, latency_ms = EXCLUDED.latency_ms,' +
      ' last_successful_sync = EXCLUDED.last_successful_sync,' +
      ' failure_count = EXCLUDED.failure_count, retry_status = EXCLUDED.retry_status,' +
      ' auth_status = EXCLUDED.auth_status, error_message = EXCLUDED.error_message,' +
      ' metadata = EXCLUDED.metadata, checked_at = NOW()' +
      ' RETURNING *';
    var vals = [
      data.integration_name, data.integration_type || 'unknown',
      data.status || 'unknown', data.latency_ms || 0,
      data.last_successful_sync || null, data.failure_count || 0,
      data.retry_status || 'none', data.auth_status || 'unknown',
      data.error_message || null, JSON.stringify(data.metadata || {})
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getAllIntegrations() {
    var res = await pool.query('SELECT * FROM platform_integration_health ORDER BY integration_name');
    return res.rows;
  }

  // ── Model Registry ───────────────────────────────────────────────────

  static async upsertModel(data) {
    var q = 'INSERT INTO platform_model_registry' +
      ' (model_name, model_version, provider, modules_using, status,' +
      ' avg_cost_per_call, avg_latency_ms, success_rate, total_calls, total_cost, notes)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)' +
      ' ON CONFLICT (model_name, model_version) DO UPDATE SET' +
      ' status = EXCLUDED.status, avg_cost_per_call = EXCLUDED.avg_cost_per_call,' +
      ' avg_latency_ms = EXCLUDED.avg_latency_ms, success_rate = EXCLUDED.success_rate,' +
      ' total_calls = EXCLUDED.total_calls, total_cost = EXCLUDED.total_cost,' +
      ' modules_using = EXCLUDED.modules_using, updated_at = NOW()' +
      ' RETURNING *';
    var vals = [
      data.model_name, data.model_version, data.provider || 'openai',
      JSON.stringify(data.modules_using || []),
      data.status || 'active', data.avg_cost_per_call || 0,
      data.avg_latency_ms || 0, data.success_rate || 100,
      data.total_calls || 0, data.total_cost || 0, data.notes || ''
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getAllModels() {
    var res = await pool.query('SELECT * FROM platform_model_registry ORDER BY status, model_name');
    return res.rows;
  }

  // ── Prompt Registry ──────────────────────────────────────────────────

  static async upsertPrompt(data) {
    var q = 'INSERT INTO platform_prompt_registry' +
      ' (prompt_name, prompt_version, owner, modules_using, status, content_hash, token_estimate, notes)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8)' +
      ' ON CONFLICT (prompt_name, prompt_version) DO UPDATE SET' +
      ' status = EXCLUDED.status, owner = EXCLUDED.owner,' +
      ' modules_using = EXCLUDED.modules_using, content_hash = EXCLUDED.content_hash,' +
      ' token_estimate = EXCLUDED.token_estimate, updated_at = NOW()' +
      ' RETURNING *';
    var vals = [
      data.prompt_name, data.prompt_version || '1.0',
      data.owner || 'AI Team',
      JSON.stringify(data.modules_using || []),
      data.status || 'active',
      data.content_hash || null,
      data.token_estimate || 0,
      data.notes || ''
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getAllPrompts() {
    var res = await pool.query('SELECT * FROM platform_prompt_registry ORDER BY prompt_name, prompt_version DESC');
    return res.rows;
  }

  static async logPromptHistory(data) {
    var q = 'INSERT INTO platform_prompt_history' +
      ' (prompt_id, prompt_name, previous_version, new_version, changed_by, change_reason)' +
      ' VALUES ($1,$2,$3,$4,$5,$6) RETURNING *';
    var res = await pool.query(q, [
      data.prompt_id, data.prompt_name,
      data.previous_version, data.new_version,
      data.changed_by || 'system', data.change_reason || ''
    ]);
    return res.rows[0];
  }

  // ── Cost Intelligence ────────────────────────────────────────────────

  static async logCostEvent(data) {
    var q = 'INSERT INTO platform_cost_events' +
      ' (module_name, operation_type, model_used, tokens_input, tokens_output,' +
      ' cost_usd, latency_ms, lead_id, session_id, success)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *';
    var vals = [
      data.module_name, data.operation_type || 'inference',
      data.model_used || 'gpt-4o',
      data.tokens_input || 0, data.tokens_output || 0,
      data.cost_usd || 0, data.latency_ms || 0,
      data.lead_id || null, data.session_id || null,
      data.success !== false
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getCostSummary() {
    var q = 'SELECT' +
      " SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE) AS today_cost," +
      " SUM(cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS week_cost," +
      " SUM(cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS month_cost," +
      " COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_calls," +
      " AVG(cost_usd) AS avg_cost_per_call," +
      " AVG(latency_ms) AS avg_latency_ms" +
      ' FROM platform_cost_events';
    var res = await pool.query(q);
    return res.rows[0] || {};
  }

  static async getCostByModule() {
    var q = 'SELECT module_name,' +
      " SUM(cost_usd) FILTER (WHERE created_at >= CURRENT_DATE) AS today_cost," +
      " SUM(cost_usd) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS month_cost," +
      " COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS month_calls," +
      " AVG(latency_ms) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS avg_latency" +
      ' FROM platform_cost_events' +
      ' GROUP BY module_name ORDER BY month_cost DESC NULLS LAST';
    var res = await pool.query(q);
    return res.rows;
  }

  static async getCostTrend(days) {
    var d = days || 30;
    var q = 'SELECT DATE(created_at) AS day,' +
      ' SUM(cost_usd) AS total_cost,' +
      ' COUNT(*) AS total_calls,' +
      ' SUM(tokens_input + tokens_output) AS total_tokens' +
      ' FROM platform_cost_events' +
      " WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL" +
      ' GROUP BY DATE(created_at) ORDER BY day DESC';
    var res = await pool.query(q, [String(d)]);
    return res.rows;
  }

  // ── Error Monitor ────────────────────────────────────────────────────

  static async logError(data) {
    var q = 'INSERT INTO platform_errors' +
      ' (module_name, error_type, severity, message, stack_trace, context,' +
      ' resolution_status, retry_count, escalated)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *';
    var vals = [
      data.module_name, data.error_type || 'application_error',
      data.severity || 'medium', data.message || '',
      data.stack_trace || null,
      JSON.stringify(data.context || {}),
      data.resolution_status || 'open',
      data.retry_count || 0, data.escalated || false
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async listErrors(opts) {
    var module_name = opts && opts.module_name;
    var severity = opts && opts.severity;
    var resolution_status = opts && opts.resolution_status;
    var limit = (opts && opts.limit) || 50;
    var offset = (opts && opts.offset) || 0;
    var q = 'SELECT * FROM platform_errors WHERE 1=1';
    var vals = [];
    if (module_name) { vals.push(module_name); q += ' AND module_name = $' + vals.length; }
    if (severity) { vals.push(severity); q += ' AND severity = $' + vals.length; }
    if (resolution_status) { vals.push(resolution_status); q += ' AND resolution_status = $' + vals.length; }
    vals.push(limit); q += ' ORDER BY created_at DESC LIMIT $' + vals.length;
    vals.push(offset); q += ' OFFSET $' + vals.length;
    var res = await pool.query(q, vals);
    return res.rows;
  }

  static async resolveError(error_id, resolved_by) {
    var res = await pool.query(
      'UPDATE platform_errors SET resolution_status = $1, resolved_at = NOW(), resolved_by = $2 WHERE error_id = $3 RETURNING *',
      ['resolved', resolved_by || 'system', error_id]
    );
    return res.rows[0] || null;
  }

  static async getErrorSummary() {
    var q = 'SELECT module_name, severity, COUNT(*) AS count,' +
      " COUNT(*) FILTER (WHERE resolution_status = 'open') AS open_count," +
      " COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_count" +
      ' FROM platform_errors' +
      ' GROUP BY module_name, severity ORDER BY open_count DESC, today_count DESC';
    var res = await pool.query(q);
    return res.rows;
  }

  // ── Config Management ────────────────────────────────────────────────

  static async getConfig(key) {
    if (key) {
      var res = await pool.query('SELECT * FROM platform_config WHERE config_key = $1', [key]);
      return res.rows[0] || null;
    }
    var res2 = await pool.query('SELECT * FROM platform_config ORDER BY config_type, config_key');
    return res2.rows;
  }

  static async setConfig(key, value, modified_by) {
    var q = 'INSERT INTO platform_config (config_key, config_value, last_modified_by)' +
      ' VALUES ($1, $2::JSONB, $3)' +
      ' ON CONFLICT (config_key) DO UPDATE SET' +
      ' config_value = EXCLUDED.config_value,' +
      ' last_modified_by = EXCLUDED.last_modified_by,' +
      ' updated_at = NOW() RETURNING *';
    var jsonVal = typeof value === 'string' ? value : JSON.stringify(value);
    var res = await pool.query(q, [key, jsonVal, modified_by || 'admin']);
    return res.rows[0];
  }

  // ── Audit Center ─────────────────────────────────────────────────────

  static async logAudit(data) {
    var q = 'INSERT INTO platform_audit' +
      ' (action, performed_by, role, module_affected, before_state, after_state, ip_address, details)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *';
    var vals = [
      data.action, data.performed_by || 'system',
      data.role || 'admin', data.module_affected || null,
      JSON.stringify(data.before_state || {}),
      JSON.stringify(data.after_state || {}),
      data.ip_address || null, data.details || ''
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async listAudit(opts) {
    var limit = (opts && opts.limit) || 100;
    var offset = (opts && opts.offset) || 0;
    var module_affected = opts && opts.module_affected;
    var q = 'SELECT * FROM platform_audit WHERE 1=1';
    var vals = [];
    if (module_affected) { vals.push(module_affected); q += ' AND module_affected = $' + vals.length; }
    vals.push(limit); q += ' ORDER BY created_at DESC LIMIT $' + vals.length;
    vals.push(offset); q += ' OFFSET $' + vals.length;
    var res = await pool.query(q, vals);
    return res.rows;
  }

  // ── Performance ──────────────────────────────────────────────────────

  static async recordPerformance(data) {
    var q = 'INSERT INTO platform_performance' +
      ' (cpu_percent, memory_mb, memory_percent, db_connections_active, db_connections_idle,' +
      ' api_latency_avg_ms, queue_latency_avg_ms, webhook_throughput_per_min,' +
      ' active_sessions, uptime_seconds)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *';
    var vals = [
      data.cpu_percent || 0, data.memory_mb || 0, data.memory_percent || 0,
      data.db_connections_active || 0, data.db_connections_idle || 0,
      data.api_latency_avg_ms || 0, data.queue_latency_avg_ms || 0,
      data.webhook_throughput_per_min || 0,
      data.active_sessions || 0, data.uptime_seconds || 0
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getLatestPerformance() {
    var res = await pool.query('SELECT * FROM platform_performance ORDER BY recorded_at DESC LIMIT 1');
    return res.rows[0] || null;
  }

  // ── Deployments & Backup ─────────────────────────────────────────────

  static async logDeployment(data) {
    var q = 'INSERT INTO platform_deployments' +
      ' (version, commit_hash, deployed_by, environment, status,' +
      ' phases_included, migration_applied, rollback_available, notes)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *';
    var vals = [
      data.version || '1.0.0', data.commit_hash || null,
      data.deployed_by || 'github', data.environment || 'production',
      data.status || 'successful',
      JSON.stringify(data.phases_included || []),
      data.migration_applied !== false,
      data.rollback_available || false,
      data.notes || ''
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async listDeployments(limit) {
    var res = await pool.query(
      'SELECT * FROM platform_deployments ORDER BY deployed_at DESC LIMIT $1',
      [limit || 20]
    );
    return res.rows;
  }

  static async upsertBackupStatus(data) {
    var q = 'INSERT INTO platform_backup_status' +
      ' (backup_type, status, last_successful_backup, backup_size_mb,' +
      ' recovery_test_status, schema_version, platform_version, migration_history, notes)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *';
    var vals = [
      data.backup_type || 'database', data.status || 'unknown',
      data.last_successful_backup || null, data.backup_size_mb || 0,
      data.recovery_test_status || 'not_tested',
      data.schema_version || '011',
      data.platform_version || '1.0.0',
      JSON.stringify(data.migration_history || []),
      data.notes || ''
    ];
    var res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getLatestBackupStatus() {
    var res = await pool.query('SELECT * FROM platform_backup_status ORDER BY recorded_at DESC LIMIT 1');
    return res.rows[0] || null;
  }
}

module.exports = PlatformModel;
