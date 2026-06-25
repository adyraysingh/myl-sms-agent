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

// Phase 2: Foundation complete - Business Memory Engine
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

// Bootstrap Business Memory Engine
bootstrapMemory().catch(err => {
  logger.error('[app] Memory bootstrap failed:', err.message);
});

// Existing routes (preserved)
app.use('/webhooks', webhookRoutes);
app.use('/', healthRoutes);

// Phase 2: Memory API routes
app.use('/api/memory', memoryRoutes);

// Phase 2: Intelligence webhook ingest routes
app.use('/webhooks/intelligence', ingestRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
