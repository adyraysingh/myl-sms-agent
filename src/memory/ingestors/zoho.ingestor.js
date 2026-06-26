const LeadMemory = require('../models/LeadMemory');
const LeadEvent = require('../models/LeadEvent');
const CRMTask = require('../models/CRMTask');
const CRMNote = require('../models/CRMNote');
const FollowUp = require('../models/FollowUp');

class ZohoIngestor {
  /**
   * Ingest a new lead from Zoho CRM webhook
   */
  static async ingestLead(payload) {
    const zohoLeadId = payload.leadId || payload.id || payload.zohoLeadId;
    const email = payload.email || payload.Email;
    const name = payload.name || payload.Full_Name || `${payload.First_Name || ''} ${payload.Last_Name || ''}`.trim();
    const phone = payload.phone || payload.Mobile || payload.Phone;
    const ownerId = payload.Owner?.id || payload.ownerId;
    const ownerName = payload.Owner?.name || payload.ownerName;

    // Upsert lead memory - use correct method name findByZohoId
    let memory = await LeadMemory.findByZohoId(zohoLeadId);
    if (!memory) {
      memory = await LeadMemory.create({
        zoho_lead_id: zohoLeadId,
        email: email || null,
        full_name: name || null,
        phone: phone || null,
        lead_owner_id: ownerId || null,
        lead_owner_name: ownerName || null,
        crm_data: payload
      });
    } else {
      // Update fields via syncFromCRM
      const updated = await LeadMemory.syncFromCRM(zohoLeadId, {
        email: email || memory.email,
        full_name: name || memory.full_name,
        phone: phone || memory.phone,
        lead_owner_id: ownerId || memory.lead_owner_id,
        lead_owner_name: ownerName || memory.lead_owner_name,
        crm_data: payload
      });
      if (updated) memory = updated;
    }

    // Record the event - wrapped in try/catch so lead creation still succeeds
    try {
      await LeadEvent.create({
        leadId: memory.id,
        eventType: 'crm_lead_created',
        eventSource: 'zoho_crm',
        title: 'Lead created in Zoho CRM',
        summary: `Lead ${name} created`,
        rawPayload: payload,
        occurredAt: payload.Created_Time ? new Date(payload.Created_Time) : new Date()
      });
    } catch (eventErr) {
      // Event logging failure is non-critical - lead was already saved
      console.warn('[ZohoIngestor] Event logging failed (non-critical):', eventErr.message);
    }

    return memory;
  }

  /**
   * Ingest a CRM task
   */
  static async ingestTask(payload, leadId) {
    const task = await CRMTask.create({
      leadId,
      zohoTaskId: payload.id || payload.zohoTaskId,
      subject: payload.Subject || payload.subject,
      description: payload.Description || payload.description,
      status: payload.Status || payload.status,
      priority: payload.Priority || payload.priority,
      dueDate: payload.Due_Date ? new Date(payload.Due_Date) : null,
      assignedTo: payload.Owner?.id || payload.assignedTo,
      rawPayload: payload
    });

    try {
      await LeadEvent.create({
        leadId,
        eventType: 'crm_task_created',
        eventSource: 'zoho_crm',
        title: payload.Subject || 'Task created',
        summary: `Task: ${payload.Subject || 'unknown'}`,
        rawPayload: payload
      });
    } catch (eventErr) {
      console.warn('[ZohoIngestor] Task event logging failed (non-critical):', eventErr.message);
    }

    return task;
  }

  /**
   * Ingest a CRM note
   */
  static async ingestNote(payload, leadId) {
    const note = await CRMNote.create({
      leadId,
      zohoNoteId: payload.id || payload.zohoNoteId,
      title: payload.Note_Title || payload.title,
      content: payload.Note_Content || payload.content,
      createdBy: payload.Owner?.id || payload.createdBy,
      rawPayload: payload
    });

    try {
      await LeadEvent.create({
        leadId,
        eventType: 'crm_note_added',
        eventSource: 'zoho_crm',
        title: payload.Note_Title || 'Note added',
        rawPayload: payload
      });
    } catch (eventErr) {
      console.warn('[ZohoIngestor] Note event logging failed (non-critical):', eventErr.message);
    }

    return note;
  }
}

module.exports = ZohoIngestor;
