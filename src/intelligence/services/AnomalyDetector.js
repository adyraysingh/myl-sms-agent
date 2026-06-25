'use strict';
const pool = require('../../memory/db/pool');
const Investigation = require('../models/Investigation');
const AIInvestigationEngine = require('./AIInvestigationEngine');

class AnomalyDetector {
  static async runAllChecks() {
    console.log('[AnomalyDetector] Running anomaly checks...');
    await Promise.allSettled([
      AnomalyDetector._checkOnboardingDrop(),
      AnomalyDetector._checkTrustScoreDrop(),
      AnomalyDetector._checkFollowupHealth(),
      AnomalyDetector._checkDecisionExecution()
    ]);
  }

  static async _checkOnboardingDrop() {
    try {
      const r = await pool.query("SELECT DATE_TRUNC('day', updated_at) as day, COUNT(*) FILTER (WHERE qualification_category = 'Hot') as hot FROM lead_qualification WHERE updated_at > NOW() - INTERVAL '14 days' GROUP BY DATE_TRUNC('day', updated_at) ORDER BY day DESC LIMIT 2");
      if (r.rows.length < 2) return;
      const todayHot = parseInt(r.rows[0].hot) || 0;
      const yesterdayHot = parseInt(r.rows[1].hot) || 0;
      if (yesterdayHot > 0 && todayHot < yesterdayHot * 0.7) {
        const dev = Math.round(((yesterdayHot - todayHot) / yesterdayHot) * 100);
        const anomaly = await Investigation.createAnomaly({ anomaly_type: 'onboarding_drop', title: 'Hot Lead Count Dropped ' + dev + '%', description: 'Hot leads: ' + yesterdayHot + ' -> ' + todayHot, metric: 'hot_lead_count', baseline_value: yesterdayHot, current_value: todayHot, deviation_percent: dev, severity: dev > 50 ? 'critical' : 'high' });
        console.log('[AnomalyDetector] Onboarding drop:', dev + '%');
        setImmediate(async () => {
          const inv = await AIInvestigationEngine.investigateBusiness('Why did hot lead count drop by ' + dev + '%?', 'anomaly_detection');
          if (inv && inv.investigation) await Investigation.linkAnomaly(anomaly.anomaly_id, inv.investigation.investigation_id);
        });
      }
    } catch (e) { console.error('[AnomalyDetector] Onboarding check failed:', e.message); }
  }

  static async _checkTrustScoreDrop() {
    try {
      const r = await pool.query("SELECT DATE_TRUNC('day', analyzed_at) as day, AVG(trust_score) as avg_trust FROM conversation_analysis WHERE analyzed_at > NOW() - INTERVAL '7 days' GROUP BY DATE_TRUNC('day', analyzed_at) ORDER BY day DESC LIMIT 2");
      if (r.rows.length < 2) return;
      const today = parseFloat(r.rows[0].avg_trust) || 0;
      const yesterday = parseFloat(r.rows[1].avg_trust) || 0;
      if (yesterday > 0 && today < yesterday * 0.8) {
        const dev = Math.round(((yesterday - today) / yesterday) * 100);
        await Investigation.createAnomaly({ anomaly_type: 'trust_score_drop', title: 'Trust Score Dropped ' + dev + '%', description: 'Avg trust: ' + Math.round(yesterday) + ' -> ' + Math.round(today), metric: 'avg_trust_score', baseline_value: yesterday, current_value: today, deviation_percent: dev, severity: dev > 30 ? 'high' : 'medium' });
        console.log('[AnomalyDetector] Trust drop:', dev + '%');
      }
    } catch (e) { console.error('[AnomalyDetector] Trust check failed:', e.message); }
  }

  static async _checkFollowupHealth() {
    try {
      const r = await pool.query("SELECT COUNT(*) FILTER (WHERE status = 'overdue') as overdue, COUNT(*) as total FROM bm_follow_ups WHERE created_at > NOW() - INTERVAL '3 days'");
      if (!r.rows[0]) return;
      const overdue = parseInt(r.rows[0].overdue) || 0;
      const total = parseInt(r.rows[0].total) || 0;
      if (total > 0 && overdue / total > 0.4) {
        const pct = Math.round((overdue / total) * 100);
        await Investigation.createAnomaly({ anomaly_type: 'followup_overdue_spike', title: pct + '% Follow-ups Overdue', description: overdue + ' of ' + total + ' follow-ups overdue', metric: 'followup_overdue_rate', baseline_value: 20, current_value: pct, deviation_percent: pct - 20, severity: pct > 60 ? 'critical' : 'high' });
        console.log('[AnomalyDetector] Followup spike:', pct + '%');
      }
    } catch (e) { console.error('[AnomalyDetector] Followup check failed:', e.message); }
  }

  static async _checkDecisionExecution() {
    try {
      const r = await pool.query("SELECT COUNT(*) FILTER (WHERE status = 'pending' AND priority = 'critical') as critical_pending FROM ai_decisions WHERE created_at > NOW() - INTERVAL '24 hours'");
      if (!r.rows[0]) return;
      const n = parseInt(r.rows[0].critical_pending) || 0;
      if (n >= 5) {
        await Investigation.createAnomaly({ anomaly_type: 'decision_backlog', title: n + ' Critical Decisions Unexecuted', description: n + ' critical decisions pending 24h', metric: 'critical_decisions_pending', baseline_value: 0, current_value: n, deviation_percent: n * 10, severity: n >= 10 ? 'critical' : 'high' });
        console.log('[AnomalyDetector] Decision backlog:', n);
      }
    } catch (e) { console.error('[AnomalyDetector] Decision check failed:', e.message); }
  }
}

module.exports = AnomalyDetector;
