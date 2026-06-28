'use strict';
/**
 * LearningEngine — Phase 3.6 Schema Audit Fix
 * FIXES (Task 3 — Schema Consistency Audit):
 *  1. discoverQualificationTrends(): was querying legacy tables onboarding_qualifications + leads.
 *     Fixed to query lead_qualification + lead_memory (current production schema).
 *     lead_qualification.category replaces onboarding_qualifications.qualification_category.
 *     lead_memory.is_onboarded replaces leads.pipeline_stage ILIKE '%onboard%'.
 *  2. discoverFollowUpTrends(): was querying legacy 'decisions' table.
 *     Fixed to query ai_decisions (current production schema).
 *     ai_decisions uses status 'executed' not 'completed'.
 *  3. discoverInvestigationTrends(): investigations table may not exist — wrapped in try/catch.
 */
const pool = require('../../memory/db/pool');
const LearningEvent = require('../models/LearningEvent');
const AccuracyEvaluator = require('./AccuracyEvaluator');

// ─── Trend Analysis ───────────────────────────────────────────────────────────

async function discoverQualificationTrends() {
try {
// FIXED: was onboarding_qualifications + leads (legacy).
// Now uses lead_qualification + lead_memory (current production schema).
const r = await pool.query(
'SELECT lq.category, ' +
'COUNT(*) as total, ' +
'COUNT(*) FILTER (WHERE lm.is_onboarded = TRUE) as onboarded ' +
'FROM lead_qualification lq JOIN lead_memory lm ON lq.lead_id = lm.id ' +
'GROUP BY lq.category ORDER BY onboarded DESC'
);
const trends = [];
for (const row of r.rows) {
const rate = row.total > 0 ? (parseInt(row.onboarded) / parseInt(row.total)) : 0;
trends.push({ trend_category: 'qualification', trend_name: row.category + ' conversion rate',
description: row.category + ' leads have a ' + Math.round(rate*100) + '% onboarding conversion rate based on ' + row.total + ' leads',
metric: 'onboarding_conversion_rate', metric_value: Math.round(rate * 10000) / 10000,
direction: rate >= 0.5 ? 'positive' : 'negative',
supporting_data: { category: row.category, total: row.total, onboarded: row.onboarded },
sample_size: parseInt(row.total), confidence: Math.min(90, 50 + parseInt(row.total) * 2),
business_impact: rate >= 0.5 ? 'high' : 'medium' });
}
return trends;
} catch (e) { return []; }
}

async function discoverConversationTrends() {
try {
const r = await pool.query(
'SELECT ca.sentiment, ca.conversation_stage, ' +
'COUNT(*) as total, ' +
'ROUND(AVG(ca.trust_score),2) as avg_trust, ' +
'ROUND(AVG(ca.confidence_score),2) as avg_confidence ' +
'FROM conversation_analysis ca ' +
'GROUP BY ca.sentiment, ca.conversation_stage ' +
'ORDER BY total DESC LIMIT 10'
);
return r.rows.map(row => ({
trend_category: 'conversation', trend_name: row.sentiment + ' / ' + row.conversation_stage,
description: 'Conversations with ' + row.sentiment + ' sentiment in ' + row.conversation_stage + ' stage average trust score ' + row.avg_trust,
metric: 'avg_trust_score', metric_value: parseFloat(row.avg_trust || 0),
direction: parseFloat(row.avg_trust) >= 6 ? 'positive' : 'needs_attention',
supporting_data: { sentiment: row.sentiment, stage: row.conversation_stage, count: row.total, avg_confidence: row.avg_confidence },
sample_size: parseInt(row.total), confidence: Math.min(85, 40 + parseInt(row.total) * 3),
business_impact: 'medium'
}));
} catch (e) { return []; }
}

async function discoverFollowUpTrends() {
try {
// FIXED: was querying legacy 'decisions' table with status='completed'.
// Now queries ai_decisions with status='executed'.
const r = await pool.query(
"SELECT d.decision_type, d.priority, d.status, COUNT(*) as total, " +
"COUNT(*) FILTER (WHERE d.status=$1) as executed " +
"FROM ai_decisions d GROUP BY d.decision_type, d.priority, d.status " +
"ORDER BY executed DESC LIMIT 15",
['executed']
);
return r.rows.filter(row => parseInt(row.total) > 0).map(row => ({
trend_category: 'follow_up', trend_name: row.decision_type + ' execution rate',
description: row.decision_type + ' decisions at ' + row.priority + ' priority have execution rate of ' + Math.round((parseInt(row.executed)/parseInt(row.total))*100) + '%',
metric: 'execution_rate', metric_value: Math.round((parseInt(row.executed)/parseInt(row.total))*10000)/10000,
direction: parseInt(row.executed)/parseInt(row.total) >= 0.6 ? 'positive' : 'needs_attention',
supporting_data: { type: row.decision_type, priority: row.priority, total: row.total, executed: row.executed },
sample_size: parseInt(row.total), confidence: 70, business_impact: 'high'
}));
} catch (e) { return []; }
}

