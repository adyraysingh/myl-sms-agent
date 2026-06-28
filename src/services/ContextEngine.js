'use strict';

/**
* ContextEngine
* Aggregates all available customer signals before allowing
* Qualification or Decision engines to run.
*
* Phase 3.7.3 Fix:
* _gatherSignals() used wrong column names for Business Memory tables.
* Tables created in 001_business_memory.sql use lead_memory_id (UUID FK),
* NOT lead_id. Fixed queries for: retell_calls, email_events, crm_tasks,
* crm_notes, lead_events.
* Tables in AI migrations use lead_id: conversation_analysis, lead_qualification.
*
* MINIMUM THRESHOLDS (configurable via env):
* QUALIFICATION_EVIDENCE_THRESHOLD default 20 (at least one conversation or call)
* DECISION_EVIDENCE_THRESHOLD default 30 (conversation + some qualification data)
*
* SIGNAL WEIGHTS (total possible = 100):
* CRM Profile complete (name+email+phone+country) 10
* At least 1 conversation / call / chat analyzed 25
* Qualification score already exists 20
* Budget signal detected in any conversation 15
* Timeline signal detected in any conversation 10
* 2+ conversations or calls 10
* CRM tasks or notes exist 5
* Email interaction detected 5
*/

const pool = require('../memory/db/pool');

const QUAL_THRESHOLD = parseInt(process.env.QUALIFICATION_EVIDENCE_THRESHOLD || '20', 10);
const DECISION_THRESHOLD = parseInt(process.env.DECISION_EVIDENCE_THRESHOLD || '30', 10);

