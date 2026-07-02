'use strict';
/**
 * QualificationEngine - AI DISABLED
 * OpenAI removed. Returns neutral unqualified result. No API calls made.
 */
class QualificationEngine {
      static async qualify(leadData) {
              return QualificationEngine.sanitize({});
      }
      static sanitize(q) {
              q = q || {};
              const clamp = (v, min, max) => Math.min(max, Math.max(min, parseInt(v) || 0));
              const validCategories = ['hot','warm','cold','dead','unqualified','onboarded'];
              return {
                        category: validCategories.includes(q.category) ? q.category : 'unqualified',
                        onboarding_score: clamp(q.onboarding_score, 0, 100),
                        onboarding_probability: clamp(q.onboarding_probability, 0, 100),
                        readiness_score: clamp(q.readiness_score, 0, 100),
                        trust_score: clamp(q.trust_score, 0, 100),
                        engagement_score: clamp(q.engagement_score, 0, 100),
                        budget_confidence: clamp(q.budget_confidence, 0, 100),
                        timeline_confidence: clamp(q.timeline_confidence, 0, 100),
                        brand_readiness: clamp(q.brand_readiness, 0, 100),
                        manufacturing_readiness: clamp(q.manufacturing_readiness, 0, 100),
                        communication_quality: clamp(q.communication_quality, 0, 100),
                        followup_health: clamp(q.followup_health, 0, 100),
                        decision_confidence: clamp(q.decision_confidence, 0, 100),
                        confidence_score: clamp(q.confidence_score, 0, 100),
                        overall_reasoning: q.overall_reasoning || 'AI qualification is disabled.',
                        score_breakdown: q.score_breakdown || {},
                        factors: q.factors || {},
                        qualification_gaps: Array.isArray(q.qualification_gaps) ? q.qualification_gaps : [],
                        positive_signals: Array.isArray(q.positive_signals) ? q.positive_signals : [],
                        negative_signals: Array.isArray(q.negative_signals) ? q.negative_signals : [],
                        recommended_next_action: q.recommended_next_action || null,
                        recommended_questions: Array.isArray(q.recommended_questions) ? q.recommended_questions : [],
                        urgency_level: ['low','normal','high','urgent'].includes(q.urgency_level) ? q.urgency_level : 'normal',
                        model_version: 'disabled',
                        processing_time_ms: 0
              };
      }
}
module.exports = QualificationEngine;
