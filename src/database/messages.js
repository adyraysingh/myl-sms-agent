const { query } = require('./connection');
const { pool } = require('./connection');

// Save a message - supports both phone-based (from mayaAgent) and conversation-based approaches
async function saveMessage(data) {
    const messageBody = data.body || data.content || '';
    const topic = data.topic || 'sms';
    const extension = data.extension || data.phone_number || '';

  // Phone-based approach (used by mayaAgent.js)
  if (data.phone_number && !data.conversationId) {
        const result = await query(
                `INSERT INTO messages (phone_number, direction, body, topic, extension, status, external_id)
                       VALUES ($1, $2, $3, $4, $5, $6, $7)
                              ON CONFLICT DO NOTHING
                                     RETURNING *`,
                [data.phone_number, data.direction, messageBody, topic, extension, data.status || 'pending', data.external_id || null]
              );
        return result.rows[0];
  }

  // Conversation-based approach (legacy)
  const result = await query(
        `INSERT INTO messages (conversation_id, lead_id, direction, body, topic, extension, status, external_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.conversationId, data.leadId, data.direction, messageBody, topic, extension, data.status || 'pending', data.external_id || null]
      );
    if (data.conversationId) {
          await query(
                  'UPDATE conversations SET updated_at = NOW() WHERE id = $1',
                  [data.conversationId]
                );
    }
    return result.rows[0];
}

// Get conversation history by phone number
async function getConversationHistory(phoneNumber, limit = 10) {
    const result = await query(
          `SELECT * FROM messages
               WHERE phone_number = $1
                    ORDER BY created_at DESC
                         LIMIT $2`,
          [phoneNumber, limit]
        );
    return result.rows.reverse();
}

async function getConversationMessages(conversationId, limit = 20) {
    const result = await query(
          'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2',
          [conversationId, limit]
        );
    return result.rows;
}

async function updateMessageStatus(externalId, status) {
    const result = await query(
          'UPDATE messages SET status = $1 WHERE external_id = $2 RETURNING *',
          [status, externalId]
        );
    return result.rows[0];
}

module.exports = { saveMessage, getConversationHistory, getConversationMessages, updateMessageStatus };
