'use strict';
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

class ForecastModel {

  // ─── revenue_forecasts ───────────────────────────────────────────────

  static async createForecast(data) {
    const q = `
      INSERT INTO revenue_forecasts
        (forecast_type, period_start, period_end, expected_onboardings, expected_revenue,
         confidence, pipeline_value, revenue_at_risk, weighted_pipeline, avg_deal_value,
         avg_sales_cycle_days, target_progress, forecast_variance, factors, assumptions,
         risks, opportunities, status, model_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`;
    const vals = [
      data.forecast_type, data.period_start, data.period_end,
      data.expected_onboardings || 0, data.expected_revenue || 0,
      data.confidence || 0, data.pipeline_value || 0, data.revenue_at_risk || 0,
      data.weighted_pipeline || 0, data.avg_deal_value || 0,
      data.avg_sales_cycle_days || 0, data.target_progress || 0,
      data.forecast_variance || 0,
      JSON.stringify(data.factors || {}),
      JSON.stringify(data.assumptions || []),
      JSON.stringify(data.risks || []),
      JSON.stringify(data.opportunities || []),
      data.status || 'active',
      data.model_version || '1.0'
    ];
    const res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getForecastById(forecast_id) {
    const res = await pool.query('SELECT * FROM revenue_forecasts WHERE forecast_id = $1', [forecast_id]);
    return res.rows[0] || null;
  }

  static async listForecasts({ forecast_type, status, limit = 20, offset = 0 } = {}) {
    let q = 'SELECT * FROM revenue_forecasts WHERE 1=1';
    const vals = [];
    if (forecast_type) { vals.push(forecast_type); q += ' AND forecast_type = $' + vals.length; }
    if (status) { vals.push(status); q += ' AND status = $' + vals.length; }
    vals.push(limit); q += ' ORDER BY created_at DESC LIMIT $' + vals.length;
    vals.push(offset); q += ' OFFSET $' + vals.length;
    const res = await pool.query(q, vals);
    return res.rows;
  }

  static async getLatestByType(forecast_type) {
    const res = await pool.query(
      'SELECT * FROM revenue_forecasts WHERE forecast_type = $1 ORDER BY created_at DESC LIMIT 1',
      [forecast_type]
    );
    return res.rows[0] || null;
  }

  static async updateForecast(forecast_id, data) {
    const fields = [];
    const vals = [];
    const allowed = ['expected_onboardings','expected_revenue','confidence','pipeline_value',
      'revenue_at_risk','weighted_pipeline','target_progress','forecast_variance','status',
      'factors','assumptions','risks','opportunities'];
    for (const k of allowed) {
      if (data[k] !== undefined) {
        vals.push(typeof data[k] === 'object' ? JSON.stringify(data[k]) : data[k]);
        fields.push(k + ' = $' + vals.length);
      }
    }
    if (!fields.length) return null;
    vals.push(forecast_id);
    const res = await pool.query(
      'UPDATE revenue_forecasts SET ' + fields.join(', ') + ' WHERE forecast_id = $' + vals.length + ' RETURNING *',
      vals
    );
    return res.rows[0] || null;
  }

  // ─── forecast_scenarios ───────────────────────────────────────────────

  static async createScenario(data) {
    const q = `
      INSERT INTO forecast_scenarios
        (forecast_id, scenario_type, expected_revenue, expected_onboardings,
         assumptions, confidence, primary_risks, primary_opportunities, explanation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`;
    const vals = [
      data.forecast_id, data.scenario_type,
      data.expected_revenue || 0, data.expected_onboardings || 0,
      JSON.stringify(data.assumptions || []),
      data.confidence || 0,
      JSON.stringify(data.primary_risks || []),
      JSON.stringify(data.primary_opportunities || []),
      data.explanation || ''
    ];
    const res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async getScenariosForForecast(forecast_id) {
    const res = await pool.query(
      'SELECT * FROM forecast_scenarios WHERE forecast_id = $1 ORDER BY created_at ASC',
      [forecast_id]
    );
    return res.rows;
  }

  static async listScenarios({ scenario_type, limit = 20, offset = 0 } = {}) {
    let q = 'SELECT fs.*, rf.forecast_type, rf.period_start, rf.period_end FROM forecast_scenarios fs LEFT JOIN revenue_forecasts rf ON rf.forecast_id = fs.forecast_id WHERE 1=1';
    const vals = [];
    if (scenario_type) { vals.push(scenario_type); q += ' AND fs.scenario_type = $' + vals.length; }
    vals.push(limit); q += ' ORDER BY fs.created_at DESC LIMIT $' + vals.length;
    vals.push(offset); q += ' OFFSET $' + vals.length;
    const res = await pool.query(q, vals);
    return res.rows;
  }

  // ─── forecast_history ────────────────────────────────────────────────

  static async createHistory(data) {
    const q = `
      INSERT INTO forecast_history
        (forecast_id, forecast_type, period_start, period_end, prediction,
         actual_result, variance, accuracy, confidence_calibration, evaluation_notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`;
    const vals = [
      data.forecast_id || null, data.forecast_type || null,
      data.period_start || null, data.period_end || null,
      JSON.stringify(data.prediction || {}),
      JSON.stringify(data.actual_result || {}),
      data.variance || 0, data.accuracy || 0,
      data.confidence_calibration || 0,
      data.evaluation_notes || ''
    ];
    const res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async listHistory({ forecast_type, limit = 30, offset = 0 } = {}) {
    let q = 'SELECT * FROM forecast_history WHERE 1=1';
    const vals = [];
    if (forecast_type) { vals.push(forecast_type); q += ' AND forecast_type = $' + vals.length; }
    vals.push(limit); q += ' ORDER BY evaluated_at DESC LIMIT $' + vals.length;
    vals.push(offset); q += ' OFFSET $' + vals.length;
    const res = await pool.query(q, vals);
    return res.rows;
  }

  static async getVarianceSummary() {
    const res = await pool.query(`
      SELECT
        forecast_type,
        COUNT(*) AS evaluations,
        AVG(accuracy)::NUMERIC(5,2) AS avg_accuracy,
        AVG(variance)::NUMERIC(8,4) AS avg_variance,
        AVG(confidence_calibration)::NUMERIC(5,2) AS avg_confidence_calibration,
        MIN(accuracy) AS min_accuracy,
        MAX(accuracy) AS max_accuracy
      FROM forecast_history
      GROUP BY forecast_type
      ORDER BY avg_accuracy DESC
    `);
    return res.rows;
  }

  // ─── forecast_events ────────────────────────────────────────────────

  static async logEvent(data) {
    const q = `
      INSERT INTO forecast_events
        (forecast_id, event_type, details, processing_time_ms, model_version, error_message, retry_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`;
    const vals = [
      data.forecast_id || null, data.event_type,
      JSON.stringify(data.details || {}),
      data.processing_time_ms || 0,
      data.model_version || '1.0',
      data.error_message || null,
      data.retry_count || 0
    ];
    const res = await pool.query(q, vals);
    return res.rows[0];
  }

  static async listEvents({ forecast_id, event_type, limit = 50 } = {}) {
    let q = 'SELECT * FROM forecast_events WHERE 1=1';
    const vals = [];
    if (forecast_id) { vals.push(forecast_id); q += ' AND forecast_id = $' + vals.length; }
    if (event_type) { vals.push(event_type); q += ' AND event_type = $' + vals.length; }
    vals.push(limit); q += ' ORDER BY created_at DESC LIMIT $' + vals.length;
    const res = await pool.query(q, vals);
    return res.rows;
  }

  // ─── aggregates ──────────────────────────────────────────────────────

  static async getPipelineSummary() {
    const res = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active_forecasts,
        SUM(pipeline_value) FILTER (WHERE status = 'active') AS total_pipeline,
        SUM(weighted_pipeline) FILTER (WHERE status = 'active') AS total_weighted_pipeline,
        SUM(revenue_at_risk) FILTER (WHERE status = 'active') AS total_at_risk,
        AVG(confidence) FILTER (WHERE status = 'active') AS avg_confidence,
        SUM(expected_onboardings) FILTER (WHERE status = 'active') AS total_expected_onboardings,
        SUM(expected_revenue) FILTER (WHERE status = 'active') AS total_expected_revenue
      FROM revenue_forecasts
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);
    return res.rows[0] || {};
  }
}

module.exports = ForecastModel;
