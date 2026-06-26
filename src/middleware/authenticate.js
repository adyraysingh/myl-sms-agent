'use strict';
/**
 * authenticate middleware — Phase 1 Enterprise Security
 *
 * Verifies JWT access tokens on every /api/ request.
 * Pure cryptographic check — zero database calls.
 * Attaches req.user = { id, email, role, full_name } on success.
 *
 * Excluded routes (handled separately):
 *   /webhooks/*  — use HMAC signature verification
 *   /health      — public
 *   /            — public
 *   /api/auth/*  — login/refresh/logout are public
 */

const AuthService = require('../auth/AuthService');
const logger      = require('./../../src/utils/logger').child
  ? require('./../../src/utils/logger')
  : require('../utils/logger');

function authenticate(req, res, next) {
  // Auth routes are always public — skip entirely
  if (req.path.startsWith('/auth/')) return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7); // Remove 'Bearer '
  try {
    const decoded = AuthService.verifyAccessToken(token);
    req.user = {
      id:        decoded.sub,
      email:     decoded.email,
      role:      decoded.role,
      full_name: decoded.full_name
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Unauthorized: token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Unauthorized: invalid token', code: 'INVALID_TOKEN' });
    }
    logger.error('[authenticate] Token verification error', { error: err.message });
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { authenticate };
