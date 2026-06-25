'use strict';

const LeadQualification = require('../models/LeadQualification');
const QualificationHistory = require('../models/QualificationHistory');
const QualificationEngine = require('./QualificationEngine');
const ZohoQualificationSync = require('./ZohoQualificationSync');
const pool = require('../../memory/db/pool');

/**
 * QualificationProcessor
 * Orchestrates async qualification recalculation.
 * Aggregates data from Business Memory + Conversation Intelligence,
 * runs QualificationEngine, saves results, records history, syncs Zoho.
 * Phase 4 - Onboarding Qualification Engine
 */

const queue = [];
let isProcessing = false;
let activeJobs = 0;
const MAX_CONCURRENT = 2;

class QualificationProcessor {

  /**
   * Submit a lead for qualification (non-blocking)
   * @param {object} params
   * @param {string} params.leadId - internal lead UUID
   * @param {string} params.zohoLeadId - Zoho CRM lead ID
   * @param {string} params.triggerEvent - what caused this recalculation
   * @param {string} params.triggerRef - reference to triggering record
   */
  static async submit({ leadId, zohoLeadId, triggerEvent, triggerRef }) {
    console.log(`[QualificationProcessor] Queuing qualification for lead ${leadId} | trigger: ${triggerEvent}`);

    // Deduplicate: if this lead already in queue, update trigger and skip
    const existing = queue.find(j => j.leadId === leadId);
    if (existing) {
      existing.triggerEvent = triggerEvent;
      existing.triggerRef = triggerRef;
      console.log(`[QualificationProcessor] Lead ${leadId} already queued - updated trigger`);
      return;
    }

    queue.push({ leadId, zohoLeadId, triggerEvent, triggerRef });

    QualificationProcessor._processQueue().catch(err => {
      console.error('[QualificationProcessor] Queue error:', err.message);
    });
  }

  static async _processQueue() {
    if (isProcessing && activeJobs >= MAX_CONCURRENT) return;
    isProcessing = true;

    while (queue.length > 0 && activeJobs < MAX_CONCURRENT) {
      const job = queue.shift();
      activeJobs++;
      QualificationProcessor._processJob(job).finally(() => {
        activeJobs--;
        if (queue.length > 0) QualificationProcessor._processQueue().catch(() => {});
      });
    }
    if (queue.length === 0 && activeJobs === 0) isProcessing = false;
  }

  static async _processJob({ leadId, zohoLeadId, triggerEvent, triggerRef }) {
    const startTime = Date.now();
    console.log(`[QualificationProcessor] Processing qualification for lead ${leadId}`);

    try {
      // 1. Aggregate all available data from Business Memory + Conversation Intelligence
      const leadData = await QualificationProcessor._aggregateLeadData(leadId, zohoLeadId);

      // 2. Get previous qualification for delta calculation
      const previousQual = await LeadQualification.findByLeadId(leadId);

      // 3. Run AI qualification
      const rawQual = await QualificationEngine.qualify(leadData);
      const sanitized = QualificationEngine.sanitize(rawQual);

      // 4. Calculate deltas
      const scoreDelta = sanitized.onboarding_score - (previousQual ? previousQual.onboarding_score : 0);
      const probabilityDelta = sanitized.onboarding_probability - (previousQual ? previousQual.onboarding_probability : 0);
      const categoryChanged = previousQual ? previousQual.category !== sanitized.category : false;

      // 5. Upsert current qualification
      const saved = await LeadQualification.upsert({
        ...sanitized,
        lead_id: leadId,
        zoho_lead_id: zohoLeadId || null,
        trigger_event: triggerEvent,
        trigger_ref: triggerRef || null,
        lead_snapshot: leadData
      });

      // 6. Record history entry
      await QualificationHistory.record({
        lead_id: leadId,
        qualification_id: saved.id,
        zoho_lead_id: zohoLeadId || null,
        category: sanitized.category,
        onboarding_score: sanitized.onboarding_score,
        onboarding_probability: sanitized.onboarding_probability,
        readiness_score: sanitized.readiness_score,
        trust_score: sanitized.trust_score,
        engagement_score: sanitized.engagement_score,
        confidence_score: sanitized.confidence_score,
        score_delta: scoreDelta,
        probability_delta: probabilityDelta,
        category_changed: categoryChanged,
        previous_category: previousQual ? previousQual.category : null,
        trigger_event: triggerEvent,
        trigger_ref: triggerRef || null,
        overall_reasoning: sanitized.overall_reasoning,
        qualification_gaps: sanitized.qualification_gaps,
        recommended_next_action: sanitized.recommended_next_action,
        lead_snapshot: leadData,
        model_version: sanitized.model_version,
        processing_time_ms: Date.now() - startTime
      });

      const elapsed = Date.now() - startTime;
      console.log(`[QualificationProcessor] Completed lead ${leadId}: category=${sanitized.category} score=${sanitized.onboarding_score} delta=${scoreDelta > 0 ? '+' : ''}${scoreDelta} time=${elapsed}ms`);

      // 7. Sync to Zoho CRM (non-blocking)
      if (zohoLeadId) {
        ZohoQualificationSync.sync(zohoLeadId, saved.id, sanitized).catch(err => {
          console.error(`[QualificationProcessor] Zoho sync failed:`, err.message);
        });
      }

      return saved;
    } catch (err) {
      console.error(`[QualificationProcessor] Failed for lead ${leadId}:`, err.message);
      await LeadQualification.markFailed(leadId, err.message).catch(() => {});
    }
  }

