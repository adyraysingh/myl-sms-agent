'use strict';

const pool = require('../../memory/db/pool');

class AIDecision {

  // Create a new decision
  static async create(data) {
    const {
      lead_id, decision_type, priority = 'medium', reason, explanation,
      evidence = [], expected_business_impact, expected_onboarding_probability_change,
      recommended_execution_time, recommended_owner, crm_owner,
      confidence_score = 0, required_information = [], trigger_event,
      trigger_source, model_version = 'gpt-4o'
    } = data;

    const result = await pool.query(
      `INSERT INTO ai_decisions
        (lead_id, decision_type, priority, reason, explanation, evidence,
         expected_business_impact, expected_onboarding_probability_change,
         recommended_execution_time, recommended_owner, crm_owner,
         confidence_score, required_information, trigger_event, trigger_source, model_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [lead_id, decision_type, priority, reason, explanation,
       JSON.stringify(evidence), expected_business_impact, expected_onboarding_probability_change,
       recommended_execution_time, recommended_owner, crm_owner,
       confidence_score, JSON.stringify(required_information), trigger_event,
       trigger_source, model_version]
    );
    return result.rows[0];
  }

  // Find by decision_id
  static async findById(decision_id) {
    const result = await pool.query(
      'SELECT * FROM ai_decisions WHERE decision_id = $1',
      [decision_id]
    );
    return result.rows[0] || null;
  }

  // Find all decisions for a lead
  static async findByLeadId(lead_id, options = {}) {
    const { limit = 20, offset = 0, status, priority } = options;
    let query = 'SELECT * FROM ai_decisions WHERE lead_id = $1';
    const params = [lead_id];
    let idx = 2;
    if (status) { query += ` AND status = $${idx++}`; params.push(status); }
    if (priority) { query += ` AND priority = $${idx++}`; params.push(priority); }
    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    params.push(limit, offset);
    const result = await pool.query(query, params);
    return result.rows;
  }

  // List all decisions (paginated)
  static async list(options = {}) {
    const { limit = 50, offset = 0, status, priority, lead_id } = options;
    let query = 'SELECT * FROM ai_decisions WHERE 1=1';
    const params = [];
    let idx = 1;
    if (lead_id) { query += ` AND lead_id = $${idx++}`; params.push(lead_id); }
    if (status) { query += ` AND status = $${idx++}`; params.push(status); }
    if (priority) { query += ` AND priority = $${idx++}`; params.push(priority); }
    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`;
    params.push(limit, offset);
    const result = await pool.query(query, params);
    return result.rows;
  }

  // Update decision status
  static async updateStatus(decision_id, status, extra = {}) {
    const fields = ['status = $2'];
    const params = [decision_id, status];
    let idx = 3;
    if (status === 'acknowledged') { fields.push(`acknowledged_at = $${idx++}`); params.push(new Date()); }
    if (status === 'completed') { fields.push(`completed_at = $${idx++}`); params.push(new Date()); }
    if (status === 'dismissed') { fields.push(`dismissed_at = $${idx++}`); params.push(new Date()); }
    if (status === 'executing') { fields.push(`executed_at = $${idx++}`); params.push(new Date()); }
    if (extra.execution_result) { fields.push(`execution_result = $${idx++}`); params.push(extra.execution_result); }
    if (extra.dismissed_reason) { fields.push(`dismissed_reason = $${idx++}`); params.push(extra.dismissed_reason); }
    const result = await pool.query(
      `UPDATE ai_decisions SET ${fields.join(', ')} WHERE decision_id = $1 RETURNING *`,
      params
    );
    return result.rows[0];
  }

  // Get active decisions for a lead (not dismissed or expired)
  static async getActiveForLead(lead_id) {
    const result = await pool.query(
      `SELECT * FROM ai_decisions WHERE lead_id = $1
       AND status NOT IN ('dismissed','expired','completed')
       ORDER BY
         CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         created_at DESC`,
      [lead_id]
    );
    return result.rows;
  }

  // Get summary stats
  static async getSummary() {
    const result = await pool.query(
      `SELECT
         status,
         priority,
         COUNT(*) as count,
         AVG(confidence_score) as avg_confidence
       FROM ai_decisions
       GROUP BY status, priority
       ORDER BY priority, status`
    );
    return result.rows;
  }

  // Expire old pending decisions for a lead before generating new ones
  static async expireOldDecisions(lead_id) {
    const result = await pool.query(
      `UPDATE ai_decisions
       SET status = 'expired'
       WHERE lead_id = $1 AND status IN ('created','pending')
       RETURNING decision_id`,
      [lead_id]
    );
    return result.rows;
  }

  // Queue a decision generation task
  static async queueGeneration(lead_id, trigger_event, trigger_source, trigger_data = {}) {
    const result = await pool.query(
      `INSERT INTO decision_queue (lead_id, trigger_event, trigger_source, trigger_data)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [lead_id, trigger_event, trigger_source, JSON.stringify(trigger_data)]
    );
    return result.rows[0];
  }

  // Get pending queue items
  static async getPendingQueue(limit = 10) {
    const result = await pool.query(
      `SELECT * FROM decision_queue
       WHERE status = 'pending' AND attempts < max_attempts
       ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  // Update queue item status
  static async updateQueueStatus(queue_id, status, error_message = null) {
    await pool.query(
      `UPDATE decision_queue
       SET status = $2, attempts = attempts + 1, error_message = $3, processed_at = NOW()
       WHERE queue_id = $1`,
      [queue_id, status, error_message]
    );
  }

  // Get queue stats
  static async getQueueStats() {
    const result = await pool.query(
      `SELECT status, COUNT(*) as count FROM decision_queue GROUP BY status`
    );
    return result.rows;
  }
}

module.exports = AIDecision;
