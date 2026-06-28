const pool = require('../db/pool');

/**
 * LeadEvent — aligned to live lead_events schema (001_business_memory.sql)
 * Schema columns: id, lead_memory_id, zoho_lead_id, event_type, source, source_id,
 *                 actor_type, actor_id, actor_name, payload, metadata, summary,
 *                 channel, occurred_at, created_at
 *
 * Fix: model previously used non-existent columns (lead_id, event_source, title, raw_payload).
 * Now uses correct schema column names.
 */
class LeadEvent {
    static async create(data) {
          const {
                  leadId,          // maps to lead_memory_id (UUID FK to lead_memory.id)
                  zohoLeadId,      // maps to zoho_lead_id (required)
                  eventType,       // maps to event_type
                  eventSource,     // maps to source
                  sourceId,        // maps to source_id
                  actorType,       // maps to actor_type
                  actorId,         // maps to actor_id
                  actorName,       // maps to actor_name
                  rawPayload,      // maps to payload (JSONB)
                  metadata,        // maps to metadata (JSONB)
                  summary,         // maps to summary
                  channel,         // maps to channel
                  occurredAt       // maps to occurred_at
          } = data;

      if (!leadId) throw new Error('LeadEvent.create: leadId (lead_memory_id) is required');
          if (!zohoLeadId && !data.zoho_lead_id) {
                  // zoho_lead_id is NOT NULL in schema — use a fallback if not provided
            console.warn('[LeadEvent] zohoLeadId not provided for leadId=' + leadId + ', using empty string');
          }

      const query = `INSERT INTO lead_events
            (lead_memory_id, zoho_lead_id, event_type, source, source_id,
                   actor_type, actor_id, actor_name, payload, metadata, summary, channel, occurred_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                               RETURNING *`;
          const values = [
                  leadId,
                  zohoLeadId || data.zoho_lead_id || '',
                  eventType || 'unknown',
                  eventSource || data.source || 'system',
                  sourceId || data.source_id || null,
                  actorType || null,
                  actorId || null,
                  actorName || null,
                  rawPayload ? (typeof rawPayload === 'object' ? JSON.stringify(rawPayload) : rawPayload) : '{}',
                  metadata ? (typeof metadata === 'object' ? JSON.stringify(metadata) : metadata) : '{}',
                  summary || null,
                  channel || null,
                  occurredAt || new Date()
                ];
          const result = await pool.query(query, values);
          return result.rows[0];
    }

  static async findByLeadId(leadId, options = {}) {
        const { limit = 100, offset = 0, eventType = null, eventSource = null } = options;
        let query = 'SELECT * FROM lead_events WHERE lead_memory_id = $1';
        const values = [leadId];
        let paramCount = 2;
        if (eventType) { query += ` AND event_type = $${paramCount}`; values.push(eventType); paramCount++; }
        if (eventSource) { query += ` AND source = $${paramCount}`; values.push(eventSource); paramCount++; }
        query += ` ORDER BY occurred_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        values.push(limit, offset);
        const result = await pool.query(query, values);
        return result.rows;
  }

  static async findById(id) {
        const result = await pool.query('SELECT * FROM lead_events WHERE id = $1', [id]);
        return result.rows[0] || null;
  }

  static async countByType(leadId) {
        const result = await pool.query(
                'SELECT event_type, COUNT(*) as count FROM lead_events WHERE lead_memory_id = $1 GROUP BY event_type',
                [leadId]
              );
        return result.rows;
  }

  static async findRecent(limit = 50) {
        const result = await pool.query('SELECT * FROM lead_events ORDER BY occurred_at DESC LIMIT $1', [limit]);
        return result.rows;
  }

  static async deleteOlderThan(date) {
        const result = await pool.query('DELETE FROM lead_events WHERE occurred_at < $1 RETURNING id', [date]);
        return result.rowCount;
  }
}

module.exports = LeadEvent;
