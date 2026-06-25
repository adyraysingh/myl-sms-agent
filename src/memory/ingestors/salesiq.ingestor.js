const LeadMemory = require('../models/LeadMemory');
const LeadEvent = require('../models/LeadEvent');
const SalesIQChat = require('../models/SalesIQChat');
const Conversation = require('../models/Conversation');

class SalesIQIngestor {
  static async ingestChat(payload) {
    const salesiqChatId = payload.chat_id || payload.salesiqChatId;
    const visitorEmail = (payload.visitor && payload.visitor.email) || payload.visitorEmail;
    const visitorName = (payload.visitor && payload.visitor.name) || payload.visitorName;
    let memory = null;
    if (visitorEmail) memory = await LeadMemory.findByEmail(visitorEmail);
    const chatData = { leadId: memory ? memory.id : null, salesiqChatId, visitorName, visitorEmail, operatorId: (payload.operator && payload.operator.id) || payload.operatorId, operatorName: (payload.operator && payload.operator.name) || payload.operatorName, chatStatus: payload.status || 'completed', durationSeconds: payload.duration, transcript: payload.transcript || null, chatSummary: payload.summary || null, pagesVisited: payload.pages_visited || null, rawPayload: payload, occurredAt: payload.created_time ? new Date(payload.created_time) : new Date() };
    const chat = await SalesIQChat.create(chatData);
    if (memory) {
      await Conversation.create({ leadId: memory.id, channel: 'chat', direction: 'inbound', agentName: chatData.operatorName || 'SalesIQ', durationSeconds: chatData.durationSeconds, summary: chatData.chatSummary, transcript: chatData.transcript, rawPayload: payload, occurredAt: chatData.occurredAt });
      await LeadEvent.create({ leadId: memory.id, eventType: 'salesiq_chat_completed', eventSource: 'zoho_salesiq', title: 'Live Chat Completed', summary: chatData.chatSummary || 'Chat session completed', rawPayload: payload, occurredAt: chatData.occurredAt });
    }
    return { chat, memory };
  }
}

module.exports = SalesIQIngestor;
