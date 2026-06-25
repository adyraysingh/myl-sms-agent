'use strict';

const OpenAI = require('openai');

/**
 * QualificationEngine
 * Uses GPT-4o to calculate onboarding qualification for MakeYourLabel leads.
 * Reads from Business Memory + Conversation Intelligence.
 * Returns fully explainable scores with reasoning for every field.
 * Phase 4 - Onboarding Qualification Engine
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the Onboarding Qualification Engine for MakeYourLabel, a clothing manufacturing company in India.

Your ONLY job is to evaluate how likely a lead is to complete onboarding with MakeYourLabel.

DO NOT generate sales messages.
DO NOT generate revenue forecasts.
DO NOT give generic advice.
ONLY evaluate onboarding readiness based on the data provided.

MakeYourLabel onboarding requires:
1. Customer has a clear brand concept (name, products, target market)
2. Customer understands MOQ (30-50 pieces minimum)
3. Customer has budget for sampling + production
4. Customer has a realistic timeline
5. Customer wants to place an order (not just browsing or learning)
6. Customer has or is ready to build a Shopify store
7. Customer understands private label / custom manufacturing
8. Customer has responded consistently (engagement)

QUALIFICATION CATEGORIES:
- hot: Score 75+, clear intent, budget confirmed, timeline within 60 days, engaged
- warm: Score 50-74, intent present, some gaps, follow-up needed
- cold: Score 25-49, low engagement, unclear intent, major gaps
- dead: Score 0-24, no response, wrong fit, or explicitly declined
- unqualified: Not enough information to assess
- onboarded: Has already placed an order with MakeYourLabel

Always return valid JSON matching the exact schema. Be precise and factual.`;

function buildPrompt(leadData) {
  return `Evaluate this MakeYourLabel lead for onboarding qualification.

LEAD DATA:
${JSON.stringify(leadData, null, 2)}

Return ONLY this JSON structure:
{
  "category": "hot|warm|cold|dead|unqualified|onboarded",
  "onboarding_score": 0-100,
  "onboarding_probability": 0-100,
  "readiness_score": 0-100,
  "trust_score": 0-100,
  "engagement_score": 0-100,
  "budget_confidence": 0-100,
  "timeline_confidence": 0-100,
  "brand_readiness": 0-100,
  "manufacturing_readiness": 0-100,
  "communication_quality": 0-100,
  "followup_health": 0-100,
  "decision_confidence": 0-100,
  "confidence_score": 0-100,
  "overall_reasoning": "2-4 sentence explanation of the overall qualification",
  "score_breakdown": {
    "onboarding_score": {"value": 0, "reason": "why this score"},
    "trust_score": {"value": 0, "reason": "why this score"},
    "engagement_score": {"value": 0, "reason": "why this score"},
    "budget_confidence": {"value": 0, "reason": "why this score"},
    "timeline_confidence": {"value": 0, "reason": "why this score"},
    "brand_readiness": {"value": 0, "reason": "why this score"},
    "manufacturing_readiness": {"value": 0, "reason": "why this score"}
  },
  "factors": {
    "budget": {"assessed": true/false, "value": "what was said or null", "notes": ""},
    "timeline": {"assessed": true/false, "value": "what was said or null", "notes": ""},
    "brand_clarity": {"assessed": true/false, "value": "clear/unclear/none", "notes": ""},
    "product_clarity": {"assessed": true/false, "value": "what products", "notes": ""},
    "moq_understanding": {"assessed": true/false, "notes": ""},
    "shopify_readiness": {"assessed": true/false, "value": "has/building/none", "notes": ""},
    "sampling_interest": {"assessed": true/false, "requested": true/false, "notes": ""},
    "decision_maker": {"confirmed": true/false, "notes": ""},
    "previous_manufacturer": {"has_one": true/false, "notes": ""},
    "urgency": {"level": "low|medium|high|urgent", "notes": ""},
    "communication_frequency": {"assessment": "consistent/inconsistent/single/none", "notes": ""},
    "private_label_understanding": {"assessed": true/false, "notes": ""},
    "packaging_requirements": {"discussed": true/false, "notes": ""}
  },
  "qualification_gaps": [
    {"gap": "what is missing", "severity": "critical|high|medium|low", "impact_on_score": "how much this is reducing the score"}
  ],
  "positive_signals": [
    {"signal": "what positive signal exists", "strength": "strong|medium|weak"}
  ],
  "negative_signals": [
    {"signal": "what negative signal exists", "severity": "high|medium|low"}
  ],
  "recommended_next_action": "specific single next action for the sales team",
  "recommended_questions": [
    "specific question to fill a qualification gap"
  ],
  "urgency_level": "low|normal|high|urgent"
}`;
}

class QualificationEngine {

  /**
   * Calculate onboarding qualification for a lead.
   * @param {object} leadData - aggregated data from Business Memory + Conversation Intelligence
   * @returns {object} structured qualification with full explainability
   */
  static async qualify(leadData) {
    const startTime = Date.now();

    // Truncate lead data to avoid token limits
    const dataStr = JSON.stringify(leadData);
    const truncated = dataStr.length > 10000 ? dataStr.substring(0, 10000) + '...[truncated]' : dataStr;
    const truncatedData = JSON.parse(truncated.endsWith(']') ? truncated.replace('...[truncated]', '') : JSON.stringify(leadData).substring(0, 8000) + '}');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 3000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(leadData) }
      ],
      response_format: { type: 'json_object' }
    });

    const processingTime = Date.now() - startTime;
    let parsed;
    try {
      parsed = JSON.parse(response.choices[0].message.content);
    } catch (e) {
      throw new Error('AI returned invalid JSON: ' + e.message);
    }

    parsed.model_version = response.model || 'gpt-4o';
    parsed.processing_time_ms = processingTime;

    console.log(`[QualificationEngine] Qualified lead: category=${parsed.category} score=${parsed.onboarding_score} probability=${parsed.onboarding_probability}% time=${processingTime}ms`);

    return parsed;
  }

  /**
   * Sanitize and validate qualification output
   */
  static sanitize(q) {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, parseInt(v) || 0));
    const validCategories = ['hot','warm','cold','dead','unqualified','onboarded'];

    return {
      category:                validCategories.includes(q.category) ? q.category : 'unqualified',
      onboarding_score:        clamp(q.onboarding_score, 0, 100),
      onboarding_probability:  clamp(q.onboarding_probability, 0, 100),
      readiness_score:         clamp(q.readiness_score, 0, 100),
      trust_score:             clamp(q.trust_score, 0, 100),
      engagement_score:        clamp(q.engagement_score, 0, 100),
      budget_confidence:       clamp(q.budget_confidence, 0, 100),
      timeline_confidence:     clamp(q.timeline_confidence, 0, 100),
      brand_readiness:         clamp(q.brand_readiness, 0, 100),
      manufacturing_readiness: clamp(q.manufacturing_readiness, 0, 100),
      communication_quality:   clamp(q.communication_quality, 0, 100),
      followup_health:         clamp(q.followup_health, 0, 100),
      decision_confidence:     clamp(q.decision_confidence, 0, 100),
      confidence_score:        clamp(q.confidence_score, 0, 100),
      overall_reasoning:       q.overall_reasoning || 'Insufficient data for full assessment.',
      score_breakdown:         q.score_breakdown || {},
      factors:                 q.factors || {},
      qualification_gaps:      Array.isArray(q.qualification_gaps) ? q.qualification_gaps : [],
      positive_signals:        Array.isArray(q.positive_signals) ? q.positive_signals : [],
      negative_signals:        Array.isArray(q.negative_signals) ? q.negative_signals : [],
      recommended_next_action: q.recommended_next_action || null,
      recommended_questions:   Array.isArray(q.recommended_questions) ? q.recommended_questions : [],
      urgency_level:           ['low','normal','high','urgent'].includes(q.urgency_level) ? q.urgency_level : 'normal',
      model_version:           q.model_version || 'gpt-4o',
      processing_time_ms:      q.processing_time_ms || null
    };
  }
}

module.exports = QualificationEngine;
