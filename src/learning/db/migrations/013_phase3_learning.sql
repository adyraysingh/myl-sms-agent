-- Phase 3: Learning Engine Repair & Model Accuracy Migration
-- Additive only. Never modifies existing tables. Never drops anything.

-- ─── 1. Prediction Registry ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_predictions (
  prediction_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module           VARCHAR(60)  NOT NULL,
  lead_id          VARCHAR(100),
  prediction_type  VARCHAR(100) NOT NULL,
  prediction       JSONB        NOT NULL DEFAULT '{}',
  confidence       NUMERIC(5,2) DEFAULT 0,
  evidence         JSONB        DEFAULT '{}',
  evaluation_status VARCHAR(20) DEFAULT 'pending',
  expires_at       TIMESTAMPTZ,
  evaluated_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── 2. Outcome Tracking ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_outcomes (
  outcome_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id  UUID REFERENCES ai_predictions(prediction_id) ON DELETE SET NULL,
  module         VARCHAR(60)  NOT NULL,
  lead_id        VARCHAR(100),
  outcome_type   VARCHAR(100) NOT NULL,
  outcome_value  JSONB        DEFAULT '{}',
  is_correct     BOOLEAN,
  accuracy_score NUMERIC(5,4),
  notes          TEXT,
  source         VARCHAR(60)  DEFAULT 'system',
  occurred_at    TIMESTAMPTZ  DEFAULT NOW(),
  created_at     TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── 3. Confidence Calibration ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS confidence_calibration (
  calibration_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module            VARCHAR(60)  NOT NULL,
  confidence_bucket VARCHAR(20)  NOT NULL,
  bucket_low        NUMERIC(5,2) NOT NULL,
  bucket_high       NUMERIC(5,2) NOT NULL,
  total_predictions INTEGER      DEFAULT 0,
  correct_predictions INTEGER    DEFAULT 0,
  actual_accuracy   NUMERIC(5,4) DEFAULT 0,
  calibration_error NUMERIC(5,4) DEFAULT 0,
  calibration_factor NUMERIC(5,4) DEFAULT 1,
  evaluated_at      TIMESTAMPTZ  DEFAULT NOW(),
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ
);

-- ─── 4. Prompt Performance Tracking ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_versions (
  version_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module          VARCHAR(60)   NOT NULL,
  prompt_name     VARCHAR(100)  NOT NULL,
  version_tag     VARCHAR(30)   NOT NULL DEFAULT '1.0',
  prompt_text     TEXT,
  total_calls     INTEGER       DEFAULT 0,
  successful_calls INTEGER      DEFAULT 0,
  failed_calls    INTEGER       DEFAULT 0,
  avg_accuracy    NUMERIC(5,4)  DEFAULT 0,
  avg_confidence  NUMERIC(5,2)  DEFAULT 0,
  avg_latency_ms  NUMERIC(10,2) DEFAULT 0,
  avg_token_cost  NUMERIC(10,4) DEFAULT 0,
  success_rate    NUMERIC(5,4)  DEFAULT 0,
  is_active       BOOLEAN       DEFAULT TRUE,
  promoted_at     TIMESTAMPTZ,
  deprecated_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- ─── 5. Recommendation Evaluation ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendation_outcomes (
  rec_outcome_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module            VARCHAR(60)  NOT NULL,
  lead_id           VARCHAR(100),
  prediction_id     UUID REFERENCES ai_predictions(prediction_id) ON DELETE SET NULL,
  recommendation_type VARCHAR(100) NOT NULL,
  recommendation    JSONB        DEFAULT '{}',
  outcome           VARCHAR(30)  NOT NULL DEFAULT 'pending',
  outcome_detail    TEXT,
  confidence        NUMERIC(5,2),
  was_effective     BOOLEAN,
  effectiveness_notes TEXT,
  actioned_at       TIMESTAMPTZ,
  evaluated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── 6. Revenue Forecast Evaluations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_forecast_evaluations (
  eval_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id          UUID,
  period_type          VARCHAR(20)   NOT NULL,
  period_start         TIMESTAMPTZ   NOT NULL,
  period_end           TIMESTAMPTZ   NOT NULL,
  predicted_revenue    NUMERIC(15,2) DEFAULT 0,
  actual_revenue       NUMERIC(15,2),
  predicted_onboardings INTEGER      DEFAULT 0,
  actual_onboardings   INTEGER,
  revenue_variance     NUMERIC(15,2),
  revenue_mape         NUMERIC(8,4),
  revenue_bias         NUMERIC(8,4),
  accuracy_pct         NUMERIC(5,2),
  calibration_trend    VARCHAR(20)   DEFAULT 'stable',
  rolling_mape_3       NUMERIC(8,4),
  notes                TEXT,
  evaluated_at         TIMESTAMPTZ   DEFAULT NOW(),
  created_at           TIMESTAMPTZ   DEFAULT NOW()
);

-- ─── 7. Copilot Quality Tracking ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_quality_snapshots (
  snapshot_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start      TIMESTAMPTZ  NOT NULL,
  period_end        TIMESTAMPTZ  NOT NULL,
  total_responses   INTEGER      DEFAULT 0,
  total_sessions    INTEGER      DEFAULT 0,
  thumbs_up         INTEGER      DEFAULT 0,
  thumbs_down       INTEGER      DEFAULT 0,
  issues_resolved   INTEGER      DEFAULT 0,
  follow_up_questions INTEGER    DEFAULT 0,
  avg_confidence    NUMERIC(5,2) DEFAULT 0,
  helpfulness_rate  NUMERIC(5,4) DEFAULT 0,
  resolution_rate   NUMERIC(5,4) DEFAULT 0,
  usefulness_score  NUMERIC(5,4) DEFAULT 0,
  top_intents       JSONB        DEFAULT '[]',
  low_confidence_pct NUMERIC(5,2) DEFAULT 0,
  created_at        TIMESTAMPTZ  DEFAULT NOW()
);

-- ─── 8. Learning Cycle Log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_cycle_log (
  cycle_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_type            VARCHAR(20)  NOT NULL,
  status                VARCHAR(20)  DEFAULT 'running',
  predictions_evaluated INTEGER      DEFAULT 0,
  outcomes_linked       INTEGER      DEFAULT 0,
  calibrations_updated  INTEGER      DEFAULT 0,
  suggestions_generated INTEGER      DEFAULT 0,
  drift_detected        BOOLEAN      DEFAULT FALSE,
  drift_details         JSONB        DEFAULT '{}',
  error_message         TEXT,
  started_at            TIMESTAMPTZ  DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  duration_ms           INTEGER
);

-- ─── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_predictions_module  ON ai_predictions(module);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_lead    ON ai_predictions(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_type    ON ai_predictions(prediction_type);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_status  ON ai_predictions(evaluation_status);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_created ON ai_predictions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_outcomes_prediction ON ai_outcomes(prediction_id);
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_module     ON ai_outcomes(module);
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_lead       ON ai_outcomes(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_type       ON ai_outcomes(outcome_type);
CREATE INDEX IF NOT EXISTS idx_ai_outcomes_correct    ON ai_outcomes(is_correct);

CREATE INDEX IF NOT EXISTS idx_conf_cal_module    ON confidence_calibration(module);
CREATE INDEX IF NOT EXISTS idx_conf_cal_evaluated ON confidence_calibration(evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_module ON prompt_versions(module);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_name   ON prompt_versions(prompt_name);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_active ON prompt_versions(is_active);

CREATE INDEX IF NOT EXISTS idx_rec_outcomes_module  ON recommendation_outcomes(module);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_lead    ON recommendation_outcomes(lead_id);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_outcome ON recommendation_outcomes(outcome);

CREATE INDEX IF NOT EXISTS idx_rfe_period ON revenue_forecast_evaluations(period_start DESC);
CREATE INDEX IF NOT EXISTS idx_rfe_type   ON revenue_forecast_evaluations(period_type);

CREATE INDEX IF NOT EXISTS idx_copilot_qs_period ON copilot_quality_snapshots(period_start DESC);

CREATE INDEX IF NOT EXISTS idx_learning_cycle_type    ON learning_cycle_log(cycle_type);
CREATE INDEX IF NOT EXISTS idx_learning_cycle_status  ON learning_cycle_log(status);
CREATE INDEX IF NOT EXISTS idx_learning_cycle_started ON learning_cycle_log(started_at DESC);

-- ─── Seed initial prompt versions ──────────────────────────────────────────
INSERT INTO prompt_versions (module, prompt_name, version_tag, total_calls, avg_accuracy, avg_confidence, is_active)
VALUES
  ('qualification_engine',    'lead_qualification_v1',    '1.0', 0, 0, 0, TRUE),
  ('decision_engine',         'decision_generation_v1',   '1.0', 0, 0, 0, TRUE),
  ('conversation_intelligence','conversation_analysis_v1','1.0', 0, 0, 0, TRUE),
  ('revenue_forecaster',      'revenue_forecast_v1',      '1.0', 0, 0, 0, TRUE),
  ('investigation_engine',    'root_cause_analysis_v1',   '1.0', 0, 0, 0, TRUE),
  ('ceo_copilot',             'executive_answer_v1',      '1.0', 0, 0, 0, TRUE)
ON CONFLICT DO NOTHING;
