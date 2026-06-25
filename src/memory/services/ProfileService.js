const LeadMemory = require('../models/LeadMemory');
const LeadEvent = require('../models/LeadEvent');
const RetellCall = require('../models/RetellCall');
const Conversation = require('../models/Conversation');
const CRMTask = require('../models/CRMTask');
const FollowUp = require('../models/FollowUp');

class ProfileService {
  static async getProfile(leadId) {
    const memory = await LeadMemory.findById(leadId);
    if (!memory) return null;
    const results = await Promise.all([LeadEvent.countByType(leadId), RetellCall.getCallStats(leadId), Conversation.getChannelSummary(leadId), LeadEvent.findByLeadId(leadId, { limit: 5 }), CRMTask.findByLeadId(leadId, { status: 'open', limit: 10 }), FollowUp.findByLeadId(leadId, { status: 'pending', limit: 5 })]);
    return { id: memory.id, zohoLeadId: memory.zoho_lead_id, name: memory.name, email: memory.email, phone: memory.phone, ownerId: memory.owner_id, ownerName: memory.owner_name, status: memory.status, tags: memory.tags, metadata: memory.metadata, firstSeenAt: memory.first_seen_at, lastActivityAt: memory.last_activity_at, createdAt: memory.created_at, activity: { eventCounts: results[0], callStats: results[1], channelSummary: results[2] }, recentEvents: results[3], pendingTasks: results[4], pendingFollowUps: results[5] };
  }

  static async getProfileByZohoId(zohoLeadId) {
    const memory = await LeadMemory.findByZohoLeadId(zohoLeadId);
    if (!memory) return null;
    return ProfileService.getProfile(memory.id);
  }

  static async getProfileByEmail(email) {
    const memory = await LeadMemory.findByEmail(email);
    if (!memory) return null;
    return ProfileService.getProfile(memory.id);
  }

  static async updateStatus(leadId, status) {
    return LeadMemory.updateStatus(leadId, status);
  }
}

module.exports = ProfileService;
