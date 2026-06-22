const { pool } = require('./connection');
const logger = require('../utils/logger');

async function createLead(leadData) {
  const { zohoLeadId, firstName, lastName, email, phone, leadSource, company } = leadData;
  const result = await pool.query(
    `INSERT INTO leads (zoho_lead_id, first_name, last_name, email, phone, lead_source, company)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [zohoLeadId, firstName, lastName, email, phone, leadSource, company]
  );
  return result.rows[0];
}

async function createOrUpdateLead(leadData) {
  const { zohoLeadId, firstName, lastName, email, phone, leadSource, company } = leadData;
  const result = await pool.query(
    `INSERT INTO leads (zoho_lead_id, first_name, last_name, email, phone, lead_source, company)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (zoho_lead_id) DO UPDATE SET
       first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
       email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = NOW()
     RETURNING *`,
    [zohoLeadId, firstName, lastName, email, phone, leadSource, company]
  );
  return result.rows[0];
}

async function findLeadByPhone(phone) {
  const result = await pool.query('SELECT * FROM leads WHERE phone = $1 LIMIT 1', [phone]);
  return result.rows[0] || null;
}

// Alias for findLeadByPhone
async function getLeadByPhone(phone) {
  return findLeadByPhone(phone);
}

async function findLeadByZohoId(zohoLeadId) {
  const result = await pool.query('SELECT * FROM leads WHERE zoho_lead_id = $1 LIMIT 1', [zohoLeadId]);
  return result.rows[0] || null;
}

async function updateLeadStatus(leadId, status) {
  const result = await pool.query(
    'UPDATE leads SET lead_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, leadId]
  );
  return result.rows[0];
}

async function updateLeadScore(leadId, score) {
  const result = await pool.query(
    'UPDATE leads SET qualification_score = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [score, leadId]
  );
  return result.rows[0];
}

async function updateLead(leadId, updates) {
  const { isOnboarded, onboardedAt, leadStatus, optedOut } = updates;
  const setClauses = [];
  const values = [];
  let idx = 1;

  if (isOnboarded !== undefined) { setClauses.push(`is_onboarded = $${idx++}`); values.push(isOnboarded); }
  if (onboardedAt !== undefined) { setClauses.push(`onboarded_at = $${idx++}`); values.push(onboardedAt); }
  if (leadStatus !== undefined) { setClauses.push(`lead_status = $${idx++}`); values.push(leadStatus); }
  if (optedOut !== undefined) { setClauses.push(`opted_out = $${idx++}`); values.push(optedOut); }
  setClauses.push(`updated_at = NOW()`);
  values.push(leadId);

  const result = await pool.query(
    `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0];
}

async function updateLeadOptOut(leadId) {
  return updateLead(leadId, { optedOut: true });
}

async function updateLeadOnboarded(leadId) {
  return updateLead(leadId, { isOnboarded: true, onboardedAt: new Date().toISOString(), leadStatus: 'Onboarded' });
}

module.exports = {
  createLead,
  createOrUpdateLead,
  findLeadByPhone,
  getLeadByPhone,
  findLeadByZohoId,
  updateLeadStatus,
  updateLeadScore,
  updateLead,
  updateLeadOptOut,
  updateLeadOnboarded
};
