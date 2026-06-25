'use strict';

const ConversationAnalysis = require('../models/ConversationAnalysis');
const AIAnalysisService = require('./AIAnalysisService');
const ZohoCRMUpdater = require('./ZohoCRMUpdater');
const LeadMemory = require('../../memory/models/LeadMemory');

/**
 * ConversationProcessor
 * Manages async analysis of conversations.
 * Receives a conversation, queues it, analyzes with AI, saves results,
 * updates Business Memory timeline, and syncs to Zoho CRM.
 * Phase 3 - Conversation Intelligence Engine
 */

// In-memory queue for pending analysis jobs
const queue = [];
let isProcessing = false;
const MAX_CONCURRENT = 2;
let activeJobs = 0;

class ConversationProcessor {

  /**
   * Submit a conversation for analysis (non-blocking)
   * @param {object} params
   * @param {string} params.conversationId - unique ID for this conversation
   * @param {string} params.leadId - internal lead UUID from lead_memory
   * @param {string} params.zohoLeadId - Zoho CRM lead ID for CRM sync
   * @param {string} params.sourceType - salesiq | retell | email | crm_note
   * @param {string} params.sourceRef - original record reference
   * @param {string} params.transcript - raw conversation text
   * @param {object} params.leadInfo - lead metadata for AI context
   * @returns {string} analysis record ID
   */
  static async submit({ conversationId, leadId, zohoLeadId, sourceType, sourceRef, transcript, leadInfo }) {
    console.log(`[ConversationProcessor] Received ${sourceType} conversation for lead ${leadId}`);

    // Create pending analysis record immediately
    const analysis = await ConversationAnalysis.create({
      conversation_id: conversationId,
      lead_id: leadId,
      source_type: sourceType,
      source_ref: sourceRef || null
    });

    // Queue for async processing - do not await
    queue.push({
      analysisId: analysis.id,
      conversationId,
      leadId,
      zohoLeadId,
      sourceType,
      transcript,
      leadInfo
    });

    console.log(`[ConversationProcessor] Queued analysis ${analysis.id} (queue size: ${queue.length})`);

    // Start processing if not already running
    ConversationProcessor._processQueue().catch(err => {
      console.error('[ConversationProcessor] Queue processing error:', err.message);
    });

    return analysis.id;
  }

  /**
   * Process the queue asynchronously
   */
  static async _processQueue() {
    if (isProcessing && activeJobs >= MAX_CONCURRENT) return;
    isProcessing = true;

    while (queue.length > 0 && activeJobs < MAX_CONCURRENT) {
      const job = queue.shift();
      activeJobs++;

      // Process each job without blocking the queue loop
      ConversationProcessor._processJob(job)
        .finally(() => {
          activeJobs--;
          if (queue.length > 0) {
            ConversationProcessor._processQueue().catch(() => {});
          }
        });
    }

    if (queue.length === 0 && activeJobs === 0) {
      isProcessing = false;
    }
  }

  /**
   * Process a single analysis job
   */
  static async _processJob(job) {
    const { analysisId, conversationId, leadId, zohoLeadId, sourceType, transcript, leadInfo } = job;
    const startTime = Date.now();
    let retryCount = 0;

    console.log(`[ConversationProcessor] Starting analysis ${analysisId}`);

    while (retryCount < 3) {
      try {
        // Run AI analysis
        const rawAnalysis = await AIAnalysisService.analyze({
          sourceType,
          transcript,
          leadInfo: leadInfo || {}
        });

        // Sanitize and save
        const sanitized = AIAnalysisService.sanitize(rawAnalysis);
        const saved = await ConversationAnalysis.saveAnalysis(analysisId, sanitized);

        const elapsed = Date.now() - startTime;
        console.log(`[ConversationProcessor] Analysis ${analysisId} completed in ${elapsed}ms | status=completed`);

        // Sync to Zoho CRM (non-blocking)
        if (zohoLeadId) {
          ZohoCRMUpdater.syncAnalysis(zohoLeadId, analysisId, sanitized).catch(err => {
            console.error(`[ConversationProcessor] Zoho sync failed for ${analysisId}:`, err.message);
          });
        }

        return saved;

      } catch (err) {
        retryCount++;
        console.error(`[ConversationProcessor] Analysis ${analysisId} failed (attempt ${retryCount}):`, err.message);

        if (retryCount < 3) {
          // Wait before retry: 5s, 15s
          const delay = retryCount * 5000;
          console.log(`[ConversationProcessor] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Mark as failed after 3 attempts
          await ConversationAnalysis.markFailed(analysisId, err.message, retryCount).catch(() => {});
          console.error(`[ConversationProcessor] Analysis ${analysisId} permanently failed after 3 attempts`);
        }
      }
    }
  }

  /**
   * Manually trigger reanalysis of an existing record
   */
  static async reanalyze({ analysisId, transcript, leadInfo, zohoLeadId }) {
    const existing = await ConversationAnalysis.findById(analysisId);
    if (!existing) throw new Error('Analysis record not found');

    // Reset to pending
    await ConversationAnalysis.markFailed(analysisId, null, 0);

    // Queue for reprocessing
    queue.unshift({
      analysisId,
      conversationId: existing.conversation_id,
      leadId: existing.lead_id,
      zohoLeadId,
      sourceType: existing.source_type,
      transcript,
      leadInfo
    });

    ConversationProcessor._processQueue().catch(() => {});
    return analysisId;
  }

  /**
   * Get current queue status
   */
  static status() {
    return {
      queueSize: queue.length,
      activeJobs,
      isProcessing
    };
  }
}

module.exports = ConversationProcessor;
