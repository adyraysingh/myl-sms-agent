'use strict';
const { Pool } = require('pg');
const os = require('os');
const PlatformModel = require('../models/PlatformModel');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

var SERVER_START = Date.now();

// ── Module definitions ───────────────────────────────────────────────────────

var MODULES = [
  { name: 'business_memory', version: '1.0', tables: ['leads', 'conversations', 'events'] },
  { name: 'conversation_intelligence', version: '1.0', tables: ['conversation_analysis'] },
  { name: 'qualification_engine', version: '1.0', tables: ['onboarding_qualifications'] },
  { name: 'decision_engine', version: '1.0', tables: ['decisions'] },
  { name: 'sales_intelligence', version: '1.0', tables: ['sales_performance'] },
  { name: 'executive_intelligence', version: '1.0', tables: ['executive_briefings'] },
  { name: 'investigation_engine', version: '1.0', tables: ['investigations'] },
  { name: 'ceo_copilot', version: '1.0', tables: ['copilot_sessions'] },
  { name: 'learning_engine', version: '1.0', tables: ['learning_events'] },
  { name: 'revenue_intelligence', version: '1.0', tables: ['revenue_forecasts'] },
  { name: 'operations_engine', version: '1.0', tables: ['automation_workflows'] },
  { name: 'platform_operations', version: '1.0', tables: ['platform_module_health'] }
];

var INTEGRATIONS = [
  { name: 'zoho_crm', type: 'crm', envKey: 'ZOHO_ACCESS_TOKEN' },
  { name: 'zoho_salesiq', type: 'chat', envKey: 'SALESIQ_WEBHOOK_SECRET' },
  { name: 'retell_ai', type: 'voice', envKey: 'RETELL_API_KEY' },
  { name: 'slack', type: 'messaging', envKey: 'SLACK_BOT_TOKEN' },
  { name: 'openai', type: 'ai_provider', envKey: 'OPENAI_API_KEY' },
  { name: 'postgresql', type: 'database', envKey: 'DATABASE_URL' },
  { name: 'email', type: 'email', envKey: 'SMTP_HOST' }
];

// ── Module Health Check ──────────────────────────────────────────────────────

async function checkModuleHealth(mod) {
  var start = Date.now();
  var status = 'healthy';
  var errorMsg = null;
  var requests = 0;
  var errors = 0;
  var lastActivity = null;

  try {
    for (var i = 0; i < mod.tables.length; i++) {
      var tbl = mod.tables[i];
      try {
        var res = await pool.query(
          'SELECT COUNT(*) AS cnt, MAX(created_at) AS last_act FROM ' + tbl
        );
        if (res.rows[0]) {
          requests += parseInt(res.rows[0].cnt || 0);
          var la = res.rows[0].last_act;
          if (la && (!lastActivity || new Date(la) > new Date(lastActivity))) {
            lastActivity = la;
          }
        }
      } catch (tblErr) {
        status = 'degraded';
        errorMsg = 'Table ' + tbl + ': ' + tblErr.message;
        errors++;
      }
    }
  } catch (err) {
    status = 'unhealthy';
    errorMsg = err.message;
  }

  var latency = Date.now() - start;
  var uptimeSec = Math.floor((Date.now() - SERVER_START) / 1000);

  return await PlatformModel.upsertModuleHealth({
    module_name: mod.name,
    module_version: mod.version,
    status: status,
    uptime_seconds: uptimeSec,
    avg_response_ms: latency,
    requests_processed: requests,
    error_count: errors,
    retry_count: 0,
    queue_length: 0,
    last_activity: lastActivity,
    last_error: errorMsg,
    metadata: { tables_checked: mod.tables, latency_ms: latency }
  });
}

async function checkAllModules() {
  var results = [];
  for (var i = 0; i < MODULES.length; i++) {
    try {
      var h = await checkModuleHealth(MODULES[i]);
      results.push(h);
    } catch (err) {
      results.push({ module_name: MODULES[i].name, status: 'unhealthy', error: err.message });
    }
  }
  return results;
}

// ── Integration Health Check ─────────────────────────────────────────────────

