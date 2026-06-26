'use strict';
/**
 * Auth Routes — Phase 1 Enterprise Security
 *
 * All routes here are PUBLIC (no authenticate middleware).
 * They are the entry point for obtaining tokens.
 *
 * POST /api/auth/login    — issue access + refresh token
 * POST /api/auth/refresh  — rotate refresh token, issue new pair
 * POST /api/auth/logout   — revoke refresh token session
 * POST /api/auth/users    — create user (ceo-only, uses authenticate + authorize inline)
 * GET  /api/auth/me       — return current user info from token
 */

const express     = require('express');
const AuthService = require('../AuthService');
const { authenticate } = require('../../middleware/authenticate');
const { authorize }    = require('../../middleware/authorize');
const logger      = require('../../utils/logger');

const router = express.Router();

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const ip        = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '';

    const result = await AuthService.login(email, password, ip, userAgent);

    // Set refresh token as HttpOnly Secure cookie
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000 // 30 days in ms
    });

    res.json({
      success: true,
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: 900, // 15 minutes in seconds
      user: result.user
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    // Accept from cookie (preferred) or body (for clients that can't use cookies)
    const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;
    const result = await AuthService.refresh(refreshToken);

    // Rotate cookie
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: 900
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;
    await AuthService.logout(refreshToken);
    res.clearCookie('refresh_token');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/users — create user (CEO only) ───────────────────────────
router.post('/users', authenticate, authorize(['ceo']), async (req, res, next) => {
  try {
    const { email, password, full_name, role } = req.body;
    const user = await AuthService.createUser(email, password, full_name, role);
    res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── GET /api/auth/me — return current user ──────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
