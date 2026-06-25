const pool = require('../db/pool');

class Conversation {
  static async create(data) {
    const { leadId, channel, direction, agentId, agentName, durationSeconds, summary, transcript, sentiment, rawPayload, metadata, occurredAt } = data;
    const result = await pool.query(
      'INSERT INTO conversations (lead_id, channel, direction, agent_id, agent_name, duration_seconds, summary, transcript, sentiment, raw_payload, metadata, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [leadId, channel, direction, agentId||null, agentName||null, durationSeconds||null, summary||null, transcript||null, sentiment||null, rawPayload?JSON.stringify(rawPayload):null, metadata?JSON.stringify(metadata):null, occurredAt||new Date()]
    );
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0, channel = null } = options;
    let query = 'SELECT * FROM conversations WHERE lead_id = $1';
    const values = [leadId];
    let p = 2;
    if (channel) { query += ` AND channel = $${p}`; values.push(channel); p++; }
    query += ` ORDER BY occurred_at DESC LIMIT $${p} OFFSET $${p+1}`;
    values.push(limit, offset);
    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async updateSentiment(id, sentiment) {
    const result = await pool.query('UPDATE conversations SET sentiment = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [sentiment, id]);
    return result.rows[0];
  }

  static async getChannelSummary(leadId) {
    const result = await pool.query('SELECT channel, COUNT(*) as count, AVG(duration_seconds) as avg_duration FROM conversations WHERE lead_id = $1 GROUP BY channel', [leadId]);
    return result.rows;
  }
}

module.exports = Conversation;
