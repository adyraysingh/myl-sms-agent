-- Phase 6: Sales Intelligence & Executive Intelligence
-- Migration: 005_sales_intelligence.sql

-- Sales performance per executive per day
CREATE TABLE IF NOT EXISTS sales_performance (
  performance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  owner_email VARCHAR(255),
  period_date DATE NOT NULL DEFAULT CURRENT_DATE,
  period_type VARCHAR(50) DEFAULT 'daily',
  -- Activity metrics
  calls_completed INTEGER DEFAULT 0,
  chats_handled INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  emails_replied INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  follow_ups_completed INTEGER DEFAULT 0,
  follow_ups_missed INTEGER DEFAULT 0,
  -- Time metrics (minutes)
  avg_response_time_minutes NUMERIC(10,2),
  avg_first_contact_time_minutes NUMERIC(10,2),
  avg_followup_delay_minutes NUMERIC(10,2),
  avg_decision_execution_time_minutes NUMERIC(10,2),
  -- Quality metrics (0-100)
  follow_up_completion_rate NUMERIC(5,2),
  onboarding_rate NUMERIC(5,2),
  lead_conversion_rate NUMERIC(5,2),
  qualification_accuracy NUMERIC(5,2),
  avg_trust_score NUMERIC(5,2),
  avg_sentiment NUMERIC(5,2),
  activity_score NUMERIC(5,2),
  productivity_score NUMERIC(5,2),
  -- Totals
  total_leads_assigned INTEGER DEFAULT 0,
  hot_leads_assigned INTEGER DEFAULT 0,
  warm_leads_assigned INTEGER DEFAULT 0,
  leads_onboarded INTEGER DEFAULT 0,
  leads_lost INTEGER DEFAULT 0,
  -- Trend
  performance_trend VARCHAR(50), -- improving, declining, stable
  trend_explanation TEXT,
  -- AI analysis
  strengths JSONB DEFAULT '[]',
  weaknesses JSONB DEFAULT '[]',
  coaching_flags JSONB DEFAULT '[]',
  performance_explanation TEXT,
  -- Meta
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, period_date, period_type)
);

