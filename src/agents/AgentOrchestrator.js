'use strict';
const JobQueue = require('../queue/JobQueue');
const pool = require('../memory/db/pool');

const AGENT_SCHEDULES = {
    revenue_optimization: { intervalMs: 15*60*1000, priority: 3 },
    sales_coach: { intervalMs: 30*60*1000, priority: 4 },
    customer_success: { intervalMs: 20*60*1000, priority: 3 },
    executive_monitoring: { intervalMs: 10*60*1000, priority: 2 },
    operational_intel: { intervalMs: 5*60*1000, priority: 2 }
};

const _timers = {};
let _started = false;
let _lifecycleTimer = null;

// Bug #12 Fix: Recommendation Lifecycle
async function runRecommendationLifecycle() {
    try {
          const r1 = await pool.query("UPDATE agent_recommendations SET status='expired', updated_at=NOW() WHERE status='open' AND expires_at IS NOT NULL AND expires_at < NOW() RETURNING rec_id");
          if (r1.rowCount > 0) console.log('[AgentOrchestrator] Expired', r1.rowCount, 'past-due recommendations');
          const r2 = await pool.query("UPDATE agent_recommendations r SET status='in_progress', updated_at=NOW() FROM automation_workflows w WHERE r.workflow_id=w.workflow_id AND r.status='open' AND w.status IN ('running','completed') RETURNING r.rec_id");
          if (r2.rowCount > 0) console.log('[AgentOrchestrator] Marked', r2.rowCount, 'recommendations in_progress');
          const r3 = await pool.query("UPDATE agent_recommendations r SET status='accepted', actioned_at=NOW(), updated_at=NOW() FROM automation_workflows w WHERE r.workflow_id=w.workflow_id AND r.status='in_progress' AND w.status='completed' RETURNING r.rec_id");
          if (r3.rowCount > 0) console.log('[AgentOrchestrator] Accepted', r3.rowCount, 'recommendations');
          const r4 = await pool.query("UPDATE agent_recommendations r SET status='rejected', updated_at=NOW() FROM automation_workflows w WHERE r.workflow_id=w.workflow_id AND r.status='in_progress' AND w.status='failed' RETURNING r.rec_id");
          if (r4.rowCount > 0) console.log('[AgentOrchestrator] Rejected', r4.rowCount, 'recommendations');
          const r5 = await pool.query("UPDATE agent_recommendations SET status='expired', updated_at=NOW() WHERE status='open' AND expires_at IS NULL AND created_at < NOW() - INTERVAL '7 days' RETURNING rec_id");
          if (r5.rowCount > 0) console.log('[AgentOrchestrator] Expired', r5.rowCount, 'stale recommendations (>7days)');
    } catch (e) { console.error('[AgentOrchestrator] Lifecycle error:', e.message); }
}

const AgentOrchestrator = {
    start() {
          if (_started) return; _started = true;
          const names = Object.keys(AGENT_SCHEDULES);
          names.forEach((agentName, idx) => {
                  const cfg = AGENT_SCHEDULES[agentName];
                  setTimeout(() => {
                            AgentOrchestrator._enqueue(agentName, cfg.priority);
                            _timers[agentName] = setInterval(() => AgentOrchestrator._enqueue(agentName, cfg.priority), cfg.intervalMs);
                  }, idx * 45000);
          });
          setTimeout(() => { runRecommendationLifecycle(); _lifecycleTimer = setInterval(() => runRecommendationLifecycle(), 5*60*1000); }, 60000);
          console.log('[AgentOrchestrator] Phase 4: 5 autonomous agents scheduled + recommendation lifecycle active');
    },
    stop() { Object.values(_timers).forEach(t => clearInterval(t)); if (_lifecycleTimer) clearInterval(_lifecycleTimer); _started = false; },
    async _enqueue(agentName, priority) {
          try {
                  await JobQueue.enqueue({ queueName: 'agent', jobType: 'run_agent',
                                                  payload: { agent_name: agentName, scheduled_at: new Date().toISOString() },
                                                  priority, maxAttempts: 2,
                                                  idempotencyKey: 'agent:' + agentName + ':' + Math.floor(Date.now() / 60000),
                                                  retryBackoff: 'linear', retryDelayMs: 30000 });
          } catch (e) { console.error('[AgentOrchestrator] Enqueue failed:', agentName, e.message); }
    },
    async runManual(agentName) { return AgentOrchestrator._enqueue(agentName, 1); },
    async runLifecycleManual() { return runRecommendationLifecycle(); },
    isStarted() { return _started; },
    getSchedules() { return AGENT_SCHEDULES; }
};
module.exports = AgentOrchestrator;
