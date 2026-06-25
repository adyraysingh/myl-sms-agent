const pool = require('../db/pool');

class FollowUp {
  static async create(data) {
    const { leadId, followUpType, channel, scheduledAt, completedAt, status, notes, assignedTo, rawPayload, occurredAt } = data;
    const result = await pool.query(
      'INSERT INTO follow_ups (lead_id, follow_up_type, channel, scheduled_at, completed_at, status, notes, assigned_to, raw_payload, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [leadId, followUpType||'general', channel||null, scheduledAt||null, completedAt||null, status||'pending', notes||null, assignedTo||null, rawPayload?JSON.stringify(rawPayload):null, occurredAt||new Date()]
    );
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0, status = null } = options;
    let query = 'SELECT * FROM follow_ups WHERE lead_id = $1';
    const values = [leadId];
    let p = 2;
    if (status) { query += ` AND status = $${p}`; values.push(status); p++; }
    query += ` ORDER BY scheduled_at ASC NULLS LAST, occurred_at DESC LIMIT $${p} OFFSET $${p+1}`;
    values.push(limit, offset);
    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM follow_ups WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async updateStatus(id, status, completedAt) {
    const result = await pool.query('UPDATE follow_ups SET status = $1, completed_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [status, completedAt||null, id]);
    return result.rows[0];
  }

  static async findPending(assignedTo) {
    let query = 'SELECT * FROM follow_ups WHERE status = $1';
    const values = ['pending'];
    if (assignedTo) { query += ' AND assigned_to = $2'; values.push(assignedTo); }
    query += ' ORDER BY scheduled_at ASC NULLS LAST';
    const result = await pool.query(query, values);
    return result.rows;
  }
}

module.exports = FollowUp;
