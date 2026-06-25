'use strict';
const pool = require('../../memory/db/pool');

class SalesCoachingEngine {
  static async generateForOwner(owner_id, owner_name) {
    console.log('[SalesCoachingEngine] Generating coaching for:', owner_id);
    const suggestions = [];

    const [perf, followups, convAnalysis, decisions] = await Promise.allSettled([
      pool.query(`SELECT * FROM sales_performance WHERE owner_id = $1 ORDER BY period_date DESC LIMIT 7`, [owner_id]),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'missed' OR (due_at < NOW() AND status = 'pending')) as missed,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) as total
        FROM bm_follow_ups WHERE owner_id = $1 AND created_at > NOW() - INTERVAL '7 days'`, [owner_id]),
      pool.query(`SELECT sentiment, trust_score, objections, conversation_quality
        FROM conversation_analysis ca
        JOIN lead_memory lm ON lm.lead_id = ca.lead_id
        WHERE lm.owner_id = $1 AND ca.analyzed_at > NOW() - INTERVAL '7 days'
        ORDER BY ca.analyzed_at DESC LIMIT 20`, [owner_id]),
      pool.query(`SELECT status, COUNT(*) as count
        FROM ai_decisions WHERE crm_owner = $1 AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY status`, [owner_id])
    ]);

    const perfRows = perf.status === 'fulfilled' ? perf.value.rows : [];
    const followupData = followups.status === 'fulfilled' ? followups.value.rows[0] : {};
    const convRows = convAnalysis.status === 'fulfilled' ? convAnalysis.value.rows : [];
    const decisionRows = decisions.status === 'fulfilled' ? decisions.value.rows : [];

    // Check missed follow-ups
    const missedFU = parseInt(followupData.missed) || 0;
    const totalFU = parseInt(followupData.total) || 0;
    if (missedFU > 2) {
      suggestions.push({
        owner_id, owner_name,
        coaching_type: 'missed_followup',
        priority: missedFU > 5 ? 'high' : 'medium',
        title: 'Missed Follow-ups Detected',
        description: owner_name + ' has missed ' + missedFU + ' follow-ups in the last 7 days. Consistent follow-up is critical for onboarding.',
        evidence: [{ metric: 'missed_followups', value: missedFU, total: totalFU }],
        suggested_action: 'Review and reschedule all missed follow-ups. Set reminders 30 minutes before each due time.',
        expected_improvement: 'Following up consistently can improve onboarding rate by 20-40%.',
        confidence_score: 90
      });
    }

    // Check slow response times
    const recentPerf = perfRows[0];
    if (recentPerf && recentPerf.avg_response_time_minutes > 120) {
      suggestions.push({
        owner_id, owner_name,
        coaching_type: 'slow_response',
        priority: 'high',
        title: 'Slow Response Time Detected',
        description: 'Average response time is ' + Math.round(recentPerf.avg_response_time_minutes) + ' minutes. Leads expect responses within 60 minutes.',
        evidence: [{ metric: 'avg_response_time_minutes', value: recentPerf.avg_response_time_minutes }],
        suggested_action: 'Set up mobile notifications for new leads. Respond within 60 minutes during business hours.',
        expected_improvement: 'Faster responses increase trust score by 15-25%.',
        confidence_score: 85
      });
    }

    // Check low trust scores
    const lowTrustConvs = convRows.filter(r => r.trust_score && r.trust_score < 40);
    if (lowTrustConvs.length >= 3) {
      suggestions.push({
        owner_id, owner_name,
        coaching_type: 'low_trust',
        priority: 'medium',
        title: 'Low Trust Detected in Conversations',
        description: lowTrustConvs.length + ' conversations this week had trust scores below 40. This indicates communication quality issues.',
        evidence: lowTrustConvs.slice(0, 3).map(r => ({ trust_score: r.trust_score, quality: r.conversation_quality })),
        suggested_action: 'Review low-trust conversation transcripts. Focus on addressing objections clearly and showing expertise.',
        expected_improvement: 'Improving trust score from 40 to 70 increases onboarding probability by 30%.',
        confidence_score: 80
      });
    }

    // Check poor decision execution
    const dismissedDecisions = decisionRows.find(r => r.status === 'dismissed');
    const pendingDecisions = decisionRows.find(r => r.status === 'pending');
    if (dismissedDecisions && parseInt(dismissedDecisions.count) > 3) {
      suggestions.push({
        owner_id, owner_name,
        coaching_type: 'poor_decision_execution',
        priority: 'medium',
        title: 'High Decision Dismissal Rate',
        description: dismissedDecisions.count + ' AI recommendations were dismissed this week. Dismissed decisions may indicate missed opportunities.',
        evidence: [{ metric: 'dismissed_decisions', value: dismissedDecisions.count }],
        suggested_action: 'Review dismissed AI recommendations to understand if business context explains the dismissals.',
        expected_improvement: 'Acting on AI recommendations improves onboarding conversion rate.',
        confidence_score: 75
      });
    }

    // Check productivity trend
    if (perfRows.length >= 3) {
      const recent = parseFloat(perfRows[0].productivity_score) || 0;
      const older = parseFloat(perfRows[perfRows.length - 1].productivity_score) || 0;
      if (recent < older - 15) {
        suggestions.push({
          owner_id, owner_name,
          coaching_type: 'declining_productivity',
          priority: 'high',
          title: 'Productivity Declining',
          description: 'Productivity score dropped from ' + Math.round(older) + ' to ' + Math.round(recent) + ' over the last ' + perfRows.length + ' days.',
          evidence: perfRows.slice(0, 3).map(r => ({ date: r.period_date, score: r.productivity_score })),
          suggested_action: 'Schedule a 1-on-1 review. Identify blockers and provide additional support.',
          expected_improvement: 'Addressing blockers early prevents further performance degradation.',
          confidence_score: 85
        });
      }
    }

    // Store all suggestions
    const stored = [];
    for (const s of suggestions) {
      try {
        const result = await pool.query(
          `INSERT INTO sales_coaching (
            owner_id, owner_name, coaching_type, priority, title, description,
            evidence, suggested_action, expected_improvement, confidence_score
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT DO NOTHING RETURNING *`,
          [
            s.owner_id, s.owner_name, s.coaching_type, s.priority,
            s.title, s.description, JSON.stringify(s.evidence || []),
            s.suggested_action, s.expected_improvement, s.confidence_score
          ]
        );
        if (result.rows[0]) stored.push(result.rows[0]);
      } catch (e) {
        console.error('[SalesCoachingEngine] Failed to store suggestion:', e.message);
      }
    }

    return stored;
  }

  static async getActiveCoaching(owner_id = null, limit = 20) {
    let sql, params;
    if (owner_id) {
      sql = "SELECT * FROM sales_coaching WHERE owner_id = $1 AND status = 'active' ORDER BY priority DESC, created_at DESC LIMIT $2";
      params = [owner_id, limit];
    } else {
      sql = "SELECT * FROM sales_coaching WHERE status = 'active' ORDER BY priority DESC, created_at DESC LIMIT $1";
      params = [limit];
    }
    const result = await pool.query(sql, params);
    return result.rows;
  }

  static async resolveCoaching(coaching_id) {
    const result = await pool.query(
      "UPDATE sales_coaching SET status = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE coaching_id = $1 RETURNING *",
      [coaching_id]
    );
    return result.rows[0];
  }
}

module.exports = SalesCoachingEngine;
