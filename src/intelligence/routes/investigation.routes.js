'use strict';
const express = require('express');
const router = express.Router();
const Investigation = require('../models/Investigation');
const AIInvestigationEngine = require('../services/AIInvestigationEngine');
const AnomalyDetector = require('../services/AnomalyDetector');

router.get('/', async (req, res) => {
  try {
    const { status, type, limit, offset } = req.query;
    const data = await Investigation.findAll({ status, type, limit: parseInt(limit)||50, offset: parseInt(offset)||0 });
    const statusCounts = await Investigation.countByStatus();
    res.json({ success: true, investigations: data, count: data.length, status_counts: statusCounts });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/open', async (req, res) => {
  try {
    const data = await Investigation.findOpen();
    res.json({ success: true, investigations: data, count: data.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/history', async (req, res) => {
  try {
    const data = await Investigation.findRecent(parseInt(req.query.limit)||20);
    res.json({ success: true, investigations: data, count: data.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/patterns', async (req, res) => {
  try {
    const data = await Investigation.getPatterns({ type: req.query.type, limit: parseInt(req.query.limit)||20 });
    res.json({ success: true, patterns: data, count: data.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/anomalies', async (req, res) => {
  try {
    const data = await Investigation.getAnomalies({ resolved: req.query.resolved === 'true', limit: parseInt(req.query.limit)||20 });
    res.json({ success: true, anomalies: data, count: data.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const inv = await Investigation.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, error: 'Investigation not found' });
    const [evidence, findings] = await Promise.all([Investigation.getEvidence(req.params.id), Investigation.getFindings(req.params.id)]);
    res.json({ success: true, investigation: inv, evidence, findings });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/start', async (req, res) => {
  try {
    const { investigation_type, title, question, lead_id, salesperson_id } = req.body;
    if (!investigation_type || !question) return res.status(400).json({ success: false, error: 'investigation_type and question are required' });
    const t = title || question.substring(0, 100);
    const inv = await Investigation.create({ investigation_type, title: t, question, lead_id, salesperson_id });
    res.status(202).json({ success: true, investigation_id: inv.investigation_id, message: 'Investigation started', status: 'pending' });
    setImmediate(async () => { await AIInvestigationEngine.investigate({ investigation_type, title: t, question, lead_id, salesperson_id }).catch(e => console.error('[investigation.routes] Failed:', e.message)); });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/question', async (req, res) => {
  try {
    const { question, investigation_type, lead_id } = req.body;
    if (!question) return res.status(400).json({ success: false, error: 'question is required' });
    const type = investigation_type || 'business_investigation';
    const inv = await Investigation.create({ investigation_type: type, title: question.substring(0, 100), question, lead_id: lead_id||null });
    res.status(202).json({ success: true, investigation_id: inv.investigation_id, message: 'Investigation started', status: 'pending' });
    setImmediate(async () => { await AIInvestigationEngine.investigate({ investigation_type: type, title: question.substring(0,100), question, lead_id: lead_id||null }).catch(e => console.error('[investigation.routes] Question failed:', e.message)); });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/reanalyze', async (req, res) => {
  try {
    res.status(202).json({ success: true, message: 'Anomaly detection and pattern analysis started' });
    setImmediate(async () => {
      await AnomalyDetector.runAllChecks().catch(e => console.error('[investigation.routes] Anomaly failed:', e.message));
      await AIInvestigationEngine.detectPatterns().catch(e => console.error('[investigation.routes] Pattern failed:', e.message));
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