async function discoverInvestigationTrends() {
try {
// FIXED: wrapped in try/catch — investigations table may not exist in current schema.
const r = await pool.query(
"SELECT investigation_type, COUNT(*) as total, ROUND(AVG(confidence),2) as avg_confidence, " +
"COUNT(*) FILTER (WHERE status=$1) as completed " +
"FROM investigations GROUP BY investigation_type ORDER BY total DESC LIMIT 10",
['completed']
);
return r.rows.map(row => ({
trend_category: 'investigation', trend_name: row.investigation_type + ' accuracy',
description: row.investigation_type + ' investigations: ' + row.completed + '/' + row.total + ' completed with avg confidence ' + row.avg_confidence,
metric: 'completion_rate', metric_value: Math.round((parseInt(row.completed)/parseInt(row.total))*10000)/10000,
direction: parseFloat(row.avg_confidence) >= 70 ? 'positive' : 'needs_attention',
supporting_data: { type: row.investigation_type, total: row.total, completed: row.completed, avg_confidence: row.avg_confidence },
sample_size: parseInt(row.total), confidence: Math.min(80, 50 + parseInt(row.total) * 5), business_impact: 'medium'
}));
} catch (e) { return []; }
}

// ─── Optimization Suggestion Generator ───────────────────────────────────────

async function generateOptimizations(evaluationResults) {
const suggestions = [];

if (evaluationResults.decisions && !evaluationResults.decisions.error) {
const d = evaluationResults.decisions;
if (d.execution_rate < 0.5 && d.total_evaluated > 5) {
suggestions.push({ source_module: 'decisions',
finding: 'Decision execution rate is ' + Math.round(d.execution_rate * 100) + '% — below 50% threshold',
recommended_change: 'Review decision timing and relevance. Consider simplifying recommended actions.',
expected_impact: 'Increasing execution rate by 20% could improve onboarding conversion.',
confidence: 80, priority: 'high',
supporting_evidence: [{ metric: 'execution_rate', value: d.execution_rate, sample: d.total_evaluated }] });
}
if (d.dismissal_rate > 0.4 && d.total_evaluated > 5) {
suggestions.push({ source_module: 'decisions',
finding: 'High decision dismissal rate: ' + Math.round(d.dismissal_rate * 100) + '% of recommendations are dismissed',
recommended_change: 'Analyze dismissed decisions. Identify patterns in rejected recommendations.',
expected_impact: 'Reducing dismissals improves salesperson trust in the AI system.',
confidence: 75, priority: 'medium',
supporting_evidence: [{ metric: 'dismissal_rate', value: d.dismissal_rate }] });
}
}

if (evaluationResults.qualification && !evaluationResults.qualification.error) {
const q = evaluationResults.qualification;
if (q.accuracy < 0.7 && q.total_evaluated > 3) {
suggestions.push({ source_module: 'qualification',
finding: 'Qualification accuracy is ' + Math.round(q.accuracy * 100) + '% on ' + q.total_evaluated + ' evaluated leads',
recommended_change: 'Review qualification scoring weights. Identify which factors are poor predictors.',
expected_impact: 'Improving qualification accuracy reduces time spent on low-probability leads.',
confidence: 70, priority: 'high',
supporting_evidence: [{ metric: 'accuracy', value: q.accuracy, total_evaluated: q.total_evaluated }] });
}
}

if (evaluationResults.coaching && !evaluationResults.coaching.error) {
const c = evaluationResults.coaching;
if (c.declining > c.improving && c.total_reps > 0) {
suggestions.push({ source_module: 'sales_coaching',
finding: c.declining + ' sales reps are declining vs ' + c.improving + ' improving',
recommended_change: 'Review declining reps immediately. Assign peer coaching.',
expected_impact: 'Stabilizing declining reps prevents revenue loss.',
confidence: 85, priority: 'high',
supporting_evidence: [{ declining: c.declining, improving: c.improving, total: c.total_reps }] });
}
}

return suggestions;
}

// ─── Main LearningEngine class ────────────────────────────────────────────────

