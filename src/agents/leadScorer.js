const { query } = require('../database/connection');
const logger = require('../utils/logger');

async function calculateLeadScore(lead, messages) {
  let score = 0;
    const factors = {};

      // Responsiveness (0-20 points)
        const inboundCount = messages.filter(m => m.direction === 'inbound').length;
          if (inboundCount >= 5) { score += 20; factors.responsiveness = 20; }
            else if (inboundCount >= 3) { score += 15; factors.responsiveness = 15; }
              else if (inboundCount >= 1) { score += 10; factors.responsiveness = 10; }
                else { factors.responsiveness = 0; }

                  // Budget indication (0-25 points)
                    const hasHighBudget = checkForKeywords(messages, ['10k', '20k', '50k', 'ten thousand', 'twenty thousand', 'serious budget']);
                      const hasMidBudget = checkForKeywords(messages, ['5k', '3k', 'few thousand', 'budget', 'invest']);
                        if (hasHighBudget) { score += 25; factors.budget = 25; }
                          else if (hasMidBudget) { score += 15; factors.budget = 15; }
                            else if (lead.budget) { score += 10; factors.budget = 10; }
                              else { factors.budget = 0; }

                                // Timeline (0-20 points)
                                  const hasUrgentTimeline = checkForKeywords(messages, ['asap', 'soon', 'this month', 'next month', '1 month', '2 months', 'quickly']);
                                    const hasMidTimeline = checkForKeywords(messages, ['3 months', '6 months', 'this year', 'quarter']);
                                      if (hasUrgentTimeline) { score += 20; factors.timeline = 20; }
                                        else if (hasMidTimeline) { score += 12; factors.timeline = 12; }
                                          else if (lead.timeline) { score += 8; factors.timeline = 8; }
                                            else { factors.timeline = 0; }

                                              // Product clarity (0-20 points)
                                                const hasProducts = checkForKeywords(messages, ['t-shirt', 'hoodie', 'joggers', 'leggings', 'dress', 'jacket', 'tops', 'bottoms', 'activewear', 'streetwear', 'collection']);
                                                  if (hasProducts) { score += 20; factors.productClarity = 20; }
                                                    else if (lead.product_category) { score += 15; factors.productClarity = 15; }
                                                      else { factors.productClarity = 0; }

                                                        // Brand readiness (0-15 points)
                                                          const hasBrandReady = checkForKeywords(messages, ['designs ready', 'logo done', 'brand name', 'have designs', 'artwork ready']);
                                                            const hasBrandPlanning = checkForKeywords(messages, ['working on', 'designing', 'planning', 'concept']);
                                                              if (hasBrandReady) { score += 15; factors.brandReadiness = 15; }
                                                                else if (hasBrandPlanning) { score += 8; factors.brandReadiness = 8; }
                                                                  else { factors.brandReadiness = 0; }

                                                                    score = Math.min(100, Math.max(0, score));

                                                                      // Save score to database
                                                                        try {
                                                                            await query(
                                                                                  'INSERT INTO lead_scores (lead_id, score, factors) VALUES ($1, $2, $3)',
                                                                                        [lead.id, score, JSON.stringify(factors)]
                                                                                            );
                                                                                                await query(
                                                                                                      'UPDATE leads SET qualification_score = $1, updated_at = NOW() WHERE id = $2',
                                                                                                            [score, lead.id]
                                                                                                                );
                                                                                                                  } catch (error) {
                                                                                                                      logger.error('Error saving lead score:', error);
                                                                                                                        }
                                                                                                                        
                                                                                                                          logger.info('Lead score calculated', { leadId: lead.id, score, factors });
                                                                                                                            return score;
                                                                                                                            }
                                                                                                                            
                                                                                                                            function checkForKeywords(messages, keywords) {
                                                                                                                              const allText = messages
                                                                                                                                  .filter(m => m.direction === 'inbound')
                                                                                                                                      .map(m => m.content.toLowerCase())
                                                                                                                                          .join(' ');
                                                                                                                                            return keywords.some(keyword => allText.includes(keyword.toLowerCase()));
                                                                                                                                            }
                                                                                                                                            
                                                                                                                                            module.exports = { calculateLeadScore };
