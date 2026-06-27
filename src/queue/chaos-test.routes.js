'use strict';
/**
 * Phase 2 Chaos Testing Routes
 * Authenticated endpoints for reliability/chaos validation.
 * ONLY accessible to authenticated users (CEO role).
 * Routes mounted at /api/queue/chaos
 */

const express = require('express');
const router = express.Router();
const JobQueue = require('./JobQueue');
const WorkerRegistry = require('./WorkerRegistry');
const pool = require('../memory/db/pool');

// ─── POST /api/queue/chaos/enqueue-batch ─────────────────────────────────────
// Enqueue N test jobs of a given type. Used for load test and idempotency test.
router.post('/enqueue-batch', async (req, res) => {
  try {
    const { queue = 'conversation', count = 10, idempotency_key = null, use_same_key = false } = req.body;
    const results = [];
    for (let i = 0; i < count; i++) {
      const key = use_same_key
        ? (idempotency_key || 'chaos-idem-test-001')
        : null;
      const job = await JobQueue.enqueue({
        queueName: queue,
        jobType: 'chaos_test_job',
        payload: { test: true, index: i, chaos_run: Date.now() },
        priority: 5,
        maxAttempts: 2,
        idempotencyKey: key
      });
      results.push({ index: i, job_id: job.id, idempotency_hit: job.idempotency_hit || false });
    }
    res.json({ success: true, enqueued: results, count: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/queue/chaos/force-dlq ─────────────────────────────────────────
// Enqueue a job that will permanently fail (invalid handler) to test DLQ.
router.post('/force-dlq', async (req, res) => {
  try {
    const { count = 1 } = req.body;
    const results = [];
    for (let i = 0; i < count; i++) {
      const job = await JobQueue.enqueue({
        queueName: 'chaos_fail',
        jobType: 'force_fail_job',
        payload: { intentional_failure: true, index: i },
        priority: 5,
        maxAttempts: 1 // max 1 attempt = instant DLQ after first failure
      });
      results.push(job.id);
    }
    res.json({ success: true, job_ids: results, note: 'Jobs enqueued in chaos_fail queue. No worker exists for this queue, so they will expire and DLQ via stale lock recovery. For instant DLQ test: use /chaos/inject-dlq instead.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/queue/chaos/inject-dlq ────────────────────────────────────────
// Directly insert a row into job_dead_letter for DLQ replay testing.
router.post('/inject-dlq', async (req, res) => {
  try {
    const { count = 3 } = req.body;
    const results = [];
    for (let i = 0; i < count; i++) {
      const r = await pool.query(
        `INSERT INTO job_dead_letter 
          (original_job_id, queue_name, job_type, payload, failure_reason, failure_stack, attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          99000 + i,
          'qualification',
          'chaos_test_dlq_job',
          JSON.stringify({ chaos_test: true, index: i, ts: Date.now() }),
          'Intentional chaos test failure #' + i,
          'Error: Intentional chaos test failure\n  at chaos-test.routes.js:chaos_inject',
          3
        ]
      );
      results.push(r.rows[0]);
    }
    res.json({ success: true, dlq_entries: results.map(r => ({ id: r.id, job_type: r.job_type, queue: r.queue_name })), count: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/queue/chaos/db-counts ──────────────────────────────────────────
// Get raw counts from all queue tables.
router.get('/db-counts', async (req, res) => {
  try {
    const [jobs, dlq, idem] = await Promise.all([
      pool.query('SELECT status, COUNT(*) as cnt FROM job_queue GROUP BY status ORDER BY status'),
      pool.query('SELECT COUNT(*) as total, COUNT(replayed_at) as replayed FROM job_dead_letter'),
      pool.query('SELECT status, COUNT(*) as cnt FROM job_idempotency GROUP BY status ORDER BY status')
    ]);
    res.json({
      success: true,
      job_queue: jobs.rows,
      dead_letter: dlq.rows[0],
      idempotency: idem.rows,
      worker_id: JobQueue.getWorkerId()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/queue/chaos/clear-test-jobs ───────────────────────────────────
// Clean up chaos test jobs from queue tables.
router.post('/clear-test-jobs', async (req, res) => {
  try {
    const r1 = await pool.query("DELETE FROM job_queue WHERE job_type LIKE 'chaos%' OR job_type = 'force_fail_job'");
    const r2 = await pool.query("DELETE FROM job_dead_letter WHERE job_type LIKE 'chaos%'");
    const r3 = await pool.query("DELETE FROM job_idempotency WHERE idempotency_key LIKE 'chaos%'");
    res.json({ success: true, deleted: { job_queue: r1.rowCount, dead_letter: r2.rowCount, idempotency: r3.rowCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/queue/chaos/snapshot ───────────────────────────────────────────
// Full queue snapshot for validation.
router.get('/snapshot', async (req, res) => {
  try {
    const [qStats, dlq, idem, workerStats] = await Promise.all([
      JobQueue.getQueueStats(),
      JobQueue.getDLQ(null, 100),
      pool.query('SELECT idempotency_key, status, created_at FROM job_idempotency ORDER BY created_at DESC LIMIT 20'),
      WorkerRegistry.getFullStats()
    ]);
    res.json({
      success: true,
      snapshot_at: new Date().toISOString(),
      queue_stats: qStats,
      dlq: dlq,
      dlq_count: dlq.length,
      idempotency_recent: idem.rows,
      worker_stats: workerStats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/queue/chaos/enqueue-idempotency-test ──────────────────────────
// Send the same idempotency key N times, verify only 1 job is created.
router.post('/enqueue-idempotency-test', async (req, res) => {
  try {
    const { key = 'chaos-idem-qualify-TEST001', queue = 'qualification', attempts = 10 } = req.body;
    const results = [];
    for (let i = 0; i < attempts; i++) {
      const job = await JobQueue.enqueue({
        queueName: queue,
        jobType: 'chaos_idempotency_test',
        payload: { lead_id: 'CHAOS_LEAD_001', attempt: i },
        priority: 5,
        maxAttempts: 3,
        idempotencyKey: key
      });
      results.push({ attempt: i + 1, job_id: job.id, idempotency_hit: !!job.idempotency_hit });
    }
    const uniqueJobIds = [...new Set(results.map(r => r.job_id))];
    const duplicatesPrevented = results.filter(r => r.idempotency_hit).length;
    res.json({
      success: true,
      total_attempts: attempts,
      unique_jobs_created: uniqueJobIds.length,
      duplicates_prevented: duplicatesPrevented,
      idempotency_enforced: uniqueJobIds.length === 1,
      results
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
