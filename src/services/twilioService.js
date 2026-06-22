const twilio = require('twilio');
const { saveMessage } = require('../database/messages');
const logger = require('../utils/logger');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
    );

    const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

    async function sendSMS(to, body, retries = 3) {
      for (let attempt = 1; attempt <= retries; attempt++) {
          try {
                const message = await client.messages.create({
                        body,
                                from: FROM_NUMBER,
                                        to
                                              });
                                                    logger.info('SMS sent', { to, sid: message.sid, status: message.status });
                                                          return message;
                                                              } catch (error) {
                                                                    logger.error(`SMS send attempt ${attempt} failed:`, { to, error: error.message });
                                                                          if (attempt === retries) throw error;
                                                                                await sleep(1000 * attempt);
                                                                                    }
                                                                                      }
                                                                                      }

                                                                                      async function sendInitialSMS(lead, conversationId) {
                                                                                        const firstName = lead.first_name || lead.firstName || 'there';
                                                                                          const message = `Hi ${firstName}, this is Maya from MakeYourLabel! I saw you're interested in launching a clothing brand. What type of products are you planning to launch?`;

                                                                                            const sent = await sendSMS(lead.phone, message);

                                                                                              await saveMessage({
                                                                                                  conversationId,
                                                                                                      leadId: lead.id,
                                                                                                          direction: 'outbound',
                                                                                                              content: message,
                                                                                                                  twilioSid: sent.sid,
                                                                                                                      status: 'sent'
                                                                                                                        });
                                                                                                                        
                                                                                                                          return sent;
                                                                                                                          }
                                                                                                                          
                                                                                                                          async function sendFollowUpSMS(phone, message, conversationId, leadId) {
                                                                                                                            const sent = await sendSMS(phone, message);
                                                                                                                            
                                                                                                                              if (conversationId && leadId) {
                                                                                                                                  await saveMessage({
                                                                                                                                        conversationId,
                                                                                                                                              leadId,
                                                                                                                                                    direction: 'outbound',
                                                                                                                                                          content: message,
                                                                                                                                                                twilioSid: sent.sid,
                                                                                                                                                                      status: 'sent'
                                                                                                                                                                          });
                                                                                                                                                                            }
                                                                                                                                                                            
                                                                                                                                                                              return sent;
                                                                                                                                                                              }
                                                                                                                                                                              
                                                                                                                                                                              function sleep(ms) {
                                                                                                                                                                                return new Promise(resolve => setTimeout(resolve, ms));
                                                                                                                                                                                }
                                                                                                                                                                                
                                                                                                                                                                                module.exports = { sendSMS, sendInitialSMS, sendFollowUpSMS };
