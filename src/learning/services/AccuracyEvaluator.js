'use strict';
// AccuracyEvaluator — compares AI predictions with actual outcomes from existing modules
const pool = require('../../memory/db/pool');
const LearningEvent = require('../models/LearningEvent');

class AccuracyEvaluator {

  // Evaluate qualification engine: compare predicted category vs actual customer status
  static async evaluateQualification() {
    try {
      const r = await pool.query(
        'SELECT q.lead_id, q.qualification_category, q.onboarding_score, q.onboarding_probability, ' +
        'q.updated_at, l.pipeline_stage, l.lead_status ' +
        'FROM onboarding_qualifications q ' +
        'JOIN leads l ON q.lead_id=l.lead_id ' +
        'WHERE q.updated_at >= NOW() - INTERVAL $1 ' +
        'LIMIT 200',
        ['30 days']
      );
      let correct = 0, total = 0;
      const events = [];
      for (const row of r.rows) {
        const predicted = row.qualification_category;
        const stage = (row.pipeline_stage || '').toLowerCase();
        const status = (row.lead_status || '').toLowerCase();
        let actual = 'unknown';
        let isCorrect = null;
        if (stage.includes('onboard') || status.includes('onboard')) { actual = 'onboarded'; isCorrect = ['hot','warm'].includes(predicted?.toLowerCase()); }
        else if (stage.includes('lost') || status.includes('lost') || status.includes('dead')) { actual = 'lost'; isCorrect = ['cold','dead','unqualified'].includes(predicted?.toLowerCase()); }
        if (isCorrect !== null) { total++; if (isCorrect) correct++; }
        events.push({ lead_id: row.lead_id, source_module: 'qualification', prediction_type: 'qualification_category',
          prediction_value: { category: predicted, score: row.onboarding_score, probability: row.onboarding_probability },
          actual_value: { stage, status, actual }, is_correct: isCorrect,
          accuracy_score: isCorrect === null ? null : (isCorrect ? 1 : 0) });
      }
      const accuracy = total > 0 ? correct / total : 0;
      return { module: 'qualification', total_evaluated: total, correct, accuracy: Math.round(accuracy * 10000) / 10000, events };
    } catch (e) { return { module: 'qualification', error: e.message }; }
  }

  // Evaluate decision engine: compare recommended actions vs execution status
  static async evaluateDecisions() {
    try {
      const r = await pool.query(
        'SELECT d.decision_id, d.lead_id, d.decision_type, d.priority, d.status, ' +
        'd.confidence_score, d.created_at, d.executed_at, d.dismissed_at, ' +
        'l.pipeline_stage ' +
        'FROM decisions d LEFT JOIN leads l ON d.lead_id=l.lead_id ' +
        'WHERE d.created_at >= NOW() - INTERVAL $1 ' +
        'AND d.status IN ($2,$3) ' +
        'LIMIT 200',
        ['30 days', 'completed', 'dismissed']
      );
      let executed = 0, dismissed = 0, total = r.rowCount;
      for (const row of r.rows) {
        if (row.status === 'completed') executed++;
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
        'FROM investigations WHERE status=$1 AND created_at >= NOW() - INTERVAL $2 ' +
        'LIMIT 100',
        ['completed', '30 days']
      );
      const avgConfidence = r.rows.reduce((s, x) => s + parseFloat(x.confidence || 0), 0) / (r.rowCount || 1);
      const withRootCause = r.rows.filter(x => x.root_cause && JSON.parse(JSON.stringify(x.root_cause)).length > 0).length;
      return { module: 'investigations', total_completed: r.rowCount,
        with_root_cause: withRootCause, root_cause_rate: Math.round((withRootCause / (r.rowCount || 1)) * 10000) / 10000,
        avg_confidence: Math.round(avgConfidence * 100) / 100 };
    } catch (e) { return { module: 'investigations', error: e.message }; }
  }

  // Evaluate conversation intelligence: check if next_step recommendations match decisions
  static async evaluateConversations() {
    try {
      const r = await pool.query(
        'SELECT ca.lead_id, ca.sentiment, ca.trust_score, ca.conversation_quality, ' +
        'ca.recommended_next_step, ca.confidence_score, ca.analyzed_at ' +
        'FROM conversation_analysis ca ' +
        'WHERE ca.analyzed_at >= NOW() - INTERVAL $1 LIMIT 200',
        ['30 days']
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

  // Evaluate sales coaching: check if performance improved after coaching
  static async evaluateSalesCoaching() {
    try {
      const r = await pool.query(
        'SELECT salesperson_name, onboarding_rate, lead_conversion_rate, activity_score, ' +
        'productivity_score, performance_trend, updated_at ' +
        'FROM sales_performance LIMIT 20'
      );
      const improving = r.rows.filter(x => x.performance_trend === 'improving').length;
      const declining = r.rows.filter(x => x.performance_trend === 'declining').length;
      const avgActivity = r.rows.reduce((s, x) => s + parseFloat(x.activity_score || 0), 0) / (r.rowCount || 1);
      return { module: 'sales_coaching', total_reps: r.rowCount, improving, declining,
        stable: r.rowCount - improving - declining,
        avg_activity_score: Math.round(avgActivity * 100) / 100,
        improvement_rate: Math.round((improving / (r.rowCount || 1)) * 10000) / 10000 };
    } catch (e) { return { module: 'sales_coaching', error: e.message }; }
  }

  // Run all evaluations and return combined results
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
