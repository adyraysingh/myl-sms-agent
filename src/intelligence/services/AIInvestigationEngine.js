'use strict';
const OpenAI = require('openai');
const pool = require('../../memory/db/pool');
const Investigation = require('../models/Investigation');
const PredictionPublisher = require('../../learning/services/PredictionPublisher');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

class AIInvestigationEngine {

static async investigate({ investigation_type, title, question, lead_id, salesperson_id }) {
const startTime = Date.now();
console.log('[AIInvestigationEngine] Starting:', title);
const inv = await Investigation.create({ investigation_type, title, question, lead_id, salesperson_id });
await Investigation.updateStatus(inv.investigation_id, 'running');
try {
const evidence = await AIInvestigationEngine._collectEvidence({ investigation_type, question, lead_id, salesperson_id });
const storedEvidence = [];
for (const e of evidence) {
const stored = await Investigation.addEvidence(inv.investigation_id, e);
storedEvidence.push(stored);
}
const analysis = await AIInvestigationEngine._analyzeWithAI({ investigation_type, title, question, evidence, lead_id, salesperson_id });
const storedFindings = [];
if (analysis.findings && Array.isArray(analysis.findings)) {
for (const f of analysis.findings) {
const stored = await Investigation.addFinding(inv.investigation_id, f);
storedFindings.push(stored);
}
}
if (analysis.patterns && Array.isArray(analysis.patterns)) {
for (const p of analysis.patterns) {
await Investigation.upsertPattern(p).catch(e => console.error('[AIInvestigationEngine] Pattern failed:', e.message));
}
}
const processingTime = Date.now() - startTime;
const completed = await Investigation.updateStatus(inv.investigation_id, 'completed', {
summary: analysis.summary,
root_cause: analysis.root_causes || [],
recommendation: analysis.recommendations || [],
business_impact: analysis.business_impact,
confidence: analysis.confidence || 0,
evidence_count: storedEvidence.length,
finding_count: storedFindings.length,
processing_time_ms: processingTime
});
// Phase 3.1: Auto-publish investigation prediction (fire-and-forget)
setImmediate(() => PredictionPublisher.investigation(lead_id, inv, {
root_cause: analysis.root_causes,
summary: analysis.summary,
recommendation: analysis.recommendations,
business_impact: analysis.business_impact,
confidence: analysis.confidence || 0,
findings: storedFindings,
evidence: storedEvidence.map(e => e.description),
patterns: analysis.patterns || []
}).catch(() => {}));
console.log('[AIInvestigationEngine] Completed:', inv.investigation_id);
return { investigation: completed, evidence: storedEvidence, findings: storedFindings };
} catch (err) {
console.error('[AIInvestigationEngine] Failed:', err.message);
await Investigation.updateStatus(inv.investigation_id, 'failed', { error_message: err.message, processing_time_ms: Date.now() - startTime });
throw err;
}
}

static async _collectEvidence({ investigation_type, question, lead_id, salesperson_id }) {
const results = await Promise.allSettled([
AIInvestigationEngine._getLeadEvidence(lead_id),
AIInvestigationEngine._getConversationEvidence(lead_id),
AIInvestigationEngine._getQualificationEvidence(lead_id),
AIInvestigationEngine._getDecisionEvidence(lead_id),
AIInvestigationEngine._getSalesEvidence(salesperson_id),
AIInvestigationEngine._getFollowupEvidence(lead_id),
AIInvestigationEngine._getBusinessEvidence(investigation_type),
AIInvestigationEngine._getOnboardingTrendEvidence()
]);
const evidence = [];
for (const r of results) {
if (r.status === 'fulfilled' && Array.isArray(r.value)) evidence.push(...r.value);
}
return evidence;
}

static async _getLeadEvidence(lead_id) {
if (!lead_id) return [];
try {
const r = await pool.query(
'SELECT lm.*, lq.onboarding_score, lq.qualification_category, lq.onboarding_probability FROM lead_memory lm LEFT JOIN lead_qualification lq ON lq.lead_id = lm.lead_id WHERE lm.lead_id = $1',
[lead_id]
);
if (!r.rows[0]) return [];
const lead = r.rows[0];
return [{ source_module: 'business_memory', source_record: lead_id, evidence_type: 'lead_profile',
description: 'Lead: ' + (lead.contact_name || 'Unknown') + ' | Category: ' + (lead.qualification_category || 'Unqualified') + ' | Score: ' + (lead.onboarding_score || 0) + '/100 | Prob: ' + (lead.onboarding_probability || 0) + '%',
data: lead, confidence: 95, weight: 2.0 }];
} catch (e) { return []; }
}

static async _getConversationEvidence(lead_id) {
try {
const q = lead_id ? 'SELECT * FROM conversation_analysis WHERE lead_id = $1 ORDER BY analyzed_at DESC LIMIT 5' : 'SELECT * FROM conversation_analysis ORDER BY analyzed_at DESC LIMIT 10';
const r = await pool.query(q, lead_id ? [lead_id] : []);
return r.rows.map(c => ({ source_module: 'conversation_intelligence', source_record: c.conversation_id, evidence_type: 'conversation_analysis',
description: 'Sentiment: ' + (c.sentiment||'?') + ' | Trust: ' + (c.trust_score||0) + ' | Intent: ' + (c.customer_intent||'?'),
data: { sentiment: c.sentiment, trust_score: c.trust_score, customer_intent: c.customer_intent, objections: c.objections, conversation_outcome: c.conversation_outcome },
confidence: parseFloat(c.confidence_score)||70, weight: 1.8 }));
} catch (e) { return []; }
}

static async _getQualificationEvidence(lead_id) {
if (!lead_id) return [];
try {
const r = await pool.query('SELECT * FROM lead_qualification WHERE lead_id = $1 ORDER BY updated_at DESC LIMIT 1', [lead_id]);
if (!r.rows[0]) return [];
const q = r.rows[0];
return [{ source_module: 'qualification_engine', source_record: lead_id, evidence_type: 'qualification_score',
description: 'Score: ' + q.onboarding_score + '/100 | Cat: ' + q.qualification_category + ' | Prob: ' + q.onboarding_probability + '% | Trust: ' + q.trust_score,
data: q, confidence: 90, weight: 2.0 }];
} catch (e) { return []; }
}

static async _getDecisionEvidence(lead_id) {
try {
const q = lead_id ? 'SELECT * FROM ai_decisions WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5' : "SELECT * FROM ai_decisions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10";
const r = await pool.query(q, lead_id ? [lead_id] : []);
return r.rows.map(d => ({ source_module: 'decision_engine', source_record: d.decision_id, evidence_type: 'ai_decision',
description: 'Decision: ' + d.decision_type + ' | Priority: ' + d.priority + ' | Status: ' + d.status,
data: { decision_type: d.decision_type, priority: d.priority, status: d.status },
confidence: parseFloat(d.confidence_score)||60, weight: 1.5 }));
} catch (e) { return []; }
}

static async _getSalesEvidence(salesperson_id) {
if (!salesperson_id) return [];
try {
const r = await pool.query('SELECT * FROM sales_performance WHERE owner_id = $1 ORDER BY period_date DESC LIMIT 7', [salesperson_id]);
return r.rows.map(s => ({ source_module: 'sales_intelligence', source_record: salesperson_id, evidence_type: 'sales_performance',
description: 'Rep: ' + (s.owner_name||salesperson_id) + ' | Productivity: ' + s.productivity_score + ' | Onboarding rate: ' + s.onboarding_rate + '%',
data: s, confidence: 85, weight: 1.6 }));
} catch (e) { return []; }
}

static async _getFollowupEvidence(lead_id) {
try {
const q = lead_id ? 'SELECT * FROM bm_follow_ups WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 5' : "SELECT * FROM bm_follow_ups WHERE status = 'overdue' ORDER BY created_at DESC LIMIT 10";
const r = await pool.query(q, lead_id ? [lead_id] : []);
return r.rows.map(f => ({ source_module: 'business_memory', source_record: f.follow_up_id, evidence_type: 'follow_up',
description: 'Follow-up: ' + f.follow_up_type + ' | Status: ' + f.status + ' | Scheduled: ' + f.scheduled_at,
data: { follow_up_type: f.follow_up_type, status: f.status, scheduled_at: f.scheduled_at },
confidence: 80, weight: 1.4 }));
} catch (e) { return []; }
}

static async _getBusinessEvidence(investigation_type) {
try {
const [q1, q2, q3] = await Promise.allSettled([
pool.query('SELECT qualification_category, COUNT(*) as count, AVG(onboarding_score) as avg_score FROM lead_qualification GROUP BY qualification_category ORDER BY count DESC'),
pool.query("SELECT sentiment, AVG(trust_score) as avg_trust, COUNT(*) as count FROM conversation_analysis WHERE analyzed_at > NOW() - INTERVAL '7 days' GROUP BY sentiment"),
pool.query("SELECT COUNT(*) FILTER (WHERE status = 'overdue') as overdue, COUNT(*) as total FROM bm_follow_ups WHERE created_at > NOW() - INTERVAL '7 days'")
]);
const evidence = [];
if (q1.status === 'fulfilled') evidence.push({ source_module: 'qualification_engine', evidence_type: 'business_overview', description: 'Lead distribution: ' + q1.value.rows.map(r => r.qualification_category + ':' + r.count).join(', '), data: q1.value.rows, confidence: 90, weight: 1.5 });
if (q2.status === 'fulfilled') evidence.push({ source_module: 'conversation_intelligence', evidence_type: 'conversation_trends', description: 'Conversation sentiment 7d: ' + q2.value.rows.map(r => r.sentiment + ':' + r.count).join(', '), data: q2.value.rows, confidence: 85, weight: 1.3 });
if (q3.status === 'fulfilled' && q3.value.rows[0]) evidence.push({ source_module: 'business_memory', evidence_type: 'followup_health', description: 'Follow-ups 7d: total=' + q3.value.rows[0].total + ' overdue=' + q3.value.rows[0].overdue, data: q3.value.rows[0], confidence: 88, weight: 1.4 });
return evidence;
} catch (e) { return []; }
}

static async _getOnboardingTrendEvidence() {
try {
const r = await pool.query("SELECT DATE_TRUNC('day', updated_at) as day, qualification_category, COUNT(*) as count FROM lead_qualification WHERE updated_at > NOW() - INTERVAL '14 days' GROUP BY DATE_TRUNC('day', updated_at), qualification_category ORDER BY day DESC");
if (!r.rows.length) return [];
return [{ source_module: 'qualification_engine', evidence_type: 'onboarding_trend', description: 'Onboarding trend 14d: ' + r.rows.length + ' data points', data: r.rows, confidence: 85, weight: 1.6 }];
} catch (e) { return []; }
}

static async _analyzeWithAI({ investigation_type, title, question, evidence, lead_id, salesperson_id }) {
const systemPrompt = 'You are an AI Business Investigation Engine for MakeYourLabel.' +
' Investigate business problems using ONLY the evidence provided. Never guess.' +
' OUTPUT VALID JSON: { "summary": "...", "root_causes": [{"cause":"...","confidence":0-100,"evidence_source":"..."}],' +
' "findings": [{"finding":"...","severity":"critical|high|medium|low","impact":"...","recommendation":"...","confidence":0-100}],' +
' "recommendations": [{"action":"...","priority":"critical|high|medium|low","expected_impact":"..."}],' +
' "business_impact": "...", "confidence": 0-100,' +
' "patterns": [{"pattern_type":"...","title":"...","description":"...","confidence":0-100,"impact_score":0-100}] }';
const evidenceSummary = evidence.slice(0, 20).map((e, i) => (i+1) + '. [' + e.source_module + '] ' + e.description).join('
');
const userPrompt = 'TYPE: ' + investigation_type + '
TITLE: ' + title + '
QUESTION: ' + question +
(lead_id ? '
LEAD: ' + lead_id : '') + (salesperson_id ? '
SALES REP: ' + salesperson_id : '') +
'

EVIDENCE (' + evidence.length + ' pieces):
' + evidenceSummary +
'

Provide evidence-based investigation. Be specific.';
try {
const completion = await openai.chat.completions.create({
model: 'gpt-4o',
messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
response_format: { type: 'json_object' },
temperature: 0.3, max_tokens: 2000
});
return JSON.parse(completion.choices[0].message.content);
} catch (err) {
console.error('[AIInvestigationEngine] AI failed:', err.message);
return {
summary: 'Investigation completed with ' + evidence.length + ' evidence pieces. AI unavailable.',
root_causes: [{ cause: 'Analysis incomplete', confidence: 0, evidence_source: 'system' }],
findings: [{ finding: 'Manual review required', severity: 'medium', impact: 'Unknown', recommendation: 'Retry', confidence: 0 }],
recommendations: [], business_impact: 'Unknown', confidence: 0, patterns: []
};
}
}

static async investigateLead(lead_id, reason) {
try {
return await AIInvestigationEngine.investigate({
investigation_type: 'lead_investigation',
title: 'Lead Investigation: ' + lead_id,
question: 'Why is this lead not progressing? What is preventing onboarding? Reason: ' + (reason || 'automatic'),
lead_id
});
} catch (e) { console.error('[AIInvestigationEngine] Lead investigation failed:', e.message); }
}

static async investigateBusiness(question, investigation_type) {
try {
return await AIInvestigationEngine.investigate({
investigation_type: investigation_type || 'business_investigation',
title: question.substring(0, 100),
question
});
} catch (e) { console.error('[AIInvestigationEngine] Business investigation failed:', e.message); }
}

static async detectPatterns() {
console.log('[AIInvestigationEngine] Detecting patterns...');
try {
const r = await pool.query("SELECT qualification_category, COUNT(*) as count, AVG(onboarding_score) as avg_score, AVG(trust_score) as avg_trust FROM lead_qualification GROUP BY qualification_category HAVING COUNT(*) > 0");
const patterns = [];
for (const row of r.rows) {
patterns.push({
pattern_type: 'conversion',
title: row.qualification_category + ' Lead Pattern',
description: row.qualification_category + ' leads: count=' + row.count + ' avg_score=' + Math.round(parseFloat(row.avg_score)||0) + ' avg_trust=' + Math.round(parseFloat(row.avg_trust)||0),
supporting_data: row, sample_size: parseInt(row.count), confidence: 75,
impact_score: row.qualification_category === 'Hot' ? 90 : 50
});
}
for (const p of patterns) { await Investigation.upsertPattern(p).catch(()=>{}); }
console.log('[AIInvestigationEngine] Patterns stored:', patterns.length);
return patterns;
} catch (e) { console.error('[AIInvestigationEngine] Pattern detection failed:', e.message); return []; }
}
}

module.exports = AIInvestigationEngine;
