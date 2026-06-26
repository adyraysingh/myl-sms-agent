'use strict';

const LeadQualification = require('../models/LeadQualification');
const QualificationHistory = require('../models/QualificationHistory');
const QualificationEngine = require('./QualificationEngine');
const ZohoQualificationSync = require('./ZohoQualificationSync');
const pool = require('../../memory/db/pool');
const { ContextEngine, InsufficientContextError } = require('../../services/ContextEngine');

/**
 * QualificationProcessor
 * Orchestrates async qualification recalculation.
 *
 * EVIDENCE GATE (NEW):
 * Before calling QualificationEngine (GPT-4o), ContextEngine.requireContext()
 * is invoked. If the lead does not meet the minimum evidence threshold, the
 * job is aborted and a structured "Insufficient Information" record is stored
 * instead of a hallucinated qualification score.
 *
 * Minimum threshold: QUALIFICATION_EVIDENCE_THRESHOLD env var (default 20).
 * A score of 20 requires at minimum a complete CRM profile (10 pts) + one
 * analyzed conversation or call (25 pts) -- meaning a brand-new lead with
 * only a name and email will score 10 points and will NOT be qualified.
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
      // ─── EVIDENCE GATE ────────────────────────────────────────────────────────
      // Evaluate how much evidence exists before running GPT-4o.
      // If the lead does not meet the minimum threshold, store an
      // "insufficient_information" record and exit early.
      let contextResult;
      try {
        contextResult = await ContextEngine.requireContext(leadId, zohoLeadId, 'qualification');
        console.log(`[QualificationProcessor] Evidence gate passed: score=${contextResult.evidence_score} lead=${leadId}`);
      } catch (ctxErr) {
        if (ctxErr.code === 'INSUFFICIENT_CONTEXT') {
          console.warn(`[QualificationProcessor] INSUFFICIENT CONTEXT for lead ${leadId}: score=${ctxErr.evidenceScore}. Missing: ${ctxErr.missingSignals.map(s => s.signal).join(', ')}`);
          // Store a placeholder qualification record so the dashboard shows
          // "Insufficient Information" instead of nothing.
          await QualificationProcessor._storeInsufficientRecord(leadId, zohoLeadId, triggerEvent, ctxErr, Date.now() - startTime);
          return;
        }
        throw ctxErr; // Re-throw unexpected errors
      }

      // Use context aggregated by ContextEngine rather than re-querying everything
      const leadData = {
        ...contextResult.context,
        lead_id: leadId,
        zoho_lead_id: zohoLeadId,
        recalculation_number: (await pool.query('SELECT COUNT(*) as count FROM qualification_history WHERE lead_id = $1', [leadId]).then(r => parseInt(r.rows[0].count || 0)).catch(() => 0)) + 1,
        profile: contextResult.context.profile,
        activity: {
          total_conversations: contextResult.signal_counts.conversations,
          total_calls:         contextResult.signal_counts.calls,
          total_emails:        contextResult.signal_counts.emails,
          total_tasks:         contextResult.signal_counts.tasks,
          total_notes:         contextResult.signal_counts.notes,
          total_events:        contextResult.signal_counts.events
        },
        latest_analysis:       contextResult.context.latest_conversation,
        all_analyses_summary:  contextResult.context.all_conversations,
        calls_summary:         contextResult.context.calls,
        emails_summary:        contextResult.context.emails,
        tasks_summary:         contextResult.context.tasks,
        notes_summary:         contextResult.context.notes
      };

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
   * Store an "Insufficient Information" placeholder in lead_qualification.
   * This ensures the dashboard shows a meaningful state instead of nothing.
   */
  static async _storeInsufficientRecord(leadId, zohoLeadId, triggerEvent, ctxErr, processingTimeMs) {
    try {
      await LeadQualification.upsert({
        lead_id:               leadId,
        zoho_lead_id:          zohoLeadId || null,
        category:              'unqualified',
        onboarding_score:      0,
        onboarding_probability: 0,
        readiness_score:       0,
        trust_score:           0,
        engagement_score:      0,
        budget_confidence:     0,
        timeline_confidence:   0,
        brand_readiness:       0,
        manufacturing_readiness: 0,
        communication_quality: 0,
        followup_health:       0,
        decision_confidence:   0,
        confidence_score:      0,
        overall_reasoning:     'Insufficient information. Evidence score: ' + ctxErr.evidenceScore + '/20 required. Missing: ' + ctxErr.missingSignals.map(s => s.signal).join('; '),
        score_breakdown:       {},
        factors:               {},
        qualification_gaps:    ctxErr.missingSignals.map(s => ({ gap: s.signal, severity: s.severity, impact_on_score: s.description })),
        positive_signals:      [],
        negative_signals:      [],
        recommended_next_action: ctxErr.missingSignals.length > 0 ? ctxErr.missingSignals[0].how_to_resolve : 'Gather more customer information',
        recommended_questions: ctxErr.missingSignals.map(s => s.how_to_resolve),
        urgency_level:         'normal',
        trigger_event:         triggerEvent,
        trigger_ref:           null,
        model_version:         'context_engine_v1',
        lead_snapshot:         { evidence_score: ctxErr.evidenceScore, missing_signals: ctxErr.missingSignals },
        insufficient_context:  true
      });
      console.log(`[QualificationProcessor] Stored insufficient context record for lead ${leadId}`);
    } catch (err) {
      console.error(`[QualificationProcessor] Failed to store insufficient record for ${leadId}:`, err.message);
    }
  }

  /**
   * Get queue status
   */
  static status() {
    return { queueSize: queue.length, activeJobs, isProcessing };
  }
}

module.exports = QualificationProcessor;
