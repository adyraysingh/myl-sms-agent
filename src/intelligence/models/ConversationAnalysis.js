'use strict';

const pool = require('../../memory/db/pool');

/**
 * ConversationAnalysis Model
 * Stores AI-generated structured intelligence for every conversation.
 * Phase 3 - Conversation Intelligence Engine
 */
class ConversationAnalysis {

  static async create({ conversation_id, lead_id, source_type, source_ref }) {
    const sql = `
      INSERT INTO conversation_analysis
        (conversation_id, lead_id, source_type, source_ref, analysis_status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [conversation_id, lead_id, source_type, source_ref || null]);
    return rows[0];
  }

  static async saveAnalysis(id, analysisData) {
    const {
      summary, customer_intent, conversation_stage, brand_stage, conversation_outcome,
      product_interest, products_requested,
      budget_detected, budget_value, timeline_detected, timeline_value,
      manufacturing_stage, shopify_status, country, experience_level, brand_readiness,
      trust_score, sentiment, conversation_quality, buying_intent_score,
      questions, objections, positive_buying_signals, negative_buying_signals,
      recommended_next_step, recommended_follow_up, risk_factors,
      topics_detected, key_requirements,
      confidence_score, model_version, processing_time_ms
    } = analysisData;

    const sql = `
      UPDATE conversation_analysis SET
        summary = $2,
        customer_intent = $3,
        conversation_stage = $4,
        brand_stage = $5,
        conversation_outcome = $6,
        product_interest = $7,
        products_requested = $8,
        budget_detected = $9,
        budget_value = $10,
        timeline_detected = $11,
        timeline_value = $12,
        manufacturing_stage = $13,
        shopify_status = $14,
        country = $15,
        experience_level = $16,
        brand_readiness = $17,
        trust_score = $18,
        sentiment = $19,
        conversation_quality = $20,
        buying_intent_score = $21,
        questions = $22,
        objections = $23,
        positive_buying_signals = $24,
        negative_buying_signals = $25,
        recommended_next_step = $26,
        recommended_follow_up = $27,
        risk_factors = $28,
        topics_detected = $29,
        key_requirements = $30,
        confidence_score = $31,
        model_version = $32,
        processing_time_ms = $33,
        analysis_status = 'completed',
        analyzed_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const { rows } = await pool.query(sql, [
      id, summary, customer_intent, conversation_stage, brand_stage, conversation_outcome,
      product_interest || [], JSON.stringify(products_requested || []),
      budget_detected || false, budget_value ? JSON.stringify(budget_value) : null,
      timeline_detected || false, timeline_value ? JSON.stringify(timeline_value) : null,
      manufacturing_stage, shopify_status, country, experience_level, brand_readiness,
      trust_score, sentiment, conversation_quality, buying_intent_score,
      JSON.stringify(questions || []), JSON.stringify(objections || []),
      JSON.stringify(positive_buying_signals || []), JSON.stringify(negative_buying_signals || []),
      recommended_next_step, recommended_follow_up, JSON.stringify(risk_factors || []),
      topics_detected || [], JSON.stringify(key_requirements || {}),
      confidence_score, model_version || 'gpt-4o', processing_time_ms
    ]);
    return rows[0];
  }

  static async markFailed(id, errorMessage, retryCount) {
    const sql = `
      UPDATE conversation_analysis SET
        analysis_status = CASE WHEN $3 >= 3 THEN 'failed' ELSE 'pending' END,
        error_message = $2,
        retry_count = $3
      WHERE id = $1
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [id, errorMessage, retryCount]);
    return rows[0];
  }

  static async findById(id) {
    const { rows } = await pool.query('SELECT * FROM conversation_analysis WHERE id = $1', [id]);
    return rows[0] || null;
  }

  static async findByConversationId(conversationId) {
    const { rows } = await pool.query(
      'SELECT * FROM conversation_analysis WHERE conversation_id = $1 ORDER BY created_at DESC',
      [conversationId]
    );
    return rows;
  }

  static async findByLeadId(leadId, limit = 20) {
    const { rows } = await pool.query(
      'SELECT * FROM conversation_analysis WHERE lead_id = $1 ORDER BY created_at DESC LIMIT $2',
      [leadId, limit]
    );
    return rows;
  }

  static async list(limit = 50, offset = 0) {
    const { rows } = await pool.query(
      'SELECT * FROM conversation_analysis ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return rows;
  }

  static async count() {
    const { rows } = await pool.query('SELECT COUNT(*) as total FROM conversation_analysis');
    return parseInt(rows[0].total, 10);
  }

  static async getLatestForLead(leadId) {
    const { rows } = await pool.query(
      `SELECT * FROM conversation_analysis
       WHERE lead_id = $1 AND analysis_status = 'completed'
       ORDER BY analyzed_at DESC LIMIT 1`,
      [leadId]
    );
    return rows[0] || null;
  }

  static async getPending(limit = 10) {
    const { rows } = await pool.query(
      `SELECT * FROM conversation_analysis
       WHERE analysis_status = 'pending' AND retry_count < 3
       ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
    return rows;
  }
}

module.exports = ConversationAnalysis;
