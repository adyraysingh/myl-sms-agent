-- Phase 8: CEO AI Chat & Executive Copilot Migration

-- copilot_sessions: one session per chat conversation
CREATE TABLE IF NOT EXISTS copilot_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  user_role VARCHAR(50) NOT NULL DEFAULT 'ceo',
  title TEXT,
  context JSONB DEFAULT '{}',
  message_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

-- copilot_messages: every question and answer
CREATE TABLE IF NOT EXISTS copilot_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES copilot_sessions(session_id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  intent VARCHAR(100),
  modules_queried JSONB DEFAULT '[]',
  evidence_sources JSONB DEFAULT '[]',
  confidence NUMERIC(5,2) DEFAULT 0,
  response_time_ms INTEGER,
  citations JSONB DEFAULT '{}',
  suggested_actions JSONB DEFAULT '[]',
  related_leads JSONB DEFAULT '[]',
  related_investigations JSONB DEFAULT '[]',
  related_decisions JSONB DEFAULT '[]',
  model_version VARCHAR(20) DEFAULT 'gpt-4o',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- copilot_feedback: thumbs up/down + comments
CREATE TABLE IF NOT EXISTS copilot_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES copilot_messages(message_id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  rating INTEGER CHECK (rating IN (1,2,3,4,5)),
  helpful BOOLEAN,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- copilot_pinned: pinned investigations/questions for dashboard
CREATE TABLE IF NOT EXISTS copilot_pinned (
  pin_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  pin_type VARCHAR(50) NOT NULL,
  reference_id VARCHAR(200) NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_user ON copilot_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_active ON copilot_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_created ON copilot_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_messages_session ON copilot_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_copilot_messages_role ON copilot_messages(role);
CREATE INDEX IF NOT EXISTS idx_copilot_messages_intent ON copilot_messages(intent);
CREATE INDEX IF NOT EXISTS idx_copilot_messages_created ON copilot_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_feedback_message ON copilot_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_copilot_pinned_user ON copilot_pinned(user_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_copilot_sessions_updated_at()
RETURNS TRIGGER AS $func$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_copilot_sessions_updated_at ON copilot_sessions;
CREATE TRIGGER trg_copilot_sessions_updated_at
BEFORE UPDATE ON copilot_sessions
FOR EACH ROW EXECUTE FUNCTION update_copilot_sessions_updated_at();