-- Sales coaching suggestions
CREATE TABLE IF NOT EXISTS sales_coaching (
  coaching_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id VARCHAR(255) NOT NULL,
  owner_name VARCHAR(255),
  coaching_type VARCHAR(100) NOT NULL,
  -- Types: missed_followup, slow_response, poor_communication,
  --        low_trust, repeated_objections, poor_qualification, poor_decision_execution
  priority VARCHAR(50) DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  suggested_action TEXT,
  expected_improvement TEXT,
  related_lead_ids JSONB DEFAULT '[]',
  status VARCHAR(50) DEFAULT 'active',
  -- active, acknowledged, resolved, dismissed
  confidence_score NUMERIC(5,2),
  model_version VARCHAR(50) DEFAULT 'gpt-4o',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Business investigations
CREATE TABLE IF NOT EXISTS business_investigations (
  investigation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  investigation_type VARCHAR(100),
  -- Types: onboarding_drop, conversion_issue, objection_spike,
  --        product_performance, executive_performance, qualification_gap, followup_dropoff
  trigger_event VARCHAR(255),
  -- Data sources used
  data_sources JSONB DEFAULT '[]',
  evidence JSONB DEFAULT '[]',
  -- Findings
  root_cause TEXT,
  conclusion TEXT NOT NULL,
  recommendations JSONB DEFAULT '[]',
  affected_leads JSONB DEFAULT '[]',
  affected_owners JSONB DEFAULT '[]',
  -- Metrics
  confidence_score NUMERIC(5,2),
  severity VARCHAR(50) DEFAULT 'medium',
  -- critical, high, medium, low
  business_impact TEXT,
  -- Status
  status VARCHAR(50) DEFAULT 'completed',
  processing_time_ms INTEGER,
  model_version VARCHAR(50) DEFAULT 'gpt-4o',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Executive briefings
CREATE TABLE IF NOT EXISTS executive_briefings (
  briefing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_type VARCHAR(100) NOT NULL,
  -- Types: morning, midday, end_of_day, weekly, monthly
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  -- Business health (0-100)
  business_health_score NUMERIC(5,2),
  sales_health_score NUMERIC(5,2),
  followup_health_score NUMERIC(5,2),
  conversation_health_score NUMERIC(5,2),
  qualification_health_score NUMERIC(5,2),
  decision_execution_health_score NUMERIC(5,2),
  overall_health_score NUMERIC(5,2),
  -- Summary sections (structured JSON)
  business_summary JSONB DEFAULT '{}',
  onboarding_performance JSONB DEFAULT '{}',
  sales_performance JSONB DEFAULT '{}',
  current_risks JSONB DEFAULT '[]',
  current_opportunities JSONB DEFAULT '[]',
  top_priorities JSONB DEFAULT '[]',
  recommended_actions JSONB DEFAULT '[]',
  expected_business_impact TEXT,
  -- Counts
  total_leads INTEGER DEFAULT 0,
  hot_leads INTEGER DEFAULT 0,
  warm_leads INTEGER DEFAULT 0,
  leads_onboarded_period INTEGER DEFAULT 0,
  leads_lost_period INTEGER DEFAULT 0,
  active_investigations INTEGER DEFAULT 0,
  critical_decisions_pending INTEGER DEFAULT 0,
  -- Raw narrative
  narrative TEXT,
  -- Meta
  model_version VARCHAR(50) DEFAULT 'gpt-4o',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(briefing_type, period_start)
);

-- Sales trends (time series)
CREATE TABLE IF NOT EXISTS sales_trends (
  trend_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name VARCHAR(255) NOT NULL,
  metric_category VARCHAR(100),
  -- Categories: onboarding, conversion, activity, quality, objections, products
  period_date DATE NOT NULL,
  period_type VARCHAR(50) DEFAULT 'daily',
  metric_value NUMERIC(15,4),
  metric_unit VARCHAR(50),
  owner_id VARCHAR(255),
  -- null = company-wide
  segment VARCHAR(255),
  -- product type, lead category, etc.
  change_from_previous NUMERIC(15,4),
  change_pct NUMERIC(10,2),
  trend_direction VARCHAR(50),
  -- up, down, stable
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_name, period_date, period_type, owner_id, segment)
);

-- Intelligence processing queue
CREATE TABLE IF NOT EXISTS intelligence_queue (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type VARCHAR(100) NOT NULL,
  -- recalculate_performance, run_investigation, generate_briefing, calculate_trends
  priority INTEGER DEFAULT 5,
  payload JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sales_performance_owner ON sales_performance(owner_id);
CREATE INDEX IF NOT EXISTS idx_sales_performance_date ON sales_performance(period_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_performance_owner_date ON sales_performance(owner_id, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_coaching_owner ON sales_coaching(owner_id);
CREATE INDEX IF NOT EXISTS idx_sales_coaching_status ON sales_coaching(status);
CREATE INDEX IF NOT EXISTS idx_sales_coaching_priority ON sales_coaching(priority);
CREATE INDEX IF NOT EXISTS idx_investigations_type ON business_investigations(investigation_type);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON business_investigations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_severity ON business_investigations(severity);
CREATE INDEX IF NOT EXISTS idx_briefings_type ON executive_briefings(briefing_type);
CREATE INDEX IF NOT EXISTS idx_briefings_generated ON executive_briefings(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_trends_metric ON sales_trends(metric_name, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_trends_owner ON sales_trends(owner_id, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_intelligence_queue_status ON intelligence_queue(status, priority, scheduled_at);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_intelligence_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sales_performance_updated_at
  BEFORE UPDATE ON sales_performance
  FOR EACH ROW EXECUTE FUNCTION update_intelligence_updated_at();

CREATE TRIGGER trigger_sales_coaching_updated_at
  BEFORE UPDATE ON sales_coaching
  FOR EACH ROW EXECUTE FUNCTION update_intelligence_updated_at();

CREATE TRIGGER trigger_investigations_updated_at
  BEFORE UPDATE ON business_investigations
  FOR EACH ROW EXECUTE FUNCTION update_intelligence_updated_at();
