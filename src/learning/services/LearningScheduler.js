'use strict';
/**
 * LearningScheduler - Phase 3
 * Automated daily/weekly/monthly learning cycles.
 * Runs as a background service. Never modifies historical records.
 * Uses setInterval for scheduling (no external cron dependency needed).
 */
const pool = require('../../memory/db/pool');

let _dailyTimer = null;
let _weeklyTimer = null;
let _monthlyTimer = null;
let _started = false;

// ─── Bug #14 Fix: Evaluate Predictions with Known Outcomes ───────────────────
// Automatically evaluates pending onboarding_probability predictions for leads
// that are now known to be onboarded (is_onboarded=true in lead_memory)

async function evaluateKnownOutcomes() {
    try {
          const PredictionRegistry = require('./PredictionRegistry');
          const r = await pool.query(
                  `SELECT p.prediction_id, p.lead_id, p.prediction, p.confidence, p.module
                         FROM ai_predictions p
                                JOIN lead_memory lm ON lm.id::text = p.lead_id::text
                                       WHERE p.evaluation_status = 'pending'
                                              AND p.prediction_type = 'onboarding_probability'
                                                     AND lm.is_onboarded = TRUE
                                                            LIMIT 200`
                );
          let evaluated = 0;
          for (const pred of r.rows) {
                  try {
                            const predObj = typeof pred.prediction === 'string' ? JSON.parse(pred.prediction) : (pred.prediction || {});
                            const predictedHigh = (predObj.probability || predObj.onboarding_probability || predObj.value || 0) >= 50;
                            await PredictionRegistry.recordOutcome({
                                        prediction_id: pred.prediction_id,
                                        module: pred.module || 'qualification_engine',
                                        lead_id: pred.lead_id,
                                        outcome_type: 'onboarding_result',
                                        outcome_value: { onboarded: true, lead_id: pred.lead_id },
                                        is_correct: predictedHigh,
                                        accuracy_score: predictedHigh ? 1 : 0,
                                        notes: 'Auto-evaluated: lead is_onboarded=true in lead_memory',
                                        source: 'learning_scheduler'
                            });
                            evaluated++;
                  } catch (e) { /* skip individual failures silently */ }
          }
          if (evaluated > 0) {
                  console.log('[LearningScheduler] evaluateKnownOutcomes: evaluated', evaluated, 'onboarding predictions for onboarded leads');
          }
          return evaluated;
    } catch (e) {
          console.error('[LearningScheduler] evaluateKnownOutcomes error:', e.message);
          return 0;
    }
}

// ─── Cycle runner ─────────────────────────────────────────────────────────────

