'use strict';
const OpenAI = require('openai');
const pool = require('../../memory/db/pool');
const ExecutiveBriefing = require('../models/ExecutiveBriefing');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

class ExecutiveBriefingEngine {
  static async generate(briefing_type = 'morning') {
    const startTime = Date.now();
    console.log('[ExecutiveBriefingEngine] Generating', briefing_type, 'briefing');

    const { period_start, period_end } = ExecutiveBriefingEngine._getPeriod(briefing_type);

    try {
      const data = await ExecutiveBriefingEngine._collectData(period_start, period_end);
      const healthScores = ExecutiveBriefingEngine._calculateHealthScores(data);
      const narrative = await ExecutiveBriefingEngine._generateNarrative(briefing_type, data, healthScores);

      const briefing = await ExecutiveBriefing.create({
        briefing_type,
        period_start,
        period_end,
        ...healthScores,
        business_summary: narrative.business_summary || {},
        onboarding_performance: narrative.onboarding_performance || {},
        sales_performance: narrative.sales_performance || {},
        current_risks: narrative.current_risks || [],
        current_opportunities: narrative.current_opportunities || [],
        top_priorities: narrative.top_priorities || [],
        recommended_actions: narrative.recommended_actions || [],
        expected_business_impact: narrative.expected_business_impact,
        total_leads: data.leadStats.total || 0,
        hot_leads: data.leadStats.hot || 0,
        warm_leads: data.leadStats.warm || 0,
        leads_onboarded_period: data.leadStats.onboarded || 0,
        leads_lost_period: data.leadStats.lost || 0,
        active_investigations: data.investigationCount || 0,
        critical_decisions_pending: data.criticalDecisions || 0,
        narrative: narrative.executive_summary
      });

      console.log('[ExecutiveBriefingEngine] Briefing generated:', briefing.briefing_id);
      return briefing;
    } catch (err) {
      console.error('[ExecutiveBriefingEngine] Error:', err.message);
      throw err;
    }
  }

  static async generateAll() {
    const types = ['morning', 'midday', 'end_of_day'];
    const results = [];
    for (const type of types) {
      try {
        const briefing = await ExecutiveBriefingEngine.generate(type);
        results.push(briefing);
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error('[ExecutiveBriefingEngine] Failed to generate', type, e.message);
      }
    }
    return results;
  }

