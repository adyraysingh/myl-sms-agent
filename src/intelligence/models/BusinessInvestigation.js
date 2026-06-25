'use strict';
const pool = require('../../memory/db/pool');

class BusinessInvestigation {
  static async create(data) {
    const {
      question, investigation_type, trigger_event,
      data_sources = [], evidence = [], root_cause, conclusion,
      recommendations = [], affected_leads = [], affected_owners = [],
      confidence_score, severity = 'medium', business_impact, status = 'completed',
      processing_time_ms, model_version = 'gpt-4o'
    } = data;

    const result = await pool.query(
      `INSERT INTO business_investigations (
        question, investigation_type, trigger_event, data_sources, evidence,
        root_cause, conclusion, recommendations, affected_leads, affected_owners,
        confidence_score, severity, business_impact, status, processing_time_ms, model_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        question, investigation_type, trigger_event,
        JSON.stringify(data_sources), JSON.stringify(evidence),
        root_cause, conclusion, JSON.stringify(recommendations),
        JSON.stringify(affected_leads), JSON.stringify(affected_owners),
        confidence_score, severity, business_impact, status, processing_time_ms, model_version
      ]
    );
    return result.rows[0];
  }

  static async findById(investigation_id) {
    const result = await pool.query(
      'SELECT * FROM business_investigations WHERE investigation_id = $1',
      [investigation_id]
    );
    return result.rows[0];
  }

  static async findAll(limit = 20, investigation_type = null) {
    let sql, params;
    if (investigation_type) {
      sql = 'SELECT * FROM business_investigations WHERE investigation_type = $1 ORDER BY created_at DESC LIMIT $2';
      params = [investigation_type, limit];
    } else {
      sql = 'SELECT * FROM business_investigations ORDER BY created_at DESC LIMIT $1';
      params = [limit];
    }
    const result = await pool.query(sql, params);
    return result.rows;
  }

  static async findRecent(hours = 24) {
    const result = await pool.query(
      `SELECT * FROM business_investigations
       WHERE created_at > NOW() - INTERVAL '${hours} hours'
       ORDER BY created_at DESC`
    );
    return result.rows;
  }

  static async findBySeverity(severity) {
    const result = await pool.query(
      'SELECT * FROM business_investigations WHERE severity = $1 ORDER BY created_at DESC LIMIT 20',
      [severity]
    );
    return result.rows;
  }

  static async updateStatus(investigation_id, status) {
    const result = await pool.query(
      'UPDATE business_investigations SET status = $1, updated_at = NOW() WHERE investigation_id = $2 RETURNING *',
      [status, investigation_id]
    );
    return result.rows[0];
  }

  static async count() {
    const result = await pool.query('SELECT COUNT(*) as total FROM business_investigations');
    return parseInt(result.rows[0].total);
  }
}

module.exports = BusinessInvestigation;
