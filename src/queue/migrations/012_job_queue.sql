-- Phase 2: Durable Infrastructure - Job Queue Migration
-- PostgreSQL SKIP LOCKED pattern for persistent background job processing

CREATE TABLE IF NOT EXISTS job_queue (
  id              BIGSERIAL PRIMARY KEY,
  queue_name      TEXT        NOT NULL DEFAULT 'default',
  job_type        TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed','dead','delayed','cancelled')),
  priority        INTEGER     NOT NULL DEFAULT 5,
  attempts        INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 3,
  last_error      TEXT,
  last_error_stack TEXT,
  idempotency_key TEXT        UNIQUE,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_id       TEXT,
  lock_expires_at TIMESTAMPTZ,
  parent_job_id   BIGINT REFERENCES job_queue(id) ON DELETE SET NULL,
  retry_backoff   TEXT        NOT NULL DEFAULT 'exponential',
  retry_delay_ms  INTEGER     NOT NULL DEFAULT 5000
);

CREATE TABLE IF NOT EXISTS job_dead_letter (
  id              BIGSERIAL PRIMARY KEY,
  original_job_id BIGINT,
  queue_name      TEXT        NOT NULL,
  job_type        TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  failure_reason  TEXT,
  failure_stack   TEXT,
  attempts        INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at     TIMESTAMPTZ,
  replayed_by     TEXT,
  replay_job_id   BIGINT
);

CREATE TABLE IF NOT EXISTS job_idempotency (
  idempotency_key TEXT        PRIMARY KEY,
  job_id          BIGINT,
  job_type        TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE TABLE IF NOT EXISTS job_queue_metrics (
  id              BIGSERIAL PRIMARY KEY,
  queue_name      TEXT        NOT NULL,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pending_count   INTEGER     NOT NULL DEFAULT 0,
  processing_count INTEGER    NOT NULL DEFAULT 0,
  completed_count INTEGER     NOT NULL DEFAULT 0,
  failed_count    INTEGER     NOT NULL DEFAULT 0,
  dead_count      INTEGER     NOT NULL DEFAULT 0,
  avg_latency_ms  NUMERIC,
  throughput_per_min NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_priority ON job_queue (status, priority, run_at) WHERE status IN ('pending', 'delayed');
CREATE INDEX IF NOT EXISTS idx_job_queue_queue_name ON job_queue (queue_name, status, run_at);
CREATE INDEX IF NOT EXISTS idx_job_queue_idempotency ON job_queue (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_queue_lock_expires ON job_queue (lock_expires_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_job_queue_job_type ON job_queue (job_type, status);
CREATE INDEX IF NOT EXISTS idx_job_dead_letter_queue ON job_dead_letter (queue_name, moved_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_idempotency_expires ON job_idempotency (expires_at);

CREATE OR REPLACE FUNCTION update_job_queue_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_job_queue_updated_at ON job_queue;
CREATE TRIGGER trg_job_queue_updated_at BEFORE UPDATE ON job_queue FOR EACH ROW EXECUTE FUNCTION update_job_queue_updated_at();

CREATE OR REPLACE FUNCTION recover_stale_jobs() RETURNS INTEGER AS $$ DECLARE recovered INTEGER; BEGIN UPDATE job_queue SET status = 'pending', worker_id = NULL, lock_expires_at = NULL, started_at = NULL, last_error = 'Stale lock recovered at ' || NOW()::TEXT WHERE status = 'processing' AND lock_expires_at < NOW(); GET DIAGNOSTICS recovered = ROW_COUNT; RETURN recovered; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE VIEW v_queue_summary AS SELECT queue_name, COUNT(*) FILTER (WHERE status = 'pending') AS pending, COUNT(*) FILTER (WHERE status = 'processing') AS processing, COUNT(*) FILTER (WHERE status = 'completed') AS completed, COUNT(*) FILTER (WHERE status = 'failed') AS failed, COUNT(*) FILTER (WHERE status = 'dead') AS dead, MAX(created_at) AS last_job_at FROM job_queue GROUP BY queue_name;
