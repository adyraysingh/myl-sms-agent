'use strict';

const pool = require('../../memory/db/pool');

/**
 * LeadQualification Model
 * Manages the current qualification state for each lead.
 * One record per lead — upserted on every recalculation.
 * Phase 4 - Onboarding Qualification Engine
 */
class LeadQualification {

  /**
   * Upsert qualification record
   * Creates if not exists, updates if exists.
   */
  static async upsert(data) {
    const {
      lead_id, zoho_lead_id, category,
      onboarding_score, onboarding_probability, readiness_score,
      trust_score, engagement_score, budget_confidence, timeline_confidence,
      brand_readiness, manufacturing_readiness, communication_quality,
      followup_health, decision_confidence, confidence_score,
      overall_reasoning, score_breakdown, factors, qualification_gaps,
      positive_signals, negative_signals,
      recommended_next_action, recommended_questions, urgency_level,
      lead_snapshot, trigger_event, trigger_ref,
      model_version, processing_time_ms
    } = data;

    const sql = `
      INSERT INTO lead_qualification (
        lead_id, zoho_lead_id, category,
        onboarding_score, onboarding_probability, readiness_score,
        trust_score, engagement_score, budget_confidence, timeline_confidence,
        brand_readiness, manufacturing_readiness, communication_quality,
        followup_health, decision_confidence, confidence_score,
        overall_reasoning, score_breakdown, factors, qualification_gaps,
        positive_signals, negative_signals,
        recommended_next_action, recommended_questions, urgency_level,
        lead_snapshot, trigger_event, trigger_ref,
        model_version, processing_time_ms, calculation_status,
        recalculation_count, first_qualified_at, last_qualified_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        'completed', 1, NOW(), NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        zoho_lead_id            = EXCLUDED.zoho_lead_id,
        category                = EXCLUDED.category,
        onboarding_score        = EXCLUDED.onboarding_score,
        onboarding_probability  = EXCLUDED.onboarding_probability,
        readiness_score         = EXCLUDED.readiness_score,
        trust_score             = EXCLUDED.trust_score,
        engagement_score        = EXCLUDED.engagement_score,
        budget_confidence       = EXCLUDED.budget_confidence,
        timeline_confidence     = EXCLUDED.timeline_confidence,
        brand_readiness         = EXCLUDED.brand_readiness,
        manufacturing_readiness = EXCLUDED.manufacturing_readiness,
        communication_quality   = EXCLUDED.communication_quality,
        followup_health         = EXCLUDED.followup_health,
        decision_confidence     = EXCLUDED.decision_confidence,
        confidence_score        = EXCLUDED.confidence_score,
        overall_reasoning       = EXCLUDED.overall_reasoning,
        score_breakdown         = EXCLUDED.score_breakdown,
        factors                 = EXCLUDED.factors,
        qualification_gaps      = EXCLUDED.qualification_gaps,
        positive_signals        = EXCLUDED.positive_signals,
        negative_signals        = EXCLUDED.negative_signals,
        recommended_next_action = EXCLUDED.recommended_next_action,
        recommended_questions   = EXCLUDED.recommended_questions,
        urgency_level           = EXCLUDED.urgency_level,
        lead_snapshot           = EXCLUDED.lead_snapshot,
        trigger_event           = EXCLUDED.trigger_event,
        trigger_ref             = EXCLUDED.trigger_ref,
        model_version           = EXCLUDED.model_version,
        processing_time_ms      = EXCLUDED.processing_time_ms,
        calculation_status      = 'completed',
        recalculation_count     = lead_qualification.recalculation_count + 1,
        last_qualified_at       = NOW()
      RETURNING *
    `;

    const { rows } = await pool.query(sql, [
      lead_id, zoho_lead_id || null, category || 'unqualified',
      onboarding_score || 0, onboarding_probability || 0, readiness_score || 0,
      trust_score || 0, engagement_score || 0, budget_confidence || 0, timeline_confidence || 0,
      brand_readiness || 0, manufacturing_readiness || 0, communication_quality || 0,
      followup_health || 0, decision_confidence || 0, confidence_score || 0,
      overall_reasoning || null,
      JSON.stringify(score_breakdown || {}),
      JSON.stringify(factors || {}),
      JSON.stringify(qualification_gaps || []),
      JSON.stringify(positive_signals || []),
      JSON.stringify(negative_signals || []),
      recommended_next_action || null,
      JSON.stringify(recommended_questions || []),
      urgency_level || 'normal',
      JSON.stringify(lead_snapshot || {}),
      trigger_event || null, trigger_ref || null,
      model_version || 'gpt-4o', processing_time_ms || null
    ]);
    return rows[0];
  }

  /**
   * Mark as failed
   */
  static async markFailed(leadId, errorMessage) {
    const sql = `
      INSERT INTO lead_qualification (lead_id, calculation_status, error_message)
      VALUES ($1, 'failed', $2)
      ON CONFLICT (lead_id) DO UPDATE SET
        calculation_status = 'failed',
        error_message = $2
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [leadId, errorMessage]);
    return rows[0];
  }

  static async findByLeadId(leadId) {
    const { rows } = await pool.query(
      'SELECT * FROM lead_qualification WHERE lead_id = $1',
      [leadId]
    );
    return rows[0] || null;
  }

  static async findByZohoId(zohoLeadId) {
    const { rows } = await pool.query(
      'SELECT * FROM lead_qualification WHERE zoho_lead_id = $1',
      [zohoLeadId]
    );
    return rows[0] || null;
  }

  static async list(limit = 50, offset = 0, category = null) {
    let sql = 'SELECT * FROM lead_qualification';
    const params = [];
    if (category) {
      sql += ' WHERE category = $1 ORDER BY onboarding_score DESC LIMIT $2 OFFSET $3';
      params.push(category, limit, offset);
    } else {
      sql += ' ORDER BY onboarding_score DESC LIMIT $1 OFFSET $2';
      params.push(limit, offset);
    }
    const { rows } = await pool.query(sql, params);
    return rows;
  }

  static async count(category = null) {
    let sql = 'SELECT COUNT(*) as total FROM lead_qualification';
    const params = [];
    if (category) { sql += ' WHERE category = $1'; params.push(category); }
    const { rows } = await pool.query(sql, params);
    return parseInt(rows[0].total, 10);
  }

  static async getCategoryCounts() {
    const { rows } = await pool.query(`
      SELECT category, COUNT(*) as count,
        AVG(onboarding_score) as avg_score,
        AVG(onboarding_probability) as avg_probability
      FROM lead_qualification
      GROUP BY category ORDER BY count DESC
    `);
    return rows;
  }
}

module.exports = LeadQualification;
