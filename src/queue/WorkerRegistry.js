'use strict';
/**
 * WorkerRegistry - Phase 2 Durable Infrastructure
 * Central registry for all queue workers.
 * Starts/stops all workers, handles graceful shutdown.
 * Wraps existing business processors without changing their logic.
 */

const QueueWorker = require('./QueueWorker');
const JobQueue = require('./JobQueue');

// Lazy-load processors to avoid circular dependencies
let _QualificationProcessor, _DecisionProcessor, _ConversationProcessor;
let _AgentRunner;
let _RevenueForecaster, _LearningEngine, _IntelligenceProcessor, _WorkflowEngine;

function getQP() { if (!_QualificationProcessor) _QualificationProcessor = require('../qualification/services/QualificationProcessor'); return _QualificationProcessor; }
function getDP() { if (!_DecisionProcessor) _DecisionProcessor = require('../decisions/services/DecisionProcessor'); return _DecisionProcessor; }
function getCP() { if (!_ConversationProcessor) _ConversationProcessor = require('../intelligence/services/ConversationProcessor'); return _ConversationProcessor; }
function getRF() { if (!_RevenueForecaster) _RevenueForecaster = require('../revenue/services/RevenueForecaster'); return _RevenueForecaster; }
function getLE() { if (!_LearningEngine) _LearningEngine = require('../learning/services/LearningEngine'); return _LearningEngine; }
function getAR() { if (!_AgentRunner) _AgentRunner = require("../agents/AgentRunner"); return _AgentRunner; }
function getIP() { if (!_IntelligenceProcessor) _IntelligenceProcessor = require('../intelligence/services/IntelligenceProcessor'); return _IntelligenceProcessor; }

// ─── Job Handlers ───────────────────────────────────────────────────────────

async function handleQualification(payload) {
  const { leadId, zohoLeadId, triggerEvent, triggerRef } = payload;
  await getQP().submit({ leadId, zohoLeadId, triggerEvent, triggerRef });
}

async function handleDecision(payload) {
  const { lead_id, trigger_event, trigger_source, trigger_data } = payload;
  await getDP().queueDecisionGeneration(lead_id, trigger_event, trigger_source, trigger_data || {});
}

async function handleConversation(payload) {
  const { conversationId, leadId, zohoLeadId, sourceType, sourceRef, transcript, leadInfo } = payload;
  await getCP().submit({ conversationId, leadId, zohoLeadId, sourceType, sourceRef, transcript, leadInfo });
}

async function handleRevenueForecast(payload) {
  const RF = getRF();
  const bounds = RF.getPeriodBounds(payload.period || 'daily');
  await RF.runForecast(payload.period || 'daily', bounds.start, bounds.end);
}

async function handleLearningEvaluation(payload) {
  await getLE().runFullEvaluation();
}

async function handleIntelligenceRefresh(payload) {
  await getIP().triggerRefresh(payload.event_type || 'manual', payload.context || {});
}

async function handleAgentRun(payload) {
  const AR = getAR();
  await AR.run(payload);
}

// ─── Worker Configuration ───────────────────────────────────────────────────

const WORKER_CONFIG = [
  {
    queueName: 'qualification',
    handler: handleQualification,
    pollIntervalMs: 3000,
    concurrency: 2,
    batchSize: 2
  },
  {
    queueName: 'decision',
    handler: handleDecision,
    pollIntervalMs: 5000,
    concurrency: 2,
    batchSize: 2
  },
  {
    queueName: 'conversation',
    handler: handleConversation,
    pollIntervalMs: 2000,
    concurrency: 3,
    batchSize: 2
  },
  {
    queueName: 'revenue',
    handler: handleRevenueForecast,
    pollIntervalMs: 30000,
    concurrency: 1,
    batchSize: 1
  },
  {
    queueName: 'learning',
    handler: handleLearningEvaluation,
    pollIntervalMs: 60000,
    concurrency: 1,
    batchSize: 1
  },
  {
    queueName: 'agent',
    handler: handleAgentRun,
    pollIntervalMs: 60000,
    concurrency: 2,
    batchSize: 1
  },
  {
    queueName: 'intelligence',
    handler: handleIntelligenceRefresh,
    pollIntervalMs: 10000,
    concurrency: 2,
    batchSize: 2
  }
];

