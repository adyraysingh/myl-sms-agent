'use strict';

const pool = require('../../memory/db/pool');

/**
 * QualificationHistory Model
 * Immutable record of every qualification recalculation.
 * Creates the historical qualification timeline for each lead.
 * Phase 4 - Onboarding Qualification Engine
 */
class QualificationHistory {

  /**
   * Record a qualification event
   * Always inserts - never updates.
   */
  static async record(data) {
    const {
      lead_id, qualification_id, zoho_lead_id,
      category, onboarding_score, onboarding_probability,
      readiness_score, trust_score, engagement_score, confidence_score,
      score_delta, probability_delta,
      category_changed, previous_category,
      trigger_event, trigger_ref,
      overall_reasoning, qualification_gaps, recommended_next_action,
      lead_snapshot, model_version, processing_time_ms
    } = data;

    const sql = `
      INSERT INTO qualification_history (
        lead_id, qualification_id, zoho_lead_id,
        category, onboarding_score, onboarding_probability,
        readiness_score, trust_score, engagement_score, confidence_score,
        score_delta, probability_delta,
        category_changed, previous_category,
        trigger_event, trigger_ref,
        overall_reasoning, qualification_gaps, recommended_next_action,
        lead_snapshot, model_version, processing_time_ms
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      ) RETURNING *
    `;

    const { rows } = await pool.query(sql, [
      lead_id, qualification_id || null, zoho_lead_id || null,
      category || 'unqualified',
      onboarding_score || 0, onboarding_probability || 0,
      readiness_score || 0, trust_score || 0, engagement_score || 0, confidence_score || 0,
      score_delta || 0, probability_delta || 0,
      category_changed || false, previous_category || null,
      trigger_event || null, trigger_ref || null,
      overall_reasoning || null,
      JSON.stringify(qualification_gaps || []),
      recommended_next_action || null,
      JSON.stringify(lead_snapshot || {}),
      model_version || 'gpt-4o', processing_time_ms || null
    ]);
    return rows[0];
  }

  /**
   * Get full history for a lead (most recent first)
   */
  static async getByLeadId(leadId, limit = 50) {
    const { rows } = await pool.query(
      'SELECT * FROM qualification_history WHERE lead_id = $1 ORDER BY created_at DESC LIMIT $2',
      [leadId, limit]
    );
    return rows;
  }

  /**
   * Get most recent history entry for a lead
   */
  static async getLatestForLead(leadId) {
    const { rows } = await pool.query(
      'SELECT * FROM qualification_history WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
      [leadId]
    );
    return rows[0] || null;
  }

  /**
   * Get history count for a lead
   */
  static async countForLead(leadId) {
    const { rows } = await pool.query(
      'SELECT COUNT(*) as total FROM qualification_history WHERE lead_id = $1',
      [leadId]
    );
    return parseInt(rows[0].total, 10);
  }
}

module.exports = QualificationHistory;
