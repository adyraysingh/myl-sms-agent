-- Phase 7: AI Investigation Engine Migration
-- investigations table
CREATE TABLE IF NOT EXISTS investigations (
  investigation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  lead_id VARCHAR(100),
  salesperson_id VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  confidence NUMERIC(5,2) DEFAULT 0,
  summary TEXT,
  root_cause JSONB DEFAULT '[]',
  recommendation JSONB DEFAULT '[]',
  business_impact TEXT,
  evidence_count INTEGER DEFAULT 0,
  finding_count INTEGER DEFAULT 0,
  processing_time_ms INTEGER,
  model_version VARCHAR(20) DEFAULT 'gpt-4o',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- investigation_evidence table
CREATE TABLE IF NOT EXISTS investigation_evidence (
  evidence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id UUID NOT NULL REFERENCES investigations(investigation_id) ON DELETE CASCADE,
  source_module VARCHAR(50) NOT NULL,
  source_record VARCHAR(200),
  evidence_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  confidence NUMERIC(5,2) DEFAULT 0,
  weight NUMERIC(5,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- investigation_findings table
CREATE TABLE IF NOT EXISTS investigation_findings (
  finding_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id UUID NOT NULL REFERENCES investigations(investigation_id) ON DELETE CASCADE,
  finding TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  impact TEXT,
  recommendation TEXT,
  evidence_ids JSONB DEFAULT '[]',
  confidence NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- investigation_patterns table
CREATE TABLE IF NOT EXISTS investigation_patterns (
  pattern_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  supporting_data JSONB DEFAULT '{}',
  sample_size INTEGER DEFAULT 0,
  confidence NUMERIC(5,2) DEFAULT 0,
  impact_score NUMERIC(5,2) DEFAULT 0,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- investigation_anomalies table
CREATE TABLE IF NOT EXISTS investigation_anomalies (
  anomaly_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metric VARCHAR(100) NOT NULL,
  baseline_value NUMERIC(10,4),
  current_value NUMERIC(10,4),
  deviation_percent NUMERIC(10,4),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  investigation_id UUID REFERENCES investigations(investigation_id),
  is_resolved BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_investigations_type ON investigations(investigation_type);
CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);
CREATE INDEX IF NOT EXISTS idx_investigations_lead ON investigations(lead_id);
CREATE INDEX IF NOT EXISTS idx_investigations_salesperson ON investigations(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_investigations_created ON investigations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_evidence_inv ON investigation_evidence(investigation_id);
CREATE INDEX IF NOT EXISTS idx_inv_findings_inv ON investigation_findings(investigation_id);
CREATE INDEX IF NOT EXISTS idx_inv_patterns_type ON investigation_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_inv_anomalies_type ON investigation_anomalies(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_inv_anomalies_severity ON investigation_anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_inv_anomalies_resolved ON investigation_anomalies(is_resolved);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_investigations_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_investigations_updated_at ON investigations;
CREATE TRIGGER trg_investigations_updated_at
  BEFORE UPDATE ON investigations
  FOR EACH ROW EXECUTE FUNCTION update_investigations_updated_at();

DROP TRIGGER IF EXISTS trg_inv_patterns_updated_at ON investigation_patterns;
CREATE TRIGGER trg_inv_patterns_updated_at
  BEFORE UPDATE ON investigation_patterns
  FOR EACH ROW EXECUTE FUNCTION update_investigations_updated_at();
