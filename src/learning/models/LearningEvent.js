'use strict';
const pool = require('../../memory/db/pool');

class LearningEvent {
  // Record an AI prediction for future comparison
  static async recordPrediction({ lead_id, source_module, prediction_type, prediction_value, trigger_event, model_version }) {
    const r = await pool.query(
      'INSERT INTO learning_events (lead_id,source_module,prediction_type,prediction_value,trigger_event,model_version) ' +
      'VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [lead_id||null, source_module, prediction_type, JSON.stringify(prediction_value||{}), trigger_event||null, model_version||'gpt-4o']
    );
    return r.rows[0];
  }

  // Record the actual outcome and calculate accuracy
  static async recordOutcome({ learning_event_id, actual_value, is_correct, accuracy_score, evaluation_notes }) {
    const r = await pool.query(
      'UPDATE learning_events SET actual_value=$1, is_correct=$2, accuracy_score=$3, evaluation_notes=$4, ' +
      'outcome_recorded=true, outcome_recorded_at=NOW(), evaluated_at=NOW() ' +
      'WHERE learning_event_id=$5 RETURNING *',
      [JSON.stringify(actual_value||{}), is_correct, accuracy_score||null, evaluation_notes||null, learning_event_id]
    );
    return r.rows[0];
  }

  // Get pending predictions that need outcome recording
  static async getPendingOutcomes(source_module, limit = 100) {
    const args = [false];
    let q = 'SELECT * FROM learning_events WHERE outcome_recorded=$1';
    if (source_module) { q += ' AND source_module=$2'; args.push(source_module); }
    q += ' ORDER BY created_at ASC LIMIT $' + (args.length + 1);
    args.push(limit);
    const r = await pool.query(q, args);
    return r.rows;
  }

  // Get accuracy metrics for a module
  static async getModuleAccuracy(source_module, days = 30) {
    const r = await pool.query(
      'SELECT source_module, prediction_type, ' +
      'COUNT(*) as total, ' +
      'COUNT(*) FILTER (WHERE outcome_recorded=true) as evaluated, ' +
      'COUNT(*) FILTER (WHERE is_correct=true) as correct, ' +
      'COUNT(*) FILTER (WHERE is_correct=false) as incorrect, ' +
      'ROUND(AVG(accuracy_score) FILTER (WHERE accuracy_score IS NOT NULL), 4) as avg_accuracy ' +
      'FROM learning_events WHERE created_at >= NOW() - ($1 || ' + "' days')::INTERVAL" + ' ' +
      'AND ($2::text IS NULL OR source_module=$2) ' +
      'GROUP BY source_module, prediction_type ORDER BY source_module',
      [days, source_module||null]
    );
    return r.rows;
  }

  // Save model performance snapshot
  static async savePerformance({ model_name, model_version, evaluation_period, period_start, period_end,
    total_predictions, correct_predictions, accuracy, precision_score, recall,
    false_positive_rate, false_negative_rate, confidence_calibration, sample_size, metadata }) {
    const r = await pool.query(
      'INSERT INTO model_performance (model_name,model_version,evaluation_period,period_start,period_end,' +
      'total_predictions,correct_predictions,accuracy,precision_score,recall,' +
      'false_positive_rate,false_negative_rate,confidence_calibration,sample_size,metadata) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
      [model_name, model_version||'gpt-4o', evaluation_period, period_start, period_end,
       total_predictions||0, correct_predictions||0, accuracy||0, precision_score||0, recall||0,
       false_positive_rate||0, false_negative_rate||0, confidence_calibration||0, sample_size||0,
       JSON.stringify(metadata||{})]
    );
    return r.rows[0];
  }

  // Get performance history for a model
  static async getPerformanceHistory(model_name, limit = 30) {
    const args = [];
    let q = 'SELECT * FROM model_performance';
    if (model_name) { q += ' WHERE model_name=$1'; args.push(model_name); }
    q += ' ORDER BY last_evaluated_at DESC LIMIT $' + (args.length + 1);
    args.push(limit);
    const r = await pool.query(q, args);
    return r.rows;
  }

  // Save an optimization suggestion
  static async saveOptimization({ source_module, finding, recommended_change, expected_impact, confidence, priority, supporting_evidence }) {
    const r = await pool.query(
      'INSERT INTO optimization_suggestions (source_module,finding,recommended_change,expected_impact,confidence,priority,supporting_evidence) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [source_module, finding, recommended_change, expected_impact||null, confidence||0,
       priority||'medium', JSON.stringify(supporting_evidence||[])]
    );
    return r.rows[0];
  }

  // Get open optimization suggestions
  static async getOptimizations(status = 'open', limit = 50) {
    const r = await pool.query(
      'SELECT * FROM optimization_suggestions WHERE status=$1 ORDER BY ' +
      'CASE priority WHEN $2 THEN 1 WHEN $3 THEN 2 WHEN $4 THEN 3 ELSE 4 END, created_at DESC LIMIT $5',
      [status, 'high', 'medium', 'low', limit]
    );
    return r.rows;
  }

  // Save a learning trend
  static async saveTrend({ trend_category, trend_name, description, metric, metric_value, direction, supporting_data, sample_size, confidence, business_impact }) {
    const r = await pool.query(
      'INSERT INTO learning_trends (trend_category,trend_name,description,metric,metric_value,direction,supporting_data,sample_size,confidence,business_impact) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ' +
      'ON CONFLICT DO NOTHING RETURNING *',
      [trend_category, trend_name, description, metric||null, metric_value||null, direction||'stable',
       JSON.stringify(supporting_data||{}), sample_size||0, confidence||0, business_impact||'medium']
    );
    return r.rows[0];
  }

  // Get active trends
  static async getTrends(category, limit = 30) {
    const args = [true];
    let q = 'SELECT * FROM learning_trends WHERE is_active=$1';
    if (category) { q += ' AND trend_category=$2'; args.push(category); }
    q += ' ORDER BY confidence DESC, created_at DESC LIMIT $' + (args.length + 1);
    args.push(limit);
    const r = await pool.query(q, args);
    return r.rows;
  }

  // Take a snapshot
  static async takeSnapshot(metrics) {
    const r = await pool.query(
      'INSERT INTO learning_snapshots (overall_accuracy,qualification_accuracy,decision_accuracy,' +
      'investigation_accuracy,conversation_accuracy,coaching_effectiveness,' +
      'total_predictions,total_evaluated,optimization_count,trend_count,metadata) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [metrics.overall||0, metrics.qualification||0, metrics.decision||0,
       metrics.investigation||0, metrics.conversation||0, metrics.coaching||0,
       metrics.total_predictions||0, metrics.total_evaluated||0,
       metrics.optimization_count||0, metrics.trend_count||0, JSON.stringify(metrics.metadata||{})]
    );
    return r.rows[0];
  }

  // Get snapshot history
  static async getSnapshotHistory(limit = 30) {
    const r = await pool.query('SELECT * FROM learning_snapshots ORDER BY snapshot_date DESC LIMIT $1', [limit]);
    return r.rows;
  }

  // Count events by module
  static async countByModule() {
    const r = await pool.query(
      'SELECT source_module, COUNT(*) as total, ' +
      'COUNT(*) FILTER (WHERE outcome_recorded=true) as evaluated, ' +
      'COUNT(*) FILTER (WHERE is_correct=true) as correct ' +
      'FROM learning_events GROUP BY source_module ORDER BY source_module'
    );
    return r.rows;
  }
}

module.exports = LearningEvent;
