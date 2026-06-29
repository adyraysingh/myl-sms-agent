'use strict';
const pool = require('../memory/db/pool');
const PredictionPublisher = require('../learning/services/PredictionPublisher');
const AGENTS = {
  revenue_optimization: () => require('./services/RevenueOptimizationAgent'),
  sales_coach:          () => require('./services/SalesCoachAgent'),
  customer_success:     () => require('./services/CustomerSuccessAgent'),
  executive_monitoring: () => require('./services/ExecutiveMonitoringAgent'),
  operational_intel:    () => require('./services/OperationalIntelligenceAgent')
};
class AgentRunner {
  static async run(payload) {
    const { agent_name, scheduled_at } = payload;
    const AgentClass = AGENTS[agent_name];
    if (!AgentClass) throw new Error('[AgentRunner] Unknown agent: ' + agent_name);
    const runRes = await pool.query(
      "INSERT INTO agent_runs (agent_name, run_type, status, metadata) VALUES ($1,$2,$3,$4) RETURNING run_id",
      [agent_name, 'scheduled', 'running', JSON.stringify({ scheduled_at: scheduled_at || new Date().toISOString() })]
    ).catch(e => { console.error('[AgentRunner] Could not create run record:', e.message); return { rows: [{ run_id: null }] }; });
    const runId = runRes.rows[0] && runRes.rows[0].run_id;
    const startTime = Date.now();
    try {
      console.log('[AgentRunner] Starting agent:', agent_name, 'run_id:', runId);
      const result = await AgentClass().run(runId);
      const durationMs = Date.now() - startTime;
      if (runId) {
        await pool.query(
          "UPDATE agent_runs SET status=$1, completed_at=NOW(), duration_ms=$2, findings_count=$3, recommendations_count=$4 WHERE run_id=$5",
          ['completed', durationMs, result.findings_count || 0, result.findings_count || 0, runId]
        ).catch(() => {});
      }
      await AgentRunner._updatePerformance(agent_name, result.findings_count || 0);
      setImmediate(() => PredictionPublisher.linkOutcome({ module: 'agent_' + agent_name, lead_id: null, outcome_type: 'agent_run_completed', outcome_value: { run_id: runId, findings_count: result.findings_count, duration_ms: durationMs }, is_correct: null, accuracy_score: result.findings_count > 0 ? 0.8 : 0.5, notes: agent_name + ' completed: ' + result.findings_count + ' findings in ' + durationMs + 'ms', source: 'agent_runner' }).catch(() => {}));
      console.log('[AgentRunner] Agent', agent_name, 'completed:', result.findings_count, 'findings in', durationMs, 'ms');
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      console.error('[AgentRunner] Agent', agent_name, 'failed:', err.message);
      if (runId) await pool.query("UPDATE agent_runs SET status=$1, completed_at=NOW(), duration_ms=$2, error_message=$3 WHERE run_id=$4", ['failed', durationMs, err.message, runId]).catch(() => {});
      throw err;
    }
  }
  static async _updatePerformance(agentName, recCount) {
    try {
      const periodStart = new Date(Date.now() - 24*60*60*1000).toISOString();
      const periodEnd = new Date().toISOString();
      const s = await pool.query("SELECT COUNT(*) as total_runs, COUNT(*) FILTER (WHERE status='completed') as successful_runs, COALESCE(AVG(duration_ms),0) as avg_dur FROM agent_runs WHERE agent_name=$1 AND started_at >= $2", [agentName, periodStart]);
      const r = s.rows[0] || {};
      await pool.query("INSERT INTO agent_performance (agent_name, period_start, period_end, total_runs, successful_runs, total_recommendations, avg_duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)", [agentName, periodStart, periodEnd, r.total_runs||0, r.successful_runs||0, recCount, Math.round(parseFloat(r.avg_dur||0))]).catch(() => {});
    } catch (e) {}
  }
  static getAgentNames() { return Object.keys(AGENTS); }
}
module.exports = AgentRunner;
