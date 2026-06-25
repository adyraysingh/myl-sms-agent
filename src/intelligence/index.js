'use strict';

const pool = require('../memory/db/pool');
const path = require('path');
const fs = require('fs');

/**
 * Phase 3 - Conversation Intelligence Engine Bootstrap
 * Runs migrations and initializes the intelligence module.
 */

async function bootstrapIntelligence() {
  console.log('[Intelligence] Initializing Conversation Intelligence Engine...');

  try {
    // Run Phase 3 SQL migration
    const migrationPath = path.join(__dirname, 'db/migrations/002_conversation_analysis.sql');

    if (!fs.existsSync(migrationPath)) {
      console.warn('[Intelligence] Migration file not found:', migrationPath);
      return;
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    await pool.query(migrationSQL);
    console.log('[Intelligence] Phase 3 migration complete - conversation_analysis, analysis_queue, zoho_ai_sync_log tables ready');

  } catch (err) {
    // Log but do not crash app - migration may already be applied
    console.error('[Intelligence] Migration warning (non-fatal):', err.message);
  }

  console.log('[Intelligence] Conversation Intelligence Engine ready');
}

module.exports = { bootstrapIntelligence };
