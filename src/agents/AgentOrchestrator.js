'use strict';
const JobQueue = require('../queue/JobQueue');
const AGENT_SCHEDULES = {
  revenue_optimization: { intervalMs: 15*60*1000, priority: 3 },
  sales_coach:          { intervalMs: 30*60*1000, priority: 4 },
  customer_success:     { intervalMs: 20*60*1000, priority: 3 },
  executive_monitoring: { intervalMs: 10*60*1000, priority: 2 },
  operational_intel:    { intervalMs:  5*60*1000, priority: 2 }
};
const _timers = {}; let _started = false;
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
    console.log('[AgentOrchestrator] Phase 4: 5 autonomous agents scheduled');
  },
  stop() { Object.values(_timers).forEach(t => clearInterval(t)); _started = false; },
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
  isStarted() { return _started; },
  getSchedules() { return AGENT_SCHEDULES; }
};
module.exports = AgentOrchestrator;