async function checkIntegration(integ) {
  var start = Date.now();
  var envPresent = !!(process.env[integ.envKey]);
  var authStatus = envPresent ? 'authenticated' : 'missing_credentials';
  var status = envPresent ? 'healthy' : 'degraded';
  var errorMsg = null;

  // Special check: test DB connectivity
  if (integ.name === 'postgresql') {
    try {
      await pool.query('SELECT 1');
      status = 'healthy';
      authStatus = 'connected';
    } catch (dbErr) {
      status = 'unhealthy';
      authStatus = 'connection_failed';
      errorMsg = dbErr.message;
    }
  }

  // Special check: OpenAI key present
  if (integ.name === 'openai') {
    var hasKey = !!(process.env.OPENAI_API_KEY);
    status = hasKey ? 'healthy' : 'degraded';
    authStatus = hasKey ? 'authenticated' : 'missing_api_key';
  }

  var latency = Date.now() - start;

  return await PlatformModel.upsertIntegration({
    integration_name: integ.name,
    integration_type: integ.type,
    status: status,
    latency_ms: latency,
    last_successful_sync: status === 'healthy' ? new Date().toISOString() : null,
    failure_count: status !== 'healthy' ? 1 : 0,
    retry_status: 'none',
    auth_status: authStatus,
    error_message: errorMsg,
    metadata: { env_key: integ.envKey, env_present: envPresent }
  });
}

async function checkAllIntegrations() {
  var results = [];
  for (var i = 0; i < INTEGRATIONS.length; i++) {
    try {
      var r = await checkIntegration(INTEGRATIONS[i]);
      results.push(r);
    } catch (err) {
      results.push({ integration_name: INTEGRATIONS[i].name, status: 'error', error: err.message });
    }
  }
  return results;
}

// ── Queue Sync ───────────────────────────────────────────────────────────────

async function syncQueueStatus() {
  var queueDefs = [
    { queue_name: 'conversation_analysis', table: 'conversation_analysis' },
    { queue_name: 'lead_qualification', table: 'onboarding_qualifications' },
    { queue_name: 'decision_processing', table: 'decisions' },
    { queue_name: 'workflow_execution', table: 'automation_workflows' },
    { queue_name: 'forecast_generation', table: 'revenue_forecasts' },
    { queue_name: 'learning_evaluation', table: 'learning_events' },
    { queue_name: 'slack_notifications', table: null },
    { queue_name: 'crm_sync', table: null }
  ];

  var results = [];
  for (var i = 0; i < queueDefs.length; i++) {
    var qd = queueDefs[i];
    var completed = 0;
    var failed = 0;
    var lastProcessed = null;

    if (qd.table) {
      try {
        var qRes = await pool.query('SELECT COUNT(*) AS cnt, MAX(created_at) AS last FROM ' + qd.table).catch(function() { return { rows: [{ cnt: 0, last: null }] }; });
        completed = parseInt((qRes.rows[0] && qRes.rows[0].cnt) || 0);
        lastProcessed = (qRes.rows[0] && qRes.rows[0].last) || null;
      } catch (e) { /* ignore */ }
    }

    var r = await PlatformModel.upsertQueueStatus({
      queue_name: qd.queue_name,
      status: 'running',
      pending_jobs: 0,
      running_jobs: 0,
      completed_jobs: completed,
      failed_jobs: failed,
      retry_count: 0,
      avg_processing_ms: 0,
      worker_count: 1,
      worker_status: 'active',
      last_processed: lastProcessed
    });
    results.push(r);
  }
  return results;
}

// ── Performance Snapshot ─────────────────────────────────────────────────────

async function capturePerformance() {
  var memUsage = process.memoryUsage();
  var totalMemMB = os.totalmem() / (1024 * 1024);
  var usedMemMB = memUsage.rss / (1024 * 1024);
  var memPct = (usedMemMB / totalMemMB) * 100;
  var uptimeSec = Math.floor((Date.now() - SERVER_START) / 1000);

  var dbConns = { active: 0, idle: 0 };
  try {
    var dbRes = await pool.query(
      'SELECT COUNT(*) FILTER (WHERE state = $1) AS active, COUNT(*) FILTER (WHERE state = $2) AS idle FROM pg_stat_activity WHERE datname = current_database()',
      ['active', 'idle']
    );
    if (dbRes.rows[0]) {
      dbConns.active = parseInt(dbRes.rows[0].active || 0);
      dbConns.idle = parseInt(dbRes.rows[0].idle || 0);
    }
  } catch (e) { /* ignore */ }

  return await PlatformModel.recordPerformance({
    cpu_percent: 0,
    memory_mb: Math.round(usedMemMB * 100) / 100,
    memory_percent: Math.round(memPct * 100) / 100,
    db_connections_active: dbConns.active,
    db_connections_idle: dbConns.idle,
    api_latency_avg_ms: 0,
    queue_latency_avg_ms: 0,
    webhook_throughput_per_min: 0,
    active_sessions: 0,
    uptime_seconds: uptimeSec
  });
}

// ── Model Stats Refresh ──────────────────────────────────────────────────────

