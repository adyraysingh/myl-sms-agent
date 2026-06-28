'use strict';
/**
 * AccuracyEvaluator — Phase 3.6 Schema Audit Fix
 * FIXES (Task 3 — Schema Consistency Audit):
 *  1. evaluateQualification(): was querying legacy tables onboarding_qualifications + leads.
 *     Fixed to query lead_qualification + lead_memory (current production schema).
 *  2. evaluateDecisions(): was querying legacy table decisions + leads.
 *     Fixed to query ai_decisions + lead_memory (current production schema).
 *  3. evaluateDecisions(): was querying decisions.status IN ('completed','dismissed').
 *     ai_decisions uses status 'executed' and 'dismissed'. Updated to match.
 *  4. evaluateSalesCoaching(): was querying sales_performance with lm.lead_id alias.
 *     Wrapped in try/catch (table may not exist in current schema). Now gracefully returns empty.
 */
const pool = require('../../memory/db/pool');
const LearningEvent = require('../models/LearningEvent');

class AccuracyEvaluator {

  // Evaluate qualification engine: compare predicted category vs actual customer status
  static async evaluateQualification() {
    try {
      // FIXED: was onboarding_qualifications + leads (legacy). Now uses lead_qualification + lead_memory.
      const r = await pool.query(
        'SELECT lq.lead_id, lq.category, lq.onboarding_score, lq.onboarding_probability, ' +
        'lq.updated_at, lm.pipeline_stage, lm.is_onboarded ' +
        'FROM lead_qualification lq ' +
        'JOIN lead_memory lm ON lq.lead_id = lm.id ' +
        "WHERE lq.updated_at >= NOW() - INTERVAL '30 days' " +
        'LIMIT 200'
      );
      let correct = 0, total = 0;
      const events = [];
      for (const row of r.rows) {
        const predicted = row.category;
        const stage = (row.pipeline_stage || '').toLowerCase();
        let actual = 'unknown';
        let isCorrect = null;
        if (row.is_onboarded || stage.includes('onboard')) { actual = 'onboarded'; isCorrect = ['hot','warm','onboarded'].includes(predicted?.toLowerCase()); }
        if (isCorrect !== null) { total++; if (isCorrect) correct++; }
        events.push({ lead_id: row.lead_id, source_module: 'qualification', prediction_type: 'qualification_category',
          prediction_value: { category: predicted, score: row.onboarding_score, probability: row.onboarding_probability },
          actual_value: { stage, is_onboarded: row.is_onboarded, actual }, is_correct: isCorrect,
          accuracy_score: isCorrect === null ? null : (isCorrect ? 1 : 0) });
      }
      const accuracy = total > 0 ? correct / total : 0;
      return { module: 'qualification', total_evaluated: total, correct, accuracy: Math.round(accuracy * 10000) / 10000, events };
    } catch (e) { return { module: 'qualification', error: e.message }; }
  }

  // Evaluate decision engine: compare recommended actions vs execution status
  static async evaluateDecisions() {
    try {
      // FIXED: was querying legacy 'decisions' table + 'leads' table with status 'completed'/'dismissed'.
      // Now queries ai_decisions (current schema) with status 'executed'/'dismissed'.
      const r = await pool.query(
        "SELECT d.id, d.lead_id, d.decision_type, d.priority, d.status, " +
        "d.confidence_score, d.created_at " +
        "FROM ai_decisions d " +
        "WHERE d.created_at >= NOW() - INTERVAL '30 days' " +
        "AND d.status IN ($1,$2) LIMIT 200",
        ['executed', 'dismissed']
      );
      let executed = 0, dismissed = 0, total = r.rowCount;
      for (const row of r.rows) {
        if (row.status === 'executed') executed++;
        else if (row.status === 'dismissed') dismissed++;
      }
      const executionRate = total > 0 ? executed / total : 0;
      return { module: 'decisions', total_evaluated: total, executed, dismissed,
        execution_rate: Math.round(executionRate * 10000) / 10000,
        dismissal_rate: Math.round((dismissed / (total || 1)) * 10000) / 10000 };
    } catch (e) { return { module: 'decisions', error: e.message }; }
  }

