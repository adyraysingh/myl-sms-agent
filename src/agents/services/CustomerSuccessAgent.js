'use strict';
const pool = require('../../memory/db/pool');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');
const WorkflowEngine = require('../../operations/services/WorkflowEngine');
class CustomerSuccessAgent {
  static get name() { return 'customer_success'; }
  static async run(runId) {
    const findings = []; const startTime = Date.now();
    try {
      const churnRisk = await pool.query("SELECT lm.id, lm.full_name, lm.company, lm.lead_owner_name, lm.last_contacted_at, EXTRACT(EPOCH FROM (NOW()-lm.last_contacted_at))/86400 AS days_inactive FROM lead_memory lm WHERE lm.is_onboarded=TRUE AND (lm.last_contacted_at < NOW()-INTERVAL '14 days' OR lm.last_contacted_at IS NULL) ORDER BY days_inactive DESC NULLS LAST LIMIT 10").catch(() => ({ rows: [] }));
      for (const lead of churnRisk.rows) {
        const daysInactive = Math.round(parseFloat(lead.days_inactive||30));
        const confidence = Math.min(90, 50+Math.min(daysInactive,30));
        const rec = await CustomerSuccessAgent._saveRec(runId, { rec_type: 'churn_risk', title: 'Churn risk: Onboarded client ' + (lead.full_name||lead.id) + ' inactive ' + daysInactive + ' days', description: (lead.full_name||lead.id) + ' (' + (lead.company||'') + ') is an onboarded client with no contact in ' + daysInactive + ' days.', evidence: JSON.stringify([{ signal: 'days_inactive', value: daysInactive, threshold: 14 }, { signal: 'is_onboarded', value: true }]), reasoning: 'Onboarded clients with over 14 days inactivity show significantly higher churn probability.', confidence, affected_lead_id: lead.id, affected_resource: JSON.stringify({ lead_name: lead.full_name, company: lead.company, owner: lead.lead_owner_name, days_inactive: daysInactive }), recommended_action: 'Customer success check-in call. Review satisfaction, address any issues.', expected_impact: 'Re-engaging an at-risk client prevents churn and protects existing revenue', priority: daysInactive > 30 ? 'high' : 'medium' });
        if (rec && daysInactive > 21) setImmediate(() => WorkflowEngine.createAndExecute({ lead_id: lead.id, decision_id: null, workflow_type: 'notify_owner', priority: 'high', assigned_owner: lead.lead_owner_name, trigger_data: { decision_type: 'churn_risk_alert', reason: 'Onboarded client inactive ' + daysInactive + ' days', lead_name: lead.full_name }, sla_hours: 4 }).catch(e => console.error('[CSAgent] workflow err:', e.message)));
        setImmediate(() => PredictionPublisher.linkOutcome({ module: 'customer_success_agent', lead_id: lead.id, outcome_type: 'churn_risk_detected', outcome_value: { days_inactive: daysInactive, company: lead.company }, is_correct: null, accuracy_score: confidence/100, notes: 'CS Agent churn risk: ' + daysInactive + ' days inactive', source: 'customer_success_agent' }).catch(() => {}));
        findings.push({ type: 'churn_risk', lead_id: lead.id, days_inactive: daysInactive });
      }
      const bottleneck = await pool.query("SELECT lm.id, lm.full_name, lm.company, lm.lead_owner_name, lq.onboarding_score, EXTRACT(EPOCH FROM (NOW()-lq.last_qualified_at))/86400 AS days_since_qual FROM lead_memory lm JOIN lead_qualification lq ON lq.lead_id=lm.id WHERE lq.category='hot' AND lm.is_onboarded=FALSE AND lq.onboarding_score >= 70 AND lq.last_qualified_at < NOW()-INTERVAL '7 days' ORDER BY lq.onboarding_score DESC LIMIT 10").catch(() => ({ rows: [] }));
      for (const lead of bottleneck.rows) {
        const daysSinceQual = Math.round(parseFloat(lead.days_since_qual||0));
        await CustomerSuccessAgent._saveRec(runId, { rec_type: 'onboarding_bottleneck', title: 'Onboarding bottleneck: Hot lead ' + (lead.full_name||lead.id) + ' (score ' + lead.onboarding_score + ') stalled ' + daysSinceQual + ' days', description: (lead.full_name||lead.id) + ' has been hot-qualified with ' + lead.onboarding_score + '% onboarding score for ' + daysSinceQual + ' days but has not onboarded.', evidence: JSON.stringify([{ signal: 'onboarding_score', value: lead.onboarding_score }, { signal: 'days_since_qualification', value: daysSinceQual }]), reasoning: 'High-scoring hot leads not onboarding within 7 days indicate a process or communication barrier.', confidence: Math.min(85, 50+parseInt(lead.onboarding_score||0)*0.3), affected_lead_id: lead.id, affected_resource: JSON.stringify({ lead_name: lead.full_name, score: lead.onboarding_score, days_stalled: daysSinceQual }), recommended_action: 'Immediate outreach. Identify specific bottleneck. Offer direct onboarding call with senior rep.', expected_impact: 'Converting this hot lead represents direct revenue addition at ' + lead.onboarding_score + '% probability', priority: daysSinceQual > 14 ? 'high' : 'medium' });
        findings.push({ type: 'onboarding_bottleneck', lead_id: lead.id, score: lead.onboarding_score });
      }
    } catch (e) { console.error('[CustomerSuccessAgent] Error:', e.message); }
    return { agent: 'customer_success', run_id: runId, findings_count: findings.length, findings, duration_ms: Date.now()-startTime };
  }
  static async _saveRec(runId, data) {
    try { const r = await pool.query("INSERT INTO agent_recommendations (run_id,agent_name,rec_type,title,description,evidence,reasoning,confidence,affected_lead_id,affected_resource,recommended_action,expected_impact,priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *", [runId,'customer_success',data.rec_type,data.title,data.description,data.evidence||'[]',data.reasoning,data.confidence||0,data.affected_lead_id||null,data.affected_resource||'{}',data.recommended_action,data.expected_impact,data.priority||'medium']); return r.rows[0]; }
    catch (e) { console.error('[CSAgent] saveRec err:', e.message); return null; }
  }
}
module.exports = CustomerSuccessAgent;
