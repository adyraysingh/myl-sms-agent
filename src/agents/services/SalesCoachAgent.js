'use strict';
const pool = require('../../memory/db/pool');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');
class SalesCoachAgent {
  static get name() { return 'sales_coach'; }
  static async run(runId) {
    const findings = []; const startTime = Date.now();
    try {
      const repPerf = await pool.query("SELECT lm.lead_owner_name AS rep, COUNT(DISTINCT lm.id) AS total_leads, COUNT(DISTINCT lm.id) FILTER (WHERE lm.is_onboarded=TRUE) AS onboarded, ROUND(AVG(lq.onboarding_score),1) AS avg_score, ROUND(AVG(ca.trust_score),1) AS avg_trust, COUNT(DISTINCT ca.id) AS conv_count FROM lead_memory lm LEFT JOIN lead_qualification lq ON lq.lead_id=lm.id LEFT JOIN conversation_analysis ca ON ca.lead_id=lm.id WHERE lm.lead_owner_name IS NOT NULL AND lm.created_at >= NOW()-INTERVAL '30 days' GROUP BY lm.lead_owner_name HAVING COUNT(DISTINCT lm.id) >= 1 ORDER BY onboarded DESC").catch(() => ({ rows: [] }));
      for (const rep of repPerf.rows) {
        const closeRate = parseInt(rep.total_leads||0) > 0 ? parseFloat(rep.onboarded||0)/parseFloat(rep.total_leads) : 0;
        const avgScore = parseFloat(rep.avg_score||0); const avgTrust = parseFloat(rep.avg_trust||0);
        const gaps = [];
        if (closeRate < 0.15 && parseInt(rep.total_leads||0) >= 3) gaps.push('Low close rate: ' + Math.round(closeRate*100) + '%');
        if (avgTrust < 6 && parseInt(rep.conv_count||0) >= 2) gaps.push('Below-average trust score: ' + avgTrust + '/10');
        if (avgScore < 50 && parseInt(rep.total_leads||0) >= 3) gaps.push('Low avg qualification score: ' + avgScore);
        if (gaps.length > 0) {
          await SalesCoachAgent._saveRec(runId, { rec_type: 'rep_coaching_needed', title: 'Coaching insight for ' + rep.rep + ': ' + gaps[0], description: rep.rep + ' (30d): ' + rep.total_leads + ' leads, ' + rep.onboarded + ' onboarded (' + Math.round(closeRate*100) + '% close rate). Avg trust: ' + avgTrust + '. Gaps: ' + gaps.join('. '), evidence: JSON.stringify([{ signal: 'close_rate', value: Math.round(closeRate*100)+'%' }, { signal: 'avg_trust', value: avgTrust }, { signal: 'avg_score', value: avgScore }]), reasoning: 'Below-threshold metrics indicate coaching opportunity.', confidence: Math.min(80, 40+parseInt(rep.total_leads||0)*5), affected_lead_id: null, affected_resource: JSON.stringify({ rep: rep.rep, close_rate: closeRate, avg_trust: avgTrust }), recommended_action: 'Schedule 1:1 coaching focused on: ' + gaps.join('; '), expected_impact: 'Improving close rate by 10% for this rep adds direct revenue', priority: closeRate < 0.1 ? 'high' : 'medium' });
          setImmediate(() => PredictionPublisher.linkOutcome({ module: 'sales_coach_agent', lead_id: null, outcome_type: 'coaching_recommendation_generated', outcome_value: { rep: rep.rep, close_rate: closeRate, gaps }, is_correct: null, accuracy_score: null, notes: 'Sales coach: ' + gaps.length + ' gaps for ' + rep.rep, source: 'sales_coach_agent' }).catch(() => {}));
          findings.push({ type: 'rep_coaching', rep: rep.rep, close_rate: closeRate, gaps });
        }
      }
      const ft = await pool.query("SELECT ROUND(AVG(EXTRACT(EPOCH FROM (lm.last_contacted_at-lm.created_at))/3600)) AS avg_first_contact_hours, COUNT(*) FILTER (WHERE lm.is_onboarded=TRUE) AS converted, COUNT(*) AS total FROM lead_memory lm WHERE lm.last_contacted_at IS NOT NULL AND lm.created_at >= NOW()-INTERVAL '30 days'").catch(() => ({ rows: [{}] }));
      const ftRow = ft.rows[0] || {};
      const avgHours = parseFloat(ftRow.avg_first_contact_hours||0);
      if (avgHours > 24 && parseInt(ftRow.total||0) > 5) {
        await SalesCoachAgent._saveRec(runId, { rec_type: 'slow_follow_up', title: 'Average first contact time is ' + Math.round(avgHours) + ' hours - exceeds 24h best practice', description: 'Leads receive first contact on average ' + Math.round(avgHours) + ' hours after creation. Industry best practice is under 2 hours.', evidence: JSON.stringify([{ signal: 'avg_first_contact_hours', value: Math.round(avgHours), threshold: 24 }]), reasoning: 'Over 90% conversion probability drops after long first contact delays for inbound leads.', confidence: 85, affected_lead_id: null, affected_resource: JSON.stringify({ avg_hours: Math.round(avgHours), total: ftRow.total }), recommended_action: 'Set automated alerts for new leads. Target under 2 hour first contact.', expected_impact: 'Reducing first contact time improves conversion rate significantly', priority: avgHours > 48 ? 'high' : 'medium' });
        findings.push({ type: 'slow_follow_up', avg_hours: Math.round(avgHours) });
      }
    } catch (e) { console.error('[SalesCoachAgent] Error:', e.message); }
    return { agent: 'sales_coach', run_id: runId, findings_count: findings.length, findings, duration_ms: Date.now()-startTime };
  }
  static async _saveRec(runId, data) {
    try { const r = await pool.query("INSERT INTO agent_recommendations (run_id,agent_name,rec_type,title,description,evidence,reasoning,confidence,affected_lead_id,affected_resource,recommended_action,expected_impact,priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *", [runId,'sales_coach',data.rec_type,data.title,data.description,data.evidence||'[]',data.reasoning,data.confidence||0,data.affected_lead_id||null,data.affected_resource||'{}',data.recommended_action,data.expected_impact,data.priority||'medium']); return r.rows[0]; }
    catch (e) { console.error('[SalesCoachAgent] saveRec err:', e.message); return null; }
  }
}
module.exports = SalesCoachAgent;
