'use strict';
const pool = require('../../memory/db/pool');

class CopilotSession {
  static async createSession({ user_id, user_role = 'ceo', title }) {
    const r = await pool.query(
      'INSERT INTO copilot_sessions (user_id, user_role, title) VALUES ($1,$2,$3) RETURNING *',
      [user_id, user_role, title || null]
    );
    return r.rows[0];
  }

  static async getSession(session_id) {
    const r = await pool.query('SELECT * FROM copilot_sessions WHERE session_id=$1', [session_id]);
    return r.rows[0] || null;
  }

  static async getUserSessions(user_id, limit = 20) {
    const r = await pool.query(
      'SELECT * FROM copilot_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [user_id, limit]
    );
    return r.rows;
  }

  static async endSession(session_id) {
    const r = await pool.query(
      'UPDATE copilot_sessions SET is_active=false, ended_at=NOW() WHERE session_id=$1 RETURNING *',
      [session_id]
    );
    return r.rows[0];
  }

  static async addMessage({ session_id, role, content, intent, modules_queried, evidence_sources,
    confidence, response_time_ms, citations, suggested_actions, related_leads,
    related_investigations, related_decisions, model_version, error_message }) {
    const r = await pool.query(
      'INSERT INTO copilot_messages (session_id,role,content,intent,modules_queried,evidence_sources,' +
      'confidence,response_time_ms,citations,suggested_actions,related_leads,related_investigations,' +
      'related_decisions,model_version,error_message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
      [session_id, role, content, intent||null,
       JSON.stringify(modules_queried||[]), JSON.stringify(evidence_sources||[]),
       confidence||0, response_time_ms||null,
       JSON.stringify(citations||{}), JSON.stringify(suggested_actions||[]),
       JSON.stringify(related_leads||[]), JSON.stringify(related_investigations||[]),
       JSON.stringify(related_decisions||[]), model_version||'gpt-4o', error_message||null]
    );
    await pool.query(
      'UPDATE copilot_sessions SET message_count=message_count+1, updated_at=NOW() WHERE session_id=$1',
      [session_id]
    );
    return r.rows[0];
  }

  static async getMessages(session_id, limit = 50) {
    const r = await pool.query(
      'SELECT * FROM copilot_messages WHERE session_id=$1 ORDER BY created_at ASC LIMIT $2',
      [session_id, limit]
    );
    return r.rows;
  }

  static async getRecentHistory(user_id, limit = 10) {
    const r = await pool.query(
      'SELECT s.session_id, s.title, s.created_at, s.message_count, ' +
      '(SELECT content FROM copilot_messages WHERE session_id=s.session_id AND role=$2 ORDER BY created_at DESC LIMIT 1) as last_question ' +
      'FROM copilot_sessions s WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT $3',
      [user_id, 'user', limit]
    );
    return r.rows;
  }

  static async addFeedback({ message_id, session_id, user_id, rating, helpful, comment }) {
    const r = await pool.query(
      'INSERT INTO copilot_feedback (message_id,session_id,user_id,rating,helpful,comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [message_id, session_id, user_id, rating||null, helpful!=null?helpful:null, comment||null]
    );
    return r.rows[0];
  }

  static async updateSessionContext(session_id, context) {
    const r = await pool.query(
      'UPDATE copilot_sessions SET context=$1, updated_at=NOW() WHERE session_id=$2 RETURNING *',
      [JSON.stringify(context), session_id]
    );
    return r.rows[0];
  }
}

module.exports = CopilotSession;
