'use strict';

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

class DecisionEngine {

  static async generateDecisions(leadData) {
    const { lead_id, crm_owner, trigger_event, trigger_source } = leadData;
    const prompt = DecisionEngine._buildPrompt(leadData);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: DecisionEngine._systemPrompt() },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);
    return DecisionEngine._normalizeDecisions(parsed, lead_id, crm_owner, trigger_event, trigger_source);
  }

  static _systemPrompt() {
    const lines = [
      'You are the AI Decision Engine for MakeYourLabel (MYL), a private label clothing manufacturer.',
      '',
      'MYL helps entrepreneurs, startups, and brands manufacture custom clothing.',
      'Products: Oversized T-Shirts, Hoodies, Tracksuits, Streetwear, Gym Wear, Activewear.',
      'Services: Sampling, Private Label Manufacturing, Custom Branding, Tech Packs, Packaging, Hang Tags, Labels.',
      'MOQ: Low MOQ available. Pre-order model supported.',
      '',
      'Your job is to determine the BEST NEXT ACTIONS for each lead.',
      'You do NOT write sales messages. You do NOT make revenue forecasts.',
      'You determine what the salesperson should do next and WHY.',
      '',
      'Decision Types Available:',
      '- call_customer: Call the customer now',
      '- send_email: Send a follow-up email',
      '- send_sample_information: Send sampling details, pricing, process',
      '- schedule_followup: Schedule a future follow-up',
      '- wait: No action needed right now, monitor',
      '- close_lead: Lead is not viable, close it',
      '- reengage_lead: Lead went cold, attempt re-engagement',
      '- escalate_to_manager: Escalate to manager or senior sales',
      '- request_missing_information: Ask for missing critical information',
      '- ask_about_budget: Initiate budget discussion',
      '- ask_about_timeline: Ask about launch timeline',
      '- confirm_moq: Clarify MOQ requirements',
      '- confirm_product_details: Confirm product specifications',
      '',
      'Priority Levels: critical, high, medium, low',
      '',
      'Rules:',
      '1. Every decision must have a clear business reason.',
      '2. Every decision must cite specific evidence from the lead data.',
      '3. Every decision must explain expected business impact.',
      '4. Never generate unexplained recommendations.',
      '5. Generate between 1 and 4 decisions per lead.',
      '6. The most important decision comes first.',
      '7. NEVER change CRM owner or pipeline stage.',
      '8. Only recommend actions the salesperson should take.',
      '',
      'Return a valid JSON object with this structure:',
      '{',
      '  "decisions": [',
      '    {',
      '      "decision_type": string,',
      '      "priority": "critical|high|medium|low",',
      '      "reason": string,',
      '      "explanation": string,',
      '      "evidence": [string],',
      '      "expected_business_impact": string,',
      '      "expected_onboarding_probability_change": number,',
      '      "recommended_execution_time": string,',
      '      "confidence_score": number,',
      '      "required_information": [string]',
      '    }',
      '  ],',
      '  "overall_situation": string,',
      '  "urgency_level": "critical|high|medium|low",',
      '  "analysis_notes": string',
      '}'
    ];
    return lines.join('\n');
  }

  static _buildPrompt(leadData) {
    const { lead_id, memory, conversations, qualification, events, tasks, notes, trigger_event } = leadData;
    const parts = [];
    parts.push('=== LEAD CONTEXT ===');
    parts.push('Lead ID: ' + lead_id);
    parts.push('Trigger Event: ' + (trigger_event || 'manual'));
    parts.push('');

    if (memory) {
      parts.push('=== BUSINESS MEMORY ===');
      parts.push('Name: ' + (memory.customer_name || 'Unknown'));
      parts.push('Email: ' + (memory.email || 'Unknown'));
      parts.push('Phone: ' + (memory.phone || 'Unknown'));
      parts.push('Country: ' + (memory.country || 'Unknown'));
      parts.push('Brand: ' + (memory.brand_name || 'Unknown'));
      parts.push('Last Activity: ' + (memory.last_activity_at || 'Unknown'));
      parts.push('');
    }

    if (qualification) {
      parts.push('=== QUALIFICATION DATA ===');
      parts.push('Category: ' + (qualification.qualification_category || 'unqualified'));
      parts.push('Onboarding Score: ' + (qualification.onboarding_score || 0) + '/100');
      parts.push('Onboarding Probability: ' + (qualification.onboarding_probability || 0) + '%');
      parts.push('Trust Score: ' + (qualification.trust_score || 0));
      parts.push('Budget Confidence: ' + (qualification.budget_confidence || 0));
      parts.push('Timeline Confidence: ' + (qualification.timeline_confidence || 0));
      parts.push('Brand Readiness: ' + (qualification.brand_readiness || 0));
      parts.push('Qualification Reason: ' + (qualification.qualification_reason || 'None'));
      parts.push('Missing Information: ' + JSON.stringify(qualification.missing_information || []));
      parts.push('');
    }

    if (conversations && conversations.length > 0) {
      parts.push('=== RECENT CONVERSATIONS ===');
      conversations.slice(0, 3).forEach((c, i) => {
        parts.push('Conversation ' + (i + 1) + ':');
        parts.push('  Summary: ' + (c.summary || 'N/A'));
        parts.push('  Intent: ' + (c.customer_intent || 'N/A'));
        parts.push('  Sentiment: ' + (c.sentiment || 'N/A'));
        parts.push('  Trust Score: ' + (c.trust_score || 0));
        parts.push('  Buying Signals: ' + JSON.stringify(c.positive_buying_signals || []));
        parts.push('  Objections: ' + JSON.stringify(c.objections || []));
        parts.push('  Recommended Next Step: ' + (c.recommended_next_step || 'N/A'));
        parts.push('');
      });
    }

    if (events && events.length > 0) {
      parts.push('=== RECENT EVENTS ===');
      events.slice(0, 5).forEach(e => {
        parts.push('- [' + e.event_type + '] ' + (e.summary || '') + ' (' + (e.created_at || '') + ')');
      });
      parts.push('');
    }

    if (tasks && tasks.length > 0) {
      parts.push('=== OPEN TASKS ===');
      tasks.forEach(t => {
        parts.push('- ' + (t.subject || t.task_subject || 'Task') + ' | Due: ' + (t.due_date || 'N/A') + ' | Status: ' + (t.status || 'N/A'));
      });
      parts.push('');
    }

    if (notes && notes.length > 0) {
      parts.push('=== CRM NOTES ===');
      notes.slice(0, 3).forEach(n => {
        parts.push('- ' + (n.content || n.note_content || '').substring(0, 200));
      });
      parts.push('');
    }

    parts.push('=== INSTRUCTION ===');
    parts.push('Based on all the above data, generate the best next action decisions for the salesperson. Be specific. Cite evidence. Explain business impact. Return valid JSON.');
    return parts.join('\n');
  }

  static _normalizeDecisions(parsed, lead_id, crm_owner, trigger_event, trigger_source) {
    const decisions = parsed.decisions || [];
    return {
      decisions: decisions.map(d => ({
        lead_id,
        crm_owner,
        decision_type: d.decision_type || 'schedule_followup',
        priority: ['critical','high','medium','low'].includes(d.priority) ? d.priority : 'medium',
        reason: d.reason || 'AI-generated decision',
        explanation: d.explanation || '',
        evidence: Array.isArray(d.evidence) ? d.evidence : [],
        expected_business_impact: d.expected_business_impact || '',
        expected_onboarding_probability_change: parseFloat(d.expected_onboarding_probability_change) || 0,
        recommended_execution_time: DecisionEngine._parseExecutionTime(d.recommended_execution_time),
        recommended_owner: crm_owner,
        confidence_score: Math.min(100, Math.max(0, parseFloat(d.confidence_score) || 70)),
        required_information: Array.isArray(d.required_information) ? d.required_information : [],
        trigger_event,
        trigger_source,
        model_version: 'gpt-4o'
      })),
      overall_situation: parsed.overall_situation || '',
      urgency_level: parsed.urgency_level || 'medium',
      analysis_notes: parsed.analysis_notes || ''
    };
  }

  static _parseExecutionTime(timeStr) {
    if (!timeStr) return null;
    const now = new Date();
    const str = timeStr.toLowerCase();
    if (str.includes('immediately') || str.includes('now')) return new Date(now.getTime() + 30 * 60000);
    if (str.includes('2 hour')) return new Date(now.getTime() + 2 * 60 * 60000);
    if (str.includes('today') || str.includes('few hour') || str.includes('4 hour')) return new Date(now.getTime() + 4 * 60 * 60000);
    if (str.includes('24 hour') || str.includes('tomorrow')) return new Date(now.getTime() + 24 * 60 * 60000);
    if (str.includes('48 hour') || str.includes('2 day')) return new Date(now.getTime() + 48 * 60 * 60000);
    if (str.includes('week')) return new Date(now.getTime() + 7 * 24 * 60 * 60000);
    return new Date(now.getTime() + 24 * 60 * 60000);
  }
}

module.exports = DecisionEngine;
