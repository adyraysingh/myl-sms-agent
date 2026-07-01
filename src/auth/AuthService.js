'use strict';
/**
* AuthService — Phase 1 Enterprise Security
* Handles: login, token issuance, refresh token rotation, logout, user creation.
*
* ACCESS TOKEN : JWT HS256, 15-minute expiry, stateless verification
* REFRESH TOKEN : JWT HS256, 30-day expiry, stored as SHA-256 hash in auth_sessions
*
* Refresh token rotation: old hash deleted on use, new hash stored.
* If a stolen refresh token is replayed, the original session row no longer
* exists — the server cannot find it, so it returns 401 and the attacker is
* blocked. Optionally the user is alerted (future enhancement).
*
* Fix (Security Validation): Added jti (JWT ID) = crypto.randomUUID() to refresh
* tokens to guarantee uniqueness even when issued within the same second.
* Without jti, rapid rotation produced identical tokens (same iat/exp second),
* allowing the old token to be replayed. jti is not verified on decode — its
* sole purpose is to make every refresh token cryptographically unique so the
* SHA-256 hash in auth_sessions is always distinct after rotation.
*/

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
const logger = require('../utils/logger');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '30d';
const BCRYPT_ROUNDS = 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function _issueAccessToken(user) {
    if (!ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET environment variable is not set');
    return jwt.sign(
      { sub: user.id, email: user.email, role: user.role, full_name: user.full_name },
          ACCESS_SECRET,
      { expiresIn: ACCESS_EXPIRY, issuer: 'myl-ai-platform' }
        );
}

function _issueRefreshToken(user) {
    if (!REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET environment variable is not set');
    return jwt.sign(
      { sub: user.id, type: 'refresh', jti: crypto.randomUUID() },
          REFRESH_SECRET,
      { expiresIn: REFRESH_EXPIRY, issuer: 'myl-ai-platform' }
        );
}

async function _storeRefreshSession(userId, refreshToken, ip, userAgent) {
    const hash = _hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await pool.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5)`,
        [userId, hash, expiresAt, ip || null, userAgent || null]
      );
    return hash;
}

// ─── Public API ───────────────────────────────────────────────────────────────

class AuthService {

  /**
     * Login: verify email + password, issue token pair.
     * @returns { user, accessToken, refreshToken }
     */
  static async login(email, password, ip, userAgent) {
        if (!email || !password) throw Object.assign(new Error('Email and password are required'), { status: 400 });

      const result = await pool.query(
              'SELECT id, email, hashed_password, full_name, role, is_active FROM platform_users WHERE email = $1 LIMIT 1',
              [email.toLowerCase().trim()]
            );
        const user = result.rows[0];

      if (!user) {
              // Constant-time rejection to prevent email enumeration
          await bcrypt.compare(password, '$2b$12$invalidhashpadding000000000000000000000000000000000000');
              throw Object.assign(new Error('Invalid credentials'), { status: 401 });
      }

      if (!user.is_active) {
              throw Object.assign(new Error('Account is disabled'), { status: 403 });
      }

      const valid = await bcrypt.compare(password, user.hashed_password);
        if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

      const accessToken = _issueAccessToken(user);
        const refreshToken = _issueRefreshToken(user);
        await _storeRefreshSession(user.id, refreshToken, ip, userAgent);

      // Update last_login_at (non-blocking — do not fail login if this fails)
      pool.query('UPDATE platform_users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => {});

      logger.info('[AuthService] Login success', { user_id: user.id, email: user.email, role: user.role });

      return {
              user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
              accessToken,
              refreshToken
      };
  }

  /**
     * Refresh: rotate refresh token, issue new token pair.
     * The old refresh token hash is deleted (rotation).
     * @returns { accessToken, refreshToken }
     */
  static async refresh(refreshToken) {
        if (!refreshToken) throw Object.assign(new Error('Refresh token required'), { status: 401 });
        if (!REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET environment variable is not set');

      let decoded;
        try {
                decoded = jwt.verify(refreshToken, REFRESH_SECRET, { issuer: 'myl-ai-platform' });
        } catch (err) {
                throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 });
        }

      if (decoded.type !== 'refresh') throw Object.assign(new Error('Invalid token type'), { status: 401 });

      const hash = _hashToken(refreshToken);
        const sessionResult = await pool.query(
                `SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
                              u.email, u.full_name, u.role, u.is_active
                                     FROM auth_sessions s
                                            JOIN platform_users u ON s.user_id = u.id
                                                   WHERE s.token_hash = $1 LIMIT 1`,
                [hash]
              );

      const session = sessionResult.rows[0];
        if (!session) throw Object.assign(new Error('Session not found or already used'), { status: 401 });
        if (session.revoked_at) throw Object.assign(new Error('Session has been revoked'), { status: 401 });
        if (new Date(session.expires_at) < new Date()) throw Object.assign(new Error('Session expired'), { status: 401 });
        if (!session.is_active) throw Object.assign(new Error('Account is disabled'), { status: 403 });

      // Rotate: delete old session, create new one
      await pool.query('DELETE FROM auth_sessions WHERE id = $1', [session.id]);

      const user = { id: session.user_id, email: session.email, full_name: session.full_name, role: session.role };
        const newAccessToken = _issueAccessToken(user);
        const newRefreshToken = _issueRefreshToken(user);
        await _storeRefreshSession(user.id, newRefreshToken, null, null);

      logger.info('[AuthService] Token refreshed', { user_id: user.id });
        return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  /**
     * Logout: revoke a specific refresh token session.
     */
  static async logout(refreshToken) {
        if (!refreshToken) return; // No-op if no token
      const hash = _hashToken(refreshToken);
        await pool.query(
                'UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1',
                [hash]
              ).catch(() => {}); // Best-effort
      logger.info('[AuthService] Session revoked');
  }

  /**
     * Revoke all sessions for a user (e.g., password change, security incident).
     */
  static async revokeAllSessions(userId) {
        await pool.query(
                'UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
                [userId]
              );
        logger.info('[AuthService] All sessions revoked', { user_id: userId });
  }

  /**
     * Create a new platform user.
     * @returns {object} user record (without hashed_password)
     */
  static async createUser(email, password, fullName, role) {
        const validRoles = ['ceo', 'sales_manager', 'sales_rep', 'system'];
        if (!validRoles.includes(role)) throw Object.assign(new Error('Invalid role: ' + role), { status: 400 });
        if (!email || !password || !fullName) throw Object.assign(new Error('email, password and fullName are required'), { status: 400 });
        if (password.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });

      const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const result = await pool.query(
                `INSERT INTO platform_users (email, hashed_password, full_name, role)
                       VALUES ($1, $2, $3, $4)
                              ON CONFLICT (email) DO NOTHING
                                     RETURNING id, email, full_name, role, is_active, created_at`,
                [email.toLowerCase().trim(), hashed, fullName, role]
              );
        if (!result.rows[0]) throw Object.assign(new Error('User already exists with that email'), { status: 409 });
        logger.info('[AuthService] User created', { email, role });
        return result.rows[0];
  }

  /**
     * Verify an access token synchronously.
     * Used by authenticate middleware — zero DB calls.
     * @returns {object} decoded payload { sub, email, role, full_name }
     */
  static verifyAccessToken(token) {
        if (!ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET environment variable is not set');
        return jwt.verify(token, ACCESS_SECRET, { issuer: 'myl-ai-platform' });
  }

  /**
     * Run the auth database migration.
     * Called once at app startup — safe to run multiple times.
     */
  static async runMigration() {
        const fs = require('fs');
        const path = require('path');
        const sql = fs.readFileSync(path.join(__dirname, 'db', '001_auth.sql'), 'utf8');
        await pool.query(sql);
        logger.info('[AuthService] Auth migration complete');
  }
}

module.exports = AuthService;
