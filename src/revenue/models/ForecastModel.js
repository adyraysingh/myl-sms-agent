'use strict';
/**
 * ForecastModel — Phase 3.7.3 Fixed
 * FIXES in this version:
 * 1. updateForecast() null-safe serialization:
 *    typeof null === 'object' in JS — previously JSON.stringify(null) produced
 *    the string "null" which caused "invalid input syntax for type numeric: 'null'"
 *    when inserting into PostgreSQL numeric columns.
 *    Fix: check data[k] !== null before testing typeof === 'object'
 */

const pool = require('../../memory/db/pool');

class ForecastModel {

  // revenue_forecasts
  static async createForecast(data) {
        var q = 'INSERT INTO revenue_forecasts' +
                ' (forecast_type, period_start, period_end, expected_onboardings, expected_revenue,' +
                ' confidence, pipeline_value, revenue_at_risk, weighted_pipeline, avg_deal_value,' +
                ' avg_sales_cycle_days, target_progress, forecast_variance, factors, assumptions,' +
                ' risks, opportunities, status, model_version)' +
                ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)' +
                ' RETURNING *';
        var vals = [
                data.forecast_type, data.period_start, data.period_end,
                data.expected_onboardings || 0, data.expected_revenue || 0,
                data.confidence || 0, data.pipeline_value || 0, data.revenue_at_risk || 0,
                data.weighted_pipeline || data.weighted_pipeline_value || 0, data.avg_deal_value || 0,
                data.avg_sales_cycle_days || 0, data.target_progress || 0,
                data.forecast_variance || 0,
                JSON.stringify(data.factors || {}),
                JSON.stringify(data.assumptions || []),
                JSON.stringify(data.risks || []),
                JSON.stringify(data.opportunities || []),
                data.status || 'active',
                data.model_version || '1.0'
              ];
        var res = await pool.query(q, vals);
        return res.rows[0];
  }

  static async upsert(data) {
        var res = await pool.query(
                'SELECT forecast_id FROM revenue_forecasts WHERE forecast_type=$1 AND DATE(period_start)=DATE($2) LIMIT 1',
                [data.forecast_type, data.period_start]
              );
        if (res.rows[0]) {
                var existing = res.rows[0];
                return await ForecastModel.updateForecast(existing.forecast_id, {
                          expected_onboardings: data.expected_onboardings,
                          expected_revenue: data.expected_revenue,
                          confidence: data.confidence,
                          pipeline_value: data.pipeline_value,
                          revenue_at_risk: data.revenue_at_risk,
                          weighted_pipeline: data.weighted_pipeline || data.weighted_pipeline_value,
                          target_progress: data.target_progress,
                          forecast_variance: data.forecast_variance,
                          status: data.status || 'active',
                          factors: data.factors,
                          assumptions: data.assumptions,
                          risks: data.risks,
                          opportunities: data.opportunities
                }) || await ForecastModel.getForecastById(existing.forecast_id);
        }
        return await ForecastModel.createForecast(data);
  }

  static async getForecastById(forecast_id) {
        var res = await pool.query('SELECT * FROM revenue_forecasts WHERE forecast_id = $1', [forecast_id]);
        return res.rows[0] || null;
  }

  static async findById(forecast_id) {
        return ForecastModel.getForecastById(forecast_id);
  }

  static async listForecasts(opts) {
        var forecast_type = opts && opts.forecast_type;
        var status = opts && opts.status;
        var limit = (opts && opts.limit) || 20;
        var offset = (opts && opts.offset) || 0;
        var q = 'SELECT * FROM revenue_forecasts WHERE 1=1';
        var vals = [];
        if (forecast_type) { vals.push(forecast_type); q += ' AND forecast_type = $' + vals.length; }
        if (status) { vals.push(status); q += ' AND status = $' + vals.length; }
        vals.push(limit); q += ' ORDER BY created_at DESC LIMIT $' + vals.length;
        vals.push(offset); q += ' OFFSET $' + vals.length;
        var res = await pool.query(q, vals);
        return res.rows;
  }

  static async getLatestByType(forecast_type) {
        var res = await pool.query('SELECT * FROM revenue_forecasts WHERE forecast_type = $1 ORDER BY created_at DESC LIMIT 1', [forecast_type]);
        return res.rows[0] || null;
  }

  static async updateForecast(forecast_id, data) {
        var fields = [];
        var vals = [];
        var allowed = ['expected_onboardings','expected_revenue','confidence','pipeline_value','revenue_at_risk','weighted_pipeline','target_progress','forecast_variance','status','factors','assumptions','risks','opportunities'];
        for (var i = 0; i < allowed.length; i++) {
                var k = allowed[i];
                if (data[k] !== undefined) {
                          // Fix: typeof null === 'object' in JS — must check for null first
                  // to avoid JSON.stringify(null) = "null" string in numeric columns
                  if (data[k] !== null && typeof data[k] === 'object') {
                              vals.push(JSON.stringify(data[k]));
                  } else {
                              vals.push(data[k]);
                  }
                          fields.push(k + ' = $' + vals.length);
                }
        }
        if (!fields.length) return null;
        vals.push(forecast_id);
        var res = await pool.query('UPDATE revenue_forecasts SET ' + fields.join(', ') + ' WHERE forecast_id = $' + vals.length + ' RETURNING *', vals);
        return res.rows[0] || null;
  }

  static async createScenario(data) {
        var q = 'INSERT INTO forecast_scenarios' +
                ' (forecast_id, scenario_type, expected_revenue, expected_onboardings,' +
                ' assumptions, confidence, primary_risks, primary_opportunities, explanation)' +
                ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *';
        var vals = [
                data.forecast_id, data.scenario_type,
                data.expected_revenue || 0, data.expected_onboardings || 0,
                JSON.stringify(data.assumptions || []),
                data.confidence || 0,
                JSON.stringify(data.primary_risks || []),
                JSON.stringify(data.primary_opportunities || []),
                data.explanation || ''
              ];
        var res = await pool.query(q, vals);
        return res.rows[0];
  }

  static async upsertScenario(data) {
        var res = await pool.query(
                'SELECT id FROM forecast_scenarios WHERE forecast_id=$1 AND scenario_type=$2 LIMIT 1',
                [data.forecast_id, data.scenario_type]
              );
        if (res.rows[0]) {
                var sid = res.rows[0].id;
                var upd = await pool.query(
                          'UPDATE forecast_scenarios SET expected_revenue=$1, expected_onboardings=$2, assumptions=$3, confidence=$4, primary_risks=$5, primary_opportunities=$6, explanation=$7 WHERE id=$8 RETURNING *',
                          [data.expected_revenue || 0, data.expected_onboardings || 0,
                                    JSON.stringify(data.assumptions || []), data.confidence || 0,
                                    JSON.stringify(data.primary_risks || []), JSON.stringify(data.primary_opportunities || []),
                                    data.explanation || '', sid]
                        );
                return upd.rows[0];
        }
        return await ForecastModel.createScenario(data);
  }

  static async getScenariosForForecast(forecast_id) {
        var res = await pool.query('SELECT * FROM forecast_scenarios WHERE forecast_id = $1 ORDER BY created_at ASC', [forecast_id]);
        return res.rows;
  }

  static async listScenarios(opts) {
        var scenario_type = opts && opts.scenario_type;
        var limit = (opts && opts.limit) || 20;
        var offset = (opts && opts.offset) || 0;
        var q = 'SELECT fs.*, rf.forecast_type, rf.period_start, rf.period_end FROM forecast_scenarios fs LEFT JOIN revenue_forecasts rf ON rf.forecast_id = fs.forecast_id WHERE 1=1';
        var vals = [];
        if (scenario_type) { vals.push(scenario_type); q += ' AND fs.scenario_type = $' + vals.length; }
        vals.push(limit); q += ' ORDER BY fs.created_at DESC LIMIT $' + vals.length;
        vals.push(offset); q += ' OFFSET $' + vals.length;
        var res = await pool.query(q, vals);
        return res.rows;
  }

  static async createHistory(data) {
        var q = 'INSERT INTO forecast_history' +
                ' (forecast_id, forecast_type, period_start, period_end, prediction,' +
                ' actual_result, variance, accuracy, confidence_calibration, evaluation_notes)' +
                ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *';
        var vals = [
                data.forecast_id || null, data.forecast_type || null,
                data.period_start || null, data.period_end || null,
                JSON.stringify(data.prediction || {}),
                JSON.stringify(data.actual_result || {}),
                data.variance || 0, data.accuracy || 0,
                data.confidence_calibration || 0,
                data.evaluation_notes || ''
              ];
        var res = await pool.query(q, vals);
        return res.rows[0];
  }

  static async listHistory(opts) {
        var forecast_type = opts && opts.forecast_type;
        var limit = (opts && opts.limit) || 30;
        var offset = (opts && opts.offset) || 0;
        var q = 'SELECT * FROM forecast_history WHERE 1=1';
        var vals = [];
        if (forecast_type) { vals.push(forecast_type); q += ' AND forecast_type = $' + vals.length; }
        vals.push(limit); q += ' ORDER BY evaluated_at DESC LIMIT $' + vals.length;
        vals.push(offset); q += ' OFFSET $' + vals.length;
        var res = await pool.query(q, vals);
        return res.rows;
  }

  static async getVarianceSummary() {
        var q = 'SELECT forecast_type,' +
                ' COUNT(*) AS evaluations,' +
                ' AVG(accuracy)::NUMERIC(5,2) AS avg_accuracy,' +
                ' AVG(variance)::NUMERIC(8,4) AS avg_variance,' +
                ' AVG(confidence_calibration)::NUMERIC(5,2) AS avg_confidence_calibration,' +
                ' MIN(accuracy) AS min_accuracy,' +
                ' MAX(accuracy) AS max_accuracy' +
                ' FROM forecast_history' +
                ' GROUP BY forecast_type' +
                ' ORDER BY avg_accuracy DESC';
        var res = await pool.query(q);
        return res.rows;
  }

  static async saveEvaluation(data) {
        try {
                var q = 'INSERT INTO revenue_forecast_evaluations' +
                          ' (forecast_id, actual_revenue, actual_onboardings, revenue_variance,' +
                          ' onboarding_variance, revenue_accuracy, notes, evaluated_at)' +
                          ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *';
                var res = await pool.query(q, [
                          data.forecast_id, data.actual_revenue || 0, data.actual_onboardings || 0,
                          data.revenue_variance || 0, data.onboarding_variance || 0,
                          data.revenue_accuracy || 0, data.notes || '',
                          data.evaluated_at || new Date().toISOString()
                        ]);
                return res.rows[0];
        } catch (tableErr) {
                try {
                          var forecast = await ForecastModel.getForecastById(data.forecast_id);
                          return await ForecastModel.createHistory({
                                      forecast_id: data.forecast_id,
                                      forecast_type: forecast ? forecast.forecast_type : 'unknown',
                                      period_start: forecast ? forecast.period_start : null,
                                      period_end: forecast ? forecast.period_end : null,
                                      prediction: { expected_revenue: forecast ? forecast.expected_revenue : 0 },
                                      actual_result: { actual_revenue: data.actual_revenue, actual_onboardings: data.actual_onboardings },
                                      variance: data.revenue_variance || 0,
                                      accuracy: data.revenue_accuracy || 0,
                                      confidence_calibration: 0,
                                      evaluation_notes: data.notes || ''
                          });
                } catch (fallbackErr) {
                          console.error('[ForecastModel] saveEvaluation fallback failed:', fallbackErr.message);
                          return { forecast_id: data.forecast_id, revenue_accuracy: data.revenue_accuracy || 0 };
                }
        }
  }

  static async logEvent(data) {
        var q = 'INSERT INTO forecast_events' +
                ' (forecast_id, event_type, details, processing_time_ms, model_version, error_message, retry_count)' +
                ' VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *';
        var vals = [
                data.forecast_id || null, data.event_type,
                JSON.stringify(data.details || {}),
                data.processing_time_ms || 0,
                data.model_version || '1.0',
                data.error_message || null,
                data.retry_count || 0
              ];
        var res = await pool.query(q, vals);
        return res.rows[0];
  }

  static async listEvents(opts) {
        var forecast_id = opts && opts.forecast_id;
        var event_type = opts && opts.event_type;
        var limit = (opts && opts.limit) || 50;
        var q = 'SELECT * FROM forecast_events WHERE 1=1';
        var vals = [];
        if (forecast_id) { vals.push(forecast_id); q += ' AND forecast_id = $' + vals.length; }
        if (event_type) { vals.push(event_type); q += ' AND event_type = $' + vals.length; }
        vals.push(limit); q += ' ORDER BY created_at DESC LIMIT $' + vals.length;
        var res = await pool.query(q, vals);
        return res.rows;
  }

  static async getPipelineSummary() {
        var q = 'SELECT' +
                " COUNT(*) FILTER (WHERE status = 'active') AS active_forecasts," +
                " SUM(pipeline_value) FILTER (WHERE status = 'active') AS total_pipeline," +
                " SUM(weighted_pipeline) FILTER (WHERE status = 'active') AS total_weighted_pipeline," +
                " SUM(revenue_at_risk) FILTER (WHERE status = 'active') AS total_at_risk," +
                " AVG(confidence) FILTER (WHERE status = 'active') AS avg_confidence," +
                " SUM(expected_onboardings) FILTER (WHERE status = 'active') AS total_expected_onboardings," +
                " SUM(expected_revenue) FILTER (WHERE status = 'active') AS total_expected_revenue" +
                " FROM revenue_forecasts" +
                " WHERE created_at >= NOW() - INTERVAL '7 days'";
        var res = await pool.query(q);
        return res.rows[0] || {};
  }
}

module.exports = ForecastModel;
