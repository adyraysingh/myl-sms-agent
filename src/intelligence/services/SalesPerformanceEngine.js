—————'use strict';
const pool = require('../../memory/db/pool');
const SalesPerformance = require('../models/SalesPerformance');

class SalesPerformanceEngine {
    // Calculate all metrics for all owners for a given date
  static async recalculateAll(period_date = null) {
        const date = period_date || new Date().toISOString().split('T')[0];
        console.log('[SalesPerformanceEngine] Recalculating all owners for', date);

      try {
              const owners = await SalesPerformanceEngine._getActiveOwners(date);
              const results = [];

          for (const owner of owners) {
                    try {
                                const perf = await SalesPerformanceEngine.calculateForOwner(owner.owner_id, owner.owner_name, owner.owner_email, date);
                                results.push(perf);
                    } catch (e) {
                                console.error('[SalesPerformanceEngine] Error for owner', owner.owner_id, e.message);
                    }
          }

          console.log('[SalesPerformanceEngine] Recalculated', results.length, 'owners');
              return results;
      } catch (err) {
              console.error('[SalesPerformanceEngine] Fatal error:', err.message);
              throw err;
      }
  }

  static async calculateForOwner(owner_id, owner_name, owner_email, period_date) {
        const date = period_date || new Date().toISOString().split('T')[0];
        const startOfDay = date + 'T00:00:00Z';
        const endOfDay = date + 'T23:59:59Z';

      // Gather all metrics in parallel
      const [
              callsResult, chatsResult, emailsResult, tasksResult,
              followupResult, leadsResult, qualResult, decisionsResult,
              prevResult
            ] = await Promise.allSettled([
              SalesPerformanceEngine._getCallMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getChatMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getEmailMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getTaskMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getFollowupMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getLeadMetrics(owner_id, date),
              SalesPerformanceEngine._getQualificationMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getDecisionMetrics(owner_id, startOfDay, endOfDay),
              SalesPerformanceEngine._getPreviousDayMetrics(owner_id, date)
            ]);

      const calls = callsResult.status === 'fulfilled' ? callsResult.value : {};
        const chats = chatsResult.status === 'fulfilled' ? chatsResult.value : {};
        const emails = emailsResult.status === 'fulfilled' ? emailsResult.value : {};
        const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : {};
        const followups = followupResult.status === 'fulfilled' ? followupResult.value : {};
        const leads = leadsResult.status === 'fulfilled' ? leadsResult.value : {};
        const quals = qualResult.status === 'fulfilled' ? qualResult.value : {};
        const decisions = decisionsResult.status === 'fulfilled' ? decisionsResult.value : {};
        const prev = prevResult.status === 'fulfilled' ? prevResult.value : null;

      // Calculate derived metrics
      const follow_up_completion_rate = followups.total > 0
          ? Math.round((followups.completed / followups.total) * 100)
              : null;

      const activity_score = SalesPerformanceEngine._calcActivityScore({
              calls: calls.count || 0,
              chats: chats.count || 0,
              emails: emails.sent || 0,
              tasks: tasks.completed || 0,
              followups: followups.completed || 0
      });

      const productivity_score = SalesPerformanceEngine._calcProductivityScore({
              activity_score,
              follow_up_completion_rate,
              onboarding_rate: leads.onboarding_rate,
              avg_response_time: calls.avg_response_time_minutes || emails.avg_response_time_minutes
      });

      // Determine trend
      let performance_trend = 'stable';
        let trend_explanation = 'No previous data available for comparison.';
        if (prev) {
                const prevScore = prev.productivity_score || 50;
                const currScore = productivity_score || 50;
                const diff = currScore - prevScore;
                if (diff > 5) {
                          performance_trend = 'improving';
                          trend_explanation = 'Productivity score increased by ' + Math.abs(diff.toFixed(1)) + ' points vs yesterday.';
                } else if (diff < -5) {
                          performance_trend = 'declining';
                          trend_explanation = 'Productivity score decreased by ' + Math.abs(diff.toFixed(1)) + ' points vs yesterday.';
                } else {
                          performance_trend = 'stable';
                          trend_explanation = 'Performance is stable compared to yesterday.';
                }
        }

      // Build coaching flags
      const coaching_flags = [];
        if (followups.missed > 2) coaching_flags.push({ type: 'missed_followup', detail: followups.missed + ' missed follow-ups today' });
        if (calls.avg_response_time_minutes > 120) coaching_flags.push({ type: 'slow_response', detail: 'Average response time ' + calls.avg_response_time_minutes + ' mins' });
        if (quals.avg_trust_score < 50) coaching_flags.push({ type: 'low_trust', detail: 'Low average trust score: ' + quals.avg_trust_score });
        if (follow_up_completion_rate !== null && follow_up_completion_rate < 50) coaching_flags.push({ type: 'poor_followup', detail: 'Follow-up completion rate: ' + follow_up_completion_rate + '%' });

      const strengths = [];
        if (leads.onboarding_rate > 20) strengths.push('High onboarding rate: ' + leads.onboarding_rate + '%');
        if (follow_up_completion_rate >= 90) strengths.push('Excellent follow-up completion: ' + follow_up_completion_rate + '%');
        if (calls.count >= 5) strengths.push('Strong call volume: ' + calls.count + ' calls');

      const weaknesses = coaching_flags.map(f => f.detail);

      const performance_explanation = [
              'Owner: ' + (owner_name || owner_id),
              'Period: ' + date,
              'Calls: ' + (calls.count || 0) + ', Chats: ' + (chats.count || 0) + ', Emails sent: ' + (emails.sent || 0),
              'Follow-up rate: ' + (follow_up_completion_rate || 0) + '%',
              'Activity score: ' + activity_score + ', Productivity score: ' + productivity_score,
              'Trend: ' + performance_trend + ' - ' + trend_explanation
            ].join(' | ');

      return await SalesPerformance.upsert({
              owner_id, owner_name, owner_email, period_date: date,
              calls_completed: calls.count || 0,
              chats_handled: chats.count || 0,
              emails_sent: emails.sent || 0,
              emails_replied: emails.replied || 0,
              tasks_completed: tasks.completed || 0,
              follow_ups_completed: followups.completed || 0,
              follow_ups_missed: followups.missed || 0,
              avg_response_time_minutes: calls.avg_response_time_minutes || emails.avg_response_time_minutes,
              avg_first_contact_time_minutes: leads.avg_first_contact_minutes,
              avg_followup_delay_minutes: followups.avg_delay_minutes,
              avg_decision_execution_time_minutes: decisions.avg_execution_time_minutes,
              follow_up_completion_rate,
              onboarding_rate: leads.onboarding_rate,
              lead_conversion_rate: leads.conversion_rate,
              qualification_accuracy: quals.accuracy,
              avg_trust_score: quals.avg_trust_score,
              avg_sentiment: quals.avg_sentiment,
              activity_score,
              productivity_score,
              total_leads_assigned: leads.total || 0,
              hot_leads_assigned: leads.hot || 0,
              warm_leads_assigned: leads.warm || 0,
              leads_onboarded: leads.onboarded || 0,
              leads_lost: leads.lost || 0,
              performance_trend,
              trend_explanation,
              strengths,
              weaknesses,
              coaching_flags,
              performance_explanation
      });
  }

