'use strict';
const pool = require('../../memory/db/pool');

class ExecutiveBriefing {
  static async create(data) {
    const {
      briefing_type, period_start, period_end,
      business_health_score, sales_health_score, followup_health_score,
      conversation_health_score, qualification_health_score, decision_execution_health_score,
      overall_health_score, business_summary = {}, onboarding_performance = {},
      sales_performance = {}, current_risks = [], current_opportunities = [],
      top_priorities = [], recommended_actions = [], expected_business_impact,
      total_leads = 0, hot_leads = 0, warm_leads = 0, leads_onboarded_period = 0,
      leads_lost_period = 0, active_investigations = 0, critical_decisions_pending = 0,
      narrative, model_version = 'gpt-4o'
    } = data;

    const sql = `
      INSERT INTO executive_briefings (
        briefing_type, period_start, period_end,
        business_health_score, sales_health_score, followup_health_score,
        conversation_health_score, qualification_health_score, decision_execution_health_score,
        overall_health_score, business_summary, onboarding_performance, sales_performance,
        current_risks, current_opportunities, top_priorities, recommended_actions,
        expected_business_impact, total_leads, hot_leads, warm_leads,
        leads_onboarded_period, leads_lost_period, active_investigations,
        critical_decisions_pending, narrative, model_version
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
      )
      ON CONFLICT (briefing_type, period_start) DO UPDATE SET
        business_health_score = EXCLUDED.business_health_score,
        sales_health_score = EXCLUDED.sales_health_score,
        followup_health_score = EXCLUDED.followup_health_score,
        overall_health_score = EXCLUDED.overall_health_score,
        business_summary = EXCLUDED.business_summary,
        onboarding_performance = EXCLUDED.onboarding_performance,
        sales_performance = EXCLUDED.sales_performance,
        current_risks = EXCLUDED.current_risks,
        current_opportunities = EXCLUDED.current_opportunities,
        top_priorities = EXCLUDED.top_priorities,
        recommended_actions = EXCLUDED.recommended_actions,
        expected_business_impact = EXCLUDED.expected_business_impact,
        narrative = EXCLUDED.narrative,
        generated_at = NOW()
      RETURNING *
    `;
    const values = [
      briefing_type, period_start, period_end,
      business_health_score, sales_health_score, followup_health_score,
      conversation_health_score, qualification_health_score, decision_execution_health_score,
      overall_health_score, JSON.stringify(business_summary), JSON.stringify(onboarding_performance),
      JSON.stringify(sales_performance), JSON.stringify(current_risks), JSON.stringify(current_opportunities),
      JSON.stringify(top_priorities), JSON.stringify(recommended_actions), expected_business_impact,
      total_leads, hot_leads, warm_leads, leads_onboarded_period, leads_lost_period,
      active_investigations, critical_decisions_pending, narrative, model_version
    ];
    const result = await pool.query(sql, values);
    return result.rows[0];
  }

  static async findLatest(briefing_type) {
    const result = await pool.query(
      'SELECT * FROM executive_briefings WHERE briefing_type = $1 ORDER BY generated_at DESC LIMIT 1',
      [briefing_type]
    );
    return result.rows[0];
  }

  static async findAll(limit = 10, briefing_type = null) {
    let sql, params;
    if (briefing_type) {
      sql = 'SELECT * FROM executive_briefings WHERE briefing_type = $1 ORDER BY generated_at DESC LIMIT $2';
      params = [briefing_type, limit];
    } else {
      sql = 'SELECT * FROM executive_briefings ORDER BY generated_at DESC LIMIT $1';
      params = [limit];
    }
    const result = await pool.query(sql, params);
    return result.rows;
  }

  static async findById(briefing_id) {
    const result = await pool.query(
      'SELECT * FROM executive_briefings WHERE briefing_id = $1',
      [briefing_id]
    );
    return result.rows[0];
  }
}

module.exports = ExecutiveBriefing;
