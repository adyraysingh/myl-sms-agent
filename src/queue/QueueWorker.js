'use strict';
/**
 * QueueWorker - Phase 2 Durable Infrastructure
 * Generic worker that polls job_queue for a specific queue and executes handlers.
 * Supports graceful shutdown, concurrent workers, stale lock recovery.
 */

const JobQueue = require('./JobQueue');

class QueueWorker {
  constructor({ queueName, handler, pollIntervalMs=5000, concurrency=2, batchSize=1 }) {
    this.queueName = queueName;
    this.handler = handler;
    this.pollIntervalMs = pollIntervalMs;
    this.concurrency = concurrency;
    this.batchSize = batchSize;
    this._running = false;
    this._shutdownRequested = false;
    this._activeJobs = 0;
    this._pollTimer = null;
    this._staleLockTimer = null;
    this._stats = { processed: 0, failed: 0, dlq: 0, uptime_start: Date.now() };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._shutdownRequested = false;
    console.log('[QueueWorker] Starting worker for queue:', this.queueName, 'concurrency:', this.concurrency);
    this._schedulePoll();
    // Stale lock recovery every 5 minutes
    this._staleLockTimer = setInterval(() => {
      JobQueue.recoverStaleLocks().catch(e => console.error('[QueueWorker] Stale lock error:', e.message));
    }, 5 * 60 * 1000);
    // Run initial stale lock recovery on startup to resume interrupted jobs
    JobQueue.recoverStaleLocks().catch(() => {});
  }

  async stop() {
    console.log('[QueueWorker] Graceful shutdown requested for queue:', this.queueName);
    this._shutdownRequested = true;
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    if (this._staleLockTimer) { clearInterval(this._staleLockTimer); this._staleLockTimer = null; }
    // Wait for active jobs to finish (max 30s)
    const deadline = Date.now() + 30000;
    while (this._activeJobs > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
    }
    this._running = false;
    if (this._activeJobs > 0) {
      console.warn('[QueueWorker] Shutdown with', this._activeJobs, 'active jobs still running for queue:', this.queueName);
    } else {
      console.log('[QueueWorker] Clean shutdown completed for queue:', this.queueName);
    }
  }

  _schedulePoll() {
    if (this._shutdownRequested) return;
    this._pollTimer = setTimeout(() => this._poll().catch(e => {
      console.error('[QueueWorker] Poll error:', this.queueName, e.message);
    }).finally(() => { if (!this._shutdownRequested) this._schedulePoll(); }), this.pollIntervalMs);
  }

  async _poll() {
    if (this._shutdownRequested) return;
    const available = this.concurrency - this._activeJobs;
    if (available <= 0) return;
    const jobs = await JobQueue.claim(this.queueName, Math.min(available, this.batchSize));
    if (jobs.length === 0) return;
    for (const job of jobs) {
      this._activeJobs++;
      this._processJob(job).finally(() => { this._activeJobs--; });
    }
  }

  async _processJob(job) {
    const start = Date.now();
    console.log('[QueueWorker] Processing job id=' + job.id, 'type=' + job.job_type, 'q=' + job.queue_name, 'attempt=' + job.attempts);
    try {
      const result = await this.handler(job.payload, job);
      await JobQueue.complete(job.id, result || {});
      this._stats.processed++;
      console.log('[QueueWorker] Completed job id=' + job.id, 'ms=' + (Date.now()-start));
    } catch (err) {
      console.error('[QueueWorker] Job id=' + job.id, 'failed:', err.message);
      const updated = await JobQueue.fail(job.id, err);
      this._stats.failed++;
      if (updated?.status === 'dead') this._stats.dlq++;
    }
  }

  getStats() {
    return {
      queue_name: this.queueName,
      running: this._running,
      shutdown_requested: this._shutdownRequested,
      active_jobs: this._activeJobs,
      worker_id: JobQueue.getWorkerId(),
      uptime_ms: Date.now() - this._stats.uptime_start,
      ...this._stats
    };
  }
}

module.exports = QueueWorker;
