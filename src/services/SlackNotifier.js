'use strict';
/**
 * SlackNotifier — posts AI events to #ai-update-center in Globolosysfashion
 * 
 * All business events are sent here automatically via EventOrchestrator:
 * New Lead Created, Lead Qualified, Hot Lead Detected, Decision Generated,
 * Investigation Started/Completed, Workflow Executed, SLA Breach,
 * Revenue Forecast Updated, AI Error, Platform Warning/Recovery,
 * Daily Executive Summary, Daily AI Health Report
 */

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const CHANNEL = '#ai-update-center';

// Priority → emoji mapping
const PRIORITY_EMOJI = {
  critical: ':rotating_light:',
  high: ':red_circle:',
  medium: ':large_yellow_circle:',
  low: ':large_green_circle:',
  info: ':large_blue_circle:'
};

// Event type → emoji mapping
const EVENT_EMOJI = {
  'lead.created': ':bust_in_silhouette:',
  'lead.qualified': ':white_check_mark:',
  'hot_lead': ':fire:',
  'decision.generated': ':brain:',
  'investigation.started': ':mag:',
  'investigation.completed': ':clipboard:',
  'workflow.executed': ':gear:',
  'sla.breach': ':alarm_clock:',
  'revenue.updated': ':chart_with_upward_trend:',
  'ai.error': ':x:',
  'platform.warning': ':warning:',
  'platform.recovery': ':white_check_mark:',
  'daily.summary': ':bar_chart:',
  'health.report': ':heart:'
};

