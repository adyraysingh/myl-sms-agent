const { query } = require('./connection');

async function saveMessage(data) {
  const result = await query(
      `INSERT INTO messages (conversation_id, lead_id, direction, content, twilio_sid, status)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
               [data.conversationId, data.leadId, data.direction, data.content, data.twilioSid || null, data.status || 'pending']
                 );
                   // Update conversation message count
                     await query(
                         'UPDATE conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1',
                             [data.conversationId]
                               );
                                 return result.rows[0];
                                 }

                                 async function getConversationMessages(conversationId, limit = 20) {
                                   const result = await query(
                                       'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2',
                                           [conversationId, limit]
                                             );
                                               return result.rows;
                                               }

                                               async function updateMessageStatus(twilioSid, status) {
                                                 const result = await query(
                                                     'UPDATE messages SET status = $1 WHERE twilio_sid = $2 RETURNING *',
                                                         [status, twilioSid]
                                                           );
                                                             return result.rows[0];
                                                             }

                                                             module.exports = { saveMessage, getConversationMessages, updateMessageStatus };