  static async _getActiveOwners(date) {
        const result = await pool.query(
                `SELECT DISTINCT
                        COALESCE(lm.owner_id, ca.owner_id) as owner_id,
                                COALESCE(lm.owner_name, '') as owner_name,
                                        COALESCE(lm.owner_email, '') as owner_email
                                               FROM lead_memory lm
                                                      LEFT JOIN conversation_analysis ca ON ca.lead_id = lm.id
                                                             WHERE lm.owner_id IS NOT NULL AND lm.owner_id != ''
                                                                    GROUP BY lm.owner_id, lm.owner_name, lm.owner_email, ca.owner_id
                                                                           LIMIT 50`
              );
        return result.rows;
  }

  static async _getCallMetrics(owner_id, start, end) {
        const result = await pool.query(
                `SELECT
                        COUNT(*) as count,
                                AVG(EXTRACT(EPOCH FROM (rc.call_ended_at - rc.call_started_at))/60) as avg_duration_minutes,
                                        AVG(EXTRACT(EPOCH FROM (rc.call_started_at - lm.created_at))/60) as avg_response_time_minutes
                                               FROM retell_calls rc
                                                      JOIN lead_memory lm ON lm.id = rc.lead_id
                                                             WHERE lm.owner_id = $1
                                                                    AND rc.created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        const row = result.rows[0];
        return {
                count: parseInt(row.count) || 0,
                avg_duration_minutes: parseFloat(row.avg_duration_minutes) || null,
                avg_response_time_minutes: parseFloat(row.avg_response_time_minutes) || null
        };
  }

  static async _getChatMetrics(owner_id, start, end) {
        const result = await pool.query(
                `SELECT COUNT(*) as count
                       FROM salesiq_chats sc
                              JOIN lead_memory lm ON lm.id = sc.lead_id
                                     WHERE lm.owner_id = $1 AND sc.created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        return { count: parseInt(result.rows[0].count) || 0 };
  }

  static async _getEmailMetrics(owner_id, start, end) {
        const sentResult = await pool.query(
                `SELECT COUNT(*) as count FROM email_events
                       WHERE owner_id = $1 AND direction = 'outbound' AND created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        const repliedResult = await pool.query(
                `SELECT COUNT(*) as count FROM email_events
                       WHERE owner_id = $1 AND direction = 'inbound' AND created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        return {
                sent: parseInt(sentResult.rows[0].count) || 0,
                replied: parseInt(repliedResult.rows[0].count) || 0
        };
  }

  static async _getTaskMetrics(owner_id, start, end) {
        const result = await pool.query(
                `SELECT
                        COUNT(*) FILTER (WHERE status = 'completed') as completed,
                                COUNT(*) as total
                                       FROM crm_tasks WHERE owner_id = $1 AND created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        const row = result.rows[0];
        return { completed: parseInt(row.completed) || 0, total: parseInt(row.total) || 0 };
  }

  static async _getFollowupMetrics(owner_id, start, end) {
        const result = await pool.query(
                `SELECT
                        COUNT(*) FILTER (WHERE status = 'completed') as completed,
                                COUNT(*) FILTER (WHERE status = 'missed' OR (due_at < NOW() AND status = 'pending')) as missed,
                                        COUNT(*) as total,
                                                AVG(EXTRACT(EPOCH FROM (completed_at - due_at))/60) as avg_delay_minutes
                                                       FROM bm_follow_ups
                                                              WHERE owner_id = $1 AND created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        const row = result.rows[0];
        return {
                completed: parseInt(row.completed) || 0,
                missed: parseInt(row.missed) || 0,
                total: parseInt(row.total) || 0,
                avg_delay_minutes: parseFloat(row.avg_delay_minutes) || null
        };
  }

  static async _getLeadMetrics(owner_id, date) {
        const result = await pool.query(
                `SELECT
                        COUNT(*) as total,
                                COUNT(*) FILTER (WHERE qualification_category = 'Hot') as hot,
                                        COUNT(*) FILTER (WHERE qualification_category = 'Warm') as warm,
                                                COUNT(*) FILTER (WHERE qualification_category = 'Onboarded') as onboarded,
                                                        COUNT(*) FILTER (WHERE qualification_category = 'Dead' OR qualification_category = 'Cold') as lost
                                                               FROM lead_memory lm
                                                                      LEFT JOIN lead_qualification lq ON lq.lead_id = lm.id
                                                                             WHERE lm.owner_id = $1`,
                [owner_id]
              );
        const row = result.rows[0];
        const total = parseInt(row.total) || 0;
        const onboarded = parseInt(row.onboarded) || 0;
        return {
                total,
                hot: parseInt(row.hot) || 0,
                warm: parseInt(row.warm) || 0,
                onboarded,
                lost: parseInt(row.lost) || 0,
                onboarding_rate: total > 0 ? Math.round((onboarded / total) * 100) : null,
                conversion_rate: null,
                avg_first_contact_minutes: null
        };
  }

  static async _getQualificationMetrics(owner_id, start, end) {
        const result = await pool.query(
                `SELECT
                        AVG(ca.trust_score) as avg_trust_score,
                                AVG(CASE WHEN ca.sentiment = 'positive' THEN 80
                                                 WHEN ca.sentiment = 'neutral' THEN 50
                                                                  ELSE 20 END) as avg_sentiment
                                                                         FROM conversation_analysis ca
                                                                                JOIN lead_memory lm ON lm.id = ca.lead_id
                                                                                       WHERE lm.owner_id = $1 AND ca.analyzed_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        const row = result.rows[0];
        return {
                avg_trust_score: parseFloat(row.avg_trust_score) || null,
                avg_sentiment: parseFloat(row.avg_sentiment) || null,
                accuracy: null
        };
  }

  static async _getDecisionMetrics(owner_id, start, end) {
        const result = await pool.query(
                `SELECT
                        AVG(EXTRACT(EPOCH FROM (executed_at - created_at))/60) as avg_execution_time_minutes
                               FROM ai_decisions
                                      WHERE crm_owner = $1 AND status = 'executed' AND created_at BETWEEN $2 AND $3`,
                [owner_id, start, end]
              );
        return {
                avg_execution_time_minutes: parseFloat(result.rows[0].avg_execution_time_minutes) || null
        };
  }

  static async _getPreviousDayMetrics(owner_id, date) {
        const prevDate = new Date(date);
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];
        const result = await pool.query(
                'SELECT * FROM sales_performance WHERE owner_id = $1 AND period_date = $2',
                [owner_id, prevDateStr]
              );
        return result.rows[0] || null;
  }

  static _calcActivityScore({ calls, chats, emails, tasks, followups }) {
        const score = (calls * 15) + (chats * 10) + (emails * 5) + (tasks * 10) + (followups * 15);
        return Math.min(100, score);
  }

  static _calcProductivityScore({ activity_score, follow_up_completion_rate, onboarding_rate, avg_response_time }) {
        let score = (activity_score || 0) * 0.4;
        if (follow_up_completion_rate !== null) score += follow_up_completion_rate * 0.3;
        if (onboarding_rate !== null) score += Math.min(100, onboarding_rate * 2) * 0.2;
        if (avg_response_time !== null && avg_response_time < 60) score += 10;
        return Math.min(100, Math.round(score));
  }
}

module.exports = SalesPerformanceEngine;