async function runCycle(cycleType) {
    let cycleId = null;
    const startTime = Date.now();
    console.log('[LearningScheduler] Starting ' + cycleType + ' cycle...');

  try {
        // Log cycle start
      const logRes = await pool.query(
              'INSERT INTO learning_cycle_log (cycle_type, status) VALUES ($1,$2) RETURNING cycle_id',
              [cycleType, 'running']
            );
        cycleId = logRes.rows[0].cycle_id;

      // Lazy-load LearningEngine to avoid circular deps
      const LearningEngine = require('./LearningEngine');
        const PredictionRegistry = require('../models/PredictionRegistry');

      let predEvaluated = 0, outcomesLinked = 0, calibrationsUpdated = 0,
                suggestionsGenerated = 0, driftDetected = false, driftDetails = {};

      // 1. Expire stale predictions
      const expired = await PredictionRegistry.expireStale().catch(() => 0);
        console.log('[LearningScheduler] Expired stale predictions:', expired);

      // Bug #14 Fix: Evaluate predictions with known business outcomes (all cycles)
      const knownOutcomes = await evaluateKnownOutcomes().catch(e => {
              console.error('[LearningScheduler] evaluateKnownOutcomes failed:', e.message);
              return 0;
      });
        if (knownOutcomes > 0) predEvaluated += knownOutcomes;

      // 2. Run accuracy evaluations (all cycles)
      const evalResult = await LearningEngine.runFullEvaluation().catch(e => {
              console.error('[LearningScheduler] runFullEvaluation failed:', e.message);
              return { trends_discovered: 0, optimizations_generated: 0, success: false };
      });
        suggestionsGenerated = evalResult.optimizations_generated || 0;

      // 3. Run confidence calibration (daily+)
      const calibResult = await runConfidenceCalibration().catch(e => {
              console.error('[LearningScheduler] calibration failed:', e.message);
              return 0;
      });
        calibrationsUpdated = calibResult;

      // 4. Evaluate copilot quality (daily+)
      await evaluateCopilotQuality().catch(e =>
              console.error('[LearningScheduler] copilot eval failed:', e.message)
                                               );

      // 5. Update prompt performance stats (daily+)
      await updatePromptStats().catch(e =>
              console.error('[LearningScheduler] prompt stats failed:', e.message)
                                          );

      // 6. Weekly: detect model drift
      if (cycleType === 'weekly' || cycleType === 'monthly') {
              const drift = await detectDrift().catch(() => ({ detected: false }));
              driftDetected = drift.detected;
              driftDetails = drift.details || {};
              if (driftDetected) {
                        console.warn('[LearningScheduler] DRIFT DETECTED:', JSON.stringify(driftDetails));
              }
      }

      // 7. Monthly: generate executive AI performance report
      if (cycleType === 'monthly') {
              await generateMonthlyReport().catch(e =>
                        console.error('[LearningScheduler] monthly report failed:', e.message)
                                                        );
      }

      const duration = Date.now() - startTime;

      // Update cycle log as completed
      if (cycleId) {
              await pool.query(
                        'UPDATE learning_cycle_log SET status=$1, predictions_evaluated=$2, outcomes_linked=$3, calibrations_updated=$4, suggestions_generated=$5, drift_detected=$6, drift_details=$7, completed_at=NOW(), duration_ms=$8 WHERE cycle_id=$9',
                        ['completed', predEvaluated, outcomesLinked, calibrationsUpdated, suggestionsGenerated, driftDetected, JSON.stringify(driftDetails), duration, cycleId]
                      );
      }

      console.log('[LearningScheduler] ' + cycleType + ' cycle completed in ' + duration + 'ms');
        return { success: true, cycleType, duration_ms: duration };

  } catch (err) {
        console.error('[LearningScheduler] Cycle failed:', err.message);
        if (cycleId) {
                await pool.query(
                          'UPDATE learning_cycle_log SET status=$1, error_message=$2, completed_at=NOW(), duration_ms=$3 WHERE cycle_id=$4',
                          ['failed', err.message, Date.now() - startTime, cycleId]
                        ).catch(() => {});
        }
        return { success: false, error: err.message };
  }
}

// ─── Confidence Calibration ───────────────────────────────────────────────────

async function runConfidenceCalibration() {
    const buckets = [
      { label: '0-50', low: 0, high: 50 },
      { label: '51-60', low: 51, high: 60 },
      { label: '61-70', low: 61, high: 70 },
      { label: '71-80', low: 71, high: 80 },
      { label: '81-90', low: 81, high: 90 },
      { label: '91-100', low: 91, high: 100 }
        ];

  const modules = ['qualification_engine', 'decision_engine', 'conversation_intelligence',
                       'revenue_forecaster', 'investigation_engine', 'ceo_copilot'];

  let count = 0;
    const now = new Date().toISOString();
    const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const mod of modules) {
        for (const b of buckets) {
                try {
                          const r = await pool.query(
                                      `SELECT COUNT(p.prediction_id) AS total,
                                                  COUNT(o.outcome_id) FILTER (WHERE o.is_correct = TRUE) AS correct
                                                             FROM ai_predictions p
                                                                        LEFT JOIN ai_outcomes o ON o.prediction_id = p.prediction_id
                                                                                   WHERE p.module = $1
                                                                                              AND p.confidence BETWEEN $2 AND $3
                                                                                                         AND p.created_at >= $4`,
                                      [mod, b.low, b.high, periodStart]
                                    );

                  const row = r.rows[0];
                          const total = parseInt(row.total || 0);
                          const correct = parseInt(row.correct || 0);
                          if (total === 0) continue;

                  const actualAccuracy = correct / total;
                          const statedMid = (b.low + b.high) / 2 / 100;
                          const calibError = Math.abs(statedMid - actualAccuracy);
                          const calibFactor = statedMid > 0 ? actualAccuracy / statedMid : 1;

                  await pool.query(
                              'INSERT INTO confidence_calibration (module, confidence_bucket, bucket_low, bucket_high, total_predictions, correct_predictions, actual_accuracy, calibration_error, calibration_factor, period_start, period_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
                              [mod, b.label, b.low, b.high, total, correct,
                                          Math.round(actualAccuracy * 10000) / 10000,
                                          Math.round(calibError * 10000) / 10000,
                                          Math.round(calibFactor * 10000) / 10000,
                                          periodStart, now]
                            );
                          count++;
                } catch (e) { /* skip bucket errors */ }
        }
  }

  console.log('[LearningScheduler] Calibration: ' + count + ' buckets evaluated');
    return count;
}

