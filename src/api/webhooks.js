const express = require('express');
const router = express.Router();
const { handleCallHippoWebhook } = require('./handlers/twilioWebhook');
const { handleZohoWebhook } = require('./handlers/zohoWebhook');
const { handleOnboardingWebhook } = require('./handlers/onboardingWebhook');

// CallHippo inbound SMS webhook
router.post('/callhippo/sms', handleCallHippoWebhook);
router.post('/callhippo/event', handleCallHippoWebhook); // generic event endpoint

// Zoho CRM new lead webhook
router.post('/zoho/new-lead', handleZohoWebhook);

// Onboarding completed webhook
router.post('/onboarding-completed', handleOnboardingWebhook);

module.exports = router;
