'use strict';
/**
 * auditLogger middleware — Phase 1 Enterprise Security
 *
 * Writes one immutable row to platform_audit_log for every authenticated
 * API request. Fires on response 'finish' event — non-blocking.
 * A logging failure NEVER fails the original API request.
 *
 * Requires authenticate middleware to have run first (req.user must exist).
 * Safe to mount on unauthenticated routes — logs with null user_id.
 */

const pool   = require('../memory/db/pool');
const logger = require('../utils/logger');

// In-memory write buffer: batch audit writes every 5 seconds to reduce DB pressure.
// Max buffer size: 100 rows. Flush immediately if buffer is full.
const _buffer  = [];
const _MAX_BUF = 100;
let   _flushTimer = null;

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(_flush, 5000);
}

async function _flush() {
  _flushTimer = null;
  if (_buffer.length === 0) return;
  const rows = _buffer.splice(0, _buffer.length); // drain buffer
  try {
    // Bulk insert with unnest for efficiency
    const userIds      = rows.map(r => r.user_id);
    const userEmails   = rows.map(r => r.user_email);
    const roles        = rows.map(r => r.role);
    const methods      = rows.map(r => r.http_method);
    const paths        = rows.map(r => r.route_path);
    const routeParams  = rows.map(r => JSON.stringify(r.route_params));
    const queryParams  = rows.map(r => JSON.stringify(r.query_params));
    const ips          = rows.map(r => r.ip_address);
    const agents       = rows.map(r => r.user_agent);
    const statuses     = rows.map(r => r.status_code);
    const times        = rows.map(r => r.response_time_ms);

    await pool.query(
      `INSERT INTO platform_audit_log
         (user_id, user_email, role, http_method, route_path, route_params,
          query_params, ip_address, user_agent, status_code, response_time_ms)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[],
         $6::jsonb[], $7::jsonb[], $8::text[], $9::text[], $10::int[], $11::int[]
       )`,
      [userIds, userEmails, roles, methods, paths,
       routeParams, queryParams, ips, agents, statuses, times]
    );
  } catch (err) {
    logger.warn('[auditLogger] Flush failed (non-critical):', err.message);
    // Do NOT re-buffer — silently drop to avoid infinite growth on DB outage
  }
}

function auditLogger(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    try {
      const row = {
        user_id:         req.user ? req.user.id   : null,
        user_email:      req.user ? req.user.email : null,
        role:            req.user ? req.user.role  : null,
        http_method:     req.method,
        route_path:      req.path || req.url,
        route_params:    req.params  || {},
        query_params:    req.query   || {},
        ip_address:      (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
        user_agent:      req.headers['user-agent'] || null,
        status_code:     res.statusCode,
        response_time_ms: Date.now() - startTime
      };

      _buffer.push(row);

      if (_buffer.length >= _MAX_BUF) {
        if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
        _flush().catch(() => {}); // immediate flush, non-blocking
      } else {
        _scheduleFlush();
      }
    } catch (err) {
      logger.warn('[auditLogger] Failed to buffer audit row:', err.message);
    }
  });

  next();
}

// Allow manual flush (e.g., on graceful shutdown)
auditLogger.flush = _flush;

module.exports = { auditLogger };
