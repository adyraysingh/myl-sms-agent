'use strict';

const OpenAI = require('openai');

/**
 * AIAnalysisService
 * Uses GPT-4o to extract structured business intelligence from conversations.
 * Understands MakeYourLabel specific business context.
 * Phase 3 - Conversation Intelligence Engine
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an expert business analyst for MakeYourLabel, a clothing manufacturing and private label company based in India. You analyze customer conversations and extract structured business intelligence.

MakeYourLabel specializes in:
- Custom clothing manufacturing (MOQ from 30-50 pieces)
- Private label and custom branding
- Products: Oversized T-Shirts, Hoodies, Tracksuits, Streetwear, Gym Wear, Activewear
- Services: Sampling, Tech Packs, Packaging (labels, hang tags, polybags), Shipping
- Business model: Pre-order model, low MOQ, quality focus
- Target customers: New and growing clothing brands (0-3 years), D2C brands, Shopify stores

Your job is to analyze conversations and extract structured intelligence. Always return valid JSON matching the required schema exactly. Never return prose without JSON.

IMPORTANT RULES:
- Be specific and factual - only extract what was actually said
- Never invent or assume information not in the conversation
- Score trust_score 0-100 based on how engaged and genuine the customer seems
- Score buying_intent_score 0-100 based on how close they are to placing an order
- Confidence score 0-1 based on how much information was in the conversation`;

function buildUserPrompt(sourceType, transcript, leadInfo) {
  const truncated = transcript && transcript.length > 12000
    ? transcript.substring(0, 12000) + '\n\n[TRANSCRIPT TRUNCATED]'
    : (transcript || '');
  return `Analyze this ${sourceType} conversation from a MakeYourLabel customer.\n\nLEAD INFORMATION:\n${JSON.stringify(leadInfo || {}, null, 2)}\n\nCONVERSATION TRANSCRIPT:\n${truncated}\n\nExtract all available intelligence and return ONLY this JSON structure (no extra text):\n\n{\n  "summary": "Executive summary max 200 words: what customer wants, current stage, main concerns, buying signals, risk factors, recommended next conversation",\n  "customer_intent": "buy_samples|get_pricing|learn_about_myl|launch_brand|scale_brand|compare_manufacturers|just_browsing|unknown",\n  "conversation_stage": "awareness|interest|consideration|decision|closed_won|closed_lost",\n  "brand_stage": "idea|planning|launching|launched|scaling|unknown",\n  "conversation_outcome": "positive|negative|neutral|follow_up_needed|dead",\n  "product_interest": ["oversized_tshirt","hoodie","tracksuit","gym_wear","activewear","streetwear"],\n  "products_requested": [{"name": "product name", "category": "category", "qty": null, "notes": "details"}],\n  "budget_detected": false,\n  "budget_value": null,\n  "timeline_detected": false,\n  "timeline_value": null,\n  "manufacturing_stage": "no_manufacturer|has_manufacturer|unhappy_with_manufacturer|unknown",\n  "shopify_status": "no_store|has_store|building_store|unknown",\n  "country": null,\n  "experience_level": "beginner|intermediate|experienced|unknown",\n  "brand_readiness": "not_ready|partially_ready|ready|unknown",\n  "trust_score": 50,\n  "sentiment": "positive|neutral|negative|mixed",\n  "conversation_quality": "excellent|good|average|poor",\n  "buying_intent_score": 0,\n  "questions": [{"question": "text", "category": "moq|pricing|sampling|production|packaging|shipping|quality|branding|timeline|other", "priority": "high|medium|low"}],\n  "objections": [{"objection": "text", "category": "price|moq|quality|timeline|trust|other", "severity": "high|medium|low"}],\n  "positive_buying_signals": [{"signal": "text", "strength": "strong|medium|weak"}],\n  "negative_buying_signals": [{"signal": "text", "severity": "high|medium|low"}],\n  "recommended_next_step": "specific action for sales team",\n  "recommended_follow_up": "what to say or send next",\n  "risk_factors": [{"risk": "description", "severity": "high|medium|low"}],\n  "topics_detected": ["sampling","moq","pricing","packaging","private_label","custom_branding","tech_pack","shipping","quality","fabric","production_time","marketing","brand_development","shopify","pre_order","labels","hang_tags"],\n  "key_requirements": {\n    "moq_asked": false,\n    "sample_requested": false,\n    "price_asked": false,\n    "quality_concern": false,\n    "packaging_needed": false,\n    "branding_needed": false,\n    "shipping_international": false,\n    "urgency_expressed": false,\n    "previous_manufacturer": false\n  },\n  "confidence_score": 0.8\n}`;
}

class AIAnalysisService {

  /**
   * Analyze a conversation transcript
   * @param {object} params
   * @param {string} params.sourceType - salesiq | retell | email | crm_note
   * @param {string} params.transcript - raw conversation text
   * @param {object} params.leadInfo - lead metadata from Business Memory
   * @returns {object} structured analysis
   */
  static async analyze({ sourceType, transcript, leadInfo = {} }) {
    const startTime = Date.now();

    if (!transcript || transcript.trim().length < 10) {
      throw new Error('Transcript too short or empty to analyze');
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 3000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(sourceType, transcript, leadInfo) }
      ],
      response_format: { type: 'json_object' }
    });

    const processingTime = Date.now() - startTime;
    const rawContent = response.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      throw new Error(`AI returned invalid JSON: ${parseErr.message}`);
    }

    parsed.model_version = response.model || 'gpt-4o';
    parsed.processing_time_ms = processingTime;

    console.log(`[AIAnalysisService] Done in ${processingTime}ms | intent=${parsed.customer_intent} | sentiment=${parsed.sentiment} | trust=${parsed.trust_score} | intent_score=${parsed.buying_intent_score}`);

    return parsed;
  }

  /**
   * Sanitize analysis output - ensures all required fields with safe defaults
   */
  static sanitize(analysis) {
    return {
      summary:                 analysis.summary || 'Analysis pending',
      customer_intent:         analysis.customer_intent || 'unknown',
      conversation_stage:      analysis.conversation_stage || 'awareness',
      brand_stage:             analysis.brand_stage || 'unknown',
      conversation_outcome:    analysis.conversation_outcome || 'neutral',
      product_interest:        Array.isArray(analysis.product_interest) ? analysis.product_interest : [],
      products_requested:      Array.isArray(analysis.products_requested) ? analysis.products_requested : [],
      budget_detected:         Boolean(analysis.budget_detected),
      budget_value:            analysis.budget_value || null,
      timeline_detected:       Boolean(analysis.timeline_detected),
      timeline_value:          analysis.timeline_value || null,
      manufacturing_stage:     analysis.manufacturing_stage || 'unknown',
      shopify_status:          analysis.shopify_status || 'unknown',
      country:                 analysis.country || null,
      experience_level:        analysis.experience_level || 'unknown',
      brand_readiness:         analysis.brand_readiness || 'unknown',
      trust_score:             Math.min(100, Math.max(0, parseInt(analysis.trust_score) || 50)),
      sentiment:               analysis.sentiment || 'neutral',
      conversation_quality:    analysis.conversation_quality || 'average',
      buying_intent_score:     Math.min(100, Math.max(0, parseInt(analysis.buying_intent_score) || 0)),
      questions:               Array.isArray(analysis.questions) ? analysis.questions : [],
      objections:              Array.isArray(analysis.objections) ? analysis.objections : [],
      positive_buying_signals: Array.isArray(analysis.positive_buying_signals) ? analysis.positive_buying_signals : [],
      negative_buying_signals: Array.isArray(analysis.negative_buying_signals) ? analysis.negative_buying_signals : [],
      recommended_next_step:   analysis.recommended_next_step || null,
      recommended_follow_up:   analysis.recommended_follow_up || null,
      risk_factors:            Array.isArray(analysis.risk_factors) ? analysis.risk_factors : [],
      topics_detected:         Array.isArray(analysis.topics_detected) ? analysis.topics_detected : [],
      key_requirements:        analysis.key_requirements || {},
      confidence_score:        Math.min(1, Math.max(0, parseFloat(analysis.confidence_score) || 0.5)),
      model_version:           analysis.model_version || 'gpt-4o',
      processing_time_ms:      analysis.processing_time_ms || null
    };
  }
}

module.exports = AIAnalysisService;
