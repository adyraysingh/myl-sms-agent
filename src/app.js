const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const webhookRoutes = require('./api/webhooks');
const { healthRoutes } = require('./api/health');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Phase 2: Business Memory Engine
const memoryRoutes = require('./memory/routes/memory.routes');
const ingestRoutes = require('./memory/routes/ingest.routes');
const { bootstrapMemory } = require('./memory');

// Phase 3: Conversation Intelligence Engine
const conversationRoutes = require('./intelligence/routes/conversation.routes');
const { bootstrapIntelligence } = require('./intelligence');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS || '*' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// JSON parsing for routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Bootstrap Phase 2: Business Memory Engine
bootstrapMemory().catch(err => {
  logger.error('[app] Memory bootstrap failed:', err.message);
});

// Bootstrap Phase 3: Conversation Intelligence Engine
bootstrapIntelligence().catch(err => {
  logger.error('[app] Intelligence bootstrap failed:', err.message);
});

// Existing routes (preserved - do not modify)
app.use('/webhooks', webhookRoutes);
app.use('/', healthRoutes);

// Phase 2: Memory API routes
app.use('/api/memory', memoryRoutes);

// Phase 2: Intelligence webhook ingest routes
app.use('/webhooks/intelligence', ingestRoutes);

// Phase 3: Conversation Intelligence API routes
app.use('/api/conversations', conversationRoutes);

// Phase 3: Lead conversations endpoint (nested resource)
app.get('/api/leads/:id/conversations', async (req, res) => {
  try {
    const ConversationAnalysis = require('./intelligence/models/ConversationAnalysis');
    const analyses = await ConversationAnalysis.findByLeadId(req.params.id);
    const latest = await ConversationAnalysis.getLatestForLead(req.params.id);
    res.json({
      success: true,
      lead_id: req.params.id,
      conversations: analyses,
      latest_analysis: latest,
      count: analyses.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