class LearningEngine {

static async runFullEvaluation() {
const startTime = Date.now();
console.log('[LearningEngine] Starting full evaluation...');

const evaluationResults = await AccuracyEvaluator.runAll();

const [qualTrends, convTrends, followTrends, invTrends] = await Promise.allSettled([
discoverQualificationTrends(),
discoverConversationTrends(),
discoverFollowUpTrends(),
discoverInvestigationTrends()
]);
const allTrends = [
...(qualTrends.status === 'fulfilled' ? qualTrends.value : []),
...(convTrends.status === 'fulfilled' ? convTrends.value : []),
...(followTrends.status === 'fulfilled' ? followTrends.value : []),
...(invTrends.status === 'fulfilled' ? invTrends.value : [])
];

const savedTrends = [];
for (const trend of allTrends) {
try { const t = await LearningEvent.saveTrend(trend); if (t) savedTrends.push(t); } catch (e) {}
}

const optimizations = await generateOptimizations(evaluationResults);
const savedOptimizations = [];
for (const opt of optimizations) {
try { const o = await LearningEvent.saveOptimization(opt); if (o) savedOptimizations.push(o); } catch (e) {}
}

const now = new Date();
const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
const modules = [
{ name: 'qualification_engine', data: evaluationResults.qualification },
{ name: 'decision_engine', data: evaluationResults.decisions },
{ name: 'investigation_engine', data: evaluationResults.investigations },
{ name: 'conversation_intelligence', data: evaluationResults.conversations },
{ name: 'sales_coaching', data: evaluationResults.coaching }
];
for (const m of modules) {
if (m.data && !m.data.error) {
try {
await LearningEvent.savePerformance({
model_name: m.name, evaluation_period: 'monthly',
period_start: periodStart.toISOString(), period_end: now.toISOString(),
total_predictions: m.data.total_evaluated || m.data.total_analyzed || m.data.total_reps || 0,
correct_predictions: m.data.correct || m.data.executed || m.data.improving || 0,
accuracy: m.data.accuracy || m.data.execution_rate || m.data.improvement_rate || 0,
sample_size: m.data.total_evaluated || m.data.total_analyzed || 0,
metadata: m.data
});
} catch (e) {}
}
}

const overallAccuracy = [
evaluationResults.qualification?.accuracy || 0,
evaluationResults.decisions?.execution_rate || 0,
evaluationResults.conversations?.avg_confidence ? evaluationResults.conversations.avg_confidence / 100 : 0
].reduce((a, b) => a + b, 0) / 3;

try {
await LearningEvent.takeSnapshot({
overall: overallAccuracy,
qualification: evaluationResults.qualification?.accuracy || 0,
decision: evaluationResults.decisions?.execution_rate || 0,
investigation: evaluationResults.investigations?.root_cause_rate || 0,
conversation: evaluationResults.conversations?.avg_confidence ? evaluationResults.conversations.avg_confidence / 100 : 0,
coaching: evaluationResults.coaching?.improvement_rate || 0,
total_predictions: allTrends.length,
total_evaluated: allTrends.filter(t => t).length,
optimization_count: savedOptimizations.length,
trend_count: savedTrends.length
});
} catch (e) {}

const processingTime = Date.now() - startTime;
console.log('[LearningEngine] Full evaluation completed in', processingTime, 'ms');

return {
success: true,
evaluation_results: evaluationResults,
trends_discovered: allTrends.length,
trends_saved: savedTrends.length,
optimizations_generated: optimizations.length,
optimizations_saved: savedOptimizations.length,
overall_accuracy: Math.round(overallAccuracy * 10000) / 10000,
processing_time_ms: processingTime
};
}

static async getSummary() {
try {
const [counts, optimizations, trends, snapshots] = await Promise.all([
LearningEvent.countByModule(),
LearningEvent.getOptimizations('open', 5),
LearningEvent.getTrends(null, 5),
LearningEvent.getSnapshotHistory(7)
]);
const latest = snapshots[0] || {};
return {
overall_accuracy: latest.overall_accuracy || 0,
qualification_accuracy: latest.qualification_accuracy || 0,
decision_accuracy: latest.decision_accuracy || 0,
investigation_accuracy: latest.investigation_accuracy || 0,
conversation_accuracy: latest.conversation_accuracy || 0,
coaching_effectiveness: latest.coaching_effectiveness || 0,
total_predictions: latest.total_predictions || 0,
module_counts: counts,
top_optimizations: optimizations,
top_trends: trends,
snapshot_count: snapshots.length
};
} catch (e) { return { error: e.message }; }
}
}

module.exports = LearningEngine;
