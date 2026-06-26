-- Phase 1: Enterprise Security Migration
-- Creates platform_users, auth_sessions, platform_audit_log
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT DO NOTHING)

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  hashed_password VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  NOT NULL CHECK (role IN ('ceo','sales_manager','sales_rep','system')),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_users_email ON platform_users(email);

-- ─── Refresh token sessions (hash only — never plaintext) ───────────────────
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,   -- SHA-256 hex of refresh token
  expires_at  TIMESTAMPTZ NOT NULL,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id    ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

-- ─── Immutable audit trail ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID REFERENCES platform_users(id),
  user_email      VARCHAR(255),
  role            VARCHAR(50),
  http_method     VARCHAR(10),
  route_path      TEXT,
  route_params    JSONB  DEFAULT '{}',
  query_params    JSONB  DEFAULT '{}',
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  status_code     INTEGER,
  response_time_ms INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id    ON platform_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_role       ON platform_audit_log(role);
