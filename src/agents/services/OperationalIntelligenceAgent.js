'use strict';
const pool = require('../../memory/db/pool');
const WorkflowEngine = require('../../operations/services/WorkflowEngine');

/**
 * OperationalIntelligenceAgent
 * Bug #10 Fix: Added deduplication before creating DLQ growth, workflow_failure,
 * and learning_cycle_issue recommendations to prevent 72+ duplicate alerts per run.
 * Before creating a new rec, checks if an open rec with same rec_type and resource exists.
 * If yes: updates timestamp only. If no: creates new recommendation.
 */
class OperationalIntelligenceAgent {
    static get name() { return 'operational_intel'; }

  static async run(runId) {
        const findings = [];
        const startTime = Date.now();
        try {
                const slaBreaches = await pool.query(
                          "SELECT ws.sla_id, ws.workflow_id, ws.lead_id, ws.sla_type, EXTRACT(EPOCH FROM (NOW()-ws.due_at))/60 AS overdue_minutes, wf.priority, wf.assigned_owner FROM workflow_slas ws JOIN automation_workflows wf ON wf.workflow_id=ws.workflow_id WHERE ws.status='active' AND ws.due_at < NOW() ORDER BY overdue_minutes DESC LIMIT 20"
                        ).catch(() => ({ rows: [] }));
                for (const sla of slaBreaches.rows) {
                          const overdueMins = Math.round(parseFloat(sla.overdue_minutes || 0));
                          await OperationalIntelligenceAgent._saveRec(runId, { rec_type: 'sla_breach', dedup_resource: sla.sla_id, title: 'SLA BREACH: ' + sla.sla_type + ' overdue by ' + overdueMins + ' minutes', description: 'Workflow ' + sla.workflow_id + ' SLA for ' + sla.sla_type + ' breached. ' + overdueMins + ' minutes overdue. Assigned: ' + (sla.assigned_owner || 'unassigned'), evidence: JSON.stringify([{ signal: 'overdue_minutes', value: overdueMins }, { signal: 'sla_type', value: sla.sla_type }]), reasoning: 'SLA breaches directly impact customer experience and conversion probability. Immediate escalation is required.', confidence: 95, affected_lead_id: sla.lead_id, affected_resource: JSON.stringify({ workflow_id: sla.workflow_id, sla_type: sla.sla_type, overdue_minutes: overdueMins, owner: sla.assigned_owner }), recommended_action: 'Escalate immediately to sales manager. Assign backup rep if primary is unresponsive.', expected_impact: 'Unresolved SLA breaches reduce trust and conversion probability', priority: overdueMins > 60 ? 'high' : 'medium' });
                          if (overdueMins > 30) setImmediate(() => WorkflowEngine.checkSLABreaches().catch(e => console.error('[OpsAgent] SLA err:', e.message)));
                          findings.push({ type: 'sla_breach', workflow_id: sla.workflow_id, overdue_minutes: overdueMins });
                }
                const failedWorkflows = await pool.query(
                          "SELECT workflow_id, workflow_type, priority, assigned_owner, retry_count, max_retries, error_message FROM automation_workflows WHERE status='failed' AND updated_at >= NOW()-INTERVAL '1 hour' ORDER BY priority ASC LIMIT 10"
                        ).catch(() => ({ rows: [] }));
                for (const wf of failedWorkflows.rows) {
                          const retryable = parseInt(wf.retry_count || 0) < parseInt(wf.max_retries || 3);
                          await OperationalIntelligenceAgent._saveRec(runId, { rec_type: 'workflow_failure', dedup_resource: wf.workflow_id, title: 'Workflow failed: ' + wf.workflow_type + ' (' + (wf.priority || 'medium') + ' priority)' + (retryable ? ' - retryable' : ' - max retries reached'), description: 'Workflow ' + wf.workflow_id + ' of type ' + wf.workflow_type + ' failed. Error: ' + (wf.error_message || 'unknown').slice(0, 200) + '. Retries: ' + (wf.retry_count || 0) + '/' + (wf.max_retries || 3), evidence: JSON.stringify([{ signal: 'workflow_type', value: wf.workflow_type }, { signal: 'retry_count', value: wf.retry_count }, { signal: 'error', value: (wf.error_message || '').slice(0, 100) }]), reasoning: retryable ? 'Workflow is eligible for retry. Triggering automatic retry.' : 'Max retries reached - manual intervention required.', confidence: 85, affected_lead_id: null, affected_resource: JSON.stringify({ workflow_id: wf.workflow_id, type: wf.workflow_type, error: (wf.error_message || '').slice(0, 100) }), recommended_action: retryable ? 'Automatic retry triggered by Operational Intelligence Agent.' : 'Manual investigation required. Check Slack webhook configuration and DB connectivity.', expected_impact: retryable ? 'Retry may restore automation execution' : 'Unresolved workflow failures create execution gaps', priority: wf.priority === 'critical' ? 'high' : 'medium' });
                          if (retryable) setImmediate(() => WorkflowEngine.retry(wf.workflow_id).catch(e => console.error('[OpsAgent] retry err:', e.message)));
                          findings.push({ type: 'workflow_failure', workflow_id: wf.workflow_id, retryable });
                }
                // Bug #10 Fix: DLQ growth deduplication - use dedup_resource=queue_name to prevent per-run duplicates
          const dlqStats = await pool.query(
                    "SELECT queue_name, COUNT(*) AS dlq_count, MAX(moved_at) AS latest_failure FROM job_dead_letter WHERE replayed_at IS NULL GROUP BY queue_name ORDER BY dlq_count DESC"
                  ).catch(() => ({ rows: [] }));
                for (const dlq of dlqStats.rows) {
                          if (parseInt(dlq.dlq_count || 0) > 3) {
                                      await OperationalIntelligenceAgent._saveRec(runId, { rec_type: 'dlq_growth', dedup_resource: dlq.queue_name, title: 'Dead Letter Queue growing: ' + dlq.queue_name + ' has ' + dlq.dlq_count + ' unresolved failures', description: 'Queue ' + dlq.queue_name + ' DLQ contains ' + dlq.dlq_count + ' failed jobs not yet replayed.', evidence: JSON.stringify([{ signal: 'dlq_count', value: dlq.dlq_count }, { signal: 'queue_name', value: dlq.queue_name }]), reasoning: 'Growing DLQ indicates systematic failures requiring investigation. Unresolved DLQ items mean missed AI actions.', confidence: 90, affected_lead_id: null, affected_resource: JSON.stringify({ queue: dlq.queue_name, dlq_count: dlq.dlq_count }), recommended_action: 'Review DLQ via /api/queue/dlq. Identify root cause. Replay safe jobs. Fix underlying issue.', expected_impact: 'Clearing DLQ restores full autonomous operation capability', priority: parseInt(dlq.dlq_count || 0) > 10 ? 'high' : 'medium' });
                                      findings.push({ type: 'dlq_growth', queue: dlq.queue_name, count: dlq.dlq_count });
                          }
                }
                const lastCycle = await pool.query(
                          "SELECT cycle_type, status, completed_at, error_message FROM learning_cycle_log ORDER BY started_at DESC LIMIT 1"
                        ).catch(() => ({ rows: [] }));
                if (lastCycle.rows.length > 0) {
                          const lc = lastCycle.rows[0];
                          const hoursSinceCycle = lc.completed_at ? (Date.now() - new Date(lc.completed_at).getTime()) / 3600000 : 999;
                          if (lc.status === 'failed' || hoursSinceCycle > 48) {
                                      await OperationalIntelligenceAgent._saveRec(runId, { rec_type: 'learning_cycle_issue', dedup_resource: 'scheduler', title: lc.status === 'failed' ? 'Learning cycle failed: ' + (lc.error_message || 'unknown error').slice(0, 80) : 'Learning cycle not run in ' + Math.round(hoursSinceCycle) + ' hours', description: 'Last learning cycle status: ' + lc.status + '. Hours since last completion: ' + Math.round(hoursSinceCycle), evidence: JSON.stringify([{ signal: 'status', value: lc.status }, { signal: 'hours_since_completion', value: Math.round(hoursSinceCycle) }]), reasoning: 'The learning engine must run regularly to maintain AI accuracy calibration.', confidence: 85, affected_lead_id: null, affected_resource: JSON.stringify({ cycle_type: lc.cycle_type, status: lc.status, hours_ago: Math.round(hoursSinceCycle) }), recommended_action: 'Trigger manual learning cycle via /api/learning/run. Investigate scheduler if consistently failing.', expected_impact: 'Learning cycles are critical for AI confidence calibration and continuous improvement', priority: 'medium' });
                                      findings.push({ type: 'learning_cycle_issue', status: lc.status, hours_ago: Math.round(hoursSinceCycle) });
                          }
                }
        } catch (e) { console.error('[OperationalIntelligenceAgent] Error:', e.message); }
        return { agent: 'operational_intel', run_id: runId, findings_count: findings.length, findings, duration_ms: Date.now() - startTime };
  }

