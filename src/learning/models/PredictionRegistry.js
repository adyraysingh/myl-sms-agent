'use strict';
/**
 * PredictionRegistry — Phase 3 Durable Learning
 * Central registry for every AI prediction. Immutable once created.
 * Tracks prediction → outcome → calibration lifecycle.
 */
const pool = require('../../memory/db/pool');

class PredictionRegistry {

  // ─── Record a new prediction (immutable) ─────────────────────────────────
  static async record({ module, lead_id, prediction_type, prediction, confidence, evidence, expires_days = 30 }) {
    const expiresAt = new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString();
    const r = await pool.query(
      `INSERT INTO ai_predictions
        (module, lead_id, prediction_type, prediction, confidence, evidence, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [module, lead_id || null, prediction_type,
       JSON.stringify(prediction || {}),
       confidence || 0,
       JSON.stringify(evidence || {}),
       expiresAt]
    );
    return r.rows[0];
  }

  // ─── Record an outcome and link to prediction ─────────────────────────────
  static async recordOutcome({ prediction_id, module, lead_id, outcome_type, outcome_value, is_correct, accuracy_score, notes, source }) {
    // 1. Insert outcome
    const r = await pool.query(
      `INSERT INTO ai_outcomes
        (prediction_id, module, lead_id, outcome_type, outcome_value, is_correct, accuracy_score, notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [prediction_id || null, module, lead_id || null, outcome_type,
       JSON.stringify(outcome_value || {}),
       is_correct === undefined ? null : is_correct,
       accuracy_score || null, notes || null, source || 'system']
    );
    const outcome = r.rows[0];

    // 2. Mark prediction as evaluated
    if (prediction_id) {
      await pool.query(
        `UPDATE ai_predictions
         SET evaluation_status='evaluated', evaluated_at=NOW()
         WHERE prediction_id=$1 AND evaluation_status='pending'`,
        [prediction_id]
      );
    }

    return outcome;
  }

  // ─── Get predictions pending evaluation ──────────────────────────────────
  static async getPending({ module, limit = 100 } = {}) {
    const args = ['pending', new Date().toISOString()];
    let q = `SELECT * FROM ai_predictions
              WHERE evaluation_status=$1 AND (expires_at IS NULL OR expires_at > $2)`;
    if (module) { q += ' AND module=$3'; args.push(module); }
    q += ' ORDER BY created_at ASC LIMIT $' + (args.length + 1);
    args.push(limit);
    const r = await pool.query(q, args);
    return r.rows;
  }

  // ─── Get recent predictions ───────────────────────────────────────────────
  static async getRecent({ module, limit = 50, days = 30 } = {}) {
    const args = [days];
    let q = `SELECT p.*, o.outcome_type, o.is_correct, o.accuracy_score, o.occurred_at
              FROM ai_predictions p
              LEFT JOIN ai_outcomes o ON o.prediction_id = p.prediction_id
              WHERE p.created_at >= NOW() - ($1 || ' days')::INTERVAL`;
    if (module) { q += ' AND p.module=$2'; args.push(module); }
    q += ' ORDER BY p.created_at DESC LIMIT $' + (args.length + 1);
    args.push(limit);
    const r = await pool.query(q, args);
    return r.rows;
  }

  // ─── Accuracy summary per module ─────────────────────────────────────────
  static async getAccuracySummary({ days = 30 } = {}) {
    const r = await pool.query(
      `SELECT
         p.module,
         p.prediction_type,
         COUNT(p.prediction_id)                                        AS total_predictions,
         COUNT(o.outcome_id)                                           AS outcomes_recorded,
         COUNT(o.outcome_id) FILTER (WHERE o.is_correct = TRUE)       AS correct,
         COUNT(o.outcome_id) FILTER (WHERE o.is_correct = FALSE)      AS incorrect,
         ROUND(AVG(o.accuracy_score) FILTER (WHERE o.accuracy_score IS NOT NULL), 4) AS avg_accuracy,
         ROUND(AVG(p.confidence) FILTER (WHERE p.confidence > 0), 2) AS avg_confidence,
         ROUND(
           COUNT(o.outcome_id) FILTER (WHERE o.is_correct = TRUE)::NUMERIC /
           NULLIF(COUNT(o.outcome_id) FILTER (WHERE o.is_correct IS NOT NULL), 0), 4
         ) AS empirical_accuracy
       FROM ai_predictions p
       LEFT JOIN ai_outcomes o ON o.prediction_id = p.prediction_id
       WHERE p.created_at >= NOW() - ($1 || ' days')::INTERVAL
       GROUP BY p.module, p.prediction_type
       ORDER BY p.module, p.prediction_type`,
      [days]
    );
    return r.rows;
  }

  // ─── Precision / Recall / F1 ──────────────────────────────────────────────
  static async getPrecisionRecall({ module, days = 30 } = {}) {
    const r = await pool.query(
      `SELECT
         p.module,
         COUNT(o.outcome_id) FILTER (WHERE o.is_correct = TRUE)                           AS tp,
         COUNT(o.outcome_id) FILTER (WHERE o.is_correct = FALSE)                          AS fp_fn,
         COUNT(o.outcome_id) FILTER (WHERE o.is_correct = FALSE AND o.outcome_type LIKE '%false_pos%') AS fp,
         COUNT(o.outcome_id) FILTER (WHERE o.is_correct = FALSE AND o.outcome_type LIKE '%false_neg%') AS fn,
         ROUND(AVG(p.confidence), 2) AS avg_stated_confidence,
         ROUND(
           COUNT(o.outcome_id) FILTER (WHERE o.is_correct = TRUE)::NUMERIC /
           NULLIF(COUNT(o.outcome_id) FILTER (WHERE o.is_correct IS NOT NULL), 0) * 100, 2
         ) AS empirical_accuracy_pct
       FROM ai_predictions p
       LEFT JOIN ai_outcomes o ON o.prediction_id = p.prediction_id
       WHERE p.created_at >= NOW() - ($1 || ' days')::INTERVAL
         AND ($2::text IS NULL OR p.module = $2)
       GROUP BY p.module`,
      [days, module || null]
    );
    return r.rows;
  }

  // ─── Expire old pending predictions ──────────────────────────────────────
  static async expireStale() {
    const r = await pool.query(
      `UPDATE ai_predictions
       SET evaluation_status='expired'
       WHERE evaluation_status='pending' AND expires_at < NOW()
       RETURNING prediction_id`
    );
    return r.rowCount;
  }

  // ─── Count by module and status ───────────────────────────────────────────
  static async countByModule() {
    const r = await pool.query(
      `SELECT module, evaluation_status, COUNT(*) as cnt
       FROM ai_predictions
       GROUP BY module, evaluation_status
       ORDER BY module, evaluation_status`
    );
    return r.rows;
  }
}

module.exports = PredictionRegistry;
