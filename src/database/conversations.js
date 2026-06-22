const { pool } = require('./connection');
const logger = require('../utils/logger');

async function createConversation(leadId) {
  const result = await pool.query(
        `INSERT INTO conversations (lead_id, status, started_at)
         VALUES ($1, 'active', NOW())
         RETURNING *`,
        [leadId]
      );
  return result.rows[0];
}

async function findOrCreateConversation(leadId) {
  // Look for active conversation
  const existing = await pool.query(
        `SELECT * FROM conversations
         WHERE lead_id = $1 AND status = 'active'
         ORDER BY started_at DESC
         LIMIT 1`,
        [leadId]
      );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create new conversation
  return createConversation(leadId);
}

async function updateConversationStatus(conversationId, status) {
  const result = await pool.query(
        'UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [status, conversationId]
      );
  return result.rows[0];
}

async function updateConversationSummary(conversationId, summary) {
  const result = await pool.query(
        'UPDATE conversations SET summary = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [summary, conversationId]
      );
  return result.rows[0];
}

async function getConversationMessages(conversationId, limit = 20) {
  const result = await pool.query(
        `SELECT * FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
     LIMIT $2`,
        [conversationId, limit]
      );
  return result.rows.reverse();
}

module.exports = {
  createConversation,
      findOrCreateConversation,
      updateConversationStatus,
      updateConversationSummary,
      getConversationMessages
    };
