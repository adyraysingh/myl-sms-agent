'use strict';
const express = require('express');
const router = express.Router();
const pool = require('../../memory/db/pool');
const AgentOrchestrator = require('../AgentOrchestrator');

router.get('/dashboard', async (req, res) => {
  try {
    const since = new Date(Date.now()-24*60*60*1000).toISOString();
    const [agentStatus, activeRecs, opportunities, risks, recentHistory, agentPerf, learningSnap] = await Promise.all([
      pool.query("SELECT agent_name, COUNT(*) as total_runs, COUNT(*) FILTER (WHERE status='completed') as successful_runs, COUNT(*) FILTER (WHERE status='failed') as failed_runs, MAX(completed_at) as last_run_at, COALESCE(AVG(findings_count),0)::INTEGER as avg_findings, COALESCE(AVG(duration_ms),0)::INTEGER as avg_duration_ms, COALESCE(SUM(findings_count),0)::INTEGER as total_findings_24h FROM agent_runs WHERE started_at >= $1 GROUP BY agent_name ORDER BY agent_name", [since]).catch(() => ({ rows: [] })),
      pool.query("SELECT rec_id, agent_name, rec_type, title, description, confidence, priority, evidence, reasoning, recommended_action, expected_impact, affected_resource, affected_lead_id, created_at FROM agent_recommendations WHERE status='open' AND created_at >= $1 ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, confidence DESC, created_at DESC LIMIT 30", [since]).catch(() => ({ rows: [] })),
      pool.query("SELECT rec_id, agent_name, title, confidence, priority, expected_impact, created_at FROM agent_recommendations WHERE status='open' AND rec_type NOT IN ('sla_breach','queue_anomaly','ai_confidence_drop','workflow_failure','dlq_growth') AND priority IN ('high','medium') AND created_at >= $1 ORDER BY confidence DESC LIMIT 10", [since]).catch(() => ({ rows: [] })),
      pool.query("SELECT rec_id, agent_name, title, confidence, priority, recommended_action, created_at FROM agent_recommendations WHERE status='open' AND rec_type IN ('stalled_hot_lead','churn_risk','onboarding_bottleneck','low_forecast_confidence','conversion_rate_change','sla_breach') AND created_at >= $1 ORDER BY CASE priority WHEN 'high' THEN 1 ELSE 2 END, confidence DESC LIMIT 10", [since]).catch(() => ({ rows: [] })),
      pool.query("SELECT run_id, agent_name, status, started_at, completed_at, findings_count, duration_ms, error_message FROM agent_runs WHERE started_at >= NOW()-INTERVAL '48 hours' ORDER BY started_at DESC LIMIT 50").catch(() => ({ rows: [] })),
      pool.query("SELECT agent_name, SUM(total_runs) as total_runs, SUM(successful_runs) as successful_runs, SUM(total_recommendations) as total_recommendations, ROUND(AVG(avg_duration_ms)) as avg_duration_ms FROM agent_performance WHERE period_end >= NOW()-INTERVAL '7 days' GROUP BY agent_name ORDER BY agent_name").catch(() => ({ rows: [] })),
      pool.query("SELECT overall_accuracy, qualification_accuracy, decision_accuracy, conversation_accuracy, coaching_effectiveness, snapshot_date FROM ai_accuracy_snapshots ORDER BY snapshot_date DESC LIMIT 7").catch(() => ({ rows: [] }))
    ]);
    const schedules = AgentOrchestrator.getSchedules();
    const agentStatusMap = {};
    for (const row of agentStatus.rows) agentStatusMap[row.agent_name] = { ...row, schedule_interval_ms: schedules[row.agent_name] && schedules[row.agent_name].intervalMs, is_scheduled: AgentOrchestrator.isStarted() };
    for (const name of Object.keys(schedules)) {
      if (!agentStatusMap[name]) agentStatusMap[name] = { agent_name: name, total_runs: 0, successful_runs: 0, failed_runs: 0, last_run_at: null, avg_findings: 0, avg_duration_ms: 0, total_findings_24h: 0, schedule_interval_ms: schedules[name].intervalMs, is_scheduled: AgentOrchestrator.isStarted() };
    }
    res.json({ success: true, dashboard: { agents: agentStatusMap, active_recommendations: activeRecs.rows, revenue_opportunities: opportunities.rows, revenue_risks: risks.rows, automation_history: recentHistory.rows, agent_performance: agentPerf.rows, ai_confidence_trends: learningSnap.rows, summary: { total_agents: Object.keys(schedules).length, active_agents: Object.values(agentStatusMap).filter(a => parseInt(a.total_runs||0) > 0).length, open_recommendations: activeRecs.rows.length, high_priority_recommendations: activeRecs.rows.filter(r => r.priority === 'high').length, revenue_opportunities: opportunities.rows.length, revenue_risks: risks.rows.length, orchestrator_running: AgentOrchestrator.isStarted() } }, retrieved_at: new Date().toISOString() });
  } catch (err) { console.error('[AgentRoutes] Dashboard error:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

router.get('/status', async (req, res) => {
  try {
    const latest = await pool.query("SELECT agent_name, status, started_at, completed_at, findings_count, error_message FROM agent_runs ORDER BY started_at DESC LIMIT 20").catch(() => ({ rows: [] }));
    res.json({ success: true, orchestrator_running: AgentOrchestrator.isStarted(), recent_runs: latest.rows, retrieved_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/recommendations', async (req, res) => {
  try {
    const { agent, status = 'open', priority, limit = '20', offset = '0' } = req.query;
    let q = "SELECT * FROM agent_recommendations WHERE 1=1"; const vals = [];
    if (agent) { vals.push(agent); q += ' AND agent_name=$'+vals.length; }
    if (status) { vals.push(status); q += ' AND status=$'+vals.length; }
    if (priority) { vals.push(priority); q += ' AND priority=$'+vals.length; }
    vals.push(parseInt(limit)); q += " ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, confidence DESC, created_at DESC LIMIT $"+vals.length;
    vals.push(parseInt(offset)); q += ' OFFSET $'+vals.length;
    const r = await pool.query(q, vals);
    res.json({ success: true, recommendations: r.rows, count: r.rows.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/run/:agent_name', async (req, res) => {
  try {
    const { agent_name } = req.params;
    const validAgents = ['revenue_optimization','sales_coach','customer_success','executive_monitoring','operational_intel'];
    if (!validAgents.includes(agent_name)) return res.status(400).json({ success: false, error: 'Unknown agent: ' + agent_name });
    await AgentOrchestrator.runManual(agent_name);
    res.json({ success: true, message: 'Agent ' + agent_name + ' enqueued for execution', agent_name, enqueued_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/recommendations/:rec_id', async (req, res) => {
  try {
    const { rec_id } = req.params;
    const { status, approved_by } = req.body;
    if (!['actioned','dismissed','in_review'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
    const r = await pool.query("UPDATE agent_recommendations SET status=$1, approved_by=$2, actioned_at=NOW(), updated_at=NOW() WHERE rec_id=$3 RETURNING *", [status, approved_by || (req.user && req.user.email) || 'user', rec_id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Recommendation not found' });
    res.json({ success: true, recommendation: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
