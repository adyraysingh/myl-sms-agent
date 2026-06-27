'use strict';
/**
 * webhookVerification.js — Phase 1.5 Webhook Security
 *
 * Provides per-provider verification middleware for every public webhook.
 * All middlewares share the same design contract:
 *   - PASS  → call next()
 *   - FAIL  → return 401 JSON, log attempt, never call next()
 *   - MISSING secret in production → 401 (fail closed, never open)
 *   - MISSING secret in development → warn + pass (safe for local testing)
 *
 * Providers covered:
 *   verifyZohoWebhook       — HMAC-SHA256 or token header (x-zoho-webhook-token)
 *   verifyTwilioWebhook     — X-Twilio-Signature HMAC verification via Twilio SDK
 *   verifyRetellWebhook     — Shared secret header (x-retell-signature)
 *   verifySharedSecret      — Generic shared-secret factory (Onboarding, CallHippo, Email)
 *
 * Environment variables required:
 *   WEBHOOK_SECRET         — Zoho, Onboarding, CallHippo, SalesIQ ingest, Email ingest
 *   TWILIO_AUTH_TOKEN      — Twilio X-Twilio-Signature verification
 *   TWILIO_ACCOUNT_SID     — Twilio account SID (already present)
 *   RETELL_WEBHOOK_SECRET  — Retell AI webhook secret (x-retell-signature)
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Constant-time HMAC-SHA256 comparison to prevent timing attacks.
 */
function _hmacSha256(secret, data) {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function _timingSafeEqual(a, b) {
    try {
          const bufA = Buffer.from(a, 'utf8');
          const bufB = Buffer.from(b, 'utf8');
          if (bufA.length !== bufB.length) return false;
          return crypto.timingSafeEqual(bufA, bufB);
    } catch {
          return false;
    }
}

/**
 * Returns the raw body string for HMAC computation.
 * express.json() parses body — we re-serialize for deterministic comparison.
 * For Twilio (form-encoded), we use the sorted param string.
 */
function _getRawBody(req) {
    // If raw body was captured by rawBody middleware, prefer that
  if (req.rawBody) return req.rawBody;
    // Fallback: re-serialize parsed JSON (only safe for JSON webhooks)
  return JSON.stringify(req.body);
}

/**
 * Check if we're in production. In dev, missing secrets warn but pass.
 * In production, missing secrets always fail closed.
 */
function _isProd() {
    return process.env.NODE_ENV === 'production';
}

function _reject(res, reason, extra) {
    logger.warn('[WebhookVerification] Rejected', { reason, ...extra });
    return res.status(401).json({ error: 'Webhook verification failed', reason });
}

// ─── Zoho CRM Webhook ────────────────────────────────────────────────────────

/**
 * verifyZohoWebhook
 *
 * Zoho CRM sends a webhook token in the header x-zoho-webhook-token.
 * We also support HMAC-SHA256 via x-webhook-signature for added security.
 *
 * Verification order:
 *   1. Token match (x-zoho-webhook-token === WEBHOOK_SECRET)
 *   2. HMAC match (x-webhook-signature === hmac(WEBHOOK_SECRET, body))
 */
function verifyZohoWebhook(req, res, next) {
    const secret = process.env.WEBHOOK_SECRET;

  if (!secret) {
        if (_isProd()) return _reject(res, 'WEBHOOK_SECRET not configured', { provider: 'zoho' });
        logger.warn('[WebhookVerification] WEBHOOK_SECRET not set — skipping Zoho verification in dev');
        return next();
  }

  const tokenHeader = (req.headers['x-zoho-webhook-token'] || '').trim();
    const sigHeader   = (req.headers['x-webhook-signature'] || '').trim();

  // Check 1: token match
  if (tokenHeader && _timingSafeEqual(tokenHeader, secret)) {
        return next();
  }

  // Check 2: HMAC match
  if (sigHeader) {
        const body     = _getRawBody(req);
        const expected = _hmacSha256(secret, body);
        if (_timingSafeEqual(sigHeader, expected) || _timingSafeEqual(sigHeader, 'sha256=' + expected)) {
                return next();
        }
  }

  return _reject(res, 'Invalid Zoho webhook signature', {
        provider: 'zoho',
        path: req.path,
        token_present: !!tokenHeader,
        sig_present: !!sigHeader
  });
}

// ─── Twilio Webhook ───────────────────────────────────────────────────────────

/**
 * verifyTwilioWebhook
 *
 * Twilio signs every webhook request using HMAC-SHA1 of:
 *   fullURL + sorted POST params concatenated
 *
 * Header: X-Twilio-Signature
 *
 * We use the twilio npm package's validateRequest() for correctness.
 * Fallback: if twilio SDK unavailable, manual HMAC-SHA1 verification.
 *
 * NOTE: Twilio sends form-encoded bodies (application/x-www-form-urlencoded).
 * Express urlencoded() must be active (it is in app.js).
 */
function verifyTwilioWebhook(req, res, next) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!authToken) {
        if (_isProd()) return _reject(res, 'TWILIO_AUTH_TOKEN not configured', { provider: 'twilio' });
        logger.warn('[WebhookVerification] TWILIO_AUTH_TOKEN not set — skipping Twilio verification in dev');
        return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'] || '';
    if (!twilioSignature) {
          return _reject(res, 'Missing X-Twilio-Signature header', { provider: 'twilio', path: req.path });
    }

  // Build the full URL Twilio signed (Railway provides X-Forwarded-Proto)
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host     = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const fullUrl  = `${protocol}://${host}${req.originalUrl}`;

  try {
        // Try using twilio SDK validateRequest
      const twilio = require('twilio');
        const valid  = twilio.validateRequest(authToken, twilioSignature, fullUrl, req.body || {});
        if (valid) return next();
        return _reject(res, 'Invalid Twilio signature', { provider: 'twilio', url: fullUrl });
  } catch (err) {
        // Fallback: manual HMAC-SHA1
      logger.warn('[WebhookVerification] Twilio SDK unavailable, using manual HMAC-SHA1');
        const params    = req.body || {};
        const sortedStr = fullUrl + Object.keys(params).sort().map(k => k + params[k]).join('');
        const expected  = crypto.createHmac('sha1', authToken).update(sortedStr).digest('base64');
        if (_timingSafeEqual(twilioSignature, expected)) return next();
        return _reject(res, 'Invalid Twilio signature (manual fallback)', { provider: 'twilio', url: fullUrl });
  }
}

