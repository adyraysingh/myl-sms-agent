'use strict';
/**
 * webhooks.js — Phase 1.5B Webhook Security
 *
 * Mounts per-provider verification middleware on every public webhook route.
 * No webhook payload is ever processed without passing verification first.
 */

const express = require('express');
const router  = express.Router();

const { handleTwilioInbound, handleCallHippoWebhook } = require('./handlers/twilioWebhook');
const { handleZohoWebhook }                            = require('./handlers/zohoWebhook');
const { handleOnboardingWebhook }                      = require('./handlers/onboardingWebhook');

const {
    verifyTwilioWebhook,
    verifyZohoWebhook,
    verifyOnboardingWebhook,
    verifyCallHippoWebhook,
} = require('../middleware/webhookVerification');

// Twilio inbound SMS — X-Twilio-Signature HMAC-SHA1
router.post('/twilio/inbound', verifyTwilioWebhook, handleTwilioInbound);

// Legacy CallHippo — shared WEBHOOK_SECRET
router.post('/callhippo/sms',   verifyCallHippoWebhook, handleCallHippoWebhook);
router.post('/callhippo/event', verifyCallHippoWebhook, handleCallHippoWebhook);

// Zoho CRM new lead — HMAC-SHA256 or x-zoho-webhook-token
router.post('/zoho/new-lead', verifyZohoWebhook, handleZohoWebhook);

// Onboarding completion — shared WEBHOOK_SECRET
router.post('/onboarding-completed', verifyOnboardingWebhook, handleOnboardingWebhook);

module.exports = router;