async function send(eventType, payload) {
  if (!WEBHOOK_URL) {
    console.warn('[SlackNotifier] SLACK_WEBHOOK_URL not set — skipping notification');
    return { success: false, reason: 'no_webhook_url' };
  }

  try {
    const emoji = EVENT_EMOJI[eventType] || ':bell:';
    const priorityEmoji = PRIORITY_EMOJI[payload.priority || 'info'] || ':bell:';
    const ts = payload.timestamp || new Date().toISOString();
    const leadName = payload.lead_name || payload.leadName || 'Unknown Lead';
    const priority = (payload.priority || 'info').toUpperCase();
    const aiConfidence = payload.ai_confidence != null ? (payload.ai_confidence * 100).toFixed(0) + '%' : 'N/A';
    const assignedTo = payload.assigned_to || payload.crm_owner || payload.owner || 'Unassigned';
    const crmLink = payload.zoho_lead_id
      ? 'https://crm.zoho.in/crm/org60057163213/leads/' + payload.zoho_lead_id
      : null;
    const nextAction = payload.next_action || payload.reason || payload.message || 'See platform dashboard';

    const fields = [
      { type: 'mrkdwn', text: '*:calendar: Timestamp:*\n' + new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' },
      { type: 'mrkdwn', text: '*:label: Event:*\n' + eventType.replace(/\./g, ' ').toUpperCase() },
      { type: 'mrkdwn', text: '*:bust_in_silhouette: Lead:*\n' + leadName },
      { type: 'mrkdwn', text: '*' + priorityEmoji + ' Priority:*\n' + priority },
      { type: 'mrkdwn', text: '*:brain: AI Confidence:*\n' + aiConfidence },
      { type: 'mrkdwn', text: '*:handshake: Assigned To:*\n' + assignedTo }
    ];

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: emoji + ' MAYA AI — ' + (payload.title || eventType.replace(/\./g, ' ').toUpperCase()),
          emoji: true
        }
      },
      {
        type: 'section',
        fields: fields
      }
    ];

    // Add CRM link if available
    if (crmLink) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':link: *CRM Record:* <' + crmLink + '|View in Zoho CRM>'
        }
      });
    }

    // Add suggested next action
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':bulb: *Suggested Next Action:* ' + nextAction
      }
    });

    // Add divider
    blocks.push({ type: 'divider' });

    const message = {
      channel: CHANNEL,
      text: emoji + ' MAYA AI — ' + (payload.title || eventType) + ' | ' + leadName + ' | ' + priority,
      blocks: blocks
    };

    const resp = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000)
    });

    const result = await resp.text();
    const success = resp.ok && result === 'ok';

    if (!success) {
      console.error('[SlackNotifier] Webhook failed:', resp.status, result);
    }

    return { success, status: resp.status, response: result };
  } catch (err) {
    console.error('[SlackNotifier] Error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Typed notification helpers ────────────────────────────────────────────────

async function notifyLeadCreated(payload) {
  return send('lead.created', {
    title: 'New Lead Created',
    lead_name: payload.lead_name || payload.name,
    priority: 'medium',
    ai_confidence: null,
    assigned_to: payload.crm_owner || payload.owner,
    zoho_lead_id: payload.zoho_lead_id,
    next_action: 'Review lead profile and begin qualification',
    ...payload
  });
}

async function notifyLeadQualified(payload) {
  const category = (payload.category || 'unknown').toUpperCase();
  const isHot = payload.category === 'hot';
  return send(isHot ? 'hot_lead' : 'lead.qualified', {
    title: isHot ? 'Hot Lead Detected!' : 'Lead Qualified: ' + category,
    lead_name: payload.lead_name,
    priority: isHot ? 'high' : 'medium',
    ai_confidence: payload.qualification_score != null ? payload.qualification_score / 100 : null,
    assigned_to: payload.crm_owner,
    zoho_lead_id: payload.zoho_lead_id,
    next_action: isHot ? 'URGENT: Reach out immediately — hot lead detected' : 'Lead scored ' + (payload.qualification_score || 0) + '/100 — category: ' + category,
    ...payload
  });
}

async function notifyDecisionGenerated(payload) {
  return send('decision.generated', {
    title: 'AI Decision Generated',
    lead_name: payload.lead_name,
    priority: payload.priority || 'medium',
    ai_confidence: payload.confidence_score,
    assigned_to: payload.crm_owner,
    zoho_lead_id: payload.zoho_lead_id,
    next_action: payload.recommended_action || payload.reason || 'Review AI decision in dashboard',
    ...payload
  });
}

async function notifyInvestigation(payload, completed = false) {
  return send(completed ? 'investigation.completed' : 'investigation.started', {
    title: completed ? 'Investigation Completed' : 'Investigation Started',
    lead_name: payload.lead_name,
    priority: payload.priority || 'medium',
    ai_confidence: payload.confidence_score,
    assigned_to: payload.assigned_to,
    zoho_lead_id: payload.zoho_lead_id,
    next_action: completed ? (payload.conclusion || 'Review investigation findings') : 'AI investigating: ' + (payload.trigger || 'lead activity'),
    ...payload
  });
}

async function notifyWorkflowExecuted(payload) {
  return send('workflow.executed', {
    title: 'Workflow Executed: ' + (payload.workflow_type || 'automated'),
    lead_name: payload.lead_name || payload.lead_id,
    priority: payload.priority || 'medium',
    ai_confidence: null,
    assigned_to: payload.assigned_owner,
    zoho_lead_id: payload.zoho_lead_id,
    next_action: 'Workflow actions executed automatically by MAYA AI',
    ...payload
  });
}

async function notifySLABreach(payload) {
  return send('sla.breach', {
    title: ':rotating_light: SLA BREACH DETECTED',
    lead_name: payload.lead_name || payload.lead_id,
    priority: 'critical',
    ai_confidence: null,
    assigned_to: payload.owner || payload.assigned_owner,
    zoho_lead_id: payload.zoho_lead_id,
    next_action: 'IMMEDIATE: Overdue by ' + Math.round(payload.breach_minutes || 0) + ' minutes — escalation triggered',
    ...payload
  });
}

async function notifyRevenueForecastUpdated(payload) {
  return send('revenue.updated', {
    title: 'Revenue Forecast Updated',
    lead_name: 'Portfolio-wide',
    priority: 'info',
    ai_confidence: null,
    assigned_to: 'CEO / Sales Director',
    next_action: 'Review updated revenue forecast in CEO Dashboard',
    ...payload
  });
}

async function notifyAIError(payload) {
  return send('ai.error', {
    title: 'AI Platform Error',
    lead_name: payload.lead_name || 'System',
    priority: 'high',
    ai_confidence: null,
    assigned_to: 'Platform Team',
    next_action: 'Check Errors page in dashboard for details',
    ...payload
  });
}

async function notifyDailySummary(payload) {
  return send('daily.summary', {
    title: 'Daily Executive Summary',
    lead_name: 'All Leads',
    priority: 'info',
    ai_confidence: null,
    assigned_to: 'CEO',
    next_action: 'Review full briefing in CEO Dashboard',
    ...payload
  });
}

async function notifyDailyHealthReport(payload) {
  return send('health.report', {
    title: 'Daily AI Health Report',
    lead_name: 'Platform',
    priority: 'info',
    ai_confidence: null,
    assigned_to: 'Platform Team',
    next_action: 'Review platform health in dashboard',
    ...payload
  });
}

module.exports = {
  send,
  notifyLeadCreated,
  notifyLeadQualified,
  notifyDecisionGenerated,
  notifyInvestigation,
  notifyWorkflowExecuted,
  notifySLABreach,
  notifyRevenueForecastUpdated,
  notifyAIError,
  notifyDailySummary,
  notifyDailyHealthReport
};