  static async _collectData(period_start, period_end) {
    const [leadStats, qualStats, convStats, decisionStats, salesStats, invCount] = await Promise.allSettled([
      pool.query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE qualification_category = 'Hot') as hot,
        COUNT(*) FILTER (WHERE qualification_category = 'Warm') as warm,
        COUNT(*) FILTER (WHERE qualification_category = 'Onboarded') as onboarded,
        COUNT(*) FILTER (WHERE qualification_category IN ('Dead','Cold')) as lost
        FROM lead_memory lm
        LEFT JOIN lead_qualification lq ON lq.lead_id = lm.lead_id`),
      pool.query(`SELECT qualification_category, COUNT(*) as count, AVG(onboarding_score) as avg_score
        FROM lead_qualification GROUP BY qualification_category ORDER BY count DESC`),
      pool.query(`SELECT sentiment, COUNT(*) as count, AVG(trust_score) as avg_trust
        FROM conversation_analysis
        WHERE analyzed_at BETWEEN $1 AND $2
        GROUP BY sentiment`, [period_start, period_end]),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE priority = 'critical' AND status = 'pending') as critical_pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_today,
        COUNT(*) as total
        FROM ai_decisions WHERE created_at BETWEEN $1 AND $2`, [period_start, period_end]),
      pool.query(`SELECT owner_name, productivity_score, onboarding_rate, follow_up_completion_rate, follow_ups_missed, performance_trend
        FROM sales_performance WHERE period_date = CURRENT_DATE ORDER BY productivity_score DESC LIMIT 10`),
      pool.query(`SELECT COUNT(*) as count FROM business_investigations WHERE created_at > NOW() - INTERVAL '24 hours'`)
    ]);

    const ls = leadStats.status === 'fulfilled' ? leadStats.value.rows[0] : {};
    return {
      leadStats: {
        total: parseInt(ls.total) || 0,
        hot: parseInt(ls.hot) || 0,
        warm: parseInt(ls.warm) || 0,
        onboarded: parseInt(ls.onboarded) || 0,
        lost: parseInt(ls.lost) || 0
      },
      qualBreakdown: qualStats.status === 'fulfilled' ? qualStats.value.rows : [],
      convStats: convStats.status === 'fulfilled' ? convStats.value.rows : [],
      decisionStats: decisionStats.status === 'fulfilled' ? decisionStats.value.rows[0] : {},
      salesStats: salesStats.status === 'fulfilled' ? salesStats.value.rows : [],
      investigationCount: invCount.status === 'fulfilled' ? parseInt(invCount.value.rows[0].count) : 0,
      criticalDecisions: decisionStats.status === 'fulfilled' ? parseInt(decisionStats.value.rows[0].critical_pending) || 0 : 0
    };
  }

  static _calculateHealthScores(data) {
    const { leadStats, qualBreakdown, convStats, decisionStats, salesStats } = data;

    const total = leadStats.total || 1;
    const hotRate = (leadStats.hot / total) * 100;
    const onboardRate = (leadStats.onboarded / total) * 100;
    const qualHealth = Math.min(100, (hotRate * 2) + (onboardRate * 3));

    const avgProductivity = salesStats.length > 0
      ? salesStats.reduce((s, r) => s + (parseFloat(r.productivity_score) || 0), 0) / salesStats.length
      : 50;

    const positiveSentiment = convStats.find(r => r.sentiment === 'positive');
    const totalConvs = convStats.reduce((s, r) => s + parseInt(r.count), 0) || 1;
    const convHealth = positiveSentiment ? Math.round((parseInt(positiveSentiment.count) / totalConvs) * 100) : 50;

    const missedFollowups = salesStats.reduce((s, r) => s + (parseInt(r.follow_ups_missed) || 0), 0);
    const followupHealth = Math.max(0, 100 - (missedFollowups * 10));

    const overall = Math.round((qualHealth + avgProductivity + convHealth + followupHealth) / 4);

    return {
      business_health_score: overall,
      sales_health_score: Math.round(avgProductivity),
      followup_health_score: Math.round(followupHealth),
      conversation_health_score: Math.round(convHealth),
      qualification_health_score: Math.round(qualHealth),
      decision_execution_health_score: 70,
      overall_health_score: overall
    };
  }

  static async _generateNarrative(briefing_type, data, healthScores) {
    const systemPrompt = [
      'You are an executive briefing AI for MakeYourLabel, a premium private label clothing manufacturer.',
      'Generate a structured executive briefing. Be specific, data-driven, and actionable.',
      'Focus on what matters for onboarding new brands. Maximum clarity.',
      '',
      'OUTPUT FORMAT (JSON):',
      '{',
      '  "executive_summary": "2-3 sentence executive summary",',
      '  "business_summary": {"headline": "...", "key_metric": "...", "trend": "..."},',
      '  "onboarding_performance": {"rate": "...", "blockers": "...", "opportunities": "..."},',
      '  "sales_performance": {"top_performer": "...", "concern": "...", "avg_score": "..."},',
      '  "current_risks": [{"risk": "...", "impact": "...", "urgency": "high|medium|low"}],',
      '  "current_opportunities": [{"opportunity": "...", "potential": "..."}],',
      '  "top_priorities": [{"priority": "...", "owner": "...", "timeline": "..."}],',
      '  "recommended_actions": [{"action": "...", "expected_impact": "..."}],',
      '  "expected_business_impact": "..."',
      '}'
    ].join('
');

    const userPrompt = [
      'BRIEFING TYPE: ' + briefing_type,
      'OVERALL HEALTH SCORE: ' + healthScores.overall_health_score + '/100',
      '',
      'CURRENT DATA:',
      JSON.stringify({ data, healthScores }, null, 2)
    ].join('
');

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 1200
      });

      return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
      console.error('[ExecutiveBriefingEngine] Narrative generation failed:', err.message);
      return {
        executive_summary: 'Briefing generated with ' + healthScores.overall_health_score + '/100 health score. ' + data.leadStats.hot + ' hot leads active.',
        business_summary: { headline: 'Business running at ' + healthScores.overall_health_score + '% health', key_metric: data.leadStats.total + ' total leads', trend: 'stable' },
        onboarding_performance: { rate: data.leadStats.onboarded + ' onboarded', blockers: 'Check investigations', opportunities: data.leadStats.hot + ' hot leads' },
        sales_performance: { top_performer: 'See dashboard', concern: 'Check coaching flags', avg_score: healthScores.sales_health_score },
        current_risks: [],
        current_opportunities: [],
        top_priorities: [],
        recommended_actions: [],
        expected_business_impact: 'Monitor hot leads and follow-up completion'
      };
    }
  }

  static _getPeriod(briefing_type) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    if (briefing_type === 'morning') {
      return { period_start: today + 'T00:00:00Z', period_end: today + 'T11:59:59Z' };
    } else if (briefing_type === 'midday') {
      return { period_start: today + 'T09:00:00Z', period_end: today + 'T14:59:59Z' };
    } else if (briefing_type === 'end_of_day') {
      return { period_start: today + 'T00:00:00Z', period_end: today + 'T23:59:59Z' };
    } else if (briefing_type === 'weekly') {
      const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
      return { period_start: weekAgo.toISOString(), period_end: now.toISOString() };
    } else {
      const monthAgo = new Date(now); monthAgo.setDate(monthAgo.getDate() - 30);
      return { period_start: monthAgo.toISOString(), period_end: now.toISOString() };
    }
  }
}

module.exports = ExecutiveBriefingEngine;
