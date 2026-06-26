'use strict';
/**
 * EventOrchestrator
 * Single source of event-driven automation for the Maya AI Sales Platform.
 *
 * Every ingestor and processor calls EventOrchestrator.emit(eventName, payload)
 * after completing its own work. The orchestrator then automatically triggers
 * the correct downstream modules — no manual API calls required.
 *
 * CONTEXT-AWARE PROCESSING (updated):
 * Qualification and Decision generation are now gated behind the ContextEngine.
 * On `lead.created`, the system does NOT immediately qualify or generate decisions.
 * Instead, ContextEngine evaluates available evidence. If below the threshold,
 * the lead is logged as "awaiting evidence" and the Slack message indicates what
 * information is still needed. Once a conversation, call, chat, or email arrives
 * (any event with real interaction data), the qualification + decision pipeline runs.
 *
 * EVENTS:
 *   lead.created           -> context check, revenue, intelligence, Slack (awaiting evidence)
 *   conversation.analyzed  -> qualify, decision, intelligence, learning, Slack
 *   call.completed         -> analyze conversation -> chains to conversation.analyzed
 *   chat.completed         -> analyze conversation -> chains to conversation.analyzed
 *   email.replied          -> qualify (context-gated), decision (context-gated), learning
 *   qualification.updated  -> decision (context-gated), revenue, intelligence, Slack (hot)
 *   decision.generated     -> workflow (operations), learning, Slack
 *   task.completed         -> qualify (context-gated), learning
 *   onboarding.completed   -> revenue, learning, intelligence, Slack
 */

