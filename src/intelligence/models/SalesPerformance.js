'use strict';
const pool = require('../../memory/db/pool');

class SalesPerformance {
  static async upsert(data) {
    const {
      owner_id, owner_name, owner_email, period_date, period_type = 'daily',
      calls_completed = 0, chats_handled = 0, emails_sent = 0, emails_replied = 0,
      tasks_completed = 0, follow_ups_completed = 0, follow_ups_missed = 0,
      avg_response_time_minutes, avg_first_contact_time_minutes, avg_followup_delay_minutes,
      avg_decision_execution_time_minutes, follow_up_completion_rate, onboarding_rate,
      lead_conversion_rate, qualification_accuracy, avg_trust_score, avg_sentiment,
      activity_score, productivity_score, total_leads_assigned = 0, hot_leads_assigned = 0,
      warm_leads_assigned = 0, leads_onboarded = 0, leads_lost = 0,
      performance_trend, trend_explanation, strengths = [], weaknesses = [],
      coaching_flags = [], performance_explanation
    } = data;

    const sql = `
      INSERT INTO sales_performance (
        owner_id, owner_name, owner_email, period_date, period_type,
        calls_completed, chats_handled, emails_sent, emails_replied,
        tasks_completed, follow_ups_completed, follow_ups_missed,
        avg_response_time_minutes, avg_first_contact_time_minutes, avg_followup_delay_minutes,
        avg_decision_execution_time_minutes, follow_up_completion_rate, onboarding_rate,
        lead_conversion_rate, qualification_accuracy, avg_trust_score, avg_sentiment,
        activity_score, productivity_score, total_leads_assigned, hot_leads_assigned,
        warm_leads_assigned, leads_onboarded, leads_lost, performance_trend,
        trend_explanation, strengths, weaknesses, coaching_flags,
        performance_explanation, calculated_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,NOW(),NOW()
      )
      ON CONFLICT (owner_id, period_date, period_type) DO UPDATE SET
        owner_name = EXCLUDED.owner_name,
        owner_email = EXCLUDED.owner_email,
        calls_completed = EXCLUDED.calls_completed,
        chats_handled = EXCLUDED.chats_handled,
        emails_sent = EXCLUDED.emails_sent,
        emails_replied = EXCLUDED.emails_replied,
        tasks_completed = EXCLUDED.tasks_completed,
        follow_ups_completed = EXCLUDED.follow_ups_completed,
        follow_ups_missed = EXCLUDED.follow_ups_missed,
        avg_response_time_minutes = EXCLUDED.avg_response_time_minutes,
        avg_first_contact_time_minutes = EXCLUDED.avg_first_contact_time_minutes,
        avg_followup_delay_minutes = EXCLUDED.avg_followup_delay_minutes,
        avg_decision_execution_time_minutes = EXCLUDED.avg_decision_execution_time_minutes,
        follow_up_completion_rate = EXCLUDED.follow_up_completion_rate,
        onboarding_rate = EXCLUDED.onboarding_rate,
        lead_conversion_rate = EXCLUDED.lead_conversion_rate,
        qualification_accuracy = EXCLUDED.qualification_accuracy,
        avg_trust_score = EXCLUDED.avg_trust_score,
        avg_sentiment = EXCLUDED.avg_sentiment,
        activity_score = EXCLUDED.activity_score,
        productivity_score = EXCLUDED.productivity_score,
        total_leads_assigned = EXCLUDED.total_leads_assigned,
        hot_leads_assigned = EXCLUDED.hot_leads_assigned,
        warm_leads_assigned = EXCLUDED.warm_leads_assigned,
        leads_onboarded = EXCLUDED.leads_onboarded,
        leads_lost = EXCLUDED.leads_lost,
        performance_trend = EXCLUDED.performance_trend,
        trend_explanation = EXCLUDED.trend_explanation,
        strengths = EXCLUDED.strengths,
        weaknesses = EXCLUDED.weaknesses,
        coaching_flags = EXCLUDED.coaching_flags,
        performance_explanation = EXCLUDED.performance_explanation,
        calculated_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `;
    const values = [
      owner_id, owner_name, owner_email, period_date, period_type,
      calls_completed, chats_handled, emails_sent, emails_replied,
      tasks_completed, follow_ups_completed, follow_ups_missed,
      avg_response_time_minutes, avg_first_contact_time_minutes, avg_followup_delay_minutes,
      avg_decision_execution_time_minutes, follow_up_completion_rate, onboarding_rate,
      lead_conversion_rate, qualification_accuracy, avg_trust_score, avg_sentiment,
      activity_score, productivity_score, total_leads_assigned, hot_leads_assigned,
      warm_leads_assigned, leads_onboarded, leads_lost, performance_trend,
      trend_explanation, JSON.stringify(strengths), JSON.stringify(weaknesses),
      JSON.stringify(coaching_flags), performance_explanation
    ];
    const result = await pool.query(sql, values);
    return result.rows[0];
  }

  static async findByOwner(owner_id, limit = 30) {
    const result = await pool.query(
      'SELECT * FROM sales_performance WHERE owner_id = $1 ORDER BY period_date DESC LIMIT $2',
      [owner_id, limit]
    );
    return result.rows;
  }

  static async findByDate(period_date, period_type = 'daily') {
    const result = await pool.query(
      'SELECT * FROM sales_performance WHERE period_date = $1 AND period_type = $2 ORDER BY productivity_score DESC NULLS LAST',
      [period_date, period_type]
    );
    return result.rows;
  }

  static async findLatestAll() {
    const result = await pool.query(`
      SELECT DISTINCT ON (owner_id) * FROM sales_performance
      ORDER BY owner_id, period_date DESC, calculated_at DESC
    `);
    return result.rows;
  }

  static async getTopPerformers(period_date, limit = 5) {
    const result = await pool.query(
      `SELECT * FROM sales_performance
       WHERE period_date = $1
       ORDER BY productivity_score DESC NULLS LAST, onboarding_rate DESC NULLS LAST
       LIMIT $2`,
      [period_date, limit]
    );
    return result.rows;
  }

  static async getNeedsAttention(period_date, limit = 5) {
    const result = await pool.query(
      `SELECT * FROM sales_performance
       WHERE period_date = $1 AND (
         follow_up_completion_rate < 50
         OR avg_response_time_minutes > 120
         OR follow_ups_missed > 2
       )
       ORDER BY productivity_score ASC NULLS FIRST
       LIMIT $2`,
      [period_date, limit]
    );
    return result.rows;
  }

  static async getTrend(owner_id, days = 14) {
    const result = await pool.query(
      `SELECT * FROM sales_performance
       WHERE owner_id = $1 AND period_type = 'daily'
       ORDER BY period_date DESC
       LIMIT $2`,
      [owner_id, days]
    );
    return result.rows;
  }
}

module.exports = SalesPerformance;
