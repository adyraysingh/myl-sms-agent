require('dotenv').config();
const { Pool } = require('pg');

const migrations = `
  CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
          zoho_lead_id VARCHAR(255) UNIQUE,
              first_name VARCHAR(255),
                  last_name VARCHAR(255),
                      email VARCHAR(255),
                          phone VARCHAR(50) UNIQUE NOT NULL,
                              lead_source VARCHAR(255),
                                  company VARCHAR(255),
                                      lead_status VARCHAR(100) DEFAULT 'New',
                                          pipeline VARCHAR(100) DEFAULT 'SMS Pipeline',
                                              qualification_score INTEGER DEFAULT 0,
                                                  budget VARCHAR(255),
                                                      timeline VARCHAR(255),
                                                          product_category VARCHAR(255),
                                                              brand_stage VARCHAR(255),
                                                                  opted_out BOOLEAN DEFAULT FALSE,
                                                                      is_onboarded BOOLEAN DEFAULT FALSE,
                                                                          onboarded_at TIMESTAMP,
                                                                              created_at TIMESTAMP DEFAULT NOW(),
                                                                                  updated_at TIMESTAMP DEFAULT NOW()
                                                                                    );
                                                                                      CREATE TABLE IF NOT EXISTS conversations (
                                                                                          id SERIAL PRIMARY KEY,
                                                                                              lead_id INTEGER REFERENCES leads(id),
                                                                                                  channel VARCHAR(50) DEFAULT 'sms',
                                                                                                      status VARCHAR(50) DEFAULT 'active',
                                                                                                          summary TEXT,
                                                                                                              message_count INTEGER DEFAULT 0,
                                                                                                                  created_at TIMESTAMP DEFAULT NOW(),
                                                                                                                      updated_at TIMESTAMP DEFAULT NOW()
                                                                                                                        );
                                                                                                                          CREATE TABLE IF NOT EXISTS messages (
                                                                                                                              id SERIAL PRIMARY KEY,
                                                                                                                                  conversation_id INTEGER REFERENCES conversations(id),
                                                                                                                                      lead_id INTEGER REFERENCES leads(id),
                                                                                                                                          direction VARCHAR(20) NOT NULL,
                                                                                                                                              content TEXT NOT NULL,
                                                                                                                                                  twilio_sid VARCHAR(255),
                                                                                                                                                      status VARCHAR(50) DEFAULT 'pending',
                                                                                                                                                          created_at TIMESTAMP DEFAULT NOW()
                                                                                                                                                            );
                                                                                                                                                              CREATE TABLE IF NOT EXISTS follow_ups (
                                                                                                                                                                  id SERIAL PRIMARY KEY,
                                                                                                                                                                      lead_id INTEGER REFERENCES leads(id),
                                                                                                                                                                          conversation_id INTEGER REFERENCES conversations(id),
                                                                                                                                                                              scheduled_at TIMESTAMP NOT NULL,
                                                                                                                                                                                  sequence_number INTEGER NOT NULL,
                                                                                                                                                                                      status VARCHAR(50) DEFAULT 'pending',
                                                                                                                                                                                          type VARCHAR(50) DEFAULT 'no_response',
                                                                                                                                                                                              executed_at TIMESTAMP,
                                                                                                                                                                                                  created_at TIMESTAMP DEFAULT NOW()
                                                                                                                                                                                                    );
                                                                                                                                                                                                      CREATE TABLE IF NOT EXISTS lead_scores (
                                                                                                                                                                                                          id SERIAL PRIMARY KEY,
                                                                                                                                                                                                              lead_id INTEGER REFERENCES leads(id),
                                                                                                                                                                                                                  score INTEGER NOT NULL,
                                                                                                                                                                                                                      factors JSONB,
                                                                                                                                                                                                                          created_at TIMESTAMP DEFAULT NOW()
                                                                                                                                                                                                                            );
                                                                                                                                                                                                                              CREATE TABLE IF NOT EXISTS audit_logs (
                                                                                                                                                                                                                                  id SERIAL PRIMARY KEY,
                                                                                                                                                                                                                                      action VARCHAR(255) NOT NULL,
                                                                                                                                                                                                                                          entity_type VARCHAR(100),
                                                                                                                                                                                                                                              entity_id INTEGER,
                                                                                                                                                                                                                                                  data JSONB,
                                                                                                                                                                                                                                                      created_at TIMESTAMP DEFAULT NOW()
                                                                                                                                                                                                                                                        );
                                                                                                                                                                                                                                                          CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
                                                                                                                                                                                                                                                            CREATE INDEX IF NOT EXISTS idx_leads_zoho_id ON leads(zoho_lead_id);
                                                                                                                                                                                                                                                              CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);
                                                                                                                                                                                                                                                                CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
                                                                                                                                                                                                                                                                  CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON follow_ups(scheduled_at, status);
                                                                                                                                                                                                                                                                  `;

async function migrate() {
    if (!process.env.DATABASE_URL) {
          console.log('DATABASE_URL not set - skipping migrations');
          process.exit(0);
    }

  const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
  });

  try {
        console.log('Running database migrations...');
        await pool.query(migrations);
        console.log('Migrations completed successfully');
        await pool.end();
        process.exit(0);
  } catch (error) {
        console.error('Migration failed:', error.message);
        await pool.end().catch(() => {});
        process.exit(1);
  }
}

migrate();