async function refreshModelStats() {
  var q = 'SELECT model_used,' +
    ' COUNT(*) AS total_calls,' +
    ' SUM(cost_usd) AS total_cost,' +
    ' AVG(cost_usd) AS avg_cost_per_call,' +
    ' AVG(latency_ms) AS avg_latency,' +
    " AVG(CASE WHEN success THEN 100.0 ELSE 0.0 END) AS success_rate" +
    ' FROM platform_cost_events' +
    ' GROUP BY model_used';

  try {
    var res = await pool.query(q);
    for (var i = 0; i < res.rows.length; i++) {
      var row = res.rows[i];
      if (!row.model_used) continue;
      await PlatformModel.upsertModel({
        model_name: row.model_used,
        model_version: 'live',
        provider: 'openai',
        status: 'active',
        total_calls: parseInt(row.total_calls || 0),
        total_cost: parseFloat(row.total_cost || 0),
        avg_cost_per_call: parseFloat(row.avg_cost_per_call || 0),
        avg_latency_ms: parseFloat(row.avg_latency || 0),
        success_rate: parseFloat(row.success_rate || 100)
      });
    }
  } catch (e) { /* Cost events may be empty */ }
}

// ── Full Health Check Orchestrator ───────────────────────────────────────────

async function runFullHealthCheck() {
  var start = Date.now();
  var [modules, integrations, queues, perf] = await Promise.all([
    checkAllModules().catch(function(e) { return [{ error: e.message }]; }),
    checkAllIntegrations().catch(function(e) { return [{ error: e.message }]; }),
    syncQueueStatus().catch(function(e) { return [{ error: e.message }]; }),
    capturePerformance().catch(function(e) { return null; })
  ]);

  await refreshModelStats().catch(function() {});

  var unhealthyModules = modules.filter(function(m) { return m.status !== 'healthy'; });
  var unhealthyIntegrations = integrations.filter(function(i) { return i.status !== 'healthy'; });
  var overallStatus = (unhealthyModules.length === 0 && unhealthyIntegrations.length === 0) ? 'healthy' :
    (unhealthyModules.length > 3 || unhealthyIntegrations.length > 2) ? 'critical' : 'degraded';

  return {
    overall_status: overallStatus,
    modules_checked: modules.length,
    integrations_checked: integrations.length,
    queues_synced: queues.length,
    unhealthy_modules: unhealthyModules.length,
    unhealthy_integrations: unhealthyIntegrations.length,
    performance: perf,
    processing_time_ms: Date.now() - start,
    checked_at: new Date().toISOString()
  };
}

// ── Alert Generation ─────────────────────────────────────────────────────────

async function generateSystemAlerts() {
  var alerts = [];

  try {
    // Check for open errors in last 24h
    var errRes = await pool.query(
      "SELECT severity, COUNT(*) AS cnt FROM platform_errors WHERE resolution_status = 'open' AND created_at >= NOW() - INTERVAL '24 hours' GROUP BY severity"
    ).catch(function() { return { rows: [] }; });

    for (var i = 0; i < errRes.rows.length; i++) {
      var row = errRes.rows[i];
      if (row.cnt > 0) {
        alerts.push({
          type: 'error_spike',
          severity: row.severity,
          message: row.cnt + ' open ' + row.severity + ' errors in last 24h',
          created_at: new Date().toISOString()
        });
      }
    }

    // Check for cost spikes
    var costRes = await pool.query(
      'SELECT SUM(cost_usd) AS today_cost FROM platform_cost_events WHERE created_at >= CURRENT_DATE'
    ).catch(function() { return { rows: [{ today_cost: 0 }] }; });

    var todayCost = parseFloat((costRes.rows[0] && costRes.rows[0].today_cost) || 0);
    if (todayCost > 50) {
      alerts.push({ type: 'cost_alert', severity: 'high', message: 'AI cost today: $' + todayCost.toFixed(4), created_at: new Date().toISOString() });
    }

    // Check SLA breaches
    var slaRes = await pool.query(
      "SELECT COUNT(*) AS cnt FROM sla_monitor WHERE sla_status = 'breached'"
    ).catch(function() { return { rows: [{ cnt: 0 }] }; });

    var slaBreach = parseInt((slaRes.rows[0] && slaRes.rows[0].cnt) || 0);
    if (slaBreach > 0) {
      alerts.push({ type: 'sla_breach', severity: 'high', message: slaBreach + ' active SLA breaches', created_at: new Date().toISOString() });
    }
  } catch (err) { /* alerts are best-effort */ }

  return alerts;
}

module.exports = {
  checkAllModules: checkAllModules,
  checkModuleHealth: checkModuleHealth,
  checkAllIntegrations: checkAllIntegrations,
  syncQueueStatus: syncQueueStatus,
  capturePerformance: capturePerformance,
  refreshModelStats: refreshModelStats,
  runFullHealthCheck: runFullHealthCheck,
  generateSystemAlerts: generateSystemAlerts,
  MODULES: MODULES,
  INTEGRATIONS: INTEGRATIONS
};
