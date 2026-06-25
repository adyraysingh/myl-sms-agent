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

    // Upsert lead memory
    let memory = await LeadMemory.findByZohoLeadId(zohoLeadId);
    if (!memory) {
      memory = await LeadMemory.create({
        zohoLeadId,
        email: email || null,
        name: name || null,
        phone: phone || null,
        ownerId: ownerId || null,
        ownerName: ownerName || null,
        rawPayload: payload
      });
    } else {
      memory = await LeadMemory.update(memory.id, {
        email: email || memory.email,
        name: name || memory.name,
        phone: phone || memory.phone,
        ownerId: ownerId || memory.owner_id,
        ownerName: ownerName || memory.owner_name
      });
    }

    // Record the event
    await LeadEvent.create({
      leadId: memory.id,
      eventType: 'crm_lead_created',
      eventSource: 'zoho_crm',
      title: 'Lead created in Zoho CRM',
      summary: `Lead ${name} created`,
      rawPayload: payload,
      occurredAt: payload.Created_Time ? new Date(payload.Created_Time) : new Date()
    });

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

    await LeadEvent.create({
      leadId,
      eventType: 'crm_task_created',
      eventSource: 'zoho_crm',
      title: payload.Subject || 'Task created',
      summary: `Task: ${payload.Subject || 'unknown'}`,
      rawPayload: payload
    });

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

    await LeadEvent.create({
      leadId,
      eventType: 'crm_note_added',
      eventSource: 'zoho_crm',
      title: payload.Note_Title || 'Note added',
      rawPayload: payload
    });

    return note;
  }
}

module.exports = ZohoIngestor;
