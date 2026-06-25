const pool = require('../db/pool');

class CRMTask {
  static async create(data) {
    const { leadId, zohoTaskId, subject, description, status, priority, dueDate, completedAt, assignedTo, rawPayload, occurredAt } = data;
    const result = await pool.query(
      'INSERT INTO crm_tasks (lead_id, zoho_task_id, subject, description, status, priority, due_date, completed_at, assigned_to, raw_payload, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [leadId, zohoTaskId||null, subject||null, description||null, status||'open', priority||'normal', dueDate||null, completedAt||null, assignedTo||null, rawPayload?JSON.stringify(rawPayload):null, occurredAt||new Date()]
    );
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0, status = null } = options;
    let query = 'SELECT * FROM crm_tasks WHERE lead_id = $1';
    const values = [leadId];
    let p = 2;
    if (status) { query += ` AND status = $${p}`; values.push(status); p++; }
    query += ` ORDER BY occurred_at DESC LIMIT $${p} OFFSET $${p+1}`;
    values.push(limit, offset);
    const result = await pool.query(query, values);
    return result.rows;
  }

  static async findByZohoId(zohoTaskId) {
    const result = await pool.query('SELECT * FROM crm_tasks WHERE zoho_task_id = $1', [zohoTaskId]);
    return result.rows[0] || null;
  }

  static async updateStatus(id, status, completedAt) {
    const result = await pool.query('UPDATE crm_tasks SET status = $1, completed_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *', [status, completedAt||null, id]);
    return result.rows[0];
  }
}

module.exports = CRMTask;
