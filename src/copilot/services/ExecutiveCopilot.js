'use strict';
/**
 * ExecutiveCopilot - AI DISABLED
 * OpenAI removed. No API calls made.
 */
class ExecutiveCopilot {
    static async answer({ question, session_id, user_id, user_role, conversationHistory = [] }) {
          return {
                  intent: 'disabled',
                  modules_queried: [],
                  evidence_sources: [],
                  confidence: 0,
                  response_time_ms: 0,
                  executive_summary: 'The AI Copilot is currently disabled. OpenAI has been removed to stop credit usage.',
                  evidence: [],
                  reasoning: 'AI disabled.',
                  recommended_actions: [],
                  related_leads: [],
                  related_investigations: [],
                  related_decisions: [],
                  citations: {},
                  model_version: 'disabled'
          };
    }
    static getSuggestedQuestions() {
          return [
            { id: 1, question: 'What should I focus on today?', category: 'priorities', icon: 'target' },
            { id: 2, question: 'Show all hot leads right now.', category: 'leads', icon: 'fire' },
            { id: 3, question: 'Which leads need immediate attention?', category: 'leads', icon: 'alert' },
            { id: 4, question: 'How is the business performing today?', category: 'health', icon: 'pulse' }
                ];
    }
}
module.exports = ExecutiveCopilot;