  /**
     * Bug #10 Fix: Deduplicated save.
     * Before inserting, checks if an OPEN recommendation exists with same rec_type and dedup_resource.
     * If yes: updates title/description to reflect latest data. No duplicate created.
     * If no: inserts new recommendation as before.
     */
  static async _saveRec(runId, data) {
        try {
                if (data.dedup_resource) {
                          const existing = await pool.query(
                                      "SELECT rec_id FROM agent_recommendations WHERE agent_name='operational_intel' AND rec_type=$1 AND status='open' AND affected_resource::text LIKE $2 LIMIT 1",
                                      [data.rec_type, '%' + String(data.dedup_resource).replace(/[%_]/g, '\\$&') + '%']
                                    );
                          if (existing.rows.length > 0) {
                                      await pool.query(
                                                    "UPDATE agent_recommendations SET title=$1, description=$2, updated_at=NOW() WHERE rec_id=$3",
                                                    [data.title, data.description, existing.rows[0].rec_id]
                                                  );
                                      return existing.rows[0];
                          }
                }
                const r = await pool.query(
                          "INSERT INTO agent_recommendations (run_id,agent_name,rec_type,title,description,evidence,reasoning,confidence,affected_lead_id,affected_resource,recommended_action,expected_impact,priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
                          [runId, 'operational_intel', data.rec_type, data.title, data.description, data.evidence || '[]', data.reasoning, data.confidence || 0, data.affected_lead_id || null, data.affected_resource || '{}', data.recommended_action, data.expected_impact, data.priority || 'medium']
                        );
                return r.rows[0];
        } catch (e) { console.error('[OpsAgent] saveRec err:', e.message); return null; }
  }
}

module.exports = OperationalIntelligenceAgent;
