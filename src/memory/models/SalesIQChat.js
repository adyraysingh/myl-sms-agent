const pool = require('../db/pool');

class SalesIQChat {
  static async create(data) {
    const { leadId, salesiqChatId, visitorName, visitorEmail, operatorId, operatorName, chatStatus, durationSeconds, transcript, chatSummary, pagesVisited, rawPayload, occurredAt } = data;
    const result = await pool.query(
      'INSERT INTO salesiq_chats (lead_id, salesiq_chat_id, visitor_name, visitor_email, operator_id, operator_name, chat_status, duration_seconds, transcript, chat_summary, pages_visited, raw_payload, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [leadId, salesiqChatId||null, visitorName||null, visitorEmail||null, operatorId||null, operatorName||null, chatStatus||'completed', durationSeconds||null, transcript||null, chatSummary||null, pagesVisited?JSON.stringify(pagesVisited):null, rawPayload?JSON.stringify(rawPayload):null, occurredAt||new Date()]
    );
    return result.rows[0];
  }

  static async findByLeadId(leadId, options = {}) {
    const { limit = 50, offset = 0 } = options;
    const result = await pool.query('SELECT * FROM salesiq_chats WHERE lead_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3', [leadId, limit, offset]);
    return result.rows;
  }

  static async findBySalesIQId(salesiqChatId) {
    const result = await pool.query('SELECT * FROM salesiq_chats WHERE salesiq_chat_id = $1', [salesiqChatId]);
    return result.rows[0] || null;
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM salesiq_chats WHERE id = $1', [id]);
    return result.rows[0] || null;
  }
}

module.exports = SalesIQChat;
