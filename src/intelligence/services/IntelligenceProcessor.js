'use strict';
const pool = require('../../memory/db/pool');
const SalesPerformanceEngine = require('./SalesPerformanceEngine');
const BusinessInvestigationEngine = require('./BusinessInvestigationEngine');
const ExecutiveBriefingEngine = require('./ExecutiveBriefingEngine');
const SalesCoachingEngine = require('./SalesCoachingEngine');

let processorRunning = false;
let lastRunAt = null;

class IntelligenceProcessor {
  static isRunning() { return processorRunning; }
  static getLastRunAt() { return lastRunAt; }
  static async triggerRefresh(trigger_event, payload) {
    trigger_event = trigger_event || 'manual';
    payload = payload || {};
    console.log('[IntelligenceProcessor] Triggered by:', trigger_event);
    setImmediate(async () => {
      if (processorRunning) {
        await IntelligenceProcessor._enqueue('refresh_all', { trigger_event, payload });
        return;
      }
      await IntelligenceProcessor._runRefresh(trigger_event, payload);
    });
  }
  static async _runRefresh(trigger_event, payload) {
    payload = payload || {};
    processorRunning = true;
    const startTime = Date.now();
    try {
      await SalesPerformanceEngine.recalculateAll();
      const owners = await pool.query('SELECT DISTINCT owner_id, owner_name FROM sales_performance WHERE period_date = CURRENT_DATE LIMIT 20').catch(() => ({ rows: [] }));
      for (const owner of owners.rows) {
        await SalesCoachingEngine.generateForOwner(owner.owner_id, owner.owner_name).catch(e => console.error('[IP] Coaching error:', e.message));
      }
      const conv_triggers = ['conversation_analyzed', 'qualification_updated', 'lead_updated'];
      if (conv_triggers.includes(trigger_event)) {
        await BusinessInvestigationEngine.investigate('Why are current leads not converting and what should we do today?', trigger_event, 'onboarding_drop').catch(e => console.error('[IP] Investigation error:', e.message));
      }
      const hour = new Date().getHours();
      let briefingType = null;
      if (hour >= 7 && hour < 10) briefingType = 'morning';
      else if (hour >= 12 && hour < 15) briefingType = 'midday';
      else if (hour >= 17 && hour < 20) briefingType = 'end_of_day';
      if (briefingType) {
        const existing = await pool.query("SELECT briefing_id FROM executive_briefings WHERE briefing_type = $1 AND DATE(generated_at) = CURRENT_DATE", [briefingType]).catch(() => ({ rows: [] }));
        if (existing.rows.length === 0) {
          await ExecutiveBriefingEngine.generate(briefingType).catch(e => console.error('[IP] Briefing error:', e.message));
        }
      }
      lastRunAt = new Date();
      console.log('[IntelligenceProcessor] Done in', Date.now() - startTime, 'ms');
      await IntelligenceProcessor._processQueue();
    } catch (err) {
      console.error('[IntelligenceProcessor] Failed:', err.message);
    } finally {
      processorRunning = false;
    }
  }
  static async runDailyInvestigations() {
    await BusinessInvestigationEngine.runDailyInvestigations().catch(e => console.error('[IP] Daily investigations error:', e.message));
  }
  static async _enqueue(task_type, payload) {
    payload = payload || {};
    try {
      await pool.query('INSERT INTO intelligence_queue (task_type, payload) VALUES ($1, $2)', [task_type, JSON.stringify(payload)]);
    } catch (e) {
      console.error('[IP] Enqueue error:', e.message);
    }
  }
  static async _processQueue() {
    try {
      const result = await pool.query("SELECT * FROM intelligence_queue WHERE status = 'pending' ORDER BY priority DESC, scheduled_at ASC LIMIT 3");
      for (const task of result.rows) {
        await pool.query("UPDATE intelligence_queue SET status = 'processing', started_at = NOW() WHERE queue_id = $1", [task.queue_id]);
        try {
          await IntelligenceProcessor._runRefresh(task.payload.trigger_event || 'queued', task.payload);
          await pool.query("UPDATE intelligence_queue SET status = 'completed', completed_at = NOW() WHERE queue_id = $1", [task.queue_id]);
        } catch (e) {
          await pool.query("UPDATE intelligence_queue SET status = 'failed', last_error = $1 WHERE queue_id = $2", [e.message, task.queue_id]);
        }
      }
    } catch (e) {
      console.error('[IP] Queue error:', e.message);
    }
  }
  static async getStatus() {
    const q = await pool.query("SELECT status, COUNT(*) as count FROM intelligence_queue GROUP BY status").catch(() => ({ rows: [] }));
    return { processorRunning, lastRunAt, queue: q.rows };
  }
}

module.exports = IntelligenceProcessor;
