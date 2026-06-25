const pool = require('../db/pool');

class LeadEvent {
  static async create(data) {
    const { leadId, eventType, eventSource, title, summary, rawPayload, metadata, occurredAt } = data;
    const query = `INSERT INTO lead_events (lead_id, event_type, event_source, title, summary, raw_payload, metadata, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;
    const values = [leadId, eventType, eventSource, title || null, summary || null, rawPayload ? JSON.stringify(rawPayload) : null, metadata ? JSON.stringify(metadata) : null, occurredAt || new Date()];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 100, offset = 0, eventType = null, eventSource = null } = options;
    let query = 'SELECT * FROM lead_events WHERE lead_id = $1';
    const values = [leadId];
    let paramCount = 2;
    if (eventType) { query += ` AND event_type = $${paramCount}`; values.push(eventType); paramCount++; }
    if (eventSource) { query += ` AND event_source = $${paramCount}`; values.push(eventSource); paramCount++; }
    query += ` ORDER BY occurred_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);
    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM lead_events WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async countByType(leadId) {
    const result = await pool.query('SELECT event_type, COUNT(*) as count FROM lead_events WHERE lead_id = $1 GROUP BY event_type', [leadId]);
    return result.rows;
  }

  static async findRecent(limit = 50) {
    const result = await pool.query('SELECT * FROM lead_events ORDER BY occurred_at DESC LIMIT $1', [limit]);
    return result.rows;
  }

  static async deleteOlderThan(date) {
    const result = await pool.query('DELETE FROM lead_events WHERE occurred_at < $1 RETURNING id', [date]);
    return result.rowCount;
  }
}

module.exports = LeadEvent;
