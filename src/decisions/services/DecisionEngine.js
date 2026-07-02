'use strict';
/**
 * DecisionEngine - AI DISABLED
 * OpenAI removed. Returns a safe default decision. No API calls made.
 */
class DecisionEngine {
    static async generateDecisions(leadData) {
          const { lead_id, crm_owner, trigger_event, trigger_source } = leadData;
          return {
                  decisions: [{
                            lead_id,
                            crm_owner,
                            decision_type: 'schedule_followup',
                            priority: 'medium',
                            reason: 'AI decision engine is currently disabled.',
                            explanation: 'Automated AI decisions have been turned off.',
                            evidence: [],
                            expected_business_impact: 'Manual review required.',
                            expected_onboarding_probability_change: 0,
                            recommended_execution_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
                            recommended_owner: crm_owner,
                            confidence_score: 50,
                            required_information: [],
                            trigger_event,
                            trigger_source,
                            model_version: 'disabled'
                  }],
                  overall_situation: 'AI decisions disabled.',
                  urgency_level: 'low',
                  analysis_notes: 'OpenAI removed to stop credit usage.'
          };
    }
    static _parseExecutionTime(timeStr) {
          return new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
}
module.exports = DecisionEngine;
