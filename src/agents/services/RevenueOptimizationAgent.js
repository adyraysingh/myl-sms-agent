'use strict';
const pool = require('../../memory/db/pool');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');
const WorkflowEngine = require('../../operations/services/WorkflowEngine');
class RevenueOptimizationAgent {
  static get name() { return 'revenue_optimization'; }
  static async run(runId) {
    const findings = []; const startTime = Date.now();
    try {
      const stalledHot = await pool.query(
        "SELECT lm.id, lm.full_name, lm.company, lm.lead_owner_name, lm.last_contacted_at, lq.onboarding_score, lq.category, EXTRACT(EPOCH FROM (NOW()-lm.last_contacted_at))/86400 AS days_stalled FROM lead_memory lm JOIN lead_qualification lq ON lq.lead_id=lm.id WHERE lq.category IN ('hot','warm') AND (lm.last_contacted_at < NOW()-INTERVAL '3 days' OR lm.last_contacted_at IS NULL) AND lm.is_onboarded=FALSE ORDER BY lq.onboarding_score DESC LIMIT 15"
      ).catch(() => ({ rows: [] }));
      for (const lead of stalledHot.rows) {
        const dayStalled = Math.round(parseFloat(lead.days_stalled || 0));
        const confidence = Math.min(95, 50 + parseInt(lead.onboarding_score || 0));
        const rec = await RevenueOptimizationAgent._saveRec(runId, {
          rec_type: 'stalled_hot_lead',
          title: (lead.category === 'hot' ? 'HOT' : 'WARM') + ' lead stalled ' + dayStalled + ' days: ' + (lead.full_name || lead.id),
          description: (lead.full_name || lead.id) + ' (' + (lead.company||'') + ') not contacted in ' + dayStalled + ' days. Qualification: ' + lead.category,
          evidence: JSON.stringify([{ signal: 'days_stalled', value: dayStalled }, { signal: 'category', value: lead.category }, { signal: 'score', value: lead.onboarding_score }]),
          reasoning: 'Hot/warm leads require contact within 3 days. Each additional day reduces close probability by ~5%.',
          confidence, affected_lead_id: lead.id,
          affected_resource: JSON.stringify({ lead_name: lead.full_name, company: lead.company, owner: lead.lead_owner_name }),
          recommended_action: 'Immediate follow-up call or email from ' + (lead.lead_owner_name || 'assigned rep'),
          expected_impact: 'Re-engaging stalled hot lead with ' + lead.onboarding_score + '% conversion score',
          priority: lead.category === 'hot' ? 'high' : 'medium'
        });
        if (rec && lead.category === 'hot' && dayStalled > 5) {
          setImmediate(() => WorkflowEngine.createAndExecute({ lead_id: lead.id, decision_id: null, workflow_type: 'notify_owner', priority: 'high', assigned_owner: lead.lead_owner_name, trigger_data: { decision_type: 'stalled_hot_lead_alert', reason: 'Hot lead stalled ' + dayStalled + ' days — Revenue Optimization Agent', lead_name: lead.full_name }, sla_hours: 2 }).catch(e => console.error('[RevenueAgent] workflow err:', e.message)));
        }
        setImmediate(() => PredictionPublisher.linkOutcome({ module: 'revenue_optimization_agent', lead_id: lead.id, outcome_type: 'stalled_lead_detected', outcome_value: { days_stalled: dayStalled, score: lead.onboarding_score, category: lead.category }, is_correct: null, accuracy_score: confidence/100, notes: 'Revenue agent detected stalled ' + lead.category + ' lead', source: 'revenue_optimization_agent' }).catch(() => {}));
        findings.push({ type: 'stalled_lead', lead_id: lead.id, days: dayStalled });
      }
      const convRate = await pool.query("SELECT COUNT(*) FILTER (WHERE is_onboarded=TRUE AND created_at >= NOW()-INTERVAL '7 days') AS recent_onboarded, COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days') AS recent_total, COUNT(*) FILTER (WHERE is_onboarded=TRUE AND created_at BETWEEN NOW()-INTERVAL '14 days' AND NOW()-INTERVAL '7 days') AS prior_onboarded, COUNT(*) FILTER (WHERE created_at BETWEEN NOW()-INTERVAL '14 days' AND NOW()-INTERVAL '7 days') AS prior_total FROM lead_memory").catch(() => ({ rows: [{}] }));
      const cr = convRate.rows[0] || {};
      const recentRate = cr.recent_total > 0 ? parseFloat(cr.recent_onboarded)/parseFloat(cr.recent_total) : 0;
      const priorRate = cr.prior_total > 0 ? parseFloat(cr.prior_onboarded)/parseFloat(cr.prior_total) : 0;
      const rateDelta = recentRate - priorRate;
      if (cr.recent_total > 0 && Math.abs(rateDelta) > 0.05) {
        await RevenueOptimizationAgent._saveRec(runId, {
          rec_type: 'conversion_rate_change',
          title: (rateDelta < 0 ? 'WARNING: Conversion declined ' : 'POSITIVE: Conversion improved ') + Math.round(Math.abs(rateDelta)*100) + '% WoW',
          description: 'Weekly conversion: ' + Math.round(recentRate*100) + '% vs prior ' + Math.round(priorRate*100) + '% (' + (rateDelta<0?'':'+') + Math.round(rateDelta*100) + '% delta).',
          evidence: JSON.stringify([{ signal: 'recent_conv', value: Math.round(recentRate*100)+'%' }, { signal: 'prior_conv', value: Math.round(priorRate*100)+'%' }]),
          reasoning: rateDelta < 0 ? 'Declining conversion warrants immediate executive review.' : 'Positive trend — replicate successful tactics.',
          confidence: Math.min(85, 40 + parseInt(cr.recent_total||0)*3), affected_lead_id: null,
          affected_resource: JSON.stringify({ recent_total: cr.recent_total, recent_onboarded: cr.recent_onboarded }),
          recommended_action: rateDelta < 0 ? 'Review qualification criteria and follow-up timing. Schedule executive pipeline review.' : 'Document what is working and standardize the approach.',
          expected_impact: rateDelta < 0 ? 'Recovering 5% conversion rate adds significant MRR' : 'Compounding positive trend',
          priority: rateDelta < -0.1 ? 'high' : 'medium'
        });
        findings.push({ type: 'conversion_rate_change', delta: rateDelta });
      }
      const fcastCheck = await pool.query("SELECT forecast_type, confidence, expected_revenue FROM revenue_forecasts WHERE created_at >= NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 10").catch(() => ({ rows: [] }));
      for (const fc of fcastCheck.rows) {
        if (parseInt(fc.confidence||100) < 50) {
          await RevenueOptimizationAgent._saveRec(runId, {
            rec_type: 'low_forecast_confidence', title: 'Low revenue forecast confidence: ' + fc.forecast_type + ' at ' + fc.confidence + '%',
            description: 'The ' + fc.forecast_type + ' forecast confidence is ' + fc.confidence + '%. Below 60% indicates high uncertainty.',
            evidence: JSON.stringify([{ signal: 'forecast_confidence', value: fc.confidence, threshold: 60 }]),
            reasoning: 'Revenue forecasts below 60% confidence indicate high uncertainty.',
            confidence: 80, affected_lead_id: null, affected_resource: JSON.stringify({ forecast_type: fc.forecast_type, confidence: fc.confidence }),
            recommended_action: 'Increase pipeline data quality. Review qualification completeness for all active leads.',
            expected_impact: 'Improving forecast confidence enables better resource allocation',
            priority: parseInt(fc.confidence||100) < 35 ? 'high' : 'medium'
          });
          findings.push({ type: 'low_forecast_confidence', type_name: fc.forecast_type, confidence: fc.confidence });
        }
      }
    } catch (e) { console.error('[RevenueOptimizationAgent] Error:', e.message); }
    return { agent: 'revenue_optimization', run_id: runId, findings_count: findings.length, findings, duration_ms: Date.now()-startTime };
  }
  static async _saveRec(runId, data) {
    try {
      const r = await pool.query("INSERT INTO agent_recommendations (run_id,agent_name,rec_type,title,description,evidence,reasoning,confidence,affected_lead_id,affected_resource,recommended_action,expected_impact,priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *", [runId,'revenue_optimization',data.rec_type,data.title,data.description,data.evidence||'[]',data.reasoning,data.confidence||0,data.affected_lead_id||null,data.affected_resource||'{}',data.recommended_action,data.expected_impact,data.priority||'medium']);
      return r.rows[0];
    } catch (e) { console.error('[RevenueAgent] saveRec err:', e.message); return null; }
  }
}
module.exports = RevenueOptimizationAgent;
