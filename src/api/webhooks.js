'use strict';
/**
* webhooks.js — Phase 1.5B Webhook Security + Phase 3.2 Deal Outcome Linking
*
* Mounts per-provider verification middleware on every public webhook route.
* No webhook payload is ever processed without passing verification first.
*/

const express = require('express');
const router = express.Router();

const { handleTwilioInbound, handleCallHippoWebhook } = require('./handlers/twilioWebhook');
const { handleZohoWebhook } = require('./handlers/zohoWebhook');
const { handleOnboardingWebhook } = require('./handlers/onboardingWebhook');
const { handleDealWon, handleDealLost } = require('./handlers/dealWebhook');

const {
verifyTwilioWebhook,
verifyZohoWebhook,
verifyOnboardingWebhook,
verifyCallHippoWebhook,
verifySharedSecret,
} = require('../middleware/webhookVerification');

// Twilio inbound SMS — X-Twilio-Signature HMAC-SHA1
router.post('/twilio/inbound', verifyTwilioWebhook, handleTwilioInbound);

// Legacy CallHippo — shared WEBHOOK_SECRET
router.post('/callhippo/sms', verifyCallHippoWebhook, handleCallHippoWebhook);
router.post('/callhippo/event', verifyCallHippoWebhook, handleCallHippoWebhook);

// Zoho CRM new lead — HMAC-SHA256 or x-zoho-webhook-token
router.post('/zoho/new-lead', verifyZohoWebhook, handleZohoWebhook);

// Onboarding completion — shared WEBHOOK_SECRET
router.post('/onboarding-completed', verifyOnboardingWebhook, handleOnboardingWebhook);

// Phase 3.2: Deal won/lost — shared WEBHOOK_SECRET
// These trigger automatic outcome linking in the Prediction Registry
const verifyDealWebhook = verifySharedSecret('WEBHOOK_SECRET', [
'x-webhook-secret', 'x-webhook-signature', 'x-deal-token', 'x-api-key'
]);
router.post('/deal-won', verifyDealWebhook, handleDealWon);
router.post('/deal-lost', verifyDealWebhook, handleDealLost);

module.exports = router;
