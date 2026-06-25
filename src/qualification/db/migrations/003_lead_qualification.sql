-- Phase 4: Onboarding Qualification Engine
-- Migration 003: lead_qualification and qualification_history tables

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- LEAD QUALIFICATION TABLE
-- Stores the current qualification state for each lead.
-- One record per lead — continuously updated.
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_qualification (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id                   UUID NOT NULL UNIQUE,
  zoho_lead_id              TEXT,

  -- Qualification Category (exactly one)
  category                  VARCHAR(20) NOT NULL DEFAULT 'unqualified',
  -- hot | warm | cold | dead | unqualified | onboarded

  -- Core Scores (0-100)
  onboarding_score          SMALLINT DEFAULT 0 CHECK (onboarding_score BETWEEN 0 AND 100),
  onboarding_probability    SMALLINT DEFAULT 0 CHECK (onboarding_probability BETWEEN 0 AND 100),
  readiness_score           SMALLINT DEFAULT 0 CHECK (readiness_score BETWEEN 0 AND 100),
  trust_score               SMALLINT DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 100),
  engagement_score          SMALLINT DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  budget_confidence         SMALLINT DEFAULT 0 CHECK (budget_confidence BETWEEN 0 AND 100),
  timeline_confidence       SMALLINT DEFAULT 0 CHECK (timeline_confidence BETWEEN 0 AND 100),
  brand_readiness           SMALLINT DEFAULT 0 CHECK (brand_readiness BETWEEN 0 AND 100),
  manufacturing_readiness   SMALLINT DEFAULT 0 CHECK (manufacturing_readiness BETWEEN 0 AND 100),
  communication_quality     SMALLINT DEFAULT 0 CHECK (communication_quality BETWEEN 0 AND 100),
  followup_health           SMALLINT DEFAULT 0 CHECK (followup_health BETWEEN 0 AND 100),
  decision_confidence       SMALLINT DEFAULT 0 CHECK (decision_confidence BETWEEN 0 AND 100),
  confidence_score          SMALLINT DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),

  -- Explainability
  overall_reasoning         TEXT,
  score_breakdown           JSONB DEFAULT '{}',
  -- {onboarding_score: {value, reason}, trust_score: {value, reason}, ...}

  -- Qualification Factors (evaluated)
  factors                   JSONB DEFAULT '{}',
  -- {budget:{assessed,value,notes}, timeline:{assessed,value,notes}, ...}

  -- Qualification Gaps (missing information)
  qualification_gaps        JSONB DEFAULT '[]',
  -- [{gap, severity, impact_on_score}]

  -- Positive and negative signals
  positive_signals          JSONB DEFAULT '[]',
  negative_signals          JSONB DEFAULT '[]',

  -- What to do next
  recommended_next_action   TEXT,
  recommended_questions     JSONB DEFAULT '[]',
  urgency_level             VARCHAR(20) DEFAULT 'normal',
  -- low | normal | high | urgent

  -- Lead context snapshot at time of qualification
  lead_snapshot             JSONB DEFAULT '{}',
  -- Captured from Business Memory + Conversation Intelligence

  -- Recalculation metadata
  trigger_event             VARCHAR(100),
  -- new_conversation | new_email | crm_note | retell_call | task_completed | manual
  trigger_ref               TEXT,
  recalculation_count       INTEGER DEFAULT 0,
  last_trigger_at           TIMESTAMPTZ,

  -- AI metadata
  model_version             VARCHAR(50) DEFAULT 'gpt-4o',
  processing_time_ms        INTEGER,
  calculation_status        VARCHAR(20) DEFAULT 'pending',
  -- pending | completed | failed
  error_message             TEXT,

  -- Timestamps
  first_qualified_at        TIMESTAMPTZ,
  last_qualified_at         TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lq_lead_id     ON lead_qualification(lead_id);
CREATE INDEX IF NOT EXISTS idx_lq_zoho        ON lead_qualification(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_lq_category    ON lead_qualification(category);
CREATE INDEX IF NOT EXISTS idx_lq_score       ON lead_qualification(onboarding_score DESC);
CREATE INDEX IF NOT EXISTS idx_lq_probability ON lead_qualification(onboarding_probability DESC);
CREATE INDEX IF NOT EXISTS idx_lq_updated     ON lead_qualification(updated_at DESC);

-- ============================================================
-- QUALIFICATION HISTORY TABLE
-- Every recalculation event stored for timeline.
-- Immutable — never updated, only inserted.
-- ============================================================
CREATE TABLE IF NOT EXISTS qualification_history (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id                UUID NOT NULL,
  qualification_id       UUID REFERENCES lead_qualification(id) ON DELETE CASCADE,
  zoho_lead_id           TEXT,

  -- Scores at this point in time
  category               VARCHAR(20),
  onboarding_score       SMALLINT,
  onboarding_probability SMALLINT,
  readiness_score        SMALLINT,
  trust_score            SMALLINT,
  engagement_score       SMALLINT,
  confidence_score       SMALLINT,

  -- Score delta from previous
  score_delta            SMALLINT,
  probability_delta      SMALLINT,
  category_changed       BOOLEAN DEFAULT FALSE,
  previous_category      VARCHAR(20),

  -- Why it changed
  trigger_event          VARCHAR(100),
  trigger_ref            TEXT,
  overall_reasoning      TEXT,
  qualification_gaps     JSONB DEFAULT '[]',
  recommended_next_action TEXT,

  -- Snapshot
  lead_snapshot          JSONB DEFAULT '{}',

  -- Meta
  model_version          VARCHAR(50),
  processing_time_ms     INTEGER,

  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qh_lead_id ON qualification_history(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qh_qual_id ON qualification_history(qualification_id);
CREATE INDEX IF NOT EXISTS idx_qh_trigger ON qualification_history(trigger_event);
CREATE INDEX IF NOT EXISTS idx_qh_created ON qualification_history(created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_lq_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lq_updated_at ON lead_qualification;
CREATE TRIGGER trg_lq_updated_at
  BEFORE UPDATE ON lead_qualification
  FOR EACH ROW EXECUTE FUNCTION update_lq_updated_at();
