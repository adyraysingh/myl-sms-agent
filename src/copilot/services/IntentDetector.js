'use strict';
// IntentDetector — classifies CEO questions and determines which modules to query

const INTENTS = {
  LEAD_STATUS:        'lead_status',
  LEAD_INVESTIGATION: 'lead_investigation',
  HOT_LEADS:          'hot_leads',
  FOLLOW_UP:          'follow_up',
  ONBOARDING_TREND:   'onboarding_trend',
  SALES_PERFORMANCE:  'sales_performance',
  SALESPERSON_DETAIL: 'salesperson_detail',
  DECISIONS:          'decisions',
  OBJECTIONS:         'objections',
  BUSINESS_HEALTH:    'business_health',
  RISKS:              'risks',
  OPPORTUNITIES:      'opportunities',
  TODAY_PRIORITIES:   'today_priorities',
  INVESTIGATION:      'investigation',
  PRODUCT_ANALYSIS:   'product_analysis',
  CONVERSATION_INTEL: 'conversation_intelligence',
  EXECUTIVE_BRIEF:    'executive_brief',
  GENERAL:            'general'
};

// Module routing map: which modules to call for each intent
const MODULE_ROUTES = {
  lead_status:            ['memory', 'qualification', 'decisions', 'conversations'],
  lead_investigation:     ['memory', 'qualification', 'conversations', 'investigations', 'decisions'],
  hot_leads:              ['qualification', 'memory', 'decisions'],
  follow_up:              ['decisions', 'memory'],
  onboarding_trend:       ['qualification', 'sales_intelligence', 'investigations', 'executive'],
  sales_performance:      ['sales_intelligence', 'decisions', 'memory'],
  salesperson_detail:     ['sales_intelligence', 'decisions'],
  decisions:              ['decisions'],
  objections:             ['conversations', 'investigations'],
  business_health:        ['executive', 'sales_intelligence', 'investigations'],
  risks:                  ['investigations', 'executive', 'qualification'],
  opportunities:          ['investigations', 'qualification', 'executive'],
  today_priorities:       ['decisions', 'qualification', 'executive', 'investigations'],
  investigation:          ['investigations'],
  product_analysis:       ['conversations', 'qualification', 'investigations'],
  conversation_intelligence: ['conversations', 'qualification'],
  executive_brief:        ['executive', 'sales_intelligence', 'investigations'],
  general:                ['executive', 'memory']
};

// Keyword → intent mapping (fast path without GPT)
const KEYWORD_MAP = [
  { patterns: ['hot lead', 'hot leads', 'show leads', 'best leads', 'top leads', 'qualified lead'], intent: 'hot_leads' },
  { patterns: ['onboard', 'onboarding', 'conversion', 'convert', 'signup'], intent: 'onboarding_trend' },
  { patterns: ['follow.?up', 'overdue', 'pending task', 'not contacted'], intent: 'follow_up' },
  { patterns: ['salesperson', 'sales exec', 'sales rep', 'team member', 'performer', 'performing'], intent: 'sales_performance' },
  { patterns: ['decision', 'recommendation', 'next action', 'not executed', 'pending decision'], intent: 'decisions' },
  { patterns: ['objection', 'concern', 'pushback', 'complaint', 'worry'], intent: 'objections' },
  { patterns: ['health', 'status', 'overview', 'how are we', 'how is the business'], intent: 'business_health' },
  { patterns: ['risk', 'danger', 'problem', 'issue', 'losing'], intent: 'risks' },
  { patterns: ['opportunit', 'potential', 'upside', 'growing'], intent: 'opportunities' },
  { patterns: ['today', 'priority', 'focus', 'first', 'what should i do'], intent: 'today_priorities' },
  { patterns: ['investigate', 'investigation', 'root cause', 'why did', 'why is', 'why are'], intent: 'investigation' },
  { patterns: ['product', 'hoodie', 'tracksuit', 'tshirt', 't-shirt', 'activewear', 'streetwear', 'gym'], intent: 'product_analysis' },
  { patterns: ['conversation', 'chat', 'transcript', 'message', 'reply'], intent: 'conversation_intelligence' },
  { patterns: ['brief', 'briefing', 'report', 'summary'], intent: 'executive_brief' },
  { patterns: ['lead', 'customer', 'contact', 'prospect'], intent: 'lead_status' }
];

class IntentDetector {
  static detect(question, conversationContext = []) {
    const q = question.toLowerCase();

    // Try keyword match first (fast path)
    for (const km of KEYWORD_MAP) {
      for (const pattern of km.patterns) {
        if (new RegExp(pattern).test(q)) {
          return {
            intent: km.intent,
            modules: MODULE_ROUTES[km.intent] || ['executive', 'memory'],
            confidence: 0.85,
            method: 'keyword'
          };
        }
      }
    }

    // Context-aware fallback: if previous question had an intent, inherit it
    if (conversationContext.length > 0) {
      const lastAssistant = [...conversationContext].reverse().find(m => m.role === 'assistant');
      if (lastAssistant && lastAssistant.intent) {
        return {
          intent: lastAssistant.intent,
          modules: MODULE_ROUTES[lastAssistant.intent] || ['executive', 'memory'],
          confidence: 0.70,
          method: 'context_inherit'
        };
      }
    }

    // Default: general business query
    return {
      intent: 'general',
      modules: MODULE_ROUTES['general'],
      confidence: 0.50,
      method: 'default'
    };
  }

  static getIntents() { return INTENTS; }
  static getModuleRoutes() { return MODULE_ROUTES; }
}

module.exports = IntentDetector;
