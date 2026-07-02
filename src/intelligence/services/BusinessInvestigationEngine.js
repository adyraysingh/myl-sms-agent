'use strict';
// AI DISABLED - OpenAI removed to stop credit usage
const pool = require('../../memory/db/pool');
const BusinessInvestigation = require('../models/BusinessInvestigation');

// AI DISABLED - openai instance removed

class BusinessInvestigationEngine {
  static async investigate(question, trigger_event, investigation_type) {
    trigger_event = trigger_event || null;
    investigation_type = investigation_type || null;
    const startTime = Date.now();
    console.log('[BusinessInvestigationEngine] Starting investigation:', question);
    try {
      const evidence = await BusinessInvestigationEngine._gatherEvidence(investigation_type);
      const systemPrompt = 'You are an elite business investigation AI for MakeYourLabel.' +
        ' MakeYourLabel helps brands launch with low MOQ, sampling, custom branding, tech packs, packaging, and full manufacturing.' +
        ' Investigate the business question using the evidence. Identify root causes. Every claim must reference specific evidence.' +
        ' Output valid JSON: {root_cause, conclusion, severity (critical|high|medium|low), business_impact, recommendations: [{action, owner, timeline, expected_impact}], affected_owners: [], confidence_score}';
      const userPrompt = 'INVESTIGATION QUESTION: ' + question + ' -- BUSINESS EVIDENCE: ' + JSON.stringify(evidence).substring(0, 3000);
      // AI DISABLED - OpenAI removed to stop credit usage
              const result = { root_cause: 'Manual review required', conclusion: 'AI investigation disabled. Review evidence manually.',
                                        severity: 'medium', business_impact: 'See evidence', recommendations: [], affected_owners: [], confidence_score: 50 };
      const investigation = await BusinessInvestigation.create({
        question,
        investigation_type: investigation_type || BusinessInvestigationEngine._detectType(question),
        trigger_event,
        data_sources: Object.keys(evidence),
        evidence: BusinessInvestigationEngine._flattenEvidence(evidence),
        root_cause: result.root_cause, conclusion: result.conclusion,
        recommendations: result.recommendations || [],
        affected_leads: result.affected_leads || [],
        affected_owners: result.affected_owners || [],
        confidence_score: result.confidence_score,
        severity: result.severity || 'medium', business_impact: result.business_impact,
        status: 'completed', processing_time_ms: Date.now() - startTime
      });
      console.log('[BusinessInvestigationEngine] Investigation complete:', investigation.investigation_id);
      return investigation;
    } catch (err) {
      console.error('[BusinessInvestigationEngine] Error:', err.message);
      throw err;
    }
  }

  static async runDailyInvestigations() {
    const questions = [
      { q: 'Why are onboardings lower today?', type: 'onboarding_drop' },
      { q: 'Which sales executive loses the most hot leads?', type: 'executive_performance' },
      { q: 'What are the biggest onboarding blockers this week?', type: 'qualification_gap' },
      { q: 'Which objections increased most this week?', type: 'objection_spike' },
      { q: 'Which follow-up step causes the most drop-offs?', type: 'followup_dropoff' }
    ];
    const results = [];
    for (const item of questions) {
      try {
        const inv = await BusinessInvestigationEngine.investigate(item.q, 'daily_automated', item.type);
        results.push(inv);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.error('[BusinessInvestigationEngine] Daily investigation failed:', item.q, e.message);
      }
    }
    return results;
  }

  static async _gatherEvidence(investigation_type) {
    const evidence = {};
    const [quals, decisions, convAnalysis, salesPerf, leads] = await Promise.allSettled([
      pool.query('SELECT qualification_category, COUNT(*) as count, AVG(onboarding_score) as avg_score FROM lead_qualification GROUP BY qualification_category ORDER BY count DESC LIMIT 10'),
      pool.query('SELECT decision_type, priority, status, COUNT(*) as count FROM ai_decisions GROUP BY decision_type, priority, status ORDER BY count DESC LIMIT 20'),
      pool.query("SELECT sentiment, conversation_outcome, COUNT(*) as count, AVG(trust_score) as avg_trust FROM conversation_analysis WHERE analyzed_at > NOW() - INTERVAL '7 days' GROUP BY sentiment, conversation_outcome LIMIT 20"),
      pool.query('SELECT owner_id, owner_name, productivity_score, onboarding_rate, follow_up_completion_rate, follow_ups_missed, performance_trend FROM sales_performance WHERE period_date = CURRENT_DATE ORDER BY productivity_score DESC LIMIT 20'),
      pool.query('SELECT qualification_category, COUNT(*) as count FROM lead_memory lm LEFT JOIN lead_qualification lq ON lq.lead_id = lm.lead_id GROUP BY qualification_category LIMIT 10')
    ]);
    if (quals.status === 'fulfilled') evidence.qualification_breakdown = quals.value.rows;
    if (decisions.status === 'fulfilled') evidence.decision_breakdown = decisions.value.rows;
    if (convAnalysis.status === 'fulfilled') evidence.conversation_analysis = convAnalysis.value.rows;
    if (salesPerf.status === 'fulfilled') evidence.sales_performance = salesPerf.value.rows;
    if (leads.status === 'fulfilled') evidence.lead_breakdown = leads.value.rows;
    return evidence;
  }

  static _detectType(question) {
    const q = question.toLowerCase();
    if (q.includes('onboard')) return 'onboarding_drop';
    if (q.includes('executive') || q.includes('loses')) return 'executive_performance';
    if (q.includes('objection')) return 'objection_spike';
    if (q.includes('product')) return 'product_performance';
    if (q.includes('follow-up') || q.includes('drop-off')) return 'followup_dropoff';
    if (q.includes('qualification') || q.includes('gap')) return 'qualification_gap';
    if (q.includes('conversion') || q.includes('convert')) return 'conversion_issue';
    return 'general';
  }

  static _flattenEvidence(evidence) {
    return Object.entries(evidence).map(([key, value]) => ({
      source: key, data: Array.isArray(value) ? value : [value], count: Array.isArray(value) ? value.length : 1
    }));
  }
}

module.exports = BusinessInvestigationEngine;
