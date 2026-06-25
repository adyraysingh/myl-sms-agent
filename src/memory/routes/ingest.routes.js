const express = require('express');
const router = express.Router();
const ZohoIngestor = require('../ingestors/zoho.ingestor');
const RetellIngestor = require('../ingestors/retell.ingestor');
const SalesIQIngestor = require('../ingestors/salesiq.ingestor');
const EmailIngestor = require('../ingestors/email.ingestor');
const LeadMemory = require('../models/LeadMemory');

router.post('/zoho/lead', async function(req, res) {
  try { const memory = await ZohoIngestor.ingestLead(req.body); res.json({ success: true, leadId: memory.id }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/zoho/task', async function(req, res) {
  try { let id = req.body.leadId; if (!id && req.body.zohoLeadId) { const m = await LeadMemory.findByZohoLeadId(req.body.zohoLeadId); if (m) id = m.id; } if (!id) return res.status(400).json({ success: false, error: 'Lead ID required' }); const task = await ZohoIngestor.ingestTask(req.body, id); res.json({ success: true, taskId: task.id }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/zoho/note', async function(req, res) {
  try { let id = req.body.leadId; if (!id && req.body.zohoLeadId) { const m = await LeadMemory.findByZohoLeadId(req.body.zohoLeadId); if (m) id = m.id; } if (!id) return res.status(400).json({ success: false, error: 'Lead ID required' }); const note = await ZohoIngestor.ingestNote(req.body, id); res.json({ success: true, noteId: note.id }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/retell/call', async function(req, res) {
  try { const result = await RetellIngestor.ingestCall(req.body); res.json({ success: true, callId: result.call.id }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/salesiq/chat', async function(req, res) {
  try { const result = await SalesIQIngestor.ingestChat(req.body); res.json({ success: true, chatId: result.chat.id }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/email', async function(req, res) {
  try { const result = await EmailIngestor.ingest(req.body); res.json({ success: true, eventId: result.event && result.event.id }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