// ─── Registry ───────────────────────────────────────────────────────────────

const _workers = [];
let _started = false;

const WorkerRegistry = {
  start() {
    if (_started) return;
    _started = true;
    for (const config of WORKER_CONFIG) {
      const worker = new QueueWorker(config);
      worker.start();
      _workers.push(worker);
    }
    console.log('[WorkerRegistry] Started', _workers.length, 'queue workers');
    // Register SIGTERM handler for graceful shutdown
    process.once('SIGTERM', () => WorkerRegistry.stop());
    process.once('SIGINT', () => WorkerRegistry.stop());
  },

  async stop() {
    console.log('[WorkerRegistry] Stopping all workers...');
    await Promise.all(_workers.map(w => w.stop()));
    _started = false;
    console.log('[WorkerRegistry] All workers stopped');
  },

  getStats() {
    return _workers.map(w => w.getStats());
  },

  async getFullStats() {
    const workerStats = _workers.map(w => w.getStats());
    const queueStats = await JobQueue.getQueueStats().catch(() => []);
    const dlq = await JobQueue.getDLQ(null, 20).catch(() => []);
    return { workers: workerStats, queues: queueStats, dlq_count: dlq.length, dlq_sample: dlq.slice(0, 5) };
  },

  isStarted() { return _started; }
};

// ─── Convenience enqueue helpers ────────────────────────────────────────────

WorkerRegistry.enqueueQualification = function({ leadId, zohoLeadId, triggerEvent, triggerRef }) {
  const key = 'qualify:' + leadId + ':' + triggerEvent;
  return JobQueue.enqueue({
    queueName: 'qualification',
    jobType: 'qualify_lead',
    payload: { leadId, zohoLeadId, triggerEvent, triggerRef },
    priority: 3,
    maxAttempts: 3,
    idempotencyKey: key
  });
};

WorkerRegistry.enqueueDecision = function({ lead_id, trigger_event, trigger_source, trigger_data }) {
  const key = 'decision:' + lead_id + ':' + trigger_event + ':' + Date.now();
  return JobQueue.enqueue({
    queueName: 'decision',
    jobType: 'generate_decision',
    payload: { lead_id, trigger_event, trigger_source, trigger_data },
    priority: 3,
    maxAttempts: 3
  });
};

WorkerRegistry.enqueueConversation = function({ conversationId, leadId, zohoLeadId, sourceType, sourceRef, transcript, leadInfo }) {
  return JobQueue.enqueue({
    queueName: 'conversation',
    jobType: 'analyze_conversation',
    payload: { conversationId, leadId, zohoLeadId, sourceType, sourceRef, transcript, leadInfo },
    priority: 2,
    maxAttempts: 3,
    idempotencyKey: 'conv:' + conversationId
  });
};

WorkerRegistry.enqueueRevenueForecast = function({ period = 'daily' } = {}) {
  return JobQueue.enqueue({
    queueName: 'revenue',
    jobType: 'revenue_forecast',
    payload: { period },
    priority: 5,
    maxAttempts: 2,
    delayMs: 0
  });
};

WorkerRegistry.enqueueAgent = function({ agent_name, scheduled_at }) {
  return JobQueue.enqueue({ queueName: "agent", jobType: "run_agent", payload: { agent_name, scheduled_at: scheduled_at || new Date().toISOString() }, priority: 3, maxAttempts: 2, idempotencyKey: "agent:" + agent_name + ":" + Math.floor(Date.now()/60000) });
};

module.exports = WorkerRegistry;
