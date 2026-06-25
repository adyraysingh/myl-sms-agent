const pool = require('../db/pool');

class RetellCall {
  static async create(data) {
    const { leadId, retellCallId, agentId, agentName, fromNumber, toNumber, callStatus, durationSeconds, transcript, callSummary, disconnectionReason, recordingUrl, userSentiment, callSuccessful, rawPayload, occurredAt } = data;
    const result = await pool.query(
      'INSERT INTO retell_calls (lead_id, retell_call_id, agent_id, agent_name, from_number, to_number, call_status, duration_seconds, transcript, call_summary, disconnection_reason, recording_url, user_sentiment, call_successful, raw_payload, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
      [leadId, retellCallId||null, agentId||null, agentName||null, fromNumber||null, toNumber||null, callStatus||'completed', durationSeconds||null, transcript||null, callSummary||null, disconnectionReason||null, recordingUrl||null, userSentiment||null, callSuccessful||false, rawPayload?JSON.stringify(rawPayload):null, occurredAt||new Date()]
    );
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    const result = await pool.query('SELECT * FROM retell_calls WHERE lead_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3', [leadId, limit, offset]);
    return result.rows;
  }

  static async findByRetellCallId(retellCallId) {
    const result = await pool.query('SELECT * FROM retell_calls WHERE retell_call_id = $1', [retellCallId]);
    return result.rows[0] || null;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM retell_calls WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async getCallStats(leadId) {
    const result = await pool.query('SELECT COUNT(*) as total_calls, SUM(duration_seconds) as total_duration, AVG(duration_seconds) as avg_duration, SUM(CASE WHEN call_successful THEN 1 ELSE 0 END) as successful_calls FROM retell_calls WHERE lead_id = $1', [leadId]);
    return result.rows[0];
  }
}

module.exports = RetellCall;
