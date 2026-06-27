'use strict';
/**
 * PredictionPublisher — Phase 3.1
 * Central fire-and-forget connector between every AI module and the
 * Prediction Registry. Never blocks the AI result. Silent on failure.
 */
const PredictionRegistry = require('../models/PredictionRegistry');

const PredictionPublisher = {

  async qualification(lead_id, sanitized, triggerEvent) {
    try {
      return await PredictionRegistry.record({
        module: 'qualification_engine',
        lead_id: lead_id || null,
        prediction_type: 'onboarding_probability',
        prediction: {
          category: sanitized.category,
          onboarding_probability: sanitized.onboarding_probability,
          onboarding_score: sanitized.onboarding_score,
          readiness_score: sanitized.readiness_score,
          trust_score: sanitized.trust_score,
          engagement_score: sanitized.engagement_score,
          confidence_score: sanitized.confidence_score,
          recommended_next_action: sanitized.recommended_next_action,
          overall_reasoning: sanitized.overall_reasoning,
          qualification_gaps: sanitized.qualification_gaps || [],
          trigger_event: triggerEvent || null
        },
        confidence: sanitized.confidence_score || 0,
        evidence: {
          score_breakdown: sanitized.score_breakdown || {},
          factors: sanitized.factors || {},
          positive_signals: sanitized.positive_signals || [],
          negative_signals: sanitized.negative_signals || []
        },
        expires_days: 60
      });
    } catch (e) { console.error('[PredictionPublisher] qualification failed:', e.message); }
  },

  async decision(lead_id, dec) {
    try {
      return await PredictionRegistry.record({
        module: 'decision_engine',
        lead_id: lead_id || null,
        prediction_type: 'decision_recommendation',
        prediction: {
          decision_id: dec.decision_id || null,
          decision_type: dec.decision_type,
          priority: dec.priority,
          reason: dec.reason,
          explanation: dec.explanation,
          recommended_execution_time: dec.recommended_execution_time || null,
          crm_owner: dec.crm_owner || null
        },
        confidence: dec.confidence_score || 0,
        evidence: { expected_impact: dec.expected_impact || null, tags: dec.tags || [] },
        expires_days: 30
      });
    } catch (e) { console.error('[PredictionPublisher] decision failed:', e.message); }
  },

  async conversation(lead_id, analysis) {
    try {
      return await PredictionRegistry.record({
        module: 'conversation_intelligence',
        lead_id: lead_id || null,
        prediction_type: 'conversation_intent',
        prediction: {
          customer_intent: analysis.customer_intent,
          conversation_stage: analysis.conversation_stage,
          sentiment: analysis.sentiment,
          trust_score: analysis.trust_score,
          buying_probability: analysis.buying_probability,
          recommended_next_step: analysis.recommended_next_step,
          urgency_level: analysis.urgency_level
        },
        confidence: analysis.confidence_score || 0,
        evidence: {
          objections: analysis.objections || [],
          positive_buying_signals: analysis.positive_buying_signals || [],
          negative_buying_signals: analysis.negative_buying_signals || [],
          topics_discussed: analysis.topics_discussed || []
        },
        expires_days: 30
      });
    } catch (e) { console.error('[PredictionPublisher] conversation failed:', e.message); }
  },

  async investigation(lead_id, inv, findings) {
    try {
      return await PredictionRegistry.record({
        module: 'investigation_engine',
        lead_id: lead_id || null,
        prediction_type: 'investigation_finding',
        prediction: {
          investigation_id: inv.investigation_id || null,
          investigation_type: inv.investigation_type,
          title: inv.title,
          root_cause: findings.root_cause || null,
          summary: findings.summary || null,
          recommendation: findings.recommendation || null,
          business_impact: findings.business_impact || null
        },
        confidence: findings.confidence || inv.confidence || 0,
        evidence: {
          findings: findings.findings || [],
          evidence: findings.evidence || [],
          patterns: findings.patterns || []
        },
        expires_days: 90
      });
    } catch (e) { console.error('[PredictionPublisher] investigation failed:', e.message); }
  },

  async revenue(forecast) {
    try {
      return await PredictionRegistry.record({
        module: 'revenue_forecaster',
        lead_id: null,
        prediction_type: 'revenue_forecast',
        prediction: {
          forecast_id: forecast.forecast_id || null,
          period_type: forecast.period_type,
          period_start: forecast.period_start,
          period_end: forecast.period_end,
          base_forecast: forecast.base_forecast,
          optimistic_forecast: forecast.optimistic_forecast,
          pessimistic_forecast: forecast.pessimistic_forecast,
          total_leads: forecast.total_leads,
          hot_leads: forecast.hot_leads
        },
        confidence: forecast.confidence_score || 0,
        evidence: {
          assumptions: forecast.assumptions || [],
          risks: forecast.risks || [],
          opportunities: forecast.opportunities || [],
          methodology: forecast.methodology || null
        },
        expires_days: 45
      });
    } catch (e) { console.error('[PredictionPublisher] revenue failed:', e.message); }
  },

  async copilot(session_id, user_id, question, result) {
    try {
      return await PredictionRegistry.record({
        module: 'ceo_copilot',
        lead_id: null,
        prediction_type: 'executive_answer',
        prediction: {
          session_id: session_id || null,
          user_id: user_id || null,
          intent: result.intent,
          executive_summary: (result.executive_summary || '').substring(0, 500),
          recommended_actions: (result.recommended_actions || []).slice(0, 5),
          modules_queried: result.modules_queried || [],
          response_time_ms: result.response_time_ms || null
        },
        confidence: result.confidence || 0,
        evidence: {
          evidence_sources: result.evidence_sources || [],
          evidence: (result.evidence || []).slice(0, 10),
          citations: result.citations || {},
          related_leads: (result.related_leads || []).slice(0, 5)
        },
        expires_days: 30
      });
    } catch (e) { console.error('[PredictionPublisher] copilot failed:', e.message); }
  },

  async linkOutcome({ prediction_id, module, lead_id, outcome_type, outcome_value, is_correct, accuracy_score, notes, source }) {
    try {
      return await PredictionRegistry.recordOutcome({
        prediction_id, module, lead_id, outcome_type,
        outcome_value, is_correct, accuracy_score, notes, source: source || 'system'
      });
    } catch (e) { console.error('[PredictionPublisher] linkOutcome failed:', e.message); }
  },

  async autoLinkOutcome({ module, lead_id, outcome_type, outcome_value, is_correct, accuracy_score, notes }) {
    try {
      const pending = await PredictionRegistry.getPending({ module, limit: 5 });
      const match = pending.find(p => p.lead_id === lead_id);
      if (!match) return null;
      return await PredictionRegistry.recordOutcome({
        prediction_id: match.prediction_id,
        module, lead_id, outcome_type,
        outcome_value: outcome_value || {},
        is_correct,
        accuracy_score: accuracy_score || null,
        notes: notes || null,
        source: 'auto_linker'
      });
    } catch (e) { console.error('[PredictionPublisher] autoLinkOutcome failed:', e.message); }
  }

};

module.exports = PredictionPublisher;
