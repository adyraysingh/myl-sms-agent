'use strict';

const ConversationAnalysis = require('../models/ConversationAnalysis');
const AIAnalysisService = require('./AIAnalysisService');
const ZohoCRMUpdater = require('./ZohoCRMUpdater');
const LeadMemory = require('../../memory/models/LeadMemory');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');
const crypto = require('crypto');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toUUID(s) { if (!s) return crypto.randomUUID(); if (UUID_RE.test(s)) return s; const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); if (m) return m[0]; return crypto.createHash('sha256').update(String(s)).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'); }

const queue = [];
let isProcessing = false;
const MAX_CONCURRENT = 2;
let activeJobs = 0;

class ConversationProcessor {

static async submit({ conversationId, leadId, zohoLeadId, sourceType, sourceRef, transcript, leadInfo }) {
  console.log('[ConversationProcessor] Received ' + sourceType + ' conversation for lead ' + leadId);
  const analysis = await ConversationAnalysis.create({
    conversation_id: toUUID(conversationId),
    lead_id: leadId,
    source_type: sourceType,
    source_ref: sourceRef || null
  });
  queue.push({ analysisId: analysis.id, conversationId, leadId, zohoLeadId, sourceType, transcript, leadInfo });
  console.log('[ConversationProcessor] Queued analysis ' + analysis.id + ' (queue size: ' + queue.length + ')');
  ConversationProcessor._processQueue().catch(err => {
    console.error('[ConversationProcessor] Queue processing error:', err.message);
  });
  return analysis.id;
}

static async _processQueue() {
  if (isProcessing && activeJobs >= MAX_CONCURRENT) return;
  isProcessing = true;
  while (queue.length > 0 && activeJobs < MAX_CONCURRENT) {
    const job = queue.shift();
    activeJobs++;
    ConversationProcessor._processJob(job).finally(() => {
      activeJobs--;
      if (queue.length > 0) { ConversationProcessor._processQueue().catch(() => {}); }
    });
  }
  if (queue.length === 0 && activeJobs === 0) { isProcessing = false; }
}

static async _processJob(job) {
  const { analysisId, conversationId, leadId, zohoLeadId, sourceType, transcript, leadInfo } = job;
  const startTime = Date.now();
  let retryCount = 0;
  console.log('[ConversationProcessor] Starting analysis ' + analysisId);
  while (retryCount < 3) {
    try {
      const rawAnalysis = await AIAnalysisService.analyze({ sourceType, transcript, leadInfo: leadInfo || {} });
      const sanitized = AIAnalysisService.sanitize(rawAnalysis);
      const saved = await ConversationAnalysis.saveAnalysis(analysisId, sanitized);
      const elapsed = Date.now() - startTime;
      console.log('[ConversationProcessor] Analysis ' + analysisId + ' completed in ' + elapsed + 'ms');
      // Phase 3.1: Auto-publish conversation prediction (fire-and-forget)
    setImmediate(() => PredictionPublisher.conversation(leadId, sanitized).catch(() => {}));
      if (zohoLeadId) {
        ZohoCRMUpdater.syncAnalysis(zohoLeadId, analysisId, sanitized).catch(err => {
          console.error('[ConversationProcessor] Zoho sync failed for ' + analysisId + ':', err.message);
        });
      }
      return saved;
    } catch (err) {
      retryCount++;
      console.error('[ConversationProcessor] Analysis ' + analysisId + ' failed (attempt ' + retryCount + '):', err.message);
      if (retryCount < 3) {
        const delay = retryCount * 5000;
        console.log('[ConversationProcessor] Retrying in ' + delay + 'ms...');
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        await ConversationAnalysis.markFailed(analysisId, err.message, retryCount).catch(() => {});
        console.error('[ConversationProcessor] Analysis ' + analysisId + ' permanently failed after 3 attempts');
      }
    }
  }
}

static async reanalyze({ analysisId, transcript, leadInfo, zohoLeadId }) {
  const existing = await ConversationAnalysis.findById(analysisId);
  if (!existing) throw new Error('Analysis record not found');
  await ConversationAnalysis.markFailed(analysisId, null, 0);
  queue.unshift({ analysisId, conversationId: existing.conversation_id, leadId: existing.lead_id, zohoLeadId, sourceType: existing.source_type, transcript, leadInfo });
  ConversationProcessor._processQueue().catch(() => {});
  return analysisId;
}

static status() {
  return { queueSize: queue.length, activeJobs, isProcessing };
}
}

module.exports = ConversationProcessor;
