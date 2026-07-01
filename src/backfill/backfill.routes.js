'use strict';
const express = require('express');
const router = express.Router();
const BackfillService = require('./backfill.service');
let _activeRun = null;
router.post('/start', async (req, res) => {
  try {
    if (_activeRun) return res.status(409).json({ success: false, error: 'Backfill already running', run_id: _activeRun });
    const { resume_from_id, batch_size } = req.body || {};
    const runId = 'backfill_' + Date.now();
    _activeRun = runId;
    res.status(202).json({ success: true, message: 'Historical Intelligence Backfill started', run_id: runId, started_at: new Date().toISOString(), resume_from_id: resume_from_id || null });
    setImmediate(async () => {
      try { await BackfillService.runBackfill({ resumeFromId: resume_from_id || null, batchSize: batch_size || 50 }); } catch(e) { console.error('[Backfill] Run failed:', e.message); } finally { _activeRun = null; }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get('/status', async (req, res) => {
  try {
    const checkpoint = await BackfillService.getCheckpoint();
    res.json({ success: true, is_running: !!_activeRun, active_run_id: _activeRun, last_checkpoint: checkpoint, checked_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get('/report', async (req, res) => {
  try {
    const report = await BackfillService.generateExecutiveReport();
    res.json({ success: true, ...report });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
router.get('/lead/:leadId/timeline', async (req, res) => {
  try {
    const timeline = await BackfillService.getLeadTimeline(req.params.leadId);
    res.json({ success: true, ...timeline });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
module.exports = router;