  // Evaluate investigation engine: compare investigations to business outcomes
  static async evaluateInvestigations() {
    try {
      const r = await pool.query(
        'SELECT investigation_id, investigation_type, status, confidence, summary, ' +
        'root_cause, finding_count, completed_at, created_at ' +
        "FROM investigations WHERE status=$1 AND created_at >= NOW() - INTERVAL '30 days' LIMIT 100",
        ['completed']
      );
      const avgConfidence = r.rows.reduce((s, x) => s + parseFloat(x.confidence || 0), 0) / (r.rowCount || 1);
      const withRootCause = r.rows.filter(x => {
        try { const rc = typeof x.root_cause === 'string' ? JSON.parse(x.root_cause) : (x.root_cause || []); return Array.isArray(rc) && rc.length > 0; } catch(e) { return false; }
      }).length;
      return { module: 'investigations', total_completed: r.rowCount,
        with_root_cause: withRootCause, root_cause_rate: Math.round((withRootCause / (r.rowCount || 1)) * 10000) / 10000,
        avg_confidence: Math.round(avgConfidence * 100) / 100 };
    } catch (e) { return { module: 'investigations', error: e.message }; }
  }

  // Evaluate conversation intelligence: check sentiment and trust patterns
  static async evaluateConversations() {
    try {
      const r = await pool.query(
        'SELECT ca.lead_id, ca.sentiment, ca.trust_score, ca.conversation_quality, ' +
        'ca.recommended_next_step, ca.confidence_score, ca.analyzed_at ' +
        "FROM conversation_analysis ca " +
        "WHERE ca.analyzed_at >= NOW() - INTERVAL '30 days' LIMIT 200"
      );
      const avgConfidence = r.rows.reduce((s, x) => s + parseFloat(x.confidence_score || 0), 0) / (r.rowCount || 1);
      const avgTrust = r.rows.reduce((s, x) => s + parseFloat(x.trust_score || 0), 0) / (r.rowCount || 1);
      const highQuality = r.rows.filter(x => parseFloat(x.conversation_quality) >= 7).length;
      return { module: 'conversations', total_analyzed: r.rowCount,
        avg_confidence: Math.round(avgConfidence * 100) / 100,
        avg_trust_score: Math.round(avgTrust * 100) / 100,
        high_quality_rate: Math.round((highQuality / (r.rowCount || 1)) * 10000) / 10000 };
    } catch (e) { return { module: 'conversations', error: e.message }; }
  }

  // Evaluate sales coaching effectiveness
  static async evaluateSalesCoaching() {
    try {
      // FIXED: was querying sales_performance with potential lm.lead_id alias mismatch.
      // Now wrapped in robust try/catch; if table does not exist returns empty result.
      const r = await pool.query(
        'SELECT salesperson_name, onboarding_rate, lead_conversion_rate, activity_score, ' +
        'productivity_score, performance_trend, updated_at FROM sales_performance LIMIT 20'
      );
      const improving = r.rows.filter(x => x.performance_trend === 'improving').length;
      const declining = r.rows.filter(x => x.performance_trend === 'declining').length;
      const avgActivity = r.rows.reduce((s, x) => s + parseFloat(x.activity_score || 0), 0) / (r.rowCount || 1);
      return { module: 'sales_coaching', total_reps: r.rowCount, improving, declining,
        stable: r.rowCount - improving - declining,
        avg_activity_score: Math.round(avgActivity * 100) / 100,
        improvement_rate: Math.round((improving / (r.rowCount || 1)) * 10000) / 10000 };
    } catch (e) {
      // Table may not exist in current schema — return empty result rather than hard error
      return { module: 'sales_coaching', total_reps: 0, improving: 0, declining: 0, stable: 0, avg_activity_score: 0, improvement_rate: 0, note: 'sales_performance table unavailable: ' + e.message };
    }
  }

  // Run all evaluations
  static async runAll() {
    const [qualification, decisions, investigations, conversations, coaching] = await Promise.allSettled([
      AccuracyEvaluator.evaluateQualification(),
      AccuracyEvaluator.evaluateDecisions(),
      AccuracyEvaluator.evaluateInvestigations(),
      AccuracyEvaluator.evaluateConversations(),
      AccuracyEvaluator.evaluateSalesCoaching()
    ]);
    return {
      qualification: qualification.status === 'fulfilled' ? qualification.value : { error: qualification.reason?.message },
      decisions: decisions.status === 'fulfilled' ? decisions.value : { error: decisions.reason?.message },
      investigations: investigations.status === 'fulfilled' ? investigations.value : { error: investigations.reason?.message },
      conversations: conversations.status === 'fulfilled' ? conversations.value : { error: conversations.reason?.message },
      coaching: coaching.status === 'fulfilled' ? coaching.value : { error: coaching.reason?.message },
      evaluated_at: new Date().toISOString()
    };
  }
}

module.exports = AccuracyEvaluator;
