const { pool } = require('./connection');
const logger = require('../utils/logger');

async function createLead(leadData) {
    const {
          zohoLeadId, firstName, lastName, email, phone,
          leadSource, company, budget, timeline, productCategory
    } = leadData;

  const result = await pool.query(
        `INSERT INTO leads (zoho_lead_id, first_name, last_name, email, phone, lead_source, company, budget, timeline, product_category)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                  ON CONFLICT (zoho_lead_id) DO UPDATE SET
                         first_name = EXCLUDED.first_name,
                                last_name = EXCLUDED.last_name,
                                       email = EXCLUDED.email,
                                              phone = EXCLUDED.phone,
                                                     updated_at = NOW()
                                                          RETURNING *`,
        [zohoLeadId, firstName, lastName, email, phone, leadSource, company, budget, timeline, productCategory]
      );

  return result.rows[0];
}

async function findLeadByPhone(phone) {
    const result = await pool.query(
          'SELECT * FROM leads WHERE phone = $1 LIMIT 1',
          [phone]
        );
    return result.rows[0] || null;
}

async function findLeadByZohoId(zohoLeadId) {
    const result = await pool.query(
          'SELECT * FROM leads WHERE zoho_lead_id = $1 LIMIT 1',
          [zohoLeadId]
        );
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

async function updateLeadOptOut(leadId) {
    const result = await pool.query(
          'UPDATE leads SET opted_out = true, updated_at = NOW() WHERE id = $1 RETURNING *',
          [leadId]
        );
    return result.rows[0];
}

async function updateLeadOnboarded(leadId) {
    const result = await pool.query(
          'UPDATE leads SET is_onboarded = true, onboarded_at = NOW(), lead_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
          ['Onboarded', leadId]
        );
    return result.rows[0];
}

module.exports = {
    createLead,
    findLeadByPhone,
    findLeadByZohoId,
    updateLeadStatus,
    updateLeadScore,
    updateLeadOptOut,
    updateLeadOnboarded
};
