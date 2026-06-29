'use strict';
const pool = require('../../memory/db/pool');
class ExecutiveMonitoringAgent {
  static get name() { return 'executive_monitoring'; }
  static async run(runId) {
    const findings = []; const startTime = Date.now();
    try {
      const confTrend = await pool.query("SELECT module, ROUND(AVG(confidence) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours'),2) AS recent_conf, ROUND(AVG(confidence) FILTER (WHERE created_at BETWEEN NOW()-INTERVAL '48 hours' AND NOW()-INTERVAL '24 hours'),2) AS prior_conf, COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '24 hours') AS recent_count FROM ai_predictions WHERE created_at >= NOW()-INTERVAL '48 hours' GROUP BY module HAVING COUNT(*) > 3").catch(() => ({ rows: [] }));
      for (const m of confTrend.rows) {
        const recent = parseFloat(m.recent_conf||0); const prior = parseFloat(m.prior_conf||0); const delta = recent - prior;
        if (prior > 0 && delta < -5) {
          await ExecutiveMonitoringAgent._saveRec(runId, { rec_type: 'ai_confidence_drop', title: 'AI confidence drop in ' + m.module + ': ' + Math.round(recent) + '% (was ' + Math.round(prior) + '%)', description: 'The ' + m.module + ' module confidence dropped ' + Math.round(Math.abs(delta)) + ' points in 24 hours.', evidence: JSON.stringify([{ signal: 'recent_conf', value: Math.round(recent) }, { signal: 'prior_conf', value: Math.round(prior) }, { signal: 'delta', value: Math.round(delta) }]), reasoning: 'Drops over 5 points may indicate drift or data quality issues requiring investigation.', confidence: 80, affected_resource: JSON.stringify({ module: m.module, recent_conf: recent, prior_conf: prior }), recommended_action: 'Review ' + m.module + ' input data quality. Check for upstream data changes. Trigger manual learning evaluation.', expected_impact: 'Early detection prevents compounding confidence degradation', priority: delta < -15 ? 'high' : 'medium' });
          findings.push({ type: 'confidence_drop', module: m.module, delta });
        }
      }
      const queueStats = await pool.query("SELECT queue_name, COUNT(*) FILTER (WHERE status='pending') AS pending_count, COUNT(*) FILTER (WHERE status='dead') AS dead_count, MAX(EXTRACT(EPOCH FROM (NOW()-run_at))/60) FILTER (WHERE status='pending') AS oldest_pending_min FROM job_queue WHERE created_at >= NOW()-INTERVAL '1 hour' GROUP BY queue_name").catch(() => ({ rows: [] }));
      for (const q of queueStats.rows) {
        const deadCount = parseInt(q.dead_count||0); const oldestMin = parseFloat(q.oldest_pending_min||0);
        if (deadCount > 5 || oldestMin > 30) {
          await ExecutiveMonitoringAgent._saveRec(runId, { rec_type: 'queue_anomaly', title: 'Queue anomaly: ' + q.queue_name + ' - ' + (deadCount > 5 ? deadCount + ' dead jobs' : 'pending stuck ' + Math.round(oldestMin) + ' min'), description: 'Queue ' + q.queue_name + ': ' + q.pending_count + ' pending, ' + deadCount + ' dead. Oldest pending: ' + Math.round(oldestMin) + ' min.', evidence: JSON.stringify([{ signal: 'dead_jobs', value: deadCount }, { signal: 'oldest_pending_min', value: Math.round(oldestMin) }]), reasoning: 'Dead jobs or stale pending jobs indicate worker failures requiring immediate attention.', confidence: 90, affected_resource: JSON.stringify({ queue: q.queue_name, dead: deadCount, pending: q.pending_count }), recommended_action: 'Review DLQ for root cause. Check worker health. Replay failed jobs if safe.', expected_impact: 'Unresolved queue issues cascade to missed AI recommendations', priority: deadCount > 10 ? 'high' : 'medium' });
          findings.push({ type: 'queue_anomaly', queue: q.queue_name, dead: deadCount });
        }
      }
      const pipelineSummary = await pool.query("SELECT COUNT(*) AS total_leads, COUNT(*) FILTER (WHERE is_onboarded=TRUE) AS onboarded, COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS new_this_week, COUNT(*) FILTER (WHERE is_onboarded=TRUE AND created_at >= NOW()-INTERVAL '7 days') AS onboarded_this_week FROM lead_memory").catch(() => ({ rows: [{}] }));
      const hotCount = await pool.query("SELECT COUNT(*) as hot FROM lead_qualification WHERE category='hot'").catch(() => ({ rows: [{ hot: 0 }] }));
      const ps = pipelineSummary.rows[0] || {};
      const weeklyConvRate = parseInt(ps.new_this_week||0) > 0 ? parseFloat(ps.onboarded_this_week||0)/parseFloat(ps.new_this_week) : 0;
      await ExecutiveMonitoringAgent._saveRec(runId, { rec_type: 'executive_briefing', title: 'Executive Briefing - ' + new Date().toISOString().slice(0,10), description: 'Pipeline: ' + (ps.total_leads||0) + ' total leads, ' + (hotCount.rows[0] && hotCount.rows[0].hot||0) + ' hot, ' + (ps.onboarded||0) + ' onboarded. This week: ' + (ps.new_this_week||0) + ' new leads, ' + (ps.onboarded_this_week||0) + ' onboarded (' + Math.round(weeklyConvRate*100) + '% conversion).', evidence: JSON.stringify([{ signal: 'total_leads', value: ps.total_leads }, { signal: 'hot_leads', value: hotCount.rows[0] && hotCount.rows[0].hot }, { signal: 'weekly_conversion_rate', value: Math.round(weeklyConvRate*100)+'%' }]), reasoning: 'Daily executive briefing provides real-time visibility into pipeline health for strategic decision-making.', confidence: 95, affected_resource: JSON.stringify({ total_leads: ps.total_leads, onboarded: ps.onboarded, weekly_conv: Math.round(weeklyConvRate*100)+'%' }), recommended_action: weeklyConvRate < 0.1 ? 'Conversion rate below 10% this week - review pipeline quality and follow-up processes.' : 'Pipeline healthy. Monitor hot leads for timely follow-up.', expected_impact: 'Real-time executive visibility enables proactive revenue management', priority: weeklyConvRate < 0.05 ? 'high' : 'low' });
      findings.push({ type: 'executive_briefing', total_leads: ps.total_leads, weekly_conv: weeklyConvRate });
    } catch (e) { console.error('[ExecutiveMonitoringAgent] Error:', e.message); }
    return { agent: 'executive_monitoring', run_id: runId, findings_count: findings.length, findings, duration_ms: Date.now()-startTime };
  }
  static async _saveRec(runId, data) {
    try { const r = await pool.query("INSERT INTO agent_recommendations (run_id,agent_name,rec_type,title,description,evidence,reasoning,confidence,affected_lead_id,affected_resource,recommended_action,expected_impact,priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *", [runId,'executive_monitoring',data.rec_type,data.title,data.description,data.evidence||'[]',data.reasoning,data.confidence||0,null,data.affected_resource||'{}',data.recommended_action,data.expected_impact,data.priority||'medium']); return r.rows[0]; }
    catch (e) { console.error('[ExecAgent] saveRec err:', e.message); return null; }
  }
}
module.exports = ExecutiveMonitoringAgent;
