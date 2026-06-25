-- src/memory/db/migrations/001_business_memory.sql
-- Phase 2: Business Memory Engine - PostgreSQL Schema
-- NOTE: Tables renamed to avoid conflicts with existing system tables
-- conversations -> bm_conversations, follow_ups -> bm_follow_ups
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS lead_memory (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
zoho_lead_id VARCHAR(255) NOT NULL UNIQUE,
email VARCHAR(255),
phone VARCHAR(50),
full_name VARCHAR(255),
company VARCHAR(255),
pipeline_stage VARCHAR(100),
lead_owner_id VARCHAR(255),
lead_owner_name VARCHAR(255),
is_onboarded BOOLEAN NOT NULL DEFAULT FALSE,
onboarded_at TIMESTAMPTZ,
call_count INTEGER NOT NULL DEFAULT 0,
email_count INTEGER NOT NULL DEFAULT 0,
chat_count INTEGER NOT NULL DEFAULT 0,
last_contacted_at TIMESTAMPTZ,
crm_data JSONB NOT NULL DEFAULT '{}',
synced_at TIMESTAMPTZ,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lm_zoho ON lead_memory(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_lm_email ON lead_memory(email);
CREATE INDEX IF NOT EXISTS idx_lm_phone ON lead_memory(phone);
CREATE INDEX IF NOT EXISTS idx_lm_owner ON lead_memory(lead_owner_id);
CREATE INDEX IF NOT EXISTS idx_lm_stage ON lead_memory(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_lm_updated ON lead_memory(updated_at DESC);

CREATE TABLE IF NOT EXISTS lead_events (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
event_type VARCHAR(100) NOT NULL,
source VARCHAR(50) NOT NULL,
source_id VARCHAR(500),
actor_type VARCHAR(50),
actor_id VARCHAR(255),
actor_name VARCHAR(255),
payload JSONB NOT NULL DEFAULT '{}',
metadata JSONB NOT NULL DEFAULT '{}',
summary TEXT,
channel VARCHAR(50),
occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_le_lead ON lead_events(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_le_zoho ON lead_events(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_le_type ON lead_events(event_type);
CREATE INDEX IF NOT EXISTS idx_le_source ON lead_events(source);
CREATE INDEX IF NOT EXISTS idx_le_occurred ON lead_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_le_source_id ON lead_events(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_le_zoho_occ ON lead_events(zoho_lead_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS bm_conversations (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
conversation_type VARCHAR(20) NOT NULL CHECK (conversation_type IN ('chat','call','email','sms')),
source VARCHAR(50),
source_id VARCHAR(500) UNIQUE,
status VARCHAR(20) NOT NULL DEFAULT 'active',
sales_executive_id VARCHAR(255),
sales_executive_name VARCHAR(255),
started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ended_at TIMESTAMPTZ,
duration_seconds INTEGER,
transcript JSONB NOT NULL DEFAULT '[]',
raw_payload JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_lead ON bm_conversations(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_conv_zoho ON bm_conversations(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_conv_type ON bm_conversations(conversation_type);
CREATE INDEX IF NOT EXISTS idx_conv_started ON bm_conversations(started_at DESC);

CREATE TABLE IF NOT EXISTS retell_calls (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
retell_call_id VARCHAR(500) NOT NULL UNIQUE,
conversation_id UUID REFERENCES bm_conversations(id) ON DELETE SET NULL,
direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
status VARCHAR(30) NOT NULL DEFAULT 'initiated',
from_number VARCHAR(50),
to_number VARCHAR(50),
agent_id VARCHAR(255),
started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ended_at TIMESTAMPTZ,
duration_seconds INTEGER,
recording_url TEXT,
transcript JSONB NOT NULL DEFAULT '[]',
retell_metadata JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rc_lead ON retell_calls(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_rc_zoho ON retell_calls(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_rc_rid ON retell_calls(retell_call_id);
CREATE INDEX IF NOT EXISTS idx_rc_started ON retell_calls(started_at DESC);

CREATE TABLE IF NOT EXISTS email_events (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
source_id VARCHAR(500) UNIQUE,
conversation_id UUID REFERENCES bm_conversations(id) ON DELETE SET NULL,
direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
status VARCHAR(20) NOT NULL DEFAULT 'sent',
from_address VARCHAR(500),
to_address VARCHAR(500),
subject TEXT,
body_preview TEXT,
sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
opened_at TIMESTAMPTZ,
replied_at TIMESTAMPTZ,
sales_executive_id VARCHAR(255),
sales_executive_name VARCHAR(255),
raw_payload JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ee_lead ON email_events(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_ee_zoho ON email_events(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_ee_sent ON email_events(sent_at DESC);

CREATE TABLE IF NOT EXISTS salesiq_chats (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
source_id VARCHAR(500) UNIQUE,
conversation_id UUID REFERENCES bm_conversations(id) ON DELETE SET NULL,
status VARCHAR(20) NOT NULL DEFAULT 'active',
operator_id VARCHAR(255),
operator_name VARCHAR(255),
visitor_name VARCHAR(255),
visitor_email VARCHAR(500),
started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ended_at TIMESTAMPTZ,
duration_seconds INTEGER,
message_count INTEGER NOT NULL DEFAULT 0,
messages JSONB NOT NULL DEFAULT '[]',
raw_payload JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sc_lead ON salesiq_chats(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_sc_zoho ON salesiq_chats(zoho_lead_id);

CREATE TABLE IF NOT EXISTS crm_tasks (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
zoho_task_id VARCHAR(255) NOT NULL UNIQUE,
subject TEXT NOT NULL,
description TEXT,
status VARCHAR(30) NOT NULL DEFAULT 'open',
priority VARCHAR(20) NOT NULL DEFAULT 'normal',
assigned_to_id VARCHAR(255),
assigned_to_name VARCHAR(255),
due_date TIMESTAMPTZ,
completed_at TIMESTAMPTZ,
raw_payload JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ct_lead ON crm_tasks(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_ct_zoho ON crm_tasks(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_ct_status ON crm_tasks(status);

CREATE TABLE IF NOT EXISTS crm_notes (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
zoho_note_id VARCHAR(255) NOT NULL UNIQUE,
title TEXT,
content TEXT NOT NULL DEFAULT '',
author_id VARCHAR(255),
author_name VARCHAR(255),
noted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
raw_payload JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cn_lead ON crm_notes(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_cn_zoho ON crm_notes(zoho_lead_id);

CREATE TABLE IF NOT EXISTS bm_follow_ups (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
lead_memory_id UUID NOT NULL REFERENCES lead_memory(id) ON DELETE CASCADE,
zoho_lead_id VARCHAR(255) NOT NULL,
source_id VARCHAR(500) UNIQUE,
followup_type VARCHAR(20) NOT NULL DEFAULT 'manual',
status VARCHAR(20) NOT NULL DEFAULT 'pending',
assigned_to_id VARCHAR(255),
assigned_to_name VARCHAR(255),
scheduled_at TIMESTAMPTZ,
completed_at TIMESTAMPTZ,
notes TEXT,
raw_payload JSONB NOT NULL DEFAULT '{}',
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fu_lead ON bm_follow_ups(lead_memory_id);
CREATE INDEX IF NOT EXISTS idx_fu_zoho ON bm_follow_ups(zoho_lead_id);
CREATE INDEX IF NOT EXISTS idx_fu_status ON bm_follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_fu_sched ON bm_follow_ups(scheduled_at ASC NULLS LAST);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
FOREACH t IN ARRAY ARRAY['lead_memory','bm_conversations','retell_calls','email_events','salesiq_chats','crm_tasks','crm_notes','bm_follow_ups']
LOOP
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at') THEN
EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
END IF;
END LOOP;
END $$;