// ─── Retell AI Webhook ────────────────────────────────────────────────────────

/**
 * verifyRetellWebhook
 *
 * Retell AI sends a shared secret in the header x-retell-signature.
 * We compare it against RETELL_WEBHOOK_SECRET using constant-time comparison.
 */
function verifyRetellWebhook(req, res, next) {
    const secret = process.env.RETELL_WEBHOOK_SECRET;

  if (!secret) {
        if (_isProd()) return _reject(res, 'RETELL_WEBHOOK_SECRET not configured', { provider: 'retell' });
        logger.warn('[WebhookVerification] RETELL_WEBHOOK_SECRET not set — skipping Retell verification in dev');
        return next();
  }

  const sigHeader = (req.headers['x-retell-signature'] || '').trim();
    if (!sigHeader) {
          return _reject(res, 'Missing x-retell-signature header', { provider: 'retell', path: req.path });
    }

  if (_timingSafeEqual(sigHeader, secret)) return next();

  // Also support HMAC-SHA256 variant
  const body     = _getRawBody(req);
    const expected = _hmacSha256(secret, body);
    if (_timingSafeEqual(sigHeader, expected) || _timingSafeEqual(sigHeader, 'sha256=' + expected)) {
          return next();
    }

  return _reject(res, 'Invalid Retell webhook signature', { provider: 'retell', path: req.path });
}

// ─── Generic Shared-Secret Factory ───────────────────────────────────────────

/**
 * verifySharedSecret(envVarName, headerNames)
 *
 * Factory for simple shared-secret webhooks (Onboarding, CallHippo, Email, SalesIQ).
 *
 * @param {string}   envVarName   — env var holding the secret (default: 'WEBHOOK_SECRET')
 * @param {string[]} headerNames  — list of header names to check (first match wins)
 *
 * Checks, in order:
 *   1. Token match (header value === secret) via timing-safe compare
 *   2. HMAC-SHA256 match (header value === hmac(secret, body))
 */
function verifySharedSecret(envVarName, headerNames) {
    envVarName  = envVarName  || 'WEBHOOK_SECRET';
    headerNames = headerNames || ['x-webhook-secret', 'x-webhook-signature', 'x-api-key', 'authorization'];

  return function webhookSecretMiddleware(req, res, next) {
        const secret = process.env[envVarName];

        if (!secret) {
                if (_isProd()) return _reject(res, `${envVarName} not configured`, { provider: envVarName });
                logger.warn(`[WebhookVerification] ${envVarName} not set — skipping verification in dev`);
                return next();
        }

        // Check each header in order
        for (const name of headerNames) {
                const headerVal = (req.headers[name.toLowerCase()] || '').trim();
                if (!headerVal) continue;

          // Token match
          if (_timingSafeEqual(headerVal, secret)) return next();

          // HMAC match
          const body     = _getRawBody(req);
                const expected = _hmacSha256(secret, body);
                if (_timingSafeEqual(headerVal, expected) || _timingSafeEqual(headerVal, 'sha256=' + expected)) {
                          return next();
                }
        }

        return _reject(res, 'Invalid webhook secret', {
                provider: envVarName,
                path:     req.path,
                checked_headers: headerNames
        });
  };
}

// ─── Pre-built instances ──────────────────────────────────────────────────────

// Onboarding webhook — uses WEBHOOK_SECRET
const verifyOnboardingWebhook = verifySharedSecret('WEBHOOK_SECRET', [
    'x-webhook-secret', 'x-webhook-signature', 'x-onboarding-token', 'x-api-key'
  ]);

// CallHippo webhook — uses WEBHOOK_SECRET
const verifyCallHippoWebhook = verifySharedSecret('WEBHOOK_SECRET', [
    'x-webhook-secret', 'x-webhook-signature', 'x-callhippo-token', 'x-api-key'
  ]);

// SalesIQ (intelligence ingest) — uses WEBHOOK_SECRET
const verifySalesIQWebhook = verifySharedSecret('WEBHOOK_SECRET', [
    'x-webhook-secret', 'x-salesiq-token', 'x-api-key', 'x-webhook-signature'
  ]);

// Email ingest — uses WEBHOOK_SECRET
const verifyEmailWebhook = verifySharedSecret('WEBHOOK_SECRET', [
    'x-webhook-secret', 'x-email-token', 'x-api-key', 'x-webhook-signature'
  ]);

// Intelligence ingest (Zoho lead/task/note, Retell call, SalesIQ chat) — uses WEBHOOK_SECRET
const verifyIntelligenceIngest = verifySharedSecret('WEBHOOK_SECRET', [
    'x-webhook-secret', 'x-ingest-token', 'x-api-key', 'x-webhook-signature'
  ]);

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    verifyZohoWebhook,
    verifyTwilioWebhook,
    verifyRetellWebhook,
    verifySharedSecret,
    verifyOnboardingWebhook,
    verifyCallHippoWebhook,
    verifySalesIQWebhook,
    verifyEmailWebhook,
    verifyIntelligenceIngest,
};
