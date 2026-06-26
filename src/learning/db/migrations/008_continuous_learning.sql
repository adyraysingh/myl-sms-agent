-- Phase 9: Continuous Learning Engine Migration

-- learning_events: every AI prediction compared with actual outcome
CREATE TABLE IF NOT EXISTS learning_events (
  learning_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(100),
  source_module VARCHAR(50) NOT NULL,
  prediction_type VARCHAR(100) NOT NULL,
  prediction_value JSONB NOT NULL DEFAULT '{}',
  actual_value JSONB,
  accuracy_score NUMERIC(5,4),
  is_correct BOOLEAN,
  outcome_recorded BOOLEAN DEFAULT FALSE,
  trigger_event VARCHAR(100),
  evaluation_notes TEXT,
  model_version VARCHAR(20) DEFAULT 'gpt-4o',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  outcome_recorded_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ
);

-- model_performance: historical accuracy per module per period
CREATE TABLE IF NOT EXISTS model_performance (
  performance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(20) DEFAULT 'gpt-4o',
  evaluation_period VARCHAR(20) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  accuracy NUMERIC(5,4) DEFAULT 0,
  precision_score NUMERIC(5,4) DEFAULT 0,
  recall NUMERIC(5,4) DEFAULT 0,
  false_positive_rate NUMERIC(5,4) DEFAULT 0,
  false_negative_rate NUMERIC(5,4) DEFAULT 0,
  confidence_calibration NUMERIC(5,4) DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  last_evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- optimization_suggestions: AI-generated improvement recommendations
CREATE TABLE IF NOT EXISTS optimization_suggestions (
  suggestion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_module VARCHAR(50) NOT NULL,
  finding TEXT NOT NULL,
  recommended_change TEXT NOT NULL,
  expected_impact TEXT,
  confidence NUMERIC(5,2) DEFAULT 0,
  priority VARCHAR(20) DEFAULT 'medium',
  status VARCHAR(20) DEFAULT 'open',
  supporting_evidence JSONB DEFAULT '[]',
  metrics_before JSONB DEFAULT '{}',
  metrics_after JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);

-- learning_trends: discovered patterns that predict success
CREATE TABLE IF NOT EXISTS learning_trends (
  trend_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_category VARCHAR(50) NOT NULL,
  trend_name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  metric VARCHAR(100),
  metric_value NUMERIC(10,4),
  direction VARCHAR(20) DEFAULT 'stable',
  supporting_data JSONB DEFAULT '{}',
  sample_size INTEGER DEFAULT 0,
  confidence NUMERIC(5,2) DEFAULT 0,
  business_impact VARCHAR(20) DEFAULT 'medium',
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- learning_snapshots: periodic accuracy snapshots for historical tracking
CREATE TABLE IF NOT EXISTS learning_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  overall_accuracy NUMERIC(5,4) DEFAULT 0,
  qualification_accuracy NUMERIC(5,4) DEFAULT 0,
  decision_accuracy NUMERIC(5,4) DEFAULT 0,
  investigation_accuracy NUMERIC(5,4) DEFAULT 0,
  conversation_accuracy NUMERIC(5,4) DEFAULT 0,
  coaching_effectiveness NUMERIC(5,4) DEFAULT 0,
  total_predictions INTEGER DEFAULT 0,
  total_evaluated INTEGER DEFAULT 0,
  optimization_count INTEGER DEFAULT 0,
  trend_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_learning_events_lead ON learning_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_module ON learning_events(source_module);
CREATE INDEX IF NOT EXISTS idx_learning_events_type ON learning_events(prediction_type);
CREATE INDEX IF NOT EXISTS idx_learning_events_correct ON learning_events(is_correct);
CREATE INDEX IF NOT EXISTS idx_learning_events_created ON learning_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_outcome ON learning_events(outcome_recorded);
CREATE INDEX IF NOT EXISTS idx_model_performance_name ON model_performance(model_name);
CREATE INDEX IF NOT EXISTS idx_model_performance_period ON model_performance(evaluation_period);
CREATE INDEX IF NOT EXISTS idx_model_performance_evaluated ON model_performance(last_evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_status ON optimization_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_optimization_module ON optimization_suggestions(source_module);
CREATE INDEX IF NOT EXISTS idx_optimization_priority ON optimization_suggestions(priority);
CREATE INDEX IF NOT EXISTS idx_learning_trends_category ON learning_trends(trend_category);
CREATE INDEX IF NOT EXISTS idx_learning_trends_active ON learning_trends(is_active);
CREATE INDEX IF NOT EXISTS idx_learning_snapshots_date ON learning_snapshots(snapshot_date DESC);

-- Trigger for learning_trends updated_at
CREATE OR REPLACE FUNCTION update_learning_trends_updated_at()
RETURNS TRIGGER AS $func$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_learning_trends_updated_at ON learning_trends;
CREATE TRIGGER trg_learning_trends_updated_at
BEFORE UPDATE ON learning_trends
FOR EACH ROW EXECUTE FUNCTION update_learning_trends_updated_at();
