const LeadEvent = require('../models/LeadEvent');
const Conversation = require('../models/Conversation');
const RetellCall = require('../models/RetellCall');
const CRMTask = require('../models/CRMTask');
const CRMNote = require('../models/CRMNote');
const FollowUp = require('../models/FollowUp');

class TimelineService {
  static async getTimeline(leadId, options) {
    options = options || {};
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    const results = await Promise.all([LeadEvent.findByLeadId(leadId, { limit }), Conversation.findByLeadId(leadId, { limit }), CRMTask.findByLeadId(leadId, { limit }), CRMNote.findByLeadId(leadId, { limit }), FollowUp.findByLeadId(leadId, { limit })]);
    const items = [
      ...results[0].map(function(e) { return { id: e.id, type: 'event', eventType: e.event_type, source: e.event_source, title: e.title, summary: e.summary, timestamp: e.occurred_at, data: e }; }),
      ...results[1].map(function(c) { return { id: c.id, type: 'conversation', eventType: 'conversation_' + c.channel, source: c.channel, title: c.channel + ' conversation', summary: c.summary, timestamp: c.occurred_at, data: c }; }),
      ...results[2].map(function(t) { return { id: t.id, type: 'task', eventType: 'crm_task', source: 'zoho_crm', title: t.subject, summary: 'Task: ' + t.status, timestamp: t.occurred_at, data: t }; }),
      ...results[3].map(function(n) { return { id: n.id, type: 'note', eventType: 'crm_note', source: 'zoho_crm', title: n.title || 'Note', summary: n.content ? n.content.substring(0, 100) : null, timestamp: n.occurred_at, data: n }; }),
      ...results[4].map(function(f) { return { id: f.id, type: 'follow_up', eventType: 'follow_up', source: 'zoho_crm', title: 'Follow-up', summary: f.notes, timestamp: f.occurred_at, data: f }; })
    ];
    items.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    let filtered = items;
    if (options.startDate) filtered = filtered.filter(function(i) { return new Date(i.timestamp) >= new Date(options.startDate); });
    if (options.endDate) filtered = filtered.filter(function(i) { return new Date(i.timestamp) <= new Date(options.endDate); });
    return { timeline: filtered.slice(offset, offset + limit), total: filtered.length, offset: offset, limit: limit };
  }

  static async getActivitySummary(leadId) {
    const results = await Promise.all([LeadEvent.countByType(leadId), Conversation.getChannelSummary(leadId), RetellCall.getCallStats(leadId)]);
    return { eventCounts: results[0], channelSummary: results[1], callStats: results[2] };
  }
}

module.exports = TimelineService;
