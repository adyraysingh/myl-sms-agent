const express = require('express');
const router = express.Router();
const LeadMemory = require('../models/LeadMemory');
const LeadEvent = require('../models/LeadEvent');
const ProfileService = require('../services/ProfileService');
const TimelineService = require('../services/TimelineService');

router.get('/leads', async function(req, res) {
  try { const leads = await LeadMemory.list({ limit: parseInt(req.query.limit)||50, offset: parseInt(req.query.offset)||0, pipeline_stage: req.query.pipeline_stage||null, lead_owner_id: req.query.lead_owner_id||null }); res.json({ success: true, leads, count: leads.length }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/leads/zoho/:zohoLeadId', async function(req, res) {
  try { const memory = await LeadMemory.findByZohoId(req.params.zohoLeadId); if (!memory) return res.status(404).json({ success: false, error: 'Lead not found' }); res.json({ success: true, memory }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/leads/:id', async function(req, res) {
  try { const memory = await LeadMemory.findById(req.params.id); if (!memory) return res.status(404).json({ success: false, error: 'Lead not found' }); res.json({ success: true, memory }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/leads/:id/profile', async function(req, res) {
  try { const profile = await ProfileService.getProfile(req.params.id); if (!profile) return res.status(404).json({ success: false, error: 'Lead not found' }); res.json({ success: true, profile }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/leads/:id/timeline', async function(req, res) {
  try { const result = await TimelineService.getTimeline(req.params.id, { limit: parseInt(req.query.limit)||100, offset: parseInt(req.query.offset)||0, startDate: req.query.startDate, endDate: req.query.endDate }); res.json({ success: true, ...result }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/leads/:id/events', async function(req, res) {
  try { const events = await LeadEvent.findByLeadId(req.params.id, { limit: parseInt(req.query.limit)||100, offset: parseInt(req.query.offset)||0, eventType: req.query.eventType, eventSource: req.query.eventSource }); res.json({ success: true, events, count: events.length }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/events/recent', async function(req, res) {
  try { const events = await LeadEvent.findRecent(parseInt(req.query.limit)||50); res.json({ success: true, events, count: events.length }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
