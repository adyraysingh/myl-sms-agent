'use strict';

const pool = require('../../memory/db/pool');

class DecisionHistory {

  static async record(data) {
    const {
      decision_id, lead_id,
      previous_status, new_status,
      previous_priority, new_priority,
      change_reason, changed_by,
      trigger_event, metadata
    } = data;
    const result = await pool.query(
      'INSERT INTO decision_history (decision_id, lead_id, previous_status, new_status, previous_priority, new_priority, change_reason, changed_by, trigger_event, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [decision_id, lead_id, previous_status, new_status, previous_priority, new_priority, change_reason, changed_by || 'system', trigger_event, JSON.stringify(metadata || {})]
    );
    return result.rows[0];
  }

  static async getByDecisionId(decision_id) {
    const result = await pool.query(
      'SELECT * FROM decision_history WHERE decision_id = $1 ORDER BY created_at ASC',
      [decision_id]
    );
    return result.rows;
  }

  static async getByLeadId(lead_id, options) {
    const { limit, offset } = options || {};
    const result = await pool.query(
      'SELECT dh.*, ad.decision_type, ad.priority as current_priority FROM decision_history dh LEFT JOIN ai_decisions ad ON dh.decision_id = ad.decision_id WHERE dh.lead_id = $1 ORDER BY dh.created_at DESC LIMIT $2 OFFSET $3',
      [lead_id, limit || 50, offset || 0]
    );
    return result.rows;
  }

  static async getRecentChanges(limit) {
    const result = await pool.query(
      'SELECT dh.*, ad.decision_type FROM decision_history dh LEFT JOIN ai_decisions ad ON dh.decision_id = ad.decision_id ORDER BY dh.created_at DESC LIMIT $1',
      [limit || 20]
    );
    return result.rows;
  }

  static async getExecutedDecisions(lead_id) {
    const result = await pool.query(
      'SELECT dh.*, ad.decision_type, ad.reason, ad.expected_business_impact FROM decision_history dh LEFT JOIN ai_decisions ad ON dh.decision_id = ad.decision_id WHERE dh.lead_id = $1 AND dh.new_status IN ($2, $3) ORDER BY dh.created_at DESC',
      [lead_id, 'completed', 'dismissed']
    );
    return result.rows;
  }
}

module.exports = DecisionHistory;
