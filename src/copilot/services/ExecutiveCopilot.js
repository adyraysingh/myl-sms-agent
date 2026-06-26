'use strict';
const OpenAI = require('openai');
const pool = require('../../memory/db/pool');
const IntentDetector = require('./IntentDetector');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Evidence collectors — read from existing modules, never duplicate
async function collectFromMemory(question) {
  try {
    const leads = await pool.query(
      'SELECT lead_id, lead_name, lead_email, company_name, lead_source, salesperson_name, pipeline_stage, created_at ' +
      'FROM leads ORDER BY created_at DESC LIMIT 30'
    );
    return { source: 'business_memory', leads: leads.rows, count: leads.rowCount };
  } catch (e) { return { source: 'business_memory', error: e.message }; }
}

async function collectFromQualification(question) {
  try {
    const hot = await pool.query(
      'SELECT q.lead_id, q.qualification_category, q.onboarding_score, q.onboarding_probability, ' +
      'q.trust_score, q.engagement_score, q.readiness_score, q.primary_reason, q.updated_at, ' +
      'l.lead_name, l.company_name, l.salesperson_name ' +
      'FROM onboarding_qualifications q JOIN leads l ON q.lead_id=l.lead_id ' +
      'ORDER BY q.onboarding_score DESC LIMIT 20'
    );
    const dist = await pool.query(
      'SELECT qualification_category, COUNT(*) as count, ROUND(AVG(onboarding_score),1) as avg_score ' +
      'FROM onboarding_qualifications GROUP BY qualification_category'
    );
    return { source: 'qualification', qualifications: hot.rows, distribution: dist.rows };
  } catch (e) { return { source: 'qualification', error: e.message }; }
}

async function collectFromDecisions(question) {
  try {
    const pending = await pool.query(
      'SELECT d.decision_id, d.lead_id, d.decision_type, d.priority, d.reason, d.explanation, ' +
      'd.status, d.recommended_execution_time, d.crm_owner, d.confidence_score, d.created_at, ' +
      'l.lead_name, l.company_name ' +
      'FROM decisions d LEFT JOIN leads l ON d.lead_id=l.lead_id ' +
      'WHERE d.status IN ($1,$2) ORDER BY ' +
      'CASE d.priority WHEN $3 THEN 1 WHEN $4 THEN 2 WHEN $5 THEN 3 ELSE 4 END, d.created_at DESC LIMIT 20',
      ['pending','acknowledged','critical','high','medium']
    );
    return { source: 'decisions', pending_decisions: pending.rows, count: pending.rowCount };
  } catch (e) { return { source: 'decisions', error: e.message }; }
}

async function collectFromInvestigations(question) {
  try {
    const open = await pool.query(
      'SELECT investigation_id, investigation_type, title, question, status, confidence, ' +
      'summary, root_cause, recommendation, business_impact, created_at ' +
      'FROM investigations WHERE status NOT IN ($1) ORDER BY created_at DESC LIMIT 10',
      ['archived']
    );
    const patterns = await pool.query(
      'SELECT pattern_type, title, description, confidence, impact_score ' +
      'FROM investigation_patterns WHERE is_active=true ORDER BY impact_score DESC LIMIT 10'
    );
    const anomalies = await pool.query(
      'SELECT anomaly_type, title, description, severity, detected_at ' +
      'FROM investigation_anomalies WHERE is_resolved=false ORDER BY detected_at DESC LIMIT 10'
    );
    return { source: 'investigations', investigations: open.rows, patterns: patterns.rows, anomalies: anomalies.rows };
  } catch (e) { return { source: 'investigations', error: e.message }; }
}

async function collectFromSalesIntelligence(question) {
  try {
    const perf = await pool.query(
      'SELECT sp.salesperson_id, sp.salesperson_name, sp.onboarding_rate, sp.lead_conversion_rate, ' +
      'sp.activity_score, sp.productivity_score, sp.performance_trend, sp.avg_response_time_hours, ' +
      'sp.follow_up_completion_rate, sp.avg_trust_score, sp.updated_at ' +
      'FROM sales_performance sp ORDER BY sp.activity_score DESC LIMIT 15'
    );
    return { source: 'sales_intelligence', performance: perf.rows };
  } catch (e) { return { source: 'sales_intelligence', error: e.message }; }
}

async function collectFromExecutive(question) {
  try {
    const brief = await pool.query(
      'SELECT briefing_type, business_summary, business_health, onboarding_performance, ' +
      'current_risks, current_opportunities, top_priorities, recommended_actions, ' +
      'confidence_score, created_at FROM executive_briefings ORDER BY created_at DESC LIMIT 1'
    );
    return { source: 'executive', latest_briefing: brief.rows[0] || null };
  } catch (e) { return { source: 'executive', error: e.message }; }
}

async function collectFromConversations(question) {
  try {
    const conv = await pool.query(
      'SELECT ca.lead_id, ca.customer_intent, ca.conversation_stage, ca.sentiment, ' +
      'ca.trust_score, ca.objections, ca.positive_buying_signals, ca.negative_buying_signals, ' +
      'ca.recommended_next_step, ca.confidence_score, ca.analyzed_at, ' +
      'l.lead_name, l.company_name ' +
      'FROM conversation_analysis ca LEFT JOIN leads l ON ca.lead_id=l.lead_id ' +
      'ORDER BY ca.analyzed_at DESC LIMIT 20'
    );
    return { source: 'conversations', analyses: conv.rows };
  } catch (e) { return { source: 'conversations', error: e.message }; }
}