const QualificationProcessor = require('../qualification/services/QualificationProcessor');
const DecisionProcessor = require('../decisions/services/DecisionProcessor');
const ConversationProcessor = require('../intelligence/services/ConversationProcessor');
const IntelligenceProcessor = require('../intelligence/services/IntelligenceProcessor');
const WorkflowEngine = require('../operations/services/WorkflowEngine');
const RevenueForecaster = require('../revenue/services/RevenueForecaster');
const LearningEngine = require('../learning/services/LearningEngine');
const SlackNotifier = require('./SlackNotifier');
const { ContextEngine } = require('./ContextEngine');

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

  /**
   * lead.created
   *
   * A brand-new lead has zero interaction history. We do NOT immediately
   * qualify or generate decisions — there is no evidence for the AI to work
   * with. Instead:
   *  1. Evaluate context to understand what is missing.
   *  2. Post a Slack message indicating the lead arrived and what signals
   *     are still needed before the AI can process it.
   *  3. Schedule revenue refresh and intelligence refresh.
   *
   * Qualification + Decisions will fire automatically when the first
   * conversation.analyzed, call.completed, or chat.completed event arrives.
   */
  static async _onLeadCreated(lead_id, zoho_lead_id, payload) {
    try {
      // Evaluate context — this gives us the evidence score and missing signals
      const ctx = await ContextEngine.evaluate(lead_id, zoho_lead_id).catch(e => {
        console.error('[EO] ContextEngine.evaluate error:', e.message);
        return null;
      });

      console.log(`[EO] lead.created: evidence_score=${ctx ? ctx.evidence_score : 'n/a'} lead=${lead_id}`);

      if (ctx && ctx.ready_for_qualification) {
        // Edge case: lead was created with pre-existing context (e.g., re-import)
        console.log(`[EO] lead.created: context already sufficient (score=${ctx.evidence_score}), proceeding with qualification`);
        if (!_dedupe('qualify:' + lead_id, 5000)) {
          await QualificationProcessor.submit({ leadId: lead_id, zohoLeadId: zoho_lead_id || null, triggerEvent: 'lead_created', triggerRef: null });
        }
        if (!_dedupe('decision:' + lead_id + ':created', 5000)) {
          await DecisionProcessor.queueDecisionGeneration(lead_id, 'lead_created', 'zoho_crm', payload);
        }
      } else {
        // Normal case: new lead, no interactions yet
        const missingList = ctx
          ? ctx.missing_signals.filter(s => s.severity === 'critical' || s.severity === 'high').map(s => s.signal)
          : ['No context data available'];
        console.log(`[EO] lead.created: insufficient evidence (score=${ctx ? ctx.evidence_score : 0}). Waiting for: ${missingList.join(', ')}`);
      }

      // Always: schedule revenue refresh and intelligence update
      EventOrchestrator._scheduleRevenueRefresh();
      IntelligenceProcessor.triggerRefresh('lead_created', { lead_id }).catch(e => console.error('[EO] Intel error:', e.message));

      // Always: notify Slack with evidence-aware message
      const missingSignalsSummary = ctx && ctx.missing_signals.length > 0
        ? ctx.missing_signals.filter(s => s.severity === 'critical' || s.severity === 'high').map(s => s.signal).join(', ')
        : null;

      SlackNotifier.notifyLeadCreated({
        lead_name:        payload.lead_name || payload.name || lead_id,
        crm_owner:        payload.crm_owner || payload.owner,
        zoho_lead_id:     zoho_lead_id || payload.zoho_lead_id,
        lead_id,
        evidence_score:   ctx ? ctx.evidence_score : 0,
        awaiting_signals: missingSignalsSummary,
        ready_for_ai:     ctx ? ctx.ready_for_qualification : false
      }).catch(e => console.error('[EO] Slack error:', e.message));

    } catch (e) { console.error('[EO] _onLeadCreated:', e.message); }
  }

  /**
   * conversation.analyzed
   *
   * A real conversation has been processed. This is the primary trigger
   * for qualification and decision generation. ContextEngine will now
   * have enough evidence to clear the threshold (conversation score = 25 pts).
   */
  static async _onConversationAnalyzed(lead_id, zoho_lead_id, payload) {
    try {
      if (!_dedupe('qualify:' + lead_id, 3000)) {
        await QualificationProcessor.submit({
          leadId: lead_id,
          zohoLeadId: zoho_lead_id || null,
          triggerEvent: 'conversation_analyzed',
          triggerRef: payload.analysis_id || null
        });
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
      // Notify Slack
      SlackNotifier.send('call.completed', {
        title: 'Call Completed',
        lead_name: payload.lead_name || lead_id,
        priority: 'medium',
        assigned_to: payload.crm_owner,
        zoho_lead_id: zoho_lead_id,
        next_action: 'Transcript analyzed — qualification and decisions queued automatically',
        lead_id
      }).catch(e => console.error('[EO] Slack error:', e.message));
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
      // Notify Slack
      SlackNotifier.send('chat.completed', {
        title: 'Chat Conversation Received',
        lead_name: payload.visitor_name || lead_id,
        priority: 'medium',
        assigned_to: payload.crm_owner,
        zoho_lead_id: zoho_lead_id,
        next_action: 'Chat analyzed — qualification and decisions queued automatically',
        lead_id
      }).catch(e => console.error('[EO] Slack error:', e.message));
    } catch (e) { console.error('[EO] _onChatCompleted:', e.message); }
  }

  static async _onEmailReplied(lead_id, zoho_lead_id, payload) {
    try {
      // Email reply is real interaction — context threshold may now be met
      if (!_dedupe('qualify:' + lead_id, 3000)) {
        await QualificationProcessor.submit({
          leadId: lead_id,
          zohoLeadId: zoho_lead_id || null,
          triggerEvent: 'email_replied',
          triggerRef: payload.message_id || null
        });
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
      // Notify Slack for hot leads
      if (payload.category === 'hot' || payload.category_changed) {
        SlackNotifier.notifyLeadQualified({
          lead_name:          payload.lead_name || lead_id,
          category:           payload.category,
          qualification_score:payload.qualification_score,
          crm_owner:          payload.crm_owner || payload.owner,
          zoho_lead_id:       zoho_lead_id || payload.zoho_lead_id,
          lead_id
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
          // Notify Slack for critical/high decisions
          if (decision.priority === 'critical' || decision.priority === 'high') {
            SlackNotifier.notifyDecisionGenerated({
              lead_name:          payload.lead_name || lead_id,
              priority:           decision.priority,
              confidence_score:   decision.confidence_score,
              crm_owner:          decision.crm_owner || payload.crm_owner,
              zoho_lead_id:       payload.zoho_lead_id,
              recommended_action: decision.recommended_action || decision.decision_type,
              reason:             decision.reason,
              lead_id
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
        await QualificationProcessor.submit({
          leadId: lead_id,
          zohoLeadId: zoho_lead_id || null,
          triggerEvent: 'task_completed',
          triggerRef: payload.decision_id || null
        });
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
      // Notify Slack
      SlackNotifier.send('onboarding.completed', {
        title: 'Onboarding Completed',
        lead_name: payload.lead_name || lead_id,
        priority: 'high',
        assigned_to: payload.crm_owner,
        zoho_lead_id: payload.zoho_lead_id,
        next_action: 'Lead onboarded — revenue forecast and learning evaluation triggered',
        lead_id
      }).catch(e => console.error('[EO] Slack error:', e.message));
    } catch (e) { console.error('[EO] _onOnboardingCompleted:', e.message); }
  }

  // Revenue recalculation coalesced: runs once after 15s of quiet
  static _revenueTimer = null;
  static _scheduleRevenueRefresh(immediate = false) {
    if (immediate) {
      if (EventOrchestrator._revenueTimer) { clearTimeout(EventOrchestrator._revenueTimer); EventOrchestrator._revenueTimer = null; }
      const bounds = RevenueForecaster.getPeriodBounds('daily');
      setImmediate(() => RevenueForecaster.runForecast('daily', bounds.start, bounds.end)
        .then(() => SlackNotifier.notifyRevenueForecastUpdated({ title: 'Revenue Forecast Updated' }).catch(() => {}))
        .catch(e => console.error('[EO] Revenue error:', e.message)));
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
