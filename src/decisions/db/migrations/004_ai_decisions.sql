-- Phase 5: AI Decision Engine
-- Migration: 004_ai_decisions.sql

-- AI Decisions Table
CREATE TABLE IF NOT EXISTS ai_decisions (
  decision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(255) NOT NULL,
  decision_type VARCHAR(100) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  reason TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  expected_business_impact TEXT,
  expected_onboarding_probability_change DECIMAL(5,2),
  recommended_execution_time TIMESTAMPTZ,
  recommended_owner VARCHAR(255),
  crm_owner VARCHAR(255),
  confidence_score DECIMAL(5,2) DEFAULT 0,
  required_information JSONB DEFAULT '[]',
  status VARCHAR(30) NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','acknowledged','executing','completed','dismissed','expired')),
  trigger_event VARCHAR(100),
  trigger_source VARCHAR(100),
  model_version VARCHAR(50) DEFAULT 'gpt-4o',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  execution_result TEXT,
  dismissed_reason TEXT
);

-- Decision History Table (lifecycle state changes)
CREATE TABLE IF NOT EXISTS decision_history (
  history_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES ai_decisions(decision_id) ON DELETE CASCADE,
  lead_id VARCHAR(255) NOT NULL,
  previous_status VARCHAR(30),
  new_status VARCHAR(30) NOT NULL,
  previous_priority VARCHAR(20),
  new_priority VARCHAR(20),
  change_reason TEXT,
  changed_by VARCHAR(100) DEFAULT 'system',
  trigger_event VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decision Generation Queue
CREATE TABLE IF NOT EXISTS decision_queue (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(255) NOT NULL,
  trigger_event VARCHAR(100) NOT NULL,
  trigger_source VARCHAR(100),
  trigger_data JSONB DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  priority VARCHAR(20) DEFAULT 'medium',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Zoho Decision Sync Log
CREATE TABLE IF NOT EXISTS zoho_decision_sync_log (
  sync_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(255) NOT NULL,
  decision_id UUID REFERENCES ai_decisions(decision_id),
  fields_updated JSONB DEFAULT '{}',
  sync_status VARCHAR(20) DEFAULT 'success',
  error_message TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_decisions_lead_id ON ai_decisions(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_status ON ai_decisions(status);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_priority ON ai_decisions(priority);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_created_at ON ai_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_lead_status ON ai_decisions(lead_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_lead_priority ON ai_decisions(lead_id, priority);
CREATE INDEX IF NOT EXISTS idx_decision_history_decision_id ON decision_history(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_history_lead_id ON decision_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_decision_queue_status ON decision_queue(status);
CREATE INDEX IF NOT EXISTS idx_decision_queue_lead_id ON decision_queue(lead_id);
CREATE INDEX IF NOT EXISTS idx_zoho_decision_sync_lead_id ON zoho_decision_sync_log(lead_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_decision_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ai_decisions_updated_at ON ai_decisions;
CREATE TRIGGER trigger_ai_decisions_updated_at
  BEFORE UPDATE ON ai_decisions
  FOR EACH ROW EXECUTE FUNCTION update_decision_updated_at();

-- Comments
COMMENT ON TABLE ai_decisions IS 'Phase 5: AI-generated next best action decisions per lead';
COMMENT ON TABLE decision_history IS 'Phase 5: Lifecycle state change history for every decision';
COMMENT ON TABLE decision_queue IS 'Phase 5: Async queue for decision generation tasks';
COMMENT ON TABLE zoho_decision_sync_log IS 'Phase 5: Audit log for Zoho CRM AI field updates';
