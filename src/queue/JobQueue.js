'use strict';
// JobQueue - Phase 2 Durable Infrastructure
// PostgreSQL SKIP LOCKED persistent job queue.
const pool = require('../memory/db/pool');
const WORKER_ID = process.env.WORKER_ID || (process.pid + '-' + Date.now());
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
class JobQueue {
  static async enqueue({ queueName='default', jobType, payload={}, priority=5,
      maxAttempts=3, idempotencyKey=null, delayMs=0,
      retryBackoff='exponential', retryDelayMs=5000 }) {
    if (idempotencyKey) {
      const existing = await JobQueue._checkIdempotency(idempotencyKey);
      if (existing) return { id: existing.job_id, idempotency_hit: true, status: existing.status };
    }
    const runAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : new Date().toISOString();
    const r = await pool.query(
      'INSERT INTO job_queue (queue_name,job_type,payload,priority,max_attempts,idempotency_key,run_at,status,retry_backoff,retry_delay_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *',
      [queueName,jobType,JSON.stringify(payload),priority,maxAttempts,idempotencyKey,runAt,delayMs>0?'delayed':'pending',retryBackoff,retryDelayMs]);
    const job = r.rows[0];
    if (!job) { const d=await pool.query('SELECT * FROM job_queue WHERE idempotency_key=$1',[idempotencyKey]); return {id:d.rows[0]?.id,idempotency_hit:true}; }
    if (idempotencyKey) await pool.query('INSERT INTO job_idempotency (idempotency_key,job_id,job_type,status) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',[idempotencyKey,job.id,jobType,'pending']).catch(()=>{});
    console.log('[JobQueue] Enqueued:',jobType,'id='+job.id,'q='+queueName,'pri='+priority);
    return job;
  }
  static async claim(queueName, batchSize=1) {
    const lockExpiresAt = new Date(Date.now()+LOCK_TIMEOUT_MS).toISOString();
    const r = await pool.query(
      'UPDATE job_queue SET status=$1,worker_id=$2,started_at=NOW(),lock_expires_at=$3,attempts=attempts+1 WHERE id IN (SELECT id FROM job_queue WHERE queue_name=$4 AND status IN ($5,$6) AND run_at<=NOW() ORDER BY priority ASC,run_at ASC LIMIT $7 FOR UPDATE SKIP LOCKED) RETURNING *',
      ['processing',WORKER_ID,lockExpiresAt,queueName,'pending','delayed',batchSize]);
    return r.rows;
  }
  static async complete(jobId, result={}) {
    const r = await pool.query('UPDATE job_queue SET status=$1,completed_at=NOW(),worker_id=NULL,lock_expires_at=NULL WHERE id=$2 RETURNING *',['completed',jobId]);
    const job = r.rows[0];
    if (job?.idempotency_key) await pool.query('UPDATE job_idempotency SET status=$1,result=$2,completed_at=NOW() WHERE idempotency_key=$3',['completed',JSON.stringify(result),job.idempotency_key]).catch(()=>{});
    return job;
  }
  static async fail(jobId, error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : null;
    const cur = await pool.query('SELECT * FROM job_queue WHERE id=$1',[jobId]);
    const job = cur.rows[0]; if (!job) return null;
    const permanent = job.attempts >= job.max_attempts;
    if (permanent) {
      await pool.query('INSERT INTO job_dead_letter (original_job_id,queue_name,job_type,payload,failure_reason,failure_stack,attempts) VALUES ($1,$2,$3,$4,$5,$6,$7)',[job.id,job.queue_name,job.job_type,JSON.stringify(job.payload),errMsg,errStack,job.attempts]);
      const r = await pool.query('UPDATE job_queue SET status=$1,last_error=$2,last_error_stack=$3,failed_at=NOW(),worker_id=NULL,lock_expires_at=NULL WHERE id=$4 RETURNING *',['dead',errMsg,errStack,jobId]);
      if (job.idempotency_key) await pool.query('UPDATE job_idempotency SET status=$1 WHERE idempotency_key=$2',['failed',job.idempotency_key]).catch(()=>{});
      console.error('[JobQueue] Job',jobId,'permanently failed -> DLQ'); return r.rows[0];
    }
    const retryDelay = JobQueue._calcRetryDelay(job.retry_backoff,job.retry_delay_ms,job.attempts);
    const retryAt = new Date(Date.now()+retryDelay).toISOString();
    const r = await pool.query('UPDATE job_queue SET status=$1,last_error=$2,last_error_stack=$3,run_at=$4,worker_id=NULL,lock_expires_at=NULL WHERE id=$5 RETURNING *',['pending',errMsg,errStack,retryAt,jobId]);
    console.warn('[JobQueue] Job',jobId,'failed attempt',job.attempts+'/'+job.max_attempts,'retry at',retryAt);
    return r.rows[0];
  }
  static async recoverStaleLocks() {
    try { const r=await pool.query('SELECT recover_stale_jobs()'); const c=r.rows[0]?.recover_stale_jobs||0; if(c>0)console.log('[JobQueue] Recovered',c,'stale locks'); return c; } catch(e){return 0;}
  }
  static async getQueueStats() {
    const r = await pool.query('SELECT queue_name, COUNT(*) FILTER (WHERE status=$1) AS pending, COUNT(*) FILTER (WHERE status=$2) AS processing, COUNT(*) FILTER (WHERE status=$3) AS completed, COUNT(*) FILTER (WHERE status=$4) AS failed, COUNT(*) FILTER (WHERE status=$5) AS dead, COUNT(*) FILTER (WHERE status=$6) AS delayed, ROUND(AVG(EXTRACT(EPOCH FROM (completed_at-started_at))*1000) FILTER (WHERE status=$3 AND completed_at IS NOT NULL AND completed_at>NOW()-INTERVAL $7),2) AS avg_latency_ms FROM job_queue GROUP BY queue_name ORDER BY queue_name',['pending','processing','completed','failed','dead','delayed','1 hour']);
    const dlq = await pool.query('SELECT queue_name,COUNT(*) AS dlq_count FROM job_dead_letter WHERE replayed_at IS NULL GROUP BY queue_name');
    const dlqMap={}; dlq.rows.forEach(d=>{dlqMap[d.queue_name]=parseInt(d.dlq_count);});
    return r.rows.map(row=>({...row,dlq_count:dlqMap[row.queue_name]||0,worker_id:WORKER_ID}));
  }
  static async getDLQ(queueName=null, limit=50) {
    if (queueName) { const r=await pool.query('SELECT * FROM job_dead_letter WHERE queue_name=$1 ORDER BY moved_at DESC LIMIT $2',[queueName,limit]); return r.rows; }
    const r=await pool.query('SELECT * FROM job_dead_letter ORDER BY moved_at DESC LIMIT $1',[limit]); return r.rows;
  }
  static async replayDLQ(dlqId, replayedBy='admin') {
    const r=await pool.query('SELECT * FROM job_dead_letter WHERE id=$1',[dlqId]);
    const dlqJob=r.rows[0]; if(!dlqJob) throw new Error('DLQ job not found: '+dlqId);
    const newJob=await JobQueue.enqueue({queueName:dlqJob.queue_name,jobType:dlqJob.job_type,payload:dlqJob.payload,priority:3,maxAttempts:3});
    await pool.query('UPDATE job_dead_letter SET replayed_at=NOW(),replayed_by=$1,replay_job_id=$2 WHERE id=$3',[replayedBy,newJob.id,dlqId]);
    return newJob;
  }
  static _calcRetryDelay(backoff,baseMs,attempts) {
    if(backoff==='exponential') return Math.min(baseMs*Math.pow(2,attempts-1),300000);
    if(backoff==='linear') return baseMs*attempts;
    return baseMs;
  }
  static async _checkIdempotency(key) {
    const r=await pool.query('SELECT * FROM job_idempotency WHERE idempotency_key=$1 AND expires_at>NOW()',[key]);
    return r.rows[0]||null;
  }
  static getWorkerId() { return WORKER_ID; }
}
module.exports = JobQueue;
