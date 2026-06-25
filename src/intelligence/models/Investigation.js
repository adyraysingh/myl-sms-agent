'use strict';
const pool = require('../../memory/db/pool');

class Investigation {
  static async create(data) {
    const { investigation_type, title, question, lead_id, salesperson_id } = data;
    const result = await pool.query(
      'INSERT INTO investigations (investigation_type, title, question, lead_id, salesperson_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [investigation_type, title, question, lead_id || null, salesperson_id || null, 'pending']
    );
    return result.rows[0];
  }

  static async findById(id) {
    const r = await pool.query('SELECT * FROM investigations WHERE investigation_id = $1', [id]);
    return r.rows[0] || null;
  }

  static async findAll({ limit = 50, offset = 0, status, type } = {}) {
    let q = 'SELECT * FROM investigations WHERE 1=1';
    const params = [];
    if (status) { params.push(status); q += ' AND status = $' + params.length; }
    if (type) { params.push(type); q += ' AND investigation_type = $' + params.length; }
    params.push(limit, offset);
    q += ' ORDER BY created_at DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length;
    const r = await pool.query(q, params);
    return r.rows;
  }

  static async findOpen() {
    const r = await pool.query("SELECT * FROM investigations WHERE status IN ('pending','running') ORDER BY created_at DESC LIMIT 20");
    return r.rows;
  }

  static async findRecent(limit = 20) {
    const r = await pool.query('SELECT * FROM investigations ORDER BY created_at DESC LIMIT $1', [limit]);
    return r.rows;
  }

  static async updateStatus(id, status, data = {}) {
    const fields = ['status = $2'];
    const params = [id, status];
    if (data.summary !== undefined) { params.push(data.summary); fields.push('summary = $' + params.length); }
    if (data.root_cause !== undefined) { params.push(JSON.stringify(data.root_cause)); fields.push('root_cause = $' + params.length); }
    if (data.recommendation !== undefined) { params.push(JSON.stringify(data.recommendation)); fields.push('recommendation = $' + params.length); }
    if (data.business_impact !== undefined) { params.push(data.business_impact); fields.push('business_impact = $' + params.length); }
    if (data.confidence !== undefined) { params.push(data.confidence); fields.push('confidence = $' + params.length); }
    if (data.evidence_count !== undefined) { params.push(data.evidence_count); fields.push('evidence_count = $' + params.length); }
    if (data.finding_count !== undefined) { params.push(data.finding_count); fields.push('finding_count = $' + params.length); }
    if (data.processing_time_ms !== undefined) { params.push(data.processing_time_ms); fields.push('processing_time_ms = $' + params.length); }
    if (data.error_message !== undefined) { params.push(data.error_message); fields.push('error_message = $' + params.length); }
    if (status === 'completed' || status === 'failed') { fields.push('completed_at = NOW()'); }
    const r = await pool.query('UPDATE investigations SET ' + fields.join(',') + ' WHERE investigation_id = $1 RETURNING *', params);
    return r.rows[0];
  }

  static async addEvidence(investigation_id, evidence) {
    const { source_module, source_record, evidence_type, description, data = {}, confidence = 0, weight = 1.0 } = evidence;
    const r = await pool.query(
      'INSERT INTO investigation_evidence (investigation_id, source_module, source_record, evidence_type, description, data, confidence, weight) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [investigation_id, source_module, source_record || null, evidence_type, description, JSON.stringify(data), confidence, weight]
    );
    return r.rows[0];
  }

  static async addFinding(investigation_id, finding) {
    const { finding: text, severity = 'medium', impact, recommendation, evidence_ids = [], confidence = 0 } = finding;
    const r = await pool.query(
      'INSERT INTO investigation_findings (investigation_id, finding, severity, impact, recommendation, evidence_ids, confidence) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [investigation_id, text, severity, impact || null, recommendation || null, JSON.stringify(evidence_ids), confidence]
    );
    return r.rows[0];
  }

  static async getEvidence(investigation_id) {
    const r = await pool.query('SELECT * FROM investigation_evidence WHERE investigation_id = $1 ORDER BY weight DESC, confidence DESC', [investigation_id]);
    return r.rows;
  }

  static async getFindings(investigation_id) {
    const r = await pool.query('SELECT * FROM investigation_findings WHERE investigation_id = $1 ORDER BY severity DESC, confidence DESC', [investigation_id]);
    return r.rows;
  }

  static async getPatterns({ type, limit = 20 } = {}) {
    let q = 'SELECT * FROM investigation_patterns WHERE is_active = TRUE';
    const params = [];
    if (type) { params.push(type); q += ' AND pattern_type = $1'; }
    params.push(limit);
    q += ' ORDER BY confidence DESC, impact_score DESC LIMIT $' + params.length;
    const r = await pool.query(q, params);
    return r.rows;
  }

  static async upsertPattern(pattern) {
    const { pattern_type, title, description, supporting_data = {}, sample_size = 0, confidence = 0, impact_score = 0 } = pattern;
    const existing = await pool.query('SELECT pattern_id FROM investigation_patterns WHERE title = $1 AND pattern_type = $2', [title, pattern_type]);
    if (existing.rows.length > 0) {
      const r = await pool.query(
        'UPDATE investigation_patterns SET description=$1, supporting_data=$2, sample_size=$3, confidence=$4, impact_score=$5, last_confirmed_at=NOW() WHERE pattern_id=$6 RETURNING *',
        [description, JSON.stringify(supporting_data), sample_size, confidence, impact_score, existing.rows[0].pattern_id]
      );
      return r.rows[0];
    }
    const r = await pool.query(
      'INSERT INTO investigation_patterns (pattern_type, title, description, supporting_data, sample_size, confidence, impact_score) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [pattern_type, title, description, JSON.stringify(supporting_data), sample_size, confidence, impact_score]
    );
    return r.rows[0];
  }

  static async createAnomaly(anomaly) {
    const { anomaly_type, title, description, metric, baseline_value, current_value, deviation_percent, severity = 'medium' } = anomaly;
    const r = await pool.query(
      'INSERT INTO investigation_anomalies (anomaly_type, title, description, metric, baseline_value, current_value, deviation_percent, severity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [anomaly_type, title, description, metric, baseline_value || null, current_value || null, deviation_percent || null, severity]
    );
    return r.rows[0];
  }

  static async getAnomalies({ resolved = false, limit = 20 } = {}) {
    const r = await pool.query('SELECT * FROM investigation_anomalies WHERE is_resolved = $1 ORDER BY detected_at DESC LIMIT $2', [resolved, limit]);
    return r.rows;
  }

  static async linkAnomaly(anomaly_id, investigation_id) {
    await pool.query('UPDATE investigation_anomalies SET investigation_id = $1 WHERE anomaly_id = $2', [investigation_id, anomaly_id]);
  }

  static async resolveAnomaly(anomaly_id) {
    await pool.query('UPDATE investigation_anomalies SET is_resolved = TRUE, resolved_at = NOW() WHERE anomaly_id = $1', [anomaly_id]);
  }

  static async countByStatus() {
    const r = await pool.query('SELECT status, COUNT(*) as count FROM investigations GROUP BY status');
    return r.rows;
  }
}

module.exports = Investigation;