// ─── Copilot Quality Evaluation ───────────────────────────────────────────────

async function evaluateCopilotQuality() {
    const periodEnd = new Date().toISOString();
    const periodStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
        const msgR = await pool.query(
                'SELECT COUNT(*) as total, ROUND(AVG(NULLIF(confidence,0)),2) as avg_conf FROM copilot_messages WHERE created_at >= $1 AND role=$2',
                [periodStart, 'assistant']
              ).catch(() => ({ rows: [{ total: 0, avg_conf: 0 }] }));

      const fbR = await pool.query(
              'SELECT COUNT(*) FILTER (WHERE helpful=TRUE OR rating >= 4) as thumbs_up, COUNT(*) FILTER (WHERE helpful=FALSE OR rating <= 2) as thumbs_down FROM copilot_feedback WHERE created_at >= $1',
              [periodStart]
            ).catch(() => ({ rows: [{ thumbs_up: 0, thumbs_down: 0 }] }));

      const total = parseInt(msgR.rows[0]?.total || 0);
        const avgConf = parseFloat(msgR.rows[0]?.avg_conf || 0);
        const thumbsUp = parseInt(fbR.rows[0]?.thumbs_up || 0);
        const thumbsDown = parseInt(fbR.rows[0]?.thumbs_down || 0);

      const feedbackTotal = thumbsUp + thumbsDown;
        const helpfulness = feedbackTotal > 0 ? thumbsUp / feedbackTotal : 0;
        const usefulness = (helpfulness * 0.6) + (Math.min(avgConf / 100, 1) * 0.4);

      if (total > 0 || feedbackTotal > 0) {
              await pool.query(
                        'INSERT INTO copilot_quality_snapshots (period_start, period_end, total_responses, thumbs_up, thumbs_down, avg_confidence, helpfulness_rate, usefulness_score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
                        [periodStart, periodEnd, total, thumbsUp, thumbsDown,
                                  Math.round(avgConf * 100) / 100,
                                  Math.round(helpfulness * 10000) / 10000,
                                  Math.round(usefulness * 10000) / 10000]
                      );
      }
  } catch (e) {
        console.error('[LearningScheduler] copilot quality error:', e.message);
  }
}

// ─── Update Prompt Performance Stats ─────────────────────────────────────────

async function updatePromptStats() {
    const promptUpdates = [
      { module: 'qualification_engine', table: 'lead_qualification', countCol: 'lead_id', confidenceCol: 'onboarding_probability' },
      { module: 'decision_engine', table: 'ai_decisions', countCol: 'decision_id', confidenceCol: 'confidence_score' },
      { module: 'conversation_intelligence', table: 'conversation_analysis', countCol: 'id', confidenceCol: 'confidence_score' },
      { module: 'investigation_engine', table: 'investigations', countCol: 'investigation_id', confidenceCol: 'confidence' }
        ];

  for (const pu of promptUpdates) {
        try {
                const r = await pool.query(
                          'SELECT COUNT(*) as cnt, ROUND(AVG(' + pu.confidenceCol + '),2) as avg_conf FROM ' + pu.table + ' WHERE created_at >= NOW() - INTERVAL $1',
                          ['30 days']
                        ).catch(() => ({ rows: [{ cnt: 0, avg_conf: 0 }] }));

          const cnt = parseInt(r.rows[0]?.cnt || 0);
                const avgConf = parseFloat(r.rows[0]?.avg_conf || 0);

          await pool.query(
                    'UPDATE prompt_versions SET total_calls=$1, avg_confidence=$2, updated_at=NOW() WHERE module=$3 AND is_active=TRUE',
                    [cnt, Math.round(avgConf * 100) / 100, pu.module]
                  );
        } catch (e) { /* skip */ }
  }
}