  /**
   * Aggregate all available lead intelligence from:
   * - Business Memory (lead_memory, lead_events)
   * - Conversation Intelligence (conversation_analysis)
   */
  static async _aggregateLeadData(leadId, zohoLeadId) {
    const results = await Promise.allSettled([
      pool.query('SELECT * FROM lead_memory WHERE id = $1 LIMIT 1', [leadId]),
      pool.query('SELECT * FROM lead_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 20', [leadId]),
      pool.query(`SELECT * FROM conversation_analysis WHERE lead_id = $1 AND analysis_status = 'completed' ORDER BY analyzed_at DESC LIMIT 5`, [leadId]),
      pool.query('SELECT * FROM retell_calls WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5', [leadId]),
      pool.query('SELECT * FROM email_events WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10', [leadId]),
      pool.query('SELECT * FROM crm_tasks WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10', [leadId]),
      pool.query('SELECT * FROM crm_notes WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10', [leadId]),
      pool.query('SELECT COUNT(*) as count FROM qualification_history WHERE lead_id = $1', [leadId])
    ]);

    const get = (i) => results[i].status === 'fulfilled' ? results[i].value.rows : [];

    const leadMemory = get(0)[0] || {};
    const events = get(1);
    const analyses = get(2);
    const calls = get(3);
    const emails = get(4);
    const tasks = get(5);
    const notes = get(6);
    const historyCount = parseInt((get(7)[0] || {}).count || 0);

    // Build the most recent conversation analysis summary
    const latestAnalysis = analyses[0] || {};

    return {
      lead_id: leadId,
      zoho_lead_id: zohoLeadId,
      recalculation_number: historyCount + 1,

      // Lead Profile
      profile: {
        name: leadMemory.name,
        email: leadMemory.email,
        phone: leadMemory.phone,
        country: leadMemory.country || latestAnalysis.country,
        source: leadMemory.lead_source,
        created_at: leadMemory.created_at,
        last_activity: leadMemory.last_activity_at
      },

      // Activity Summary
      activity: {
        total_events: events.length,
        total_conversations: analyses.length,
        total_calls: calls.length,
        total_emails: emails.length,
        total_tasks: tasks.length,
        total_notes: notes.length,
        event_types: [...new Set(events.map(e => e.event_type))],
        last_event_at: events[0] ? events[0].created_at : null
      },

      // Latest Conversation Intelligence
      latest_analysis: {
        summary: latestAnalysis.summary,
        customer_intent: latestAnalysis.customer_intent,
        conversation_stage: latestAnalysis.conversation_stage,
        brand_stage: latestAnalysis.brand_stage,
        sentiment: latestAnalysis.sentiment,
        trust_score: latestAnalysis.trust_score,
        buying_intent_score: latestAnalysis.buying_intent_score,
        budget_detected: latestAnalysis.budget_detected,
        budget_value: latestAnalysis.budget_value,
        timeline_detected: latestAnalysis.timeline_detected,
        timeline_value: latestAnalysis.timeline_value,
        manufacturing_stage: latestAnalysis.manufacturing_stage,
        shopify_status: latestAnalysis.shopify_status,
        experience_level: latestAnalysis.experience_level,
        brand_readiness: latestAnalysis.brand_readiness,
        product_interest: latestAnalysis.product_interest,
        products_requested: latestAnalysis.products_requested,
        questions: latestAnalysis.questions,
        objections: latestAnalysis.objections,
        positive_buying_signals: latestAnalysis.positive_buying_signals,
        negative_buying_signals: latestAnalysis.negative_buying_signals,
        topics_detected: latestAnalysis.topics_detected,
        key_requirements: latestAnalysis.key_requirements,
        conversation_quality: latestAnalysis.conversation_quality,
        conversation_outcome: latestAnalysis.conversation_outcome,
        recommended_next_step: latestAnalysis.recommended_next_step,
        analyzed_at: latestAnalysis.analyzed_at
      },

      // All analyses summary
      all_analyses_summary: analyses.map(a => ({
        intent: a.customer_intent,
        sentiment: a.sentiment,
        trust: a.trust_score,
        buying_intent: a.buying_intent_score,
        outcome: a.conversation_outcome,
        analyzed_at: a.analyzed_at
      })),

      // Call activity
      calls_summary: calls.map(c => ({
        duration: c.duration_seconds,
        outcome: c.call_outcome,
        sentiment: c.sentiment,
        created_at: c.created_at
      })),

      // Email activity
      emails_summary: emails.map(e => ({
        direction: e.direction,
        subject: e.subject,
        created_at: e.created_at
      })),

      // Task and notes
      tasks_summary: tasks.map(t => ({
        type: t.task_type,
        status: t.status,
        due_date: t.due_date
      })),
      notes_summary: notes.map(n => ({
        content: n.content ? n.content.substring(0, 200) : null,
        created_at: n.created_at
      }))
    };
  }

  /**
   * Get queue status
   */
  static status() {
    return { queueSize: queue.length, activeJobs, isProcessing };
  }
}

module.exports = QualificationProcessor;