// Route question to correct modules and collect evidence
async function collectEvidence(question, modules) {
  const collectors = {
    memory:            () => collectFromMemory(question),
    qualification:     () => collectFromQualification(question),
    decisions:         () => collectFromDecisions(question),
    investigations:    () => collectFromInvestigations(question),
    sales_intelligence: () => collectFromSalesIntelligence(question),
    executive:         () => collectFromExecutive(question),
    conversations:     () => collectFromConversations(question)
  };
  const tasks = modules.filter(m => collectors[m]).map(m => collectors[m]());
  const results = await Promise.allSettled(tasks);
  return results.map((r, i) => r.status === 'fulfilled' ? r.value : { source: modules[i], error: r.reason?.message });
}

class ExecutiveCopilot {
  static async answer({ question, session_id, user_id, user_role, conversationHistory = [] }) {
    const startTime = Date.now();

    // 1. Detect intent
    const intentResult = IntentDetector.detect(question, conversationHistory);
    const { intent, modules } = intentResult;

    // 2. Collect evidence from relevant modules
    const evidence = await collectEvidence(question, modules);

    // 3. Build conversation history for GPT (last 8 messages for context)
    const historyMessages = conversationHistory.slice(-8).map(m => ({
      role: m.role,
      content: m.content
    }));

    // 4. Build system prompt
    const systemPrompt =
      'You are MAYA — the AI Executive Copilot for MakeYourLabel (MYL), a private label clothing manufacturer. ' +
      'You answer questions from the CEO and senior management using ONLY the evidence provided. ' +
      'Never invent data. Never guess. If evidence is missing, say so clearly. ' +
      'MYL business context: B2B private label clothing manufacturer. ' +
      'Products: Oversized T-Shirts, Hoodies, Tracksuits, Streetwear, Gym Wear, Activewear. ' +
      'Business goal: Convert leads into onboarded manufacturing clients. ' +
      'Key metrics: Onboarding score, trust score, qualification category (Hot/Warm/Cold/Dead), decision execution. ' +
      'Always respond with this JSON structure: ' +
      '{"executive_summary":"...","evidence":[{"fact":"...","source":"...","confidence":0.9}],' +
      '"reasoning":"...","confidence":0.85,"recommended_actions":[{"action":"...","priority":"high","lead_id":null,"decision_id":null,"investigation_id":null}],' +
      '"related_leads":[{"lead_id":"...","lead_name":"...","reason":"..."}],' +
      '"related_investigations":[{"investigation_id":"...","title":"..."}],' +
      '"related_decisions":[{"decision_id":"...","decision_type":"...","priority":"..."}],' +
      '"citations":{"module_sources":[],"record_ids":{}}}';

    // 5. Build user message with evidence
    const evidenceSummary = JSON.stringify(evidence, null, 2).substring(0, 12000);
    const userMessage =
      'CEO QUESTION: ' + question + '\n\n' +
      'DETECTED INTENT: ' + intent + '\n' +
      'USER ROLE: ' + (user_role || 'ceo') + '\n\n' +
      'EVIDENCE FROM BUSINESS MODULES:\n' + evidenceSummary + '\n\n' +
      'Answer the question using ONLY the evidence above. Be direct and executive-level. ' +
      'Respond with the required JSON structure.';

    // 6. Call GPT-4o
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userMessage }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices[0].message.content;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { parsed = { executive_summary: raw, evidence: [], reasoning: '', confidence: 0.5, recommended_actions: [], related_leads: [], related_investigations: [], related_decisions: [], citations: {} }; }

    const responseTimeMs = Date.now() - startTime;

    return {
      intent,
      modules_queried: modules,
      evidence_sources: evidence.map(e => e.source),
      confidence: parsed.confidence || 0.8,
      response_time_ms: responseTimeMs,
      executive_summary: parsed.executive_summary || '',
      evidence: parsed.evidence || [],
      reasoning: parsed.reasoning || '',
      recommended_actions: parsed.recommended_actions || [],
      related_leads: parsed.related_leads || [],
      related_investigations: parsed.related_investigations || [],
      related_decisions: parsed.related_decisions || [],
      citations: parsed.citations || {},
      model_version: 'gpt-4o'
    };
  }

  static getSuggestedQuestions() {
    return [
      { id: 1, question: 'What should I focus on today?', category: 'priorities', icon: 'target' },
      { id: 2, question: 'Show all hot leads right now.', category: 'leads', icon: 'fire' },
      { id: 3, question: 'Why are onboarding conversions lower this week?', category: 'onboarding', icon: 'trend' },
      { id: 4, question: 'Which leads need immediate attention?', category: 'leads', icon: 'alert' },
      { id: 5, question: 'Show overdue follow-ups.', category: 'decisions', icon: 'clock' },
      { id: 6, question: 'How is the business performing today?', category: 'health', icon: 'pulse' },
      { id: 7, question: 'Which salesperson needs support?', category: 'sales', icon: 'person' },
      { id: 8, question: 'What are the biggest risks right now?', category: 'risks', icon: 'warning' },
      { id: 9, question: 'Which objections are increasing this week?', category: 'intelligence', icon: 'chart' },
      { id: 10, question: 'What decisions have not been executed?', category: 'decisions', icon: 'check' },
      { id: 11, question: 'Which products are converting best?', category: 'products', icon: 'product' },
      { id: 12, question: 'What opportunities should we act on now?', category: 'opportunities', icon: 'star' }
    ];
  }
}

module.exports = ExecutiveCopilot;
