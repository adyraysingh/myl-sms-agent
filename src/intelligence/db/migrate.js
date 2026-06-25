'use strict';
const pool = require('../../memory/db/pool');
const path = require('path');
const fs = require('fs');

async function runPhase7Migration() {
  const sqlPath = path.join(__dirname, 'migrations', '006_ai_investigation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  return { success: true, message: 'Phase 7 migration completed successfully' };
}

module.exports = { runPhase7Migration };
