'use strict';
const LeadMemory=require('../models/LeadMemory');
const LeadEvent=require('../models/LeadEvent');
const EmailEvent=require('../models/EmailEvent');
async function ingestEmailSent(payload){
  const mid=payload.message_id||payload.id||null;
  const to=payload.to||payload.to_address||null;
  const from=payload.from||payload.from_address||null;
  const zid=payload.zoho_lead_id||null;
  if(mid){const ex=await EmailEvent.existsBySourceId(mid);if(ex)return{skipped:true};}
  let memory=null;
  if(zid)memory=await LeadMemory.findByZohoId(zid);
  if(!memory&&to)memory=await LeadMemory.findByEmail(to);
  if(!memory)return{skipped:true,reason:'no memory found'};
  const email=await EmailEvent.create({lead_memory_id:memory.id,zoho_lead_id:memory.zoho_lead_id,source_id:mid,direction:EmailEvent.EMAIL_DIRECTION.OUTBOUND,status:EmailEvent.EMAIL_STATUS.SENT,from_address:from,to_address:to,subject:payload.subject||null,body_preview:(payload.body||'').substring(0,500),sent_at:payload.sent_at?new Date(payload.sent_at):new Date(),sales_executive_id:payload.sender_id||null,sales_executive_name:payload.sender_name||null,raw_payload:payload});
  await LeadEvent.insert({lead_memory_id:memory.id,zoho_lead_id:memory.zoho_lead_id,event_type:LeadEvent.EVENT_TYPES.EMAIL_SENT,source:LeadEvent.EVENT_SOURCES.EMAIL,source_id:'email_sent_'+(mid||Date.now()),actor_type:'sales_executive',actor_name:email.sales_executive_name,payload:{message_id:mid,subject:email.subject},summary:'Email sent: '+(email.subject||'(no subject)'),channel:'email',occurred_at:email.sent_at});
  await LeadMemory.incrementCounter(memory.zoho_lead_id,'email_count');
  return{memory,email};
}
async function ingestEmailOpened(payload){
  const mid=payload.message_id||payload.id;
  if(!mid)return{skipped:true};
  const openedAt=payload.opened_at?new Date(payload.opened_at):new Date();
  const upd=await EmailEvent.updateBySourceId(mid,{status:EmailEvent.EMAIL_STATUS.OPENED,opened_at:openedAt});
  if(!upd)return{skipped:true};
  const memory=await LeadMemory.findById(upd.lead_memory_id);
  if(!memory)return{skipped:true};
  await LeadEvent.insert({lead_memory_id:memory.id,zoho_lead_id:memory.zoho_lead_id,event_type:LeadEvent.EVENT_TYPES.EMAIL_OPENED,source:LeadEvent.EVENT_SOURCES.EMAIL,source_id:'email_opened_'+mid,actor_type:'customer',payload:{message_id:mid},summary:'Email opened: '+(upd.subject||'(no subject)'),channel:'email',occurred_at:openedAt});
  return{memory,email:upd};
}
async function ingestEmailReplied(payload){
  const mid=payload.message_id||payload.in_reply_to||payload.id;
  const repliedAt=payload.replied_at?new Date(payload.replied_at):new Date();
  const zid=payload.zoho_lead_id||null;
  const from=payload.from||payload.from_address||null;
  let memory=null;
  if(zid)memory=await LeadMemory.findByZohoId(zid);
  if(!memory&&from)memory=await LeadMemory.findByEmail(from);
  if(!memory)return{skipped:true};
  if(mid)await EmailEvent.updateBySourceId(mid,{status:EmailEvent.EMAIL_STATUS.REPLIED,replied_at:repliedAt});
  const reply=await EmailEvent.create({lead_memory_id:memory.id,zoho_lead_id:memory.zoho_lead_id,source_id:payload.reply_message_id||'reply_'+Date.now(),direction:EmailEvent.EMAIL_DIRECTION.INBOUND,status:EmailEvent.EMAIL_STATUS.REPLIED,from_address:from,to_address:payload.to||null,subject:payload.subject||null,body_preview:(payload.body||'').substring(0,500),sent_at:repliedAt,raw_payload:payload});
  await LeadEvent.insert({lead_memory_id:memory.id,zoho_lead_id:memory.zoho_lead_id,event_type:LeadEvent.EVENT_TYPES.EMAIL_REPLIED,source:LeadEvent.EVENT_SOURCES.EMAIL,source_id:'email_replied_'+(mid||Date.now()),actor_type:'customer',payload:{message_id:mid},summary:'Customer replied: '+(reply.subject||'(no subject)'),channel:'email',occurred_at:repliedAt});
  await LeadEvent.insert({lead_memory_id:memory.id,zoho_lead_id:memory.zoho_lead_id,event_type:LeadEvent.EVENT_TYPES.CUSTOMER_REPLIED,source:LeadEvent.EVENT_SOURCES.EMAIL,source_id:'cust_replied_'+(mid||Date.now()),actor_type:'customer',payload:{},summary:'Customer replied via email',channel:'email',occurred_at:repliedAt});
  await LeadMemory.touchLastContacted(memory.zoho_lead_id,repliedAt);
  return{memory,email:reply};
}
module.exports={ingestEmailSent,ingestEmailOpened,ingestEmailReplied};
