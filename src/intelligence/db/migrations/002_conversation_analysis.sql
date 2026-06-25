-- Phase 3: Conversation Intelligence Engine
-- Migration 002: conversation_analysis table

-- Enable UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- CONVERSATION ANALYSIS TABLE
-- Stores AI-generated structured intelligence per conversation
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_analysis (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id         UUID NOT NULL,
  lead_id                 UUID NOT NULL,
  source_type             VARCHAR(50) NOT NULL,
  source_ref              TEXT,

  summary                 TEXT,
  customer_intent         VARCHAR(100),
  conversation_stage      VARCHAR(50),
  brand_stage             VARCHAR(50),
  conversation_outcome    VARCHAR(50),

  product_interest        TEXT[],
  products_requested      JSONB DEFAULT '[]',

  budget_detected         BOOLEAN DEFAULT FALSE,
  budget_value            JSONB,
  timeline_detected       BOOLEAN DEFAULT FALSE,
  timeline_value          JSONB,

  manufacturing_stage     VARCHAR(50),
  shopify_status          VARCHAR(50),
  country                 VARCHAR(100),
  experience_level        VARCHAR(50),
  brand_readiness         VARCHAR(50),

  trust_score             SMALLINT CHECK (trust_score BETWEEN 0 AND 100),
  sentiment               VARCHAR(20),
  conversation_quality    VARCHAR(20),
  buying_intent_score     SMALLINT CHECK (buying_intent_score BETWEEN 0 AND 100),

  questions               JSONB DEFAULT '[]',
  objections              JSONB DEFAULT '[]',
  positive_buying_signals JSONB DEFAULT '[]',
  negative_buying_signals JSONB DEFAULT '[]',

  recommended_next_step   TEXT,
  recommended_follow_up   TEXT,
  risk_factors            JSONB DEFAULT '[]',

  topics_detected         TEXT[],
  key_requirements        JSONB DEFAULT '{}',

  confidence_score        DECIMAL(3,2) CHECK (confidence_score BETWEEN 0 AND 1),
  model_version           VARCHAR(50) DEFAULT 'gpt-4o',
  processing_time_ms      INTEGER,
  analysis_status         VARCHAR(20) DEFAULT 'pending',
  retry_count             SMALLINT DEFAULT 0,
  error_message           TEXT,

  analyzed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_conversation ON conversation_analysis(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ca_lead        ON conversation_analysis(lead_id);
CREATE INDEX IF NOT EXISTS idx_ca_source_type ON conversation_analysis(source_type);
CREATE INDEX IF NOT EXISTS idx_ca_status      ON conversation_analysis(analysis_status);
CREATE INDEX IF NOT EXISTS idx_ca_sentiment   ON conversation_analysis(sentiment);
CREATE INDEX IF NOT EXISTS idx_ca_intent      ON conversation_analysis(customer_intent);
CREATE INDEX IF NOT EXISTS idx_ca_created     ON conversation_analysis(created_at DESC);

-- ============================================================
-- ANALYSIS QUEUE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_queue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL,
  lead_id         UUID,
  source_type     VARCHAR(50),
  source_data     JSONB NOT NULL,
  priority        SMALLINT DEFAULT 5,
  status          VARCHAR(20) DEFAULT 'pending',
  retry_count     SMALLINT DEFAULT 0,
  max_retries     SMALLINT DEFAULT 3,
  error_message   TEXT,
  scheduled_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aq_status       ON analysis_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_aq_conversation ON analysis_queue(conversation_id);

-- ============================================================
-- ZOHO CRM SYNC LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS zoho_ai_sync_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id     UUID NOT NULL REFERENCES conversation_analysis(id) ON DELETE CASCADE,
  zoho_lead_id    TEXT NOT NULL,
  fields_updated  JSONB DEFAULT '{}',
  success         BOOLEAN DEFAULT FALSE,
  error_message   TEXT,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zsl_analysis    ON zoho_ai_sync_log(analysis_id);
CREATE INDEX IF NOT EXISTS idx_zsl_zoho_lead   ON zoho_ai_sync_log(zoho_lead_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_ca_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ca_updated_at ON conversation_analysis;
CREATE TRIGGER trg_ca_updated_at
  BEFORE UPDATE ON conversation_analysis
  FOR EACH ROW EXECUTE FUNCTION update_ca_updated_at();
