-- Phase 10: Autonomous Revenue Operations Migration

-- automation_workflows: one workflow per AI decision → operational task
CREATE TABLE IF NOT EXISTS automation_workflows (
  workflow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(100),
  decision_id VARCHAR(200),
  workflow_type VARCHAR(100) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  assigned_owner VARCHAR(200),
  trigger_event VARCHAR(100),
  trigger_data JSONB DEFAULT '{}',
  conditions JSONB DEFAULT '{}',
  actions JSONB DEFAULT '[]',
  execution_result JSONB DEFAULT '{}',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  idempotency_key VARCHAR(300) UNIQUE,
  sla_hours INTEGER DEFAULT 24,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- workflow_execution: every execution attempt for each workflow
CREATE TABLE IF NOT EXISTS workflow_execution (
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(workflow_id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  result JSONB DEFAULT '{}',
  processing_time_ms INTEGER,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

-- workflow_audit: immutable audit trail of every workflow event
CREATE TABLE IF NOT EXISTS workflow_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES automation_workflows(workflow_id) ON DELETE CASCADE,
  event VARCHAR(100) NOT NULL,
  performed_by VARCHAR(100) DEFAULT 'system',
  details JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- sla_monitor: SLA tracking per workflow
CREATE TABLE IF NOT EXISTS sla_monitor (
  sla_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(100),
  workflow_id UUID REFERENCES automation_workflows(workflow_id) ON DELETE CASCADE,
  sla_type VARCHAR(50) NOT NULL,
  required_completion_time TIMESTAMPTZ NOT NULL,
  actual_completion_time TIMESTAMPTZ,
  sla_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  escalated BOOLEAN DEFAULT FALSE,
  escalation_level INTEGER DEFAULT 0,
  escalated_at TIMESTAMPTZ,
  escalated_to VARCHAR(200),
  breach_duration_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflows_lead ON automation_workflows(lead_id);
CREATE INDEX IF NOT EXISTS idx_workflows_decision ON automation_workflows(decision_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON automation_workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_priority ON automation_workflows(priority);
CREATE INDEX IF NOT EXISTS idx_workflows_owner ON automation_workflows(assigned_owner);
CREATE INDEX IF NOT EXISTS idx_workflows_type ON automation_workflows(workflow_type);
CREATE INDEX IF NOT EXISTS idx_workflows_created ON automation_workflows(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_idem ON automation_workflows(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_execution_workflow ON workflow_execution(workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_status ON workflow_execution(status);
CREATE INDEX IF NOT EXISTS idx_audit_workflow ON workflow_audit(workflow_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON workflow_audit(event);
CREATE INDEX IF NOT EXISTS idx_sla_workflow ON sla_monitor(workflow_id);
CREATE INDEX IF NOT EXISTS idx_sla_lead ON sla_monitor(lead_id);
CREATE INDEX IF NOT EXISTS idx_sla_status ON sla_monitor(sla_status);
CREATE INDEX IF NOT EXISTS idx_sla_escalated ON sla_monitor(escalated);
CREATE INDEX IF NOT EXISTS idx_sla_required ON sla_monitor(required_completion_time);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_operations_updated_at()
RETURNS TRIGGER AS $func$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflows_updated_at ON automation_workflows;
CREATE TRIGGER trg_workflows_updated_at
BEFORE UPDATE ON automation_workflows
FOR EACH ROW EXECUTE FUNCTION update_operations_updated_at();

DROP TRIGGER IF EXISTS trg_sla_updated_at ON sla_monitor;
CREATE TRIGGER trg_sla_updated_at
BEFORE UPDATE ON sla_monitor
FOR EACH ROW EXECUTE FUNCTION update_operations_updated_at();
