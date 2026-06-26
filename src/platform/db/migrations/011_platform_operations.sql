-- Phase 12: AI Platform Operations
-- Migration: 011_platform_operations.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Module Health Registry
CREATE TABLE IF NOT EXISTS platform_module_health (
  health_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name VARCHAR(100) NOT NULL,
  module_version VARCHAR(30) DEFAULT '1.0',
  status VARCHAR(30) DEFAULT 'healthy',
  uptime_seconds BIGINT DEFAULT 0,
  avg_response_ms NUMERIC(10,2) DEFAULT 0,
  requests_processed BIGINT DEFAULT 0,
  error_count BIGINT DEFAULT 0,
  retry_count BIGINT DEFAULT 0,
  queue_length INTEGER DEFAULT 0,
  last_activity TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB DEFAULT '{}',
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Queue Monitor
CREATE TABLE IF NOT EXISTS platform_queue_status (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(30) DEFAULT 'running',
  pending_jobs INTEGER DEFAULT 0,
  running_jobs INTEGER DEFAULT 0,
  completed_jobs BIGINT DEFAULT 0,
  failed_jobs BIGINT DEFAULT 0,
  retry_count BIGINT DEFAULT 0,
  oldest_pending_job TIMESTAMPTZ,
  avg_processing_ms NUMERIC(10,2) DEFAULT 0,
  worker_count INTEGER DEFAULT 1,
  worker_status VARCHAR(30) DEFAULT 'active',
  last_processed TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Integration Health
CREATE TABLE IF NOT EXISTS platform_integration_health (
  integration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_name VARCHAR(100) NOT NULL UNIQUE,
  integration_type VARCHAR(50),
  status VARCHAR(30) DEFAULT 'healthy',
  latency_ms NUMERIC(10,2) DEFAULT 0,
  last_successful_sync TIMESTAMPTZ,
  failure_count BIGINT DEFAULT 0,
  retry_status VARCHAR(30) DEFAULT 'none',
  auth_status VARCHAR(30) DEFAULT 'authenticated',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Model Registry
CREATE TABLE IF NOT EXISTS platform_model_registry (
  model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  provider VARCHAR(50) DEFAULT 'openai',
  modules_using JSONB DEFAULT '[]',
  deployment_date TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(30) DEFAULT 'active',
  avg_cost_per_call NUMERIC(10,6) DEFAULT 0,
  avg_latency_ms NUMERIC(10,2) DEFAULT 0,
  success_rate NUMERIC(5,2) DEFAULT 100,
  total_calls BIGINT DEFAULT 0,
  total_cost NUMERIC(15,6) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_name, model_version)
);

-- Prompt Registry
CREATE TABLE IF NOT EXISTS platform_prompt_registry (
  prompt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_name VARCHAR(200) NOT NULL,
  prompt_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  owner VARCHAR(100),
  modules_using JSONB DEFAULT '[]',
  status VARCHAR(30) DEFAULT 'active',
  content_hash VARCHAR(64),
  token_estimate INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(prompt_name, prompt_version)
);

-- Prompt Rollback History
CREATE TABLE IF NOT EXISTS platform_prompt_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES platform_prompt_registry(prompt_id) ON DELETE CASCADE,
  prompt_name VARCHAR(200),
  previous_version VARCHAR(20),
  new_version VARCHAR(20),
  changed_by VARCHAR(100),
  change_reason TEXT,
  rolled_back BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Intelligence
CREATE TABLE IF NOT EXISTS platform_cost_events (
  cost_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name VARCHAR(100) NOT NULL,
  operation_type VARCHAR(100),
  model_used VARCHAR(100),
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd NUMERIC(12,8) DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  lead_id UUID,
  session_id UUID,
  success BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cost Aggregates (daily snapshots)
CREATE TABLE IF NOT EXISTS platform_cost_daily (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL UNIQUE,
  total_cost_usd NUMERIC(12,6) DEFAULT 0,
  cost_by_module JSONB DEFAULT '{}',
  cost_by_operation JSONB DEFAULT '{}',
  total_calls BIGINT DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  avg_cost_per_call NUMERIC(12,8) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Error Monitor
CREATE TABLE IF NOT EXISTS platform_errors (
  error_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name VARCHAR(100) NOT NULL,
  error_type VARCHAR(100),
  severity VARCHAR(20) DEFAULT 'medium',
  message TEXT,
  stack_trace TEXT,
  context JSONB DEFAULT '{}',
  resolution_status VARCHAR(30) DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  retry_count INTEGER DEFAULT 0,
  escalated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuration Management
CREATE TABLE IF NOT EXISTS platform_config (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR(200) NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  config_type VARCHAR(50) DEFAULT 'operational',
  description TEXT,
  default_value JSONB,
  editable_by VARCHAR(50) DEFAULT 'admin',
  last_modified_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Center
CREATE TABLE IF NOT EXISTS platform_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(200) NOT NULL,
  performed_by VARCHAR(100),
  role VARCHAR(50),
  module_affected VARCHAR(100),
  before_state JSONB DEFAULT '{}',
  after_state JSONB DEFAULT '{}',
  ip_address VARCHAR(50),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deployment History
CREATE TABLE IF NOT EXISTS platform_deployments (
  deploy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL,
  commit_hash VARCHAR(100),
  deployed_by VARCHAR(100),
  environment VARCHAR(30) DEFAULT 'production',
  status VARCHAR(30) DEFAULT 'successful',
  phases_included JSONB DEFAULT '[]',
  migration_applied BOOLEAN DEFAULT FALSE,
  rollback_available BOOLEAN DEFAULT FALSE,
  notes TEXT,
  deployed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Snapshots
CREATE TABLE IF NOT EXISTS platform_performance (
  perf_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpu_percent NUMERIC(5,2) DEFAULT 0,
  memory_mb NUMERIC(10,2) DEFAULT 0,
  memory_percent NUMERIC(5,2) DEFAULT 0,
  db_connections_active INTEGER DEFAULT 0,
  db_connections_idle INTEGER DEFAULT 0,
  api_latency_avg_ms NUMERIC(10,2) DEFAULT 0,
  queue_latency_avg_ms NUMERIC(10,2) DEFAULT 0,
  webhook_throughput_per_min NUMERIC(10,2) DEFAULT 0,
  active_sessions INTEGER DEFAULT 0,
  uptime_seconds BIGINT DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backup & Recovery Status
CREATE TABLE IF NOT EXISTS platform_backup_status (
  backup_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type VARCHAR(50) DEFAULT 'database',
  status VARCHAR(30) DEFAULT 'unknown',
  last_successful_backup TIMESTAMPTZ,
  backup_size_mb NUMERIC(12,2) DEFAULT 0,
  recovery_test_status VARCHAR(30) DEFAULT 'not_tested',
  schema_version VARCHAR(20),
  platform_version VARCHAR(20),
  migration_history JSONB DEFAULT '[]',
  notes TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_module_health_name ON platform_module_health(module_name);
CREATE INDEX IF NOT EXISTS idx_module_health_checked ON platform_module_health(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_module_health_status ON platform_module_health(status);
CREATE INDEX IF NOT EXISTS idx_integration_name ON platform_integration_health(integration_name);
CREATE INDEX IF NOT EXISTS idx_model_registry_status ON platform_model_registry(status);
CREATE INDEX IF NOT EXISTS idx_prompt_registry_name ON platform_prompt_registry(prompt_name);
CREATE INDEX IF NOT EXISTS idx_cost_events_module ON platform_cost_events(module_name);
CREATE INDEX IF NOT EXISTS idx_cost_events_created ON platform_cost_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_daily_date ON platform_cost_daily(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_platform_errors_module ON platform_errors(module_name);
CREATE INDEX IF NOT EXISTS idx_platform_errors_severity ON platform_errors(severity);
CREATE INDEX IF NOT EXISTS idx_platform_errors_status ON platform_errors(resolution_status);
CREATE INDEX IF NOT EXISTS idx_platform_errors_created ON platform_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_config_key ON platform_config(config_key);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit(action);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_perf_recorded ON platform_performance(recorded_at DESC);

-- Seed default configuration
INSERT INTO platform_config (config_key, config_value, config_type, description, default_value, editable_by) VALUES
  ('qualification.hot_threshold', '70', 'threshold', 'Minimum onboarding score for Hot category', '70', 'admin'),
  ('qualification.warm_threshold', '40', 'threshold', 'Minimum onboarding score for Warm category', '40', 'admin'),
  ('decision.critical_priority_threshold', '90', 'threshold', 'Score threshold for Critical priority decisions', '90', 'admin'),
  ('sla.first_response_hours', '2', 'sla', 'First response SLA in hours', '2', 'admin'),
  ('sla.followup_hours', '24', 'sla', 'Follow-up SLA in hours', '24', 'admin'),
  ('sla.decision_execution_hours', '4', 'sla', 'Decision execution SLA in hours', '4', 'admin'),
  ('sla.task_completion_hours', '48', 'sla', 'Task completion SLA in hours', '48', 'admin'),
  ('retry.max_attempts', '3', 'retry', 'Maximum retry attempts for failed operations', '3', 'admin'),
  ('retry.backoff_seconds', '30', 'retry', 'Backoff seconds between retries', '30', 'admin'),
  ('escalation.wait_minutes', '60', 'escalation', 'Wait minutes before escalating to sales manager', '60', 'admin'),
  ('slack.critical_channel', '"#ai-alerts"', 'integration', 'Slack channel for critical alerts', '"#ai-alerts"', 'admin'),
  ('slack.notifications_enabled', 'true', 'feature_flag', 'Enable Slack notifications', 'true', 'admin'),
  ('ai.copilot_enabled', 'true', 'feature_flag', 'Enable CEO Copilot', 'true', 'admin'),
  ('ai.auto_qualify_enabled', 'true', 'feature_flag', 'Enable automatic lead qualification', 'true', 'admin'),
  ('ai.auto_decision_enabled', 'true', 'feature_flag', 'Enable automatic decision generation', 'true', 'admin'),
  ('ai.learning_enabled', 'true', 'feature_flag', 'Enable continuous learning', 'true', 'admin'),
  ('ai.forecasting_enabled', 'true', 'feature_flag', 'Enable revenue forecasting', 'true', 'admin'),
  ('rate_limit.api_per_minute', '100', 'rate_limit', 'API requests per minute per IP', '100', 'admin'),
  ('rate_limit.webhooks_per_minute', '500', 'rate_limit', 'Webhook events per minute', '500', 'admin'),
  ('platform.version', '"1.0.0"', 'system', 'Current platform version', '"1.0.0"', 'system')
ON CONFLICT (config_key) DO NOTHING;

-- Seed AI model registry
INSERT INTO platform_model_registry (model_name, model_version, provider, modules_using, status, notes) VALUES
  ('gpt-4o', '2024-08-06', 'openai', '["conversation","qualification","decisions","investigations","copilot","learning","executive","forecasting"]', 'active', 'Primary model for all AI analysis'),
  ('gpt-4o-mini', '2024-07-18', 'openai', '[]', 'available', 'Lower cost alternative for simple tasks')
ON CONFLICT (model_name, model_version) DO NOTHING;

-- Seed prompt registry
INSERT INTO platform_prompt_registry (prompt_name, prompt_version, owner, modules_using, status, notes) VALUES
  ('conversation_analysis', '1.0', 'AI Team', '["conversation"]', 'active', 'Extracts structured intelligence from customer conversations'),
  ('onboarding_qualification', '1.0', 'AI Team', '["qualification"]', 'active', 'Scores and categorizes leads by onboarding probability'),
  ('ai_decision_engine', '1.0', 'AI Team', '["decisions"]', 'active', 'Determines best next action for each lead'),
  ('executive_briefing', '1.0', 'AI Team', '["executive","sales"]', 'active', 'Generates morning/evening/weekly executive briefings'),
  ('investigation_engine', '1.0', 'AI Team', '["investigations"]', 'active', 'Root cause analysis and pattern discovery'),
  ('ceo_copilot', '1.0', 'AI Team', '["copilot"]', 'active', 'Executive AI chat with intent detection and evidence routing'),
  ('revenue_forecaster', '1.0', 'AI Team', '["forecasting"]', 'active', 'Evidence-based revenue and onboarding forecasts'),
  ('learning_evaluator', '1.0', 'AI Team', '["learning"]', 'active', 'Accuracy measurement and optimization suggestions')
ON CONFLICT (prompt_name, prompt_version) DO NOTHING;

-- Seed queue status
INSERT INTO platform_queue_status (queue_name, status, worker_status) VALUES
  ('conversation_analysis', 'running', 'active'),
  ('lead_qualification', 'running', 'active'),
  ('decision_processing', 'running', 'active'),
  ('workflow_execution', 'running', 'active'),
  ('forecast_generation', 'running', 'active'),
  ('learning_evaluation', 'running', 'active'),
  ('slack_notifications', 'running', 'active'),
  ('crm_sync', 'running', 'active')
ON CONFLICT (queue_name) DO NOTHING;

-- Seed integration health
INSERT INTO platform_integration_health (integration_name, integration_type, status, auth_status) VALUES
  ('zoho_crm', 'crm', 'healthy', 'authenticated'),
  ('zoho_salesiq', 'chat', 'healthy', 'authenticated'),
  ('retell_ai', 'voice', 'healthy', 'authenticated'),
  ('slack', 'messaging', 'healthy', 'authenticated'),
  ('openai', 'ai_provider', 'healthy', 'authenticated'),
  ('postgresql', 'database', 'healthy', 'connected'),
  ('email', 'email', 'unknown', 'unknown')
ON CONFLICT (integration_name) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'Platform Operations migration 011 complete.';
END $$;
