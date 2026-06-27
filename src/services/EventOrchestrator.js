'use strict';
/**
 * EventOrchestrator - Phase 2 Updated
 * Routes events to the durable job queue (WorkerRegistry) instead of
 * directly calling in-memory processors.
 *
 * This is the key integration point: the orchestrator now enqueues jobs
 * persistently. Even if the process crashes after receiving an event,
 * the job will be picked up on restart.
 *
 * Business logic is unchanged. Only the execution path is now durable.
 */

const WorkerRegistry = require('../queue/WorkerRegistry');
const ConversationProcessor = require('../intelligence/services/ConversationProcessor');
const IntelligenceProcessor = require('../intelligence/services/IntelligenceProcessor');
const WorkflowEngine = require('../operations/services/WorkflowEngine');
const RevenueForecaster = require('../revenue/services/RevenueForecaster');
const LearningEngine = require('../learning/services/LearningEngine');
const SlackNotifier = require('./SlackNotifier');
const { ContextEngine } = require('./ContextEngine');

const _debounce = new Map();
function _dedupe(key, windowMs) {
  const now = Date.now();
  const last = _debounce.get(key) || 0;
  if (now - last < windowMs) return true;
  _debounce.set(key, now);
  return false;
}

let _lastLearningEval = 0;
const LEARNING_EVAL_INTERVAL = 6 * 60 * 60 * 1000;

class EventOrchestrator {

  static emit(event, payload) {
    payload = payload || {};
    const { lead_id, zoho_lead_id } = payload;
    console.log('[EventOrchestrator] emit:', event, 'lead=' + (lead_id || '(none)'));

    switch (event) {
      case 'lead.created':
        if (lead_id) setImmediate(() => EventOrchestrator._onLeadCreated(lead_id, zoho_lead_id, payload));
        break;
      case 'conversation.analyzed':
        if (lead_id) setImmediate(() => EventOrchestrator._onConversationAnalyzed(lead_id, zoho_lead_id, payload));
        break;
      case 'call.completed':
        if (lead_id) setImmediate(() => EventOrchestrator._onCallCompleted(lead_id, zoho_lead_id, payload));
        break;
      case 'chat.completed':
        if (lead_id) setImmediate(() => EventOrchestrator._onChatCompleted(lead_id, zoho_lead_id, payload));
        break;
      case 'email.replied':
        if (lead_id) setImmediate(() => EventOrchestrator._onEmailReplied(lead_id, zoho_lead_id, payload));
        break;
      case 'qualification.updated':
        if (lead_id) setImmediate(() => EventOrchestrator._onQualificationUpdated(lead_id, zoho_lead_id, payload));
        break;
      case 'decision.generated':
        if (lead_id) setImmediate(() => EventOrchestrator._onDecisionGenerated(lead_id, payload));
        break;
      case 'task.completed':
        if (lead_id) setImmediate(() => EventOrchestrator._onTaskCompleted(lead_id, zoho_lead_id, payload));
        break;
      case 'onboarding.completed':
        if (lead_id) setImmediate(() => EventOrchestrator._onOnboardingCompleted(lead_id, payload));
        break;
      default:
        console.warn('[EventOrchestrator] Unknown event:', event);
    }
  }

