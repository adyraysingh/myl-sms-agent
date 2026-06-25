'use strict';
const pool = require('../../memory/db/pool');
const AIDecision = require('../models/AIDecision');
const DecisionHistory = require('../models/DecisionHistory');
const DecisionEngine = require('./DecisionEngine');
const ZohoDecisionSync = require('./ZohoDecisionSync');
const SlackNotifier = require('./SlackNotifier');
let isProcessing = false;
let processorInterval = null;
class DecisionProcessor {
  static async queueDecisionGeneration(lead_id, trigger_event, trigger_source, trigger_data) {
    try {
      const item = await AIDecision.queueGeneration(lead_id, trigger_event, trigger_source, trigger_data || {});
      console.log('[DP] Queued for lead:', lead_id);
      setImmediate(() => DecisionProcessor.processQueue());
      return item;
    } catch (err) { console.error('[DP] Queue error:', err.message); }
  }
  static startQueueProcessor(intervalMs) {
    if (processorInterval) return;
    processorInterval = setInterval(() => {
      DecisionProcessor.processQueue().catch(err => console.error('[DP] Interval error:', err.message));
    }, intervalMs || 30000);
    console.log('[DP] Queue processor started');
  }
  static async processQueue() {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const items = await AIDecision.getPendingQueue(5);
      for (const item of items) await DecisionProcessor._processItem(item);
    } catch (err) { console.error('[DP] processQueue error:', err.message); }
    finally { isProcessing = false; }
  }
  static async _processItem(item) {
    try {
      await AIDecision.updateQueueStatus(item.queue_id, 'processing');
      const leadData = await DecisionProcessor._aggregateLeadData(item.lead_id, item.trigger_event, item.trigger_source);
      if (!leadData) { await AIDecision.updateQueueStatus(item.queue_id, 'failed', 'No lead data'); return; }
      await AIDecision.expireOldDecisions(item.lead_id);
      const result = await DecisionEngine.generateDecisions(leadData);
      const saved = [];
      for (const d of result.decisions) {
        const dec = await AIDecision.create(d);
        saved.push(dec);
        await DecisionHistory.record({ decision_id: dec.decision_id, lead_id: dec.lead_id, previous_status: null, new_status: 'created', change_reason: 'AI generated', trigger_event: item.trigger_event, metadata: {} });
        if (dec.priority === 'critical' || dec.priority === 'high') await SlackNotifier.notifyDecision(dec, leadData.memory);
      }
      if (saved.length > 0) await ZohoDecisionSync.syncToZoho(item.lead_id, saved[0], result);
      await DecisionProcessor._storeInTimeline(item.lead_id, saved, result);
      await AIDecision.updateQueueStatus(item.queue_id, 'completed');
    } catch (err) {
      console.error('[DP] Error for lead:', item.lead_id, err.message);
      await AIDecision.updateQueueStatus(item.queue_id, item.attempts >= item.max_attempts - 1 ? 'failed' : 'pending', err.message);
    }
  }
  static async _aggregateLeadData(lead_id, trigger_event, trigger_source) {
    const r = await Promise.allSettled([
      pool.query('SELECT * FROM lead_memory WHERE zoho_lead_id = $1 LIMIT 1', [lead_id]),
      pool.query('SELECT * FROM conversation_analysis WHERE lead_id = $1 ORDER BY analyzed_at DESC LIMIT 5', [lead_id]),
      pool.query('SELECT * FROM lead_qualification WHERE lead_id = $1 LIMIT 1', [lead_id]),
      pool.query('SELECT * FROM lead_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10', [lead_id]),
      pool.query('SELECT * FROM crm_tasks WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5', [lead_id]),
      pool.query('SELECT * FROM crm_notes WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5', [lead_id])
    ]);
    const memory = r[0].status === 'fulfilled' ? (r[0].value.rows[0] || null) : null;
    return { lead_id, crm_owner: (memory && memory.crm_owner) || null, trigger_event, trigger_source, memory, conversations: r[1].status === 'fulfilled' ? r[1].value.rows : [], qualification: r[2].status === 'fulfilled' ? (r[2].value.rows[0] || null) : null, events: r[3].status === 'fulfilled' ? r[3].value.rows : [], tasks: r[4].status === 'fulfilled' ? r[4].value.rows : [], notes: r[5].status === 'fulfilled' ? r[5].value.rows : [] };
  }
  static async _storeInTimeline(lead_id, decisions, result) {
    try {
      if (!decisions.length) return;
      const s = decisions.map(d => d.priority + ':' + d.decision_type).join(';');
      await pool.query('INSERT INTO lead_events (lead_id, event_type, source, summary, metadata) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [lead_id, 'ai_decision_generated', 'decision_engine', 'AI decisions: ' + s, JSON.stringify({ count: decisions.length, urgency: result.urgency_level })]);
    } catch (err) { console.error('[DP] Timeline error:', err.message); }
  }
  static async updateDecisionStatus(decision_id, new_status, extra) {
    extra = extra || {};
    const decision = await AIDecision.findById(decision_id);
    if (!decision) throw new Error('Decision not found: ' + decision_id);
    const updated = await AIDecision.updateStatus(decision_id, new_status, extra);
    await DecisionHistory.record({ decision_id, lead_id: decision.lead_id, previous_status: decision.status, new_status, change_reason: extra.reason || 'Updated', changed_by: extra.changed_by || 'system', metadata: extra });
    return updated;
  }
  static getQueueStatus() { return { isProcessing, processorRunning: !!processorInterval }; }
}
module.exports = DecisionProcessor;
