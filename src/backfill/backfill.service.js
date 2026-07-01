'use strict';
const pool = require('../memory/db/pool');
const WorkerRegistry = require('../queue/WorkerRegistry');
const BACKFILL_START_DATE = '2026-06-15';
const BATCH_SIZE = 50;
async function getCheckpoint() {
  try {
    const res = await pool.query("SELECT payload FROM job_queue WHERE job_type = 'backfill_checkpoint' AND status = 'completed' ORDER BY id DESC LIMIT 1");
    if (res.rows[0] && res.rows[0].payload) { const m = typeof res.rows[0].payload === 'string' ? JSON.parse(res.rows[0].payload) : res.rows[0].payload; return m.checkpoint || null; }
    return null;
  } catch (e) { return null; }
}
async function saveCheckpoint(lastId, stats) {
  try {
    const checkpointPayload = { checkpoint: { last_id: lastId, stats, saved_at: new Date().toISOString() } };
    await pool.query("INSERT INTO job_queue (queue_name, job_type, payload, status, created_at, updated_at) VALUES ($1,$2,$3,$4,NOW(),NOW())", ['backfill','backfill_checkpoint',JSON.stringify(checkpointPayload),'completed']);
  } catch(e) { console.error('[Backfill] Checkpoint save failed:',e.message); }
}
async function collectLeadData(leadId) {
  const [convRows,qualRows,decRows,predRows,outcomeRows,eventRows] = await Promise.allSettled([
    pool.query('SELECT * FROM conversation_analysis WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT * FROM lead_qualification WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT * FROM ai_decisions WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT * FROM ai_predictions WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT * FROM ai_outcomes WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT * FROM lead_events WHERE lead_id=$1 ORDER BY created_at ASC',[leadId])
  ]);
  return {
    conversations: convRows.status==='fulfilled'?convRows.value.rows:[],
    qualifications: qualRows.status==='fulfilled'?qualRows.value.rows:[],
    decisions: decRows.status==='fulfilled'?decRows.value.rows:[],
    predictions: predRows.status==='fulfilled'?predRows.value.rows:[],
    outcomes: outcomeRows.status==='fulfilled'?outcomeRows.value.rows:[],
    events: eventRows.status==='fulfilled'?eventRows.value.rows:[]
  };
}
function getLeadSource(lead) {
  if (lead.crm_data && typeof lead.crm_data === 'object') return lead.crm_data.Lead_Source || lead.crm_data.lead_source || null;
  return null;
}
function buildSyntheticContext(lead, data) {
  const parts = [];
  if (lead.full_name) parts.push('Lead: '+lead.full_name);
  if (lead.company) parts.push('Company: '+lead.company);
  const src = getLeadSource(lead);
  if (src) parts.push('Source: '+src);
  if (lead.pipeline_stage) parts.push('Stage: '+lead.pipeline_stage);
  if (data.events.length>0) parts.push('Events: '+data.events.map(e=>e.event_type||'interaction').join(', '));
  if (parts.length<2) return null;
  return parts.join('. ');
}
async function processLead(lead, stats) {
  const leadId = lead.id, zohoLeadId = lead.zoho_lead_id;
  stats.leads_processed++;
  try {
    const data = await collectLeadData(leadId);
    stats.conversations_reviewed += data.conversations.length;
    stats.qualifications_reviewed += data.qualifications.length;
    stats.decisions_reviewed += data.decisions.length;
    stats.predictions_reviewed += data.predictions.length;
    stats.outcomes_reviewed += data.outcomes.length;
    const src = getLeadSource(lead);
    const leadInfo = { id:leadId, zoho_lead_id:zohoLeadId, full_name:lead.full_name, email:lead.email, phone:lead.phone, company:lead.company, lead_source:src, stage:lead.pipeline_stage };
    if (data.conversations.length===0) {
      const t = buildSyntheticContext(lead, data);
      if (t) { await WorkerRegistry.enqueueConversation({ conversationId:'backfill-'+leadId, leadId, zohoLeadId, sourceType:src||'backfill', sourceRef:'historical_backfill_'+new Date().toISOString().split('T')[0], transcript:t, leadInfo }); stats.conversations_queued++; }
    }
    if (data.qualifications.length===0 && data.conversations.length>0) { await WorkerRegistry.enqueueQualification({ leadId, zohoLeadId, triggerEvent:'backfill.historical_review', triggerRef:'backfill_'+new Date().toISOString().split('T')[0] }); stats.qualifications_queued++; }
    if (data.decisions.length===0 && data.qualifications.length>0) { await WorkerRegistry.enqueueDecision({ lead_id:leadId, trigger_event:'backfill.historical_review', trigger_source:'historical_backfill', trigger_data:{backfill:true,date:new Date().toISOString()} }); stats.decisions_queued++; }
    if (data.predictions.length>0 && data.outcomes.length>0) stats.outcomes_linked++;
    stats.leads_succeeded++;
  } catch(err) { stats.leads_failed++; stats.errors.push({leadId,error:err.message}); console.error('[Backfill] Failed lead',leadId,err.message); }
}
async function runBackfill({ resumeFromId=null, batchSize=BATCH_SIZE }={}) {
  const runId='backfill_'+Date.now();
  console.log('[Backfill] Starting run',runId,'from date',BACKFILL_START_DATE);
  const checkpoint = resumeFromId || await getCheckpoint();
  const stats = { run_id:runId, started_at:new Date().toISOString(), leads_processed:0, leads_succeeded:0, leads_failed:0, conversations_reviewed:0, qualifications_reviewed:0, decisions_reviewed:0, predictions_reviewed:0, outcomes_reviewed:0, conversations_queued:0, qualifications_queued:0, decisions_queued:0, outcomes_linked:0, errors:[], last_processed_id:null };
  let lastId = checkpoint ? checkpoint.last_id : null;
  let hasMore = true;
  while (hasMore) {
    let query, params;
    if (lastId) { query='SELECT id,zoho_lead_id,full_name,email,phone,company,pipeline_stage,crm_data FROM lead_memory WHERE created_at>=$1 AND id>$2 ORDER BY id ASC LIMIT $3'; params=[BACKFILL_START_DATE,lastId,batchSize]; }
    else { query='SELECT id,zoho_lead_id,full_name,email,phone,company,pipeline_stage,crm_data FROM lead_memory WHERE created_at>=$1 ORDER BY id ASC LIMIT $2'; params=[BACKFILL_START_DATE,batchSize]; }
    let leads;
    try { const res=await pool.query(query,params); leads=res.rows; } catch(err) { console.error('[Backfill] Batch query failed:',err.message); break; }
    if (!leads||leads.length===0) { hasMore=false; break; }
    console.log('[Backfill] Processing batch of',leads.length,'leads');
    for (let i=0;i<leads.length;i+=5) { const g=leads.slice(i,i+5); await Promise.allSettled(g.map(l=>processLead(l,stats))); await new Promise(r=>setTimeout(r,200)); }
    lastId=leads[leads.length-1].id;
    stats.last_processed_id=lastId;
    await saveCheckpoint(lastId,{...stats,errors:stats.errors.slice(-10)});
    hasMore=leads.length===batchSize;
    console.log('[Backfill] Batch done. Total:',stats.leads_processed);
  }
  try { await WorkerRegistry.enqueueAgent({agent_name:'revenue_optimization',scheduled_at:new Date().toISOString()}); } catch(e) {}
  stats.completed_at=new Date().toISOString();
  stats.duration_ms=Date.now()-new Date(stats.started_at).getTime();
  console.log('[Backfill] Complete:',JSON.stringify({...stats,errors:stats.errors.length}));
  return stats;
}
async function generateExecutiveReport() {
  const since=BACKFILL_START_DATE;
  const results=await Promise.allSettled([
    pool.query('SELECT COUNT(*) as total FROM lead_memory WHERE created_at>=$1',[since]),
    pool.query('SELECT COUNT(*) as total FROM conversation_analysis WHERE created_at>=$1',[since]),
    pool.query('SELECT COUNT(*) as total FROM lead_qualification WHERE created_at>=$1',[since]),
    pool.query('SELECT COUNT(*) as total FROM ai_decisions WHERE created_at>=$1',[since]),
    pool.query('SELECT COUNT(*) as total FROM ai_predictions WHERE created_at>=$1',[since]),
    pool.query('SELECT COUNT(*) as total FROM ai_outcomes WHERE created_at>=$1',[since]),
    pool.query("SELECT lm.id,lm.full_name,lm.company,lm.pipeline_stage,lm.zoho_lead_id,lq.score,lq.category,lq.confidence,lq.calculated_at FROM lead_memory lm JOIN lead_qualification lq ON lq.lead_id=lm.id WHERE lq.category='hot' AND lm.created_at>=$1 ORDER BY lq.score DESC LIMIT 20",[since]),
    pool.query("SELECT lm.id,lm.full_name,lm.company,lm.pipeline_stage,lm.zoho_lead_id,lq.score,lq.category,lq.confidence,lq.calculated_at FROM lead_memory lm JOIN lead_qualification lq ON lq.lead_id=lm.id WHERE lq.category='warm' AND lm.created_at>=$1 ORDER BY lq.score DESC LIMIT 20",[since]),
    pool.query("SELECT lm.id,lm.full_name,lm.company,lm.pipeline_stage,lm.zoho_lead_id,lq.score,lq.category,lq.confidence,lq.calculated_at FROM lead_memory lm JOIN lead_qualification lq ON lq.lead_id=lm.id WHERE lq.category IN ('cold','unqualified') AND lm.created_at>=$1 ORDER BY lq.score ASC LIMIT 20",[since]),
    pool.query('SELECT lm.pipeline_stage as lead_source,COUNT(*) as leads,AVG(lq.score) as avg_score FROM lead_memory lm LEFT JOIN lead_qualification lq ON lq.lead_id=lm.id WHERE lm.created_at>=$1 GROUP BY lm.pipeline_stage ORDER BY leads DESC',[since]),
    pool.query('SELECT source_type,COUNT(*) as conversations FROM conversation_analysis WHERE created_at>=$1 GROUP BY source_type ORDER BY conversations DESC',[since]),
    pool.query('SELECT decision_type,COUNT(*) as total,AVG(confidence_score) as avg_confidence FROM ai_decisions WHERE created_at>=$1 GROUP BY decision_type ORDER BY total DESC LIMIT 10',[since]),
    pool.query('SELECT module_name,COUNT(*) as total,AVG(confidence_score) as avg_confidence,SUM(CASE WHEN is_correct=true THEN 1 ELSE 0 END) as correct FROM ai_predictions WHERE created_at>=$1 GROUP BY module_name ORDER BY total DESC',[since]),
    pool.query('SELECT COUNT(*) as unprocessed FROM lead_memory lm WHERE lm.created_at>=$1 AND NOT EXISTS (SELECT 1 FROM lead_qualification lq WHERE lq.lead_id=lm.id)',[since]),
    pool.query("SELECT queue_name,status,COUNT(*) as count FROM job_queue WHERE created_at>=NOW()-INTERVAL '24 hours' GROUP BY queue_name,status ORDER BY queue_name,status"),
    pool.query('SELECT error_type,COUNT(*) as count FROM platform_errors WHERE created_at>=$1 GROUP BY error_type ORDER BY count DESC LIMIT 10',[since])
  ]);
  const safe=(idx,fb=null)=>results[idx].status==='fulfilled'?results[idx].value.rows:fb;
  return {
    generated_at:new Date().toISOString(), period:{from:since,to:new Date().toISOString()},
    summary:{ total_leads:safe(0)?.[0]?.total||0, total_conversations:safe(1)?.[0]?.total||0, total_qualifications:safe(2)?.[0]?.total||0, total_decisions:safe(3)?.[0]?.total||0, total_predictions:safe(4)?.[0]?.total||0, total_outcomes:safe(5)?.[0]?.total||0, unprocessed_leads:safe(13)?.[0]?.unprocessed||0 },
    hot_leads:safe(6,[]), warm_leads:safe(7,[]), cold_leads:safe(8,[]),
    channel_breakdown:safe(9,[]), conversation_sources:safe(10,[]), decision_types:safe(11,[]),
    prediction_accuracy:safe(12,[]), queue_status:safe(14,[]), recent_errors:safe(15,[])
  };
}
async function getLeadTimeline(leadId) {
  const [lead,convs,quals,decisions,predictions,outcomes,events]=await Promise.allSettled([
    pool.query('SELECT * FROM lead_memory WHERE id=$1',[leadId]),
    pool.query('SELECT id,source_type,source_ref,sentiment,intent,qualification_signal,summary,created_at FROM conversation_analysis WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT id,category,score,confidence,calculation_status,calculated_at FROM lead_qualification WHERE lead_id=$1 ORDER BY calculated_at ASC',[leadId]),
    pool.query('SELECT id,decision_type,action_type,status,confidence_score,created_at FROM ai_decisions WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT id,module_name,prediction_type,confidence_score,is_correct,created_at FROM ai_predictions WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT id,outcome_type,outcome_value,created_at FROM ai_outcomes WHERE lead_id=$1 ORDER BY created_at ASC',[leadId]),
    pool.query('SELECT id,event_type,event_data,created_at FROM lead_events WHERE lead_id=$1 ORDER BY created_at ASC',[leadId])
  ]);
  const r=(p)=>p.status==='fulfilled'?p.value.rows:[];
  const timeline=[];
  const ld=r(lead)[0];
  if (ld) timeline.push({type:'lead_created',timestamp:ld.created_at,data:{stage:ld.pipeline_stage}});
  r(events).forEach(e=>timeline.push({type:e.event_type,timestamp:e.created_at,data:e.event_data}));
  r(convs).forEach(c=>timeline.push({type:'conversation_'+c.source_type,timestamp:c.created_at,data:{sentiment:c.sentiment,intent:c.intent,signal:c.qualification_signal}}));
  r(quals).forEach(q=>timeline.push({type:'qualification',timestamp:q.calculated_at,data:{category:q.category,score:q.score,confidence:q.confidence}}));
  r(decisions).forEach(d=>timeline.push({type:'ai_decision_'+d.decision_type,timestamp:d.created_at,data:{action:d.action_type,status:d.status,confidence:d.confidence_score}}));
  r(predictions).forEach(p=>timeline.push({type:'prediction',timestamp:p.created_at,data:{module:p.module_name,type:p.prediction_type,confidence:p.confidence_score,correct:p.is_correct}}));
  r(outcomes).forEach(o=>timeline.push({type:'outcome_'+o.outcome_type,timestamp:o.created_at,data:o.outcome_value}));
  timeline.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));
  return { lead:ld||null, timeline, summary:{ conversations:r(convs).length, qualifications:r(quals).length, decisions:r(decisions).length, predictions:r(predictions).length, outcomes:r(outcomes).length } };
}
module.exports = { runBackfill, generateExecutiveReport, getLeadTimeline, getCheckpoint };Backfill:Fixcheckpoint-usepayloadcolinsteadofmetadata(notinjob_queue)