// ─── Drift Detection ─────────────────────────────────────────────────────────

async function detectDrift() {
    try {
          const r = await pool.query(
                  `SELECT
                          source_module,
                                  ROUND(AVG(accuracy_score) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 4) AS recent_accuracy,
                                          ROUND(AVG(accuracy_score) FILTER (WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'), 4) AS prior_accuracy
                                                 FROM learning_events
                                                        WHERE created_at >= NOW() - INTERVAL '14 days' AND accuracy_score IS NOT NULL
                                                               GROUP BY source_module`
                ).catch(() => ({ rows: [] }));

      const driftModules = [];
          for (const row of r.rows) {
                  const recent = parseFloat(row.recent_accuracy || 0);
                  const prior = parseFloat(row.prior_accuracy || 0);
                  const delta = recent - prior;
                  if (Math.abs(delta) > 0.1 && prior > 0) {
                            driftModules.push({
                                        module: row.source_module,
                                        recent_accuracy: recent,
                                        prior_accuracy: prior,
                                        delta: Math.round(delta * 10000) / 10000,
                                        direction: delta < 0 ? 'degrading' : 'improving'
                            });
                  }
          }

      return { detected: driftModules.length > 0, details: { modules: driftModules } };
    } catch (e) {
          return { detected: false, details: {} };
    }
}

// ─── Monthly Executive Report ─────────────────────────────────────────────────

async function generateMonthlyReport() {
    try {
          const LearningEngine = require('./LearningEngine');
          const summary = await LearningEngine.getSummary();

      await pool.query(
              'INSERT INTO optimization_suggestions (source_module, finding, recommended_change, expected_impact, confidence, priority) VALUES ($1,$2,$3,$4,$5,$6)',
              [
                        'learning_engine',
                        'Monthly AI Performance Report - ' + new Date().toISOString().substring(0, 7),
                        'Overall accuracy: ' + Math.round((summary.overall_accuracy || 0) * 100) + '%. ' +
                        'Qualification: ' + Math.round((summary.qualification_accuracy || 0) * 100) + '%. ' +
                        'Decision: ' + Math.round((summary.decision_accuracy || 0) * 100) + '%. ' +
                        'Investigation: ' + Math.round((summary.investigation_accuracy || 0) * 100) + '%.',
                        'Review monthly trends and implement top optimization suggestions to improve AI accuracy.',
                        70, 'medium'
                      ]
            );
    } catch (e) {
          console.error('[LearningScheduler] monthly report error:', e.message);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

const LearningScheduler = {
    start() {
          if (_started) return;
          _started = true;

      // Daily cycle: every 24 hours (first run after 5 minutes)
      setTimeout(() => {
              runCycle('daily');
              _dailyTimer = setInterval(() => runCycle('daily'), 24 * 60 * 60 * 1000);
      }, 5 * 60 * 1000);

      // Weekly cycle: every 7 days (first run after 10 minutes)
      setTimeout(() => {
              runCycle('weekly');
              _weeklyTimer = setInterval(() => runCycle('weekly'), 7 * 24 * 60 * 60 * 1000);
      }, 10 * 60 * 1000);

      // Monthly cycle: every 30 days (first run after 15 minutes)
      setTimeout(() => {
              _monthlyTimer = setInterval(() => runCycle('monthly'), 30 * 24 * 60 * 60 * 1000);
      }, 15 * 60 * 1000);

      console.log('[LearningScheduler] Started: daily/weekly/monthly cycles scheduled');
    },

    stop() {
          if (_dailyTimer) clearInterval(_dailyTimer);
          if (_weeklyTimer) clearInterval(_weeklyTimer);
          if (_monthlyTimer) clearInterval(_monthlyTimer);
          _started = false;
          console.log('[LearningScheduler] Stopped');
    },

    async runManual(cycleType = 'daily') {
          return runCycle(cycleType);
    },

    async getCycleHistory(limit = 20) {
          const r = await pool.query(
                  'SELECT * FROM learning_cycle_log ORDER BY started_at DESC LIMIT $1',
                  [limit]
                );
          return r.rows;
    },

    // Bug #14 Fix: Public method to trigger known outcome evaluation on demand
    async evaluateKnownOutcomes() {
          return evaluateKnownOutcomes();
    },

    isStarted() { return _started; }
};

module.exports = LearningScheduler;
