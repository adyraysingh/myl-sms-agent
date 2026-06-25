const LeadEvent = require('../models/LeadEvent');
const CRMTask = require('../models/CRMTask');
const FollowUp = require('../models/FollowUp');

class TaskIngestor {
  static async ingestTaskEvent(payload, leadId, eventType) {
    eventType = eventType || 'crm_task_updated';
    let task = await CRMTask.findByZohoId(payload.id || payload.zohoTaskId);
    if (!task) {
      task = await CRMTask.create({ leadId, zohoTaskId: payload.id || payload.zohoTaskId, subject: payload.Subject || payload.subject, description: payload.Description || payload.description, status: payload.Status || payload.status || 'open', priority: payload.Priority || payload.priority || 'normal', dueDate: payload.Due_Date ? new Date(payload.Due_Date) : null, assignedTo: (payload.Owner && payload.Owner.id) || payload.assignedTo, rawPayload: payload });
    } else if (payload.Status) {
      task = await CRMTask.updateStatus(task.id, payload.Status, payload.Status === 'Completed' ? new Date() : null);
    }
    await LeadEvent.create({ leadId, eventType, eventSource: 'zoho_crm', title: payload.Subject || 'Task event', summary: 'Task ' + (payload.Status || 'updated') + ': ' + (payload.Subject || 'unknown'), rawPayload: payload, metadata: { taskId: task.id } });
    return task;
  }

  static async ingestFollowUp(payload, leadId) {
    const followUp = await FollowUp.create({ leadId, followUpType: payload.type || payload.followUpType || 'general', channel: payload.channel || null, scheduledAt: payload.scheduled_at ? new Date(payload.scheduled_at) : null, status: payload.status || 'pending', notes: payload.notes || null, assignedTo: payload.assignedTo || null, rawPayload: payload });
    await LeadEvent.create({ leadId, eventType: 'follow_up_scheduled', eventSource: 'zoho_crm', title: 'Follow-up Scheduled', summary: 'Follow-up via ' + (payload.channel || 'unknown'), rawPayload: payload, metadata: { followUpId: followUp.id } });
    return followUp;
  }
}

module.exports = TaskIngestor;
