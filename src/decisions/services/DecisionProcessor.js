'use strict';
const pool = require('../../memory/db/pool');
const AIDecision = require('../models/AIDecision');
const DecisionHistory = require('../models/DecisionHistory');
const DecisionEngine = require('./DecisionEngine');
const ZohoDecisionSync = require('./ZohoDecisionSync');
const SlackNotifier = require('../../services/SlackNotifier');
const { ContextEngine, InsufficientContextError } = require('../../services/ContextEngine');

/**
 * DecisionProcessor
 * Queues and processes AI decision generation for leads.
 *
 * EVIDENCE GATE (NEW):
 * Before calling DecisionEngine (GPT-4o), ContextEngine.requireContext()
 * is invoked. If the lead does not meet the minimum evidence threshold,
 * the queue item is marked as 'insufficient_context' and no decision is
 * generated. This prevents the AI from producing confident-sounding
 * recommendations based on a bare lead record with no interaction history.
 *
 * Minimum threshold: DECISION_EVIDENCE_THRESHOLD env var (default 30).
 * A score of 30 requires: CRM profile (10) + at least one conversation (25)
 * = 35 pts, which clears the bar. A lead with only profile = 10 pts, blocked.
 */

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

      // ─── EVIDENCE GATE ────────────────────────────────────────────────────────
      // Resolve the internal lead UUID: item.lead_id might be a Zoho ID if
      // the decision was queued with a Zoho lead ID. Try both lookups.
      let resolvedLeadId = item.lead_id;
      let resolvedZohoId = null;

      const memRow = await pool.query(
        'SELECT id, zoho_lead_id FROM lead_memory WHERE id = $1 OR zoho_lead_id = $1 LIMIT 1',
        [item.lead_id]
      ).then(r => r.rows[0] || null).catch(() => null);

      if (memRow) {
        resolvedLeadId = memRow.id;
        resolvedZohoId = memRow.zoho_lead_id;
      }

      let contextResult;
      try {
        contextResult = await ContextEngine.requireContext(resolvedLeadId, resolvedZohoId, 'decision');
        console.log(`[DP] Evidence gate passed: score=${contextResult.evidence_score} lead=${resolvedLeadId}`);
      } catch (ctxErr) {
        if (ctxErr.code === 'INSUFFICIENT_CONTEXT') {
          console.warn(`[DP] INSUFFICIENT CONTEXT for lead ${resolvedLeadId}: score=${ctxErr.evidenceScore}. Missing: ${ctxErr.missingSignals.map(s => s.signal).join(', ')}`);
          await AIDecision.updateQueueStatus(
            item.queue_id,
            'insufficient_context',
            'Insufficient evidence. Score: ' + ctxErr.evidenceScore + '/30. Missing: ' + ctxErr.missingSignals.map(s => s.signal).join('; ')
          );
          return;
        }
        throw ctxErr;
      }

      // ─── Normal decision generation ──────────────────────────────────────────
      // Use the context already aggregated by ContextEngine instead of re-querying
      const leadData = DecisionProcessor._buildLeadDataFromContext(
        resolvedLeadId, resolvedZohoId, item.trigger_event, item.trigger_source, contextResult
      );

      await AIDecision.expireOldDecisions(resolvedLeadId);
      const result = await DecisionEngine.generateDecisions(leadData);
      const saved = [];

      for (const d of result.decisions) {
        const dec = await AIDecision.create(d);
        saved.push(dec);
        await DecisionHistory.record({
          decision_id: dec.decision_id,
          lead_id: dec.lead_id,
          previous_status: null,
          new_status: 'created',
          change_reason: 'AI generated',
          trigger_event: item.trigger_event,
          metadata: {}
        });
        if (dec.priority === 'critical' || dec.priority === 'high') {
          await SlackNotifier.notifyDecision(dec, leadData.memory).catch(e => console.error('[DP] Slack error:', e.message));
        }
      }

      if (saved.length > 0) await ZohoDecisionSync.syncToZoho(resolvedLeadId, saved[0], result);
      await DecisionProcessor._storeInTimeline(resolvedLeadId, saved, result);
      await AIDecision.updateQueueStatus(item.queue_id, 'completed');

    } catch (err) {
      console.error('[DP] Error for lead:', item.lead_id, err.message);
      await AIDecision.updateQueueStatus(
        item.queue_id,
        item.attempts >= item.max_attempts - 1 ? 'failed' : 'pending',
        err.message
      );
    }
  }

  /**
   * Build the leadData object expected by DecisionEngine from a ContextEngine result.
   * Avoids a second full database scan.
   */
  static _buildLeadDataFromContext(lead_id, zoho_lead_id, trigger_event, trigger_source, ctx) {
    const { context, signal_counts } = ctx;
    const mem = context.profile || {};
    const qual = context.qualification || null;
    const conv = context.latest_conversation || {};

    // Memory row shape expected by DecisionEngine._buildPrompt
    const memory = {
      id:                lead_id,
      zoho_lead_id:      zoho_lead_id,
      customer_name:     mem.name,
      name:              mem.name,
      email:             mem.email,
      phone:             mem.phone,
      country:           mem.country,
      brand_name:        mem.brand_name,
      lead_source:       mem.lead_source,
      crm_owner:         mem.crm_owner,
      last_activity_at:  mem.last_activity
    };

    // Qualification row shape expected by DecisionEngine._buildPrompt
    const qualification = qual ? {
      qualification_category:   qual.category,
      onboarding_score:         qual.onboarding_score,
      onboarding_probability:   qual.onboarding_probability,
      trust_score:              qual.trust_score,
      budget_confidence:        qual.budget_confidence,
      timeline_confidence:      qual.timeline_confidence,
      brand_readiness:          qual.brand_readiness,
      confidence_score:         qual.confidence_score,
      qualification_reason:     qual.overall_reasoning,
      missing_information:      (qual.qualification_gaps || []).map(g => g.gap)
    } : null;

    // Conversation rows shape (DecisionEngine uses .summary, .customer_intent, etc.)
    const conversations = context.all_conversations.map(c => ({
      summary:               c.intent,
      customer_intent:       c.intent,
      sentiment:             c.sentiment,
      trust_score:           c.trust,
      buying_intent_score:   c.buying_intent,
      positive_buying_signals: [],
      objections:            [],
      recommended_next_step: null
    }));

    // Enrich first conversation with full latest data
    if (conversations.length > 0) {
      conversations[0] = {
        summary:                  conv.summary,
        customer_intent:          conv.customer_intent,
        sentiment:                conv.sentiment,
        trust_score:              conv.trust_score,
        buying_intent_score:      conv.buying_intent_score,
        positive_buying_signals:  conv.positive_buying_signals || [],
        objections:               conv.objections || [],
        recommended_next_step:    conv.recommended_next_step
      };
    }

    return {
      lead_id,
      crm_owner:      mem.crm_owner || null,
      trigger_event,
      trigger_source,
      memory,
      conversations,
      qualification,
      events:         context.recent_events.map(e => ({ event_type: e.type, summary: e.summary, created_at: e.created_at })),
      tasks:          context.tasks.map(t => ({ task_type: t.type, status: t.status, due_date: t.due_date })),
      notes:          context.notes.map(n => ({ content: n.content, created_at: n.created_at })),
      evidence_score: ctx.evidence_score,
      missing_signals: ctx.missing_signals
    };
  }

  static async _storeInTimeline(lead_id, decisions, result) {
    try {
      if (!decisions.length) return;
      const s = decisions.map(d => d.priority + ':' + d.decision_type).join(';');
      await pool.query(
        'INSERT INTO lead_events (lead_id, event_type, source, summary, metadata) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [lead_id, 'ai_decision_generated', 'decision_engine', 'AI decisions: ' + s, JSON.stringify({ count: decisions.length, urgency: result.urgency_level })]
      );
    } catch (err) { console.error('[DP] Timeline error:', err.message); }
  }

  static async updateDecisionStatus(decision_id, new_status, extra) {
    extra = extra || {};
    const decision = await AIDecision.findById(decision_id);
    if (!decision) throw new Error('Decision not found: ' + decision_id);
    const updated = await AIDecision.updateStatus(decision_id, new_status, extra);
    await DecisionHistory.record({
      decision_id, lead_id: decision.lead_id,
      previous_status: decision.status, new_status,
      change_reason: extra.reason || 'Updated',
      changed_by: extra.changed_by || 'system',
      metadata: extra
    });
    return updated;
  }

  static getQueueStatus() { return { isProcessing, processorRunning: !!processorInterval }; }
}

module.exports = DecisionProcessor;