class ContextEngine {

/**
  * Aggregate all signals for a lead and evaluate evidence readiness.
  *
  * @param {string} leadId - internal lead UUID (lead_memory.id)
  * @param {string} [zohoLeadId] - optional Zoho CRM lead ID (used for fallback lookups)
  * @returns {Promise<ContextResult>}
  */
static async evaluate(leadId, zohoLeadId) {
  const raw = await ContextEngine._gatherSignals(leadId, zohoLeadId);
  const scoring = ContextEngine._scoreSignals(raw);
  const missingSignals = ContextEngine._identifyMissingSignals(raw, scoring);

  return {
    lead_id: leadId,
    zoho_lead_id: zohoLeadId || null,
    evidence_score: scoring.total,
    signal_breakdown: scoring.breakdown,
    missing_signals: missingSignals,
    ready_for_qualification: scoring.total >= QUAL_THRESHOLD,
    ready_for_decision: scoring.total >= DECISION_THRESHOLD,
    thresholds: {
      qualification: QUAL_THRESHOLD,
      decision: DECISION_THRESHOLD
    },
    signal_counts: {
      conversations: raw.conversations.length,
      calls: raw.calls.length,
      emails: raw.emails.length,
      tasks: raw.tasks.length,
      notes: raw.notes.length,
      events: raw.events.length
    },
    has_existing_qualification: !!raw.qualification,
    has_budget_signal: raw.hasBudgetSignal,
    has_timeline_signal: raw.hasTimelineSignal,
    profile_complete: raw.profileComplete,
    context: ContextEngine._buildContext(raw)
  };
}

/**
  * Convenience: evaluate and throw a structured error if not ready.
  * Used inside QualificationProcessor and DecisionProcessor.
  *
  * @param {string} leadId
  * @param {string} zohoLeadId
  * @param {'qualification'|'decision'} purpose
  * @returns {Promise<ContextResult>} - if ready, returns the full context
  * @throws {InsufficientContextError} - if not ready
  */
static async requireContext(leadId, zohoLeadId, purpose) {
  const result = await ContextEngine.evaluate(leadId, zohoLeadId);
  const ready = purpose === 'qualification'
  ? result.ready_for_qualification
    : result.ready_for_decision;

  if (!ready) {
    const err = new InsufficientContextError(leadId, result);
    throw err;
  }
  return result;
}

// Internal: signal gathering

static async _gatherSignals(leadId, zohoLeadId) {
  const queries = await Promise.allSettled([
    // 0: lead profile
                                           pool.query('SELECT * FROM lead_memory WHERE id = $1 LIMIT 1', [leadId]),
    // 1: conversation analyses — conversation_analysis uses lead_id (AI table)
    pool.query(
      "SELECT * FROM conversation_analysis WHERE lead_id = $1 AND analysis_status = 'completed' ORDER BY analyzed_at DESC LIMIT 10",
      [leadId]
      ),
    // 2: retell calls — retell_calls uses lead_memory_id (Business Memory table)
    pool.query(
      'SELECT * FROM retell_calls WHERE lead_memory_id = $1 ORDER BY created_at DESC LIMIT 10',
      [leadId]
      ),
    // 3: email events — email_events uses lead_memory_id (Business Memory table)
    pool.query(
      'SELECT * FROM email_events WHERE lead_memory_id = $1 ORDER BY created_at DESC LIMIT 10',
      [leadId]
      ),
    // 4: crm tasks — crm_tasks uses lead_memory_id (Business Memory table)
    pool.query(
      'SELECT * FROM crm_tasks WHERE lead_memory_id = $1 ORDER BY created_at DESC LIMIT 10',
      [leadId]
      ),
    // 5: crm notes — crm_notes uses lead_memory_id (Business Memory table)
    pool.query(
      'SELECT * FROM crm_notes WHERE lead_memory_id = $1 ORDER BY created_at DESC LIMIT 10',
      [leadId]
      ),
    // 6: lead events timeline — lead_events uses lead_memory_id (Business Memory table)
    pool.query(
      'SELECT * FROM lead_events WHERE lead_memory_id = $1 ORDER BY occurred_at DESC LIMIT 20',
      [leadId]
      ),
    // 7: existing qualification — lead_qualification uses lead_id (AI table)
    pool.query(
      'SELECT * FROM lead_qualification WHERE lead_id = $1 LIMIT 1',
      [leadId]
      )
    ]);

  const get = (i) => queries[i].status === 'fulfilled' ? queries[i].value.rows : [];

  const profile = get(0)[0] || null;
  const conversations = get(1);
  const calls = get(2);
  const emails = get(3);
  const tasks = get(4);
  const notes = get(5);
  const events = get(6);
  const qualRows = get(7);
  const qualification = qualRows[0] || null;

  // Detect budget + timeline signals from any conversation
  const allAnalyses = [...conversations, ...calls];
  const hasBudgetSignal = allAnalyses.some(
    c => c.budget_detected === true || (c.budget_value && c.budget_value !== null)
    );
  const hasTimelineSignal = allAnalyses.some(
    c => c.timeline_detected === true || (c.timeline_value && c.timeline_value !== null)
    );

  // Profile completeness
  const profileComplete = !!(
    profile &&
    profile.name &&
    (profile.email || profile.phone)
    );

  return {
    profile,
    conversations,
    calls,
    emails,
    tasks,
    notes,
    events,
    qualification,
    hasBudgetSignal,
    hasTimelineSignal,
    profileComplete
  };
}

// Internal: scoring

static _scoreSignals(raw) {
  const breakdown = {};
  let total = 0;

  // CRM profile complete: 10 pts
  breakdown.profile_complete = raw.profileComplete ? 10 : 0;
  total += breakdown.profile_complete;

  // At least 1 analyzed conversation/call/chat: 25 pts
  const hasConversation = raw.conversations.length > 0 || raw.calls.length > 0;
  breakdown.has_conversation = hasConversation ? 25 : 0;
  total += breakdown.has_conversation;

  // Existing qualification record: 20 pts
  breakdown.has_qualification = raw.qualification ? 20 : 0;
  total += breakdown.has_qualification;

  // Budget signal: 15 pts
  breakdown.budget_signal = raw.hasBudgetSignal ? 15 : 0;
  total += breakdown.budget_signal;

  // Timeline signal: 10 pts
  breakdown.timeline_signal = raw.hasTimelineSignal ? 10 : 0;
  total += breakdown.timeline_signal;

  // 2+ conversations or calls: 10 pts
  const totalInteractions = raw.conversations.length + raw.calls.length;
  breakdown.multiple_interactions = totalInteractions >= 2 ? 10 : 0;
  total += breakdown.multiple_interactions;

  // CRM tasks or notes: 5 pts
  breakdown.crm_activity = (raw.tasks.length > 0 || raw.notes.length > 0) ? 5 : 0;
  total += breakdown.crm_activity;

  // Email interaction: 5 pts
  breakdown.email_interaction = raw.emails.length > 0 ? 5 : 0;
  total += breakdown.email_interaction;

  return { total: Math.min(100, total), breakdown };
}

// Internal: missing signal identification

static _identifyMissingSignals(raw, scoring) {
  const missing = [];

  if (!raw.profileComplete) {
    missing.push({
      signal: 'CRM profile incomplete',
      severity: 'high',
      description: 'Lead is missing name, email, or phone in Business Memory',
      how_to_resolve: 'Sync lead from Zoho CRM or update lead_memory record'
    });
  }

  if (raw.conversations.length === 0 && raw.calls.length === 0) {
    missing.push({
      signal: 'No conversation or call data',
      severity: 'critical',
      description: 'No conversation analysis or call transcript exists for this lead',
      how_to_resolve: 'Wait for a call (Retell AI), chat (SalesIQ), SMS, or email reply to arrive'
    });
  }

  if (!raw.hasBudgetSignal) {
    missing.push({
      signal: 'Budget not discussed',
      severity: 'high',
      description: 'No budget signal has been detected in any conversation or call',
      how_to_resolve: 'Ask about budget during the next interaction'
    });
  }

  if (!raw.hasTimelineSignal) {
    missing.push({
      signal: 'Timeline not discussed',
      severity: 'medium',
      description: 'No launch timeline has been mentioned in any conversation',
      how_to_resolve: 'Ask about planned launch date during the next interaction'
    });
  }

  if (!raw.qualification) {
    missing.push({
      signal: 'No qualification history',
      severity: 'medium',
      description: 'Lead has never been through the Qualification Engine',
      how_to_resolve: 'Qualification will run automatically once conversation evidence is available'
    });
  }

  if (raw.conversations.length + raw.calls.length < 2) {
    missing.push({
      signal: 'Only one interaction recorded',
      severity: 'low',
      description: 'Decision accuracy improves significantly with 2+ interactions',
      how_to_resolve: 'Continue engaging the lead through calls, chat, or email'
    });
  }

  return missing;
}

// Internal: build full context object for downstream engines

static _buildContext(raw) {
  const { profile, conversations, calls, emails, tasks, notes, events, qualification } = raw;
  const latestAnalysis = conversations[0] || {};

  return {
    profile: profile ? {
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      country: profile.country,
      brand_name: profile.brand_name,
      lead_source: profile.lead_source,
      crm_owner: profile.crm_owner,
      created_at: profile.created_at,
      last_activity: profile.last_activity_at
    } : null,

    qualification: qualification ? {
      category: qualification.category || qualification.qualification_category,
      onboarding_score: qualification.onboarding_score,
      onboarding_probability: qualification.onboarding_probability,
      trust_score: qualification.trust_score,
      engagement_score: qualification.engagement_score,
      budget_confidence: qualification.budget_confidence,
      timeline_confidence: qualification.timeline_confidence,
      brand_readiness: qualification.brand_readiness,
      confidence_score: qualification.confidence_score,
      overall_reasoning: qualification.overall_reasoning,
      qualification_gaps: qualification.qualification_gaps,
      recommended_next_action: qualification.recommended_next_action,
      updated_at: qualification.updated_at
    } : null,

    latest_conversation: {
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
      positive_buying_signals: latestAnalysis.positive_buying_signals,
      negative_buying_signals: latestAnalysis.negative_buying_signals,
      objections: latestAnalysis.objections,
      topics_detected: latestAnalysis.topics_detected,
      key_requirements: latestAnalysis.key_requirements,
      conversation_quality: latestAnalysis.conversation_quality,
      conversation_outcome: latestAnalysis.conversation_outcome,
      recommended_next_step: latestAnalysis.recommended_next_step,
      analyzed_at: latestAnalysis.analyzed_at
    },

    all_conversations: conversations.map(c => ({
      intent: c.customer_intent,
      sentiment: c.sentiment,
      trust: c.trust_score,
      buying_intent: c.buying_intent_score,
      outcome: c.conversation_outcome,
      analyzed_at: c.analyzed_at
    })),

    calls: calls.map(c => ({
      duration: c.duration_seconds,
      outcome: c.call_outcome,
      sentiment: c.sentiment,
      created_at: c.created_at
    })),

    emails: emails.map(e => ({
      direction: e.direction,
      subject: e.subject,
      created_at: e.created_at
    })),

    tasks: tasks.map(t => ({
      type: t.task_type,
      status: t.status,
      due_date: t.due_date
    })),

    notes: notes.map(n => ({
      content: n.content ? n.content.substring(0, 200) : null,
      created_at: n.created_at
    })),

    recent_events: events.slice(0, 10).map(e => ({
      type: e.event_type,
      summary: e.summary,
      created_at: e.occurred_at || e.created_at
    }))
  };
}
}

/**
* Structured error returned when evidence is insufficient.
*/
class InsufficientContextError extends Error {
  constructor(leadId, contextResult) {
    const signalList = contextResult.missing_signals
    .map(s => ' - [' + s.severity.toUpperCase() + '] ' + s.signal + ': ' + s.description)
    .join('\n');

  super(
    'Insufficient evidence to process lead ' + leadId + '.\n' +
    'Evidence score: ' + contextResult.evidence_score + '/' +
    (contextResult.ready_for_decision ? contextResult.thresholds.decision : contextResult.thresholds.qualification) + ' required.\n' +
    'Missing signals:\n' + signalList
    );

  this.name = 'InsufficientContextError';
    this.leadId = leadId;
    this.evidenceScore = contextResult.evidence_score;
    this.missingSignals = contextResult.missing_signals;
    this.contextResult = contextResult;
    this.code = 'INSUFFICIENT_CONTEXT';
  }
}

module.exports = { ContextEngine, InsufficientContextError };
