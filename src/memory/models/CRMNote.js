const pool = require('../db/pool');

class CRMNote {
  static async create(data) {
    const { leadId, zohoNoteId, title, content, noteType, createdBy, rawPayload, occurredAt } = data;
    const result = await pool.query(
      'INSERT INTO crm_notes (lead_id, zoho_note_id, title, content, note_type, created_by, raw_payload, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [leadId, zohoNoteId||null, title||null, content||null, noteType||'general', createdBy||null, rawPayload?JSON.stringify(rawPayload):null, occurredAt||new Date()]
    );
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    const result = await pool.query('SELECT * FROM crm_notes WHERE lead_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3', [leadId, limit, offset]);
    return result.rows;
  }

  static async findByZohoId(zohoNoteId) {
    const result = await pool.query('SELECT * FROM crm_notes WHERE zoho_note_id = $1', [zohoNoteId]);
    return result.rows[0] || null;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM crm_notes WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  static async search(leadId, searchTerm) {
    const result = await pool.query('SELECT * FROM crm_notes WHERE lead_id = $1 AND (title ILIKE $2 OR content ILIKE $2) ORDER BY occurred_at DESC', [leadId, '%' + searchTerm + '%']);
    return result.rows;
  }
}

module.exports = CRMNote;
