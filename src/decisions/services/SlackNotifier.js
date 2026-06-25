'use strict';

const axios = require('axios');

class SlackNotifier {

  static async notifyDecision(decision, memory) {
    try {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) { console.log('[SlackNotifier] No Slack webhook configured, skipping'); return; }
      const customerName = (memory && memory.customer_name) ? memory.customer_name : 'Unknown Customer';
      const crmOwner = decision.crm_owner || 'Unassigned';
      const priority = (decision.priority || 'high').toUpperCase();
      const decisionType = (decision.decision_type || '').replace(/_/g, ' ').toUpperCase();
      const emoji = decision.priority === 'critical' ? ':rotating_light:' : ':bell:';
      const color = decision.priority === 'critical' ? '#FF0000' : '#FF8C00';
      const message = {
        text: emoji + ' *AI DECISION ENGINE* - ' + priority + ' PRIORITY',
        attachments: [{
          color: color,
          blocks: [
            { type: 'section', fields: [{ type: 'mrkdwn', text: '*Customer:*\n' + customerName }, { type: 'mrkdwn', text: '*CRM Owner:*\n' + crmOwner }] },
            { type: 'section', fields: [{ type: 'mrkdwn', text: '*Decision:*\n' + decisionType }, { type: 'mrkdwn', text: '*Priority:*\n' + priority }] },
            { type: 'section', text: { type: 'mrkdwn', text: '*Reason:*\n' + (decision.reason || '') } },
            { type: 'section', text: { type: 'mrkdwn', text: '*Expected Impact:*\n' + (decision.expected_business_impact || 'N/A') } },
            { type: 'section', fields: [{ type: 'mrkdwn', text: '*Confidence:*\n' + Math.round(decision.confidence_score || 0) + '%' }, { type: 'mrkdwn', text: '*Execute By:*\n' + SlackNotifier._formatTime(decision.recommended_execution_time) }] },
            { type: 'context', elements: [{ type: 'mrkdwn', text: ':robot_face: MYL AI Decision Engine | Lead: ' + decision.lead_id }] }
          ]
        }]
      };
      await axios.post(webhookUrl, message);
      console.log('[SlackNotifier] Notification sent for lead:', decision.lead_id, '| priority:', decision.priority);
    } catch (err) {
      console.error('[SlackNotifier] Failed to send notification:', err.message);
    }
  }

  static _formatTime(timeValue) {
    if (!timeValue) return 'ASAP';
    try {
      const date = new Date(timeValue);
      const now = new Date();
      const diffHours = Math.round((date - now) / (1000 * 60 * 60));
      if (diffHours <= 0) return 'Immediately';
      if (diffHours < 24) return 'Within ' + diffHours + ' hour(s)';
      return 'Within ' + Math.round(diffHours / 24) + ' day(s)';
    } catch (e) { return String(timeValue); }
  }
}

module.exports = SlackNotifier;
