'use strict';
/**
 * AIAnalysisService - AI DISABLED
 * OpenAI removed. Returns empty analysis. No API calls made.
 */
class AIAnalysisService {
      static async analyze({ sourceType, transcript, leadInfo = {} }) {
              return AIAnalysisService.sanitize({});
      }
      static sanitize(analysis) {
              analysis = analysis || {};
              return {
                        summary: analysis.summary || 'AI analysis is disabled.',
                        customer_intent: 'unknown',
                        conversation_stage: 'awareness',
                        brand_stage: 'unknown',
                        conversation_outcome: 'neutral',
                        product_interest: [],
                        products_requested: [],
                        budget_detected: false,
                        budget_value: null,
                        timeline_detected: false,
                        timeline_value: null,
                        manufacturing_stage: 'unknown',
                        shopify_status: 'unknown',
                        country: null,
                        experience_level: 'unknown',
                        brand_readiness: 'unknown',
                        trust_score: 50,
                        sentiment: 'neutral',
                        conversation_quality: 'average',
                        buying_intent_score: 0,
                        questions: [],
                        objections: [],
                        positive_buying_signals: [],
                        negative_buying_signals: [],
                        recommended_next_step: null,
                        recommended_follow_up: null,
                        risk_factors: [],
                        topics_detected: [],
                        key_requirements: {},
                        confidence_score: 0.5,
                        model_version: 'disabled',
                        processing_time_ms: 0
              };
      }
}
module.exports = AIAnalysisService;
