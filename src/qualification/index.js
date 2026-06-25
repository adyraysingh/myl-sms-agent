'use strict';

const pool = require('../memory/db/pool');
const path = require('path');
const fs   = require('fs');

/**
 * Phase 4 - Onboarding Qualification Engine Bootstrap
 * Runs migration and initializes the qualification module.
 */
async function bootstrapQualification() {
  console.log('[Qualification] Initializing Onboarding Qualification Engine...');

  try {
    const migrationPath = path.join(__dirname, 'db/migrations/003_lead_qualification.sql');

    if (!fs.existsSync(migrationPath)) {
      console.warn('[Qualification] Migration file not found:', migrationPath);
      return;
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(migrationSQL);
    console.log('[Qualification] Phase 4 migration complete - lead_qualification, qualification_history tables ready');

  } catch (err) {
    console.error('[Qualification] Migration warning (non-fatal):', err.message);
  }

  console.log('[Qualification] Onboarding Qualification Engine ready');
}

module.exports = { bootstrapQualification };
