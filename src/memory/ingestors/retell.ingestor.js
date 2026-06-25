const LeadMemory = require('../models/LeadMemory');
const LeadEvent = require('../models/LeadEvent');
const RetellCall = require('../models/RetellCall');
const Conversation = require('../models/Conversation');

class RetellIngestor {
  static async ingestCall(payload) {
    const retellCallId = payload.call_id || payload.retellCallId;
    const fromNumber = payload.from_number || payload.fromNumber;
    const toNumber = payload.to_number || payload.toNumber;
    const callSummary = payload.call_analysis && payload.call_analysis.call_summary;
    const userSentiment = payload.call_analysis && payload.call_analysis.user_sentiment;
    const callSuccessful = (payload.call_analysis && payload.call_analysis.call_successful) || false;
    const durationSeconds = payload.duration_ms ? Math.round(payload.duration_ms / 1000) : null;
    let memory = null;
    if (fromNumber) memory = await LeadMemory.findByPhone(fromNumber);
    if (!memory && toNumber) memory = await LeadMemory.findByPhone(toNumber);
    const transcript = payload.transcript;
    const callData = { leadId: memory ? memory.id : null, retellCallId, fromNumber, toNumber, callStatus: payload.call_status || 'completed', durationSeconds, transcript: typeof transcript === 'string' ? transcript : JSON.stringify(transcript), callSummary, disconnectionReason: payload.disconnection_reason, recordingUrl: payload.recording_url, userSentiment, callSuccessful, rawPayload: payload, occurredAt: payload.start_timestamp ? new Date(payload.start_timestamp) : new Date() };
    const call = await RetellCall.create(callData);
    if (memory) {
      await Conversation.create({ leadId: memory.id, channel: 'phone', direction: 'outbound', agentName: 'Retell AI', durationSeconds, summary: callSummary, transcript: callData.transcript, sentiment: userSentiment, rawPayload: payload, occurredAt: callData.occurredAt });
      await LeadEvent.create({ leadId: memory.id, eventType: 'retell_call_completed', eventSource: 'retell_ai', title: 'AI Call Completed', summary: callSummary || 'Call completed', rawPayload: payload, occurredAt: callData.occurredAt });
    }
    return { call, memory };
  }
}

module.exports = RetellIngestor;
