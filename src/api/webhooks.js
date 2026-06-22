const express = require('express');
const router = express.Router();
const { handleTwilioInbound, handleCallHippoWebhook } = require('./handlers/twilioWebhook');
const { handleZohoWebhook } = require('./handlers/zohoWebhook');
const { handleOnboardingWebhook } = require('./handlers/onboardingWebhook');

// Twilio inbound SMS webhook (Twilio Messaging Service posts here)
router.post('/twilio/inbound', handleTwilioInbound);

// Legacy CallHippo routes (backward compat)
router.post('/callhippo/sms', handleCallHippoWebhook);
router.post('/callhippo/event', handleCallHippoWebhook);

// Zoho CRM new lead webhook
router.post('/zoho/new-lead', handleZohoWebhook);

// Onboarding completed webhook
router.post('/onboarding-completed', handleOnboardingWebhook);

module.exports = router;