  static async _onLeadCreated(lead_id, zoho_lead_id, payload) {
    try {
      const ctx = await ContextEngine.evaluate(lead_id, zoho_lead_id).catch(e => {
        console.error('[EO] ContextEngine.evaluate error:', e.message); return null;
      });
      console.log('[EO] lead.created: evidence_score=' + (ctx ? ctx.evidence_score : 'n/a') + ' lead=' + lead_id);

      if (ctx && ctx.ready_for_qualification) {
        if (!_dedupe('qualify:' + lead_id, 5000)) {
          // Phase 2: enqueue durably instead of calling directly
          await WorkerRegistry.enqueueQualification({
            leadId: lead_id, zohoLeadId: zoho_lead_id || null,
            triggerEvent: 'lead_created', triggerRef: null
          }).catch(e => console.error('[EO] Queue qualification error:', e.message));
        }
        if (!_dedupe('decision:' + lead_id + ':created', 5000)) {
          await WorkerRegistry.enqueueDecision({
            lead_id, trigger_event: 'lead_created', trigger_source: 'zoho_crm', trigger_data: payload
          }).catch(e => console.error('[EO] Queue decision error:', e.message));
        }
      } else {
        const missingList = ctx
          ? ctx.missing_signals.filter(s => s.severity === 'critical' || s.severity === 'high').map(s => s.signal)
          : ['No context data available'];
        console.log('[EO] lead.created: insufficient evidence. Waiting for:', missingList.join(', '));
      }

      EventOrchestrator._scheduleRevenueRefresh();
      IntelligenceProcessor.triggerRefresh('lead_created', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));

      const missingSignalsSummary = ctx && ctx.missing_signals.length > 0
        ? ctx.missing_signals.filter(s => s.severity === 'critical' || s.severity === 'high').map(s => s.signal).join(', ')
        : null;

      SlackNotifier.notifyLeadCreated({
        lead_name: payload.lead_name || payload.name || lead_id,
        crm_owner: payload.crm_owner || payload.owner,
        zoho_lead_id: zoho_lead_id || payload.zoho_lead_id,
        lead_id, evidence_score: ctx ? ctx.evidence_score : 0,
        awaiting_signals: missingSignalsSummary, ready_for_ai: ctx ? ctx.ready_for_qualification : false
      }).catch(e => console.error('[EO] Slack error:', e.message));

    } catch (e) { console.error('[EO] _onLeadCreated:', e.message); }
  }

  static async _onConversationAnalyzed(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 3000)) {
        await WorkerRegistry.enqueueQualification({
          leadId: lead_id, zohoLeadId: zoho_lead_id || null,
          triggerEvent: 'conversation_analyzed', triggerRef: payload.analysis_id || null
        }).catch(e => console.error('[EO] Queue qual error:', e.message));
      }
      if (!_dedupe('decision:' + lead_id + ':conv', 3000)) {
        await WorkerRegistry.enqueueDecision({
          lead_id, trigger_event: 'conversation_analyzed',
          trigger_source: 'conversation_intelligence', trigger_data: payload
        }).catch(e => console.error('[EO] Queue decision error:', e.message));
      }
      IntelligenceProcessor.triggerRefresh('conversation_analyzed', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onConversationAnalyzed:', e.message); }
  }

  static async _onCallCompleted(lead_id, zoho_lead_id, payload) {
    try {
      const transcript = payload.transcript || payload.call_summary || '(no transcript)';
      // Phase 2: enqueue conversation analysis durably with idempotency
      await WorkerRegistry.enqueueConversation({
        conversationId: payload.call_id || ('call-' + lead_id + '-' + Date.now()),
        leadId: lead_id, zohoLeadId: zoho_lead_id || null,
        sourceType: 'retell', sourceRef: payload.call_id || null,
        transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
        leadInfo: { name: payload.lead_name, email: payload.email, phone: payload.phone }
      }).catch(e => {
        // Fallback to direct processing if queue not available
        console.error('[EO] Queue error, falling back to direct:', e.message);
        ConversationProcessor.submit({
          conversationId: payload.call_id || ('call-' + lead_id + '-' + Date.now()),
          leadId: lead_id, zohoLeadId: zoho_lead_id || null,
          sourceType: 'retell', sourceRef: payload.call_id || null,
          transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
          leadInfo: { name: payload.lead_name, email: payload.email, phone: payload.phone }
        });
      });
      SlackNotifier.send('call.completed', {
        title: 'Call Completed', lead_name: payload.lead_name || lead_id, priority: 'medium',
        assigned_to: payload.crm_owner, zoho_lead_id: zoho_lead_id,
        next_action: 'Transcript queued for analysis', lead_id
      }).catch(e => console.error('[EO] Slack error:', e.message));
    } catch (e) { console.error('[EO] _onCallCompleted:', e.message); }
  }

  static async _onChatCompleted(lead_id, zoho_lead_id, payload) {
    try {
      const transcript = payload.transcript || payload.chat_summary || '(no transcript)';
      await WorkerRegistry.enqueueConversation({
        conversationId: payload.chat_id || ('chat-' + lead_id + '-' + Date.now()),
        leadId: lead_id, zohoLeadId: zoho_lead_id || null,
        sourceType: 'salesiq', sourceRef: payload.chat_id || null,
        transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
        leadInfo: { name: payload.visitor_name, email: payload.visitor_email }
      }).catch(e => console.error('[EO] Queue chat error:', e.message));
      SlackNotifier.send('chat.completed', {
        title: 'Chat Conversation Received', lead_name: payload.visitor_name || lead_id,
        priority: 'medium', assigned_to: payload.crm_owner, zoho_lead_id: zoho_lead_id,
        next_action: 'Chat queued for analysis', lead_id
      }).catch(e => console.error('[EO] Slack error:', e.message));
    } catch (e) { console.error('[EO] _onChatCompleted:', e.message); }
  }

  static async _onEmailReplied(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 3000)) {
        await WorkerRegistry.enqueueQualification({
          leadId: lead_id, zohoLeadId: zoho_lead_id || null,
          triggerEvent: 'email_replied', triggerRef: payload.message_id || null
        }).catch(e => console.error('[EO] Queue qual error:', e.message));
      }
      if (!_dedupe('decision:' + lead_id + ':email', 3000)) {
        await WorkerRegistry.enqueueDecision({
          lead_id, trigger_event: 'email_replied', trigger_source: 'email', trigger_data: payload
        }).catch(e => console.error('[EO] Queue decision error:', e.message));
      }
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onEmailReplied:', e.message); }
  }

  static async _onQualificationUpdated(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('decision:' + lead_id + ':qual', 2000)) {
        await WorkerRegistry.enqueueDecision({
          lead_id, trigger_event: 'qualification_updated',
          trigger_source: 'qualification_engine', trigger_data: payload
        }).catch(e => console.error('[EO] Queue decision error:', e.message));
      }
      EventOrchestrator._scheduleRevenueRefresh();
      if (payload.category_changed) {
        IntelligenceProcessor.triggerRefresh('qualification_updated', { lead_id, category: payload.category }).catch(e => console.error('[EO] Intel error:', e.message));
      }
      if (payload.category === 'hot' || payload.category_changed) {
        SlackNotifier.notifyLeadQualified({
          lead_name: payload.lead_name || lead_id, category: payload.category,
          qualification_score: payload.qualification_score, crm_owner: payload.crm_owner || payload.owner,
          zoho_lead_id: zoho_lead_id || payload.zoho_lead_id, lead_id
        }).catch(e => console.error('[EO] Slack error:', e.message));
      }
    } catch (e) { console.error('[EO] _onQualificationUpdated:', e.message); }
  }

  static async _onDecisionGenerated(lead_id, payload) {
    try {
      const decisions = payload.decisions || (payload.decision ? [payload.decision] : []);
      for (const decision of decisions) {
        if (decision.status !== 'dismissed' && decision.status !== 'expired') {
          WorkflowEngine.triggerFromDecision({ ...decision, crm_owner: decision.crm_owner || payload.crm_owner || null })
            .catch(e => console.error('[EO] WorkflowEngine error:', e.message));
          if (decision.priority === 'critical' || decision.priority === 'high') {
            SlackNotifier.notifyDecisionGenerated({
              lead_name: payload.lead_name || lead_id, priority: decision.priority,
              confidence_score: decision.confidence_score, crm_owner: decision.crm_owner || payload.crm_owner,
              zoho_lead_id: payload.zoho_lead_id, recommended_action: decision.recommended_action || decision.decision_type,
              reason: decision.reason, lead_id
            }).catch(e => console.error('[EO] Slack error:', e.message));
          }
        }
      }
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onDecisionGenerated:', e.message); }
  }

  static async _onTaskCompleted(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 5000)) {
        await WorkerRegistry.enqueueQualification({
          leadId: lead_id, zohoLeadId: zoho_lead_id || null,
          triggerEvent: 'task_completed', triggerRef: payload.decision_id || null
        }).catch(e => console.error('[EO] Queue qual error:', e.message));
      }
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onTaskCompleted:', e.message); }
  }

  static async _onOnboardingCompleted(lead_id, payload) {
    try {
      EventOrchestrator._scheduleRevenueRefresh(true);
      IntelligenceProcessor.triggerRefresh('onboarding_completed', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));
      _lastLearningEval = 0;
      EventOrchestrator._maybeTriggerLearning();
      SlackNotifier.send('onboarding.completed', {
        title: 'Onboarding Completed', lead_name: payload.lead_name || lead_id, priority: 'high',
        assigned_to: payload.crm_owner, zoho_lead_id: payload.zoho_lead_id,
        next_action: 'Revenue forecast and learning evaluation queued', lead_id
      }).catch(e => console.error('[EO] Slack error:', e.message));
    } catch (e) { console.error('[EO] _onOnboardingCompleted:', e.message); }
  }

  static _revenueTimer = null;
  static _scheduleRevenueRefresh(immediate = false) {
    if (immediate) {
      if (EventOrchestrator._revenueTimer) { clearTimeout(EventOrchestrator._revenueTimer); EventOrchestrator._revenueTimer = null; }
      WorkerRegistry.enqueueRevenueForecast({ period: 'daily' }).catch(e => {
        // Fallback to direct
        const bounds = RevenueForecaster.getPeriodBounds('daily');
        setImmediate(() => RevenueForecaster.runForecast('daily', bounds.start, bounds.end)
          .then(() => SlackNotifier.notifyRevenueForecastUpdated({ title: 'Revenue Forecast Updated' }).catch(() => {}))
          .catch(e2 => console.error('[EO] Revenue error:', e2.message)));
      });
      return;
    }
    if (EventOrchestrator._revenueTimer) return;
    EventOrchestrator._revenueTimer = setTimeout(() => {
      EventOrchestrator._revenueTimer = null;
      WorkerRegistry.enqueueRevenueForecast({ period: 'daily' }).catch(() => {
        const bounds = RevenueForecaster.getPeriodBounds('daily');
        RevenueForecaster.runForecast('daily', bounds.start, bounds.end).catch(e => console.error('[EO] Revenue error:', e.message));
      });
    }, 15000);
  }

  static _maybeTriggerLearning() {
    const now = Date.now();
    if (now - _lastLearningEval < LEARNING_EVAL_INTERVAL) return;
    _lastLearningEval = now;
    setImmediate(() => LearningEngine.runFullEvaluation().catch(e => console.error('[EO] Learning error:', e.message)));
  }
}

module.exports = EventOrchestrator;
