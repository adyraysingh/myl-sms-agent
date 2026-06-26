'use strict';
/**
 * EventOrchestrator
 * Single source of event-driven automation for the Maya AI Sales Platform.
 *
 * Every ingestor and processor calls EventOrchestrator.emit(eventName, payload)
 * after completing its own work. The orchestrator then automatically triggers
 * the correct downstream modules — no manual API calls required.
 *
 * EVENTS:
 *   lead.created              -> qualify, decision, revenue, intelligence, learning
 *   conversation.analyzed     -> qualify, decision, intelligence, learning
 *   call.completed            -> analyze conversation, qualify, decision, learning
 *   chat.completed            -> analyze conversation, qualify, decision, learning
 *   email.replied             -> qualify, decision, learning
 *   qualification.updated     -> decision, revenue, intelligence, learning
 *   decision.generated        -> workflow (operations), learning
 *   task.completed            -> qualify, learning
 *   onboarding.completed      -> revenue, learning, intelligence
 */

const QualificationProcessor = require('../qualification/services/QualificationProcessor');
const DecisionProcessor       = require('../decisions/services/DecisionProcessor');
const ConversationProcessor   = require('../intelligence/services/ConversationProcessor');
const IntelligenceProcessor   = require('../intelligence/services/IntelligenceProcessor');
const WorkflowEngine          = require('../operations/services/WorkflowEngine');
const RevenueForecaster       = require('../revenue/services/RevenueForecaster');
const LearningEngine          = require('../learning/services/LearningEngine');

// Debounce map: prevent the same lead from flooding the same pipeline
const _debounce = new Map();
function _dedupe(key, windowMs) {
  const now = Date.now();
  const last = _debounce.get(key) || 0;
  if (now - last < windowMs) return true;
  _debounce.set(key, now);
  return false;
}

// Learning evaluation is expensive — run at most once per 6 hours
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
      if (!_dedupe('qualify:' + lead_id, 5000)) {
        await QualificationProcessor.submit({ leadId: lead_id, zohoLeadId: zoho_lead_id || null, triggerEvent: 'lead_created', triggerRef: null });
      }
      if (!_dedupe('decision:' + lead_id + ':created', 5000)) {
        await DecisionProcessor.queueDecisionGeneration(lead_id, 'lead_created', 'zoho_crm', payload);
      }
      EventOrchestrator._scheduleRevenueRefresh();
      IntelligenceProcessor.triggerRefresh('lead_created', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));
    } catch (e) { console.error('[EO] _onLeadCreated:', e.message); }
  }

  static async _onConversationAnalyzed(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 3000)) {
        await QualificationProcessor.submit({ leadId: lead_id, zohoLeadId: zoho_lead_id || null, triggerEvent: 'conversation_analyzed', triggerRef: payload.analysis_id || null });
      }
      if (!_dedupe('decision:' + lead_id + ':conv', 3000)) {
        await DecisionProcessor.queueDecisionGeneration(lead_id, 'conversation_analyzed', 'conversation_intelligence', payload);
      }
      IntelligenceProcessor.triggerRefresh('conversation_analyzed', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onConversationAnalyzed:', e.message); }
  }

  static async _onCallCompleted(lead_id, zoho_lead_id, payload) {
    try {
      const transcript = payload.transcript || payload.call_summary || '(no transcript)';
      await ConversationProcessor.submit({
        conversationId: payload.call_id || ('call-' + lead_id + '-' + Date.now()),
        leadId: lead_id, zohoLeadId: zoho_lead_id || null,
        sourceType: 'retell', sourceRef: payload.call_id || null,
        transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
        leadInfo: { name: payload.lead_name, email: payload.email, phone: payload.phone }
      });
      // ConversationProcessor emits conversation.analyzed when done -> chains automatically
    } catch (e) { console.error('[EO] _onCallCompleted:', e.message); }
  }

  static async _onChatCompleted(lead_id, zoho_lead_id, payload) {
    try {
      const transcript = payload.transcript || payload.chat_summary || '(no transcript)';
      await ConversationProcessor.submit({
        conversationId: payload.chat_id || ('chat-' + lead_id + '-' + Date.now()),
        leadId: lead_id, zohoLeadId: zoho_lead_id || null,
        sourceType: 'salesiq', sourceRef: payload.chat_id || null,
        transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
        leadInfo: { name: payload.visitor_name, email: payload.visitor_email }
      });
    } catch (e) { console.error('[EO] _onChatCompleted:', e.message); }
  }

  static async _onEmailReplied(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 3000)) {
        await QualificationProcessor.submit({ leadId: lead_id, zohoLeadId: zoho_lead_id || null, triggerEvent: 'email_replied', triggerRef: payload.message_id || null });
      }
      if (!_dedupe('decision:' + lead_id + ':email', 3000)) {
        await DecisionProcessor.queueDecisionGeneration(lead_id, 'email_replied', 'email', payload);
      }
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onEmailReplied:', e.message); }
  }

  static async _onQualificationUpdated(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('decision:' + lead_id + ':qual', 2000)) {
        await DecisionProcessor.queueDecisionGeneration(lead_id, 'qualification_updated', 'qualification_engine', payload);
      }
      EventOrchestrator._scheduleRevenueRefresh();
      if (payload.category_changed) {
        IntelligenceProcessor.triggerRefresh('qualification_updated', { lead_id, category: payload.category }).catch(e => console.error('[EO] Intel error:', e.message));
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
        }
      }
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onDecisionGenerated:', e.message); }
  }

  static async _onTaskCompleted(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 5000)) {
        await QualificationProcessor.submit({ leadId: lead_id, zohoLeadId: zoho_lead_id || null, triggerEvent: 'task_completed', triggerRef: payload.decision_id || null });
      }
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onTaskCompleted:', e.message); }
  }

  static async _onOnboardingCompleted(lead_id, payload) {
    try {
      EventOrchestrator._scheduleRevenueRefresh(true);
      IntelligenceProcessor.triggerRefresh('onboarding_completed', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));
      _lastLearningEval = 0; // Force learning after real outcome
      EventOrchestrator._maybeTriggerLearning();
    } catch (e) { console.error('[EO] _onOnboardingCompleted:', e.message); }
  }

  // Revenue recalculation coalesced: runs once after 15s of quiet
  static _revenueTimer = null;
  static _scheduleRevenueRefresh(immediate = false) {
    if (immediate) {
      if (EventOrchestrator._revenueTimer) { clearTimeout(EventOrchestrator._revenueTimer); EventOrchestrator._revenueTimer = null; }
      const bounds = RevenueForecaster.getPeriodBounds('daily');
      setImmediate(() => RevenueForecaster.runForecast('daily', bounds.start, bounds.end).catch(e => console.error('[EO] Revenue error:', e.message)));
      return;
    }
    if (EventOrchestrator._revenueTimer) return;
    EventOrchestrator._revenueTimer = setTimeout(() => {
      EventOrchestrator._revenueTimer = null;
      const bounds = RevenueForecaster.getPeriodBounds('daily');
      RevenueForecaster.runForecast('daily', bounds.start, bounds.end).catch(e => console.error('[EO] Revenue error:', e.message));
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
