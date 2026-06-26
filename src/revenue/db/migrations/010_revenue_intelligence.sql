-- Phase 11: Revenue Intelligence & Forecasting
-- Migration: 010_revenue_intelligence.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Revenue Forecasts Table
CREATE TABLE IF NOT EXISTS revenue_forecasts (
  forecast_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_type VARCHAR(50) NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  expected_onboardings INTEGER DEFAULT 0,
  expected_revenue NUMERIC(15,2) DEFAULT 0,
  confidence NUMERIC(5,2) DEFAULT 0,
  pipeline_value NUMERIC(15,2) DEFAULT 0,
  revenue_at_risk NUMERIC(15,2) DEFAULT 0,
  weighted_pipeline NUMERIC(15,2) DEFAULT 0,
  avg_deal_value NUMERIC(15,2) DEFAULT 0,
  avg_sales_cycle_days INTEGER DEFAULT 0,
  target_progress NUMERIC(5,2) DEFAULT 0,
  forecast_variance NUMERIC(5,2) DEFAULT 0,
  factors JSONB DEFAULT '{}',
  assumptions JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]',
  opportunities JSONB DEFAULT '[]',
  status VARCHAR(30) DEFAULT 'active',
  model_version VARCHAR(20) DEFAULT '1.0',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Forecast Scenarios Table
CREATE TABLE IF NOT EXISTS forecast_scenarios (
  scenario_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID REFERENCES revenue_forecasts(forecast_id) ON DELETE CASCADE,
  scenario_type VARCHAR(30) NOT NULL,
  expected_revenue NUMERIC(15,2) DEFAULT 0,
  expected_onboardings INTEGER DEFAULT 0,
  assumptions JSONB DEFAULT '[]',
  confidence NUMERIC(5,2) DEFAULT 0,
  primary_risks JSONB DEFAULT '[]',
  primary_opportunities JSONB DEFAULT '[]',
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Forecast History / Evaluation Table
CREATE TABLE IF NOT EXISTS forecast_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID REFERENCES revenue_forecasts(forecast_id) ON DELETE SET NULL,
  forecast_type VARCHAR(50),
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  prediction JSONB NOT NULL,
  actual_result JSONB DEFAULT '{}',
  variance NUMERIC(10,4) DEFAULT 0,
  accuracy NUMERIC(5,2) DEFAULT 0,
  confidence_calibration NUMERIC(5,2) DEFAULT 0,
  evaluation_notes TEXT,
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Forecast Events Log Table
CREATE TABLE IF NOT EXISTS forecast_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID,
  event_type VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}',
  processing_time_ms INTEGER DEFAULT 0,
  model_version VARCHAR(20),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_type ON revenue_forecasts(forecast_type);
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_period ON revenue_forecasts(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_status ON revenue_forecasts(status);
CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_created ON revenue_forecasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_scenarios_forecast ON forecast_scenarios(forecast_id);
CREATE INDEX IF NOT EXISTS idx_forecast_scenarios_type ON forecast_scenarios(scenario_type);
CREATE INDEX IF NOT EXISTS idx_forecast_history_forecast ON forecast_history(forecast_id);
CREATE INDEX IF NOT EXISTS idx_forecast_history_evaluated ON forecast_history(evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_events_forecast ON forecast_events(forecast_id);
CREATE INDEX IF NOT EXISTS idx_forecast_events_type ON forecast_events(event_type);
CREATE INDEX IF NOT EXISTS idx_forecast_events_created ON forecast_events(created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_revenue_forecast_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revenue_forecasts_updated ON revenue_forecasts;
CREATE TRIGGER trg_revenue_forecasts_updated
  BEFORE UPDATE ON revenue_forecasts
  FOR EACH ROW EXECUTE FUNCTION update_revenue_forecast_timestamp();

-- Seed forecast types reference
DO $$
BEGIN
  RAISE NOTICE 'Revenue Intelligence migration 010 complete.';
END $$;
