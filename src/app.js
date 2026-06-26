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

// Phase 4: Onboarding Qualification Engine
const qualificationRoutes = require('./qualification/routes/qualification.routes');
const { bootstrapQualification } = require('./qualification');

// Phase 5: AI Decision Engine
const decisionRoutes = require('./decisions/routes/decision.routes');
const AIDecision = require('./decisions/models/AIDecision');
const DecisionHistory = require('./decisions/models/DecisionHistory');
const DecisionProcessor = require('./decisions/services/DecisionProcessor');
const pool = require('./memory/db/pool');
const fs = require('fs');
const path = require('path');

// Phase 6: Sales Intelligence & Executive Intelligence
const executiveRoutes = require('./intelligence/routes/executive.routes');
const salesRoutes = require('./intelligence/routes/sales.routes');

// Phase 7: AI Investigation Engine
const investigationRoutes = require('./intelligence/routes/investigation.routes');

// Phase 8: CEO AI Chat & Executive Copilot
const copilotRoutes = require('./copilot/routes/copilot.routes');

// Phase 9: Continuous Learning Engine
const learningRoutes = require('./learning/routes/learning.routes');

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

// JSON parsing
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

// Bootstrap Phase 4: Onboarding Qualification Engine
bootstrapQualification().catch(err => {
logger.error('[app] Qualification bootstrap failed:', err.message);
});

// Bootstrap Phase 5: AI Decision Engine (run migration async)
(async () => {
try {
const migrationPath = path.join(__dirname, 'decisions', 'db', 'migrations', '004_ai_decisions.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
await pool.query(sql);
console.log('[DecisionEngine] Phase 5 migration: SUCCESS');
DecisionProcessor.startQueueProcessor(30000);
console.log('[DecisionEngine] Phase 5 AI Decision Engine initialized successfully');
} catch (err) {
logger.error('[app] Decision Engine initialization failed:', err.message);
}
})();

// Existing routes (preserved)
app.use('/webhooks', webhookRoutes);
app.use('/', healthRoutes);

// Phase 2: Memory API routes
app.use('/api/memory', memoryRoutes);
app.use('/webhooks/intelligence', ingestRoutes);

// Phase 3: Conversation Intelligence API
app.use('/api/conversations', conversationRoutes);

// Phase 3: Lead conversations endpoint
app.get('/api/leads/:id/conversations', async (req, res) => {
try {
const ConversationAnalysis = require('./intelligence/models/ConversationAnalysis');
const analyses = await ConversationAnalysis.findByLeadId(req.params.id);
const latest = await ConversationAnalysis.getLatestForLead(req.params.id);
res.json({ success: true, lead_id: req.params.id, conversations: analyses, latest_analysis: latest, count: analyses.length });
} catch (err) {
res.status(500).json({ success: false, error: err.message });
}
});

// Phase 4: Qualification API
app.use('/api/qualification', qualificationRoutes);

// Phase 4: Lead qualification shortcut endpoint
app.get('/api/leads/:id/qualification', async (req, res) => {
try {
const LeadQualification = require('./qualification/models/LeadQualification');
const QualificationHistory = require('./qualification/models/QualificationHistory');
const qual = await LeadQualification.findByLeadId(req.params.id);
const history = await QualificationHistory.getByLeadId(req.params.id, 10);
res.json({ success: true, lead_id: req.params.id, qualification: qual, history, history_count: history.length });
} catch (err) {
res.status(500).json({ success: false, error: err.message });
}
});

// Phase 5: AI Decision Engine API routes
app.use('/api/decisions', decisionRoutes);

// Phase 5: Lead decisions endpoint
app.get('/api/leads/:leadId/decisions', async (req, res) => {
try {
const decisions = await AIDecision.findByLeadId(req.params.leadId, {
limit: parseInt(req.query.limit) || 20,
offset: parseInt(req.query.offset) || 0,
status: req.query.status,
priority: req.query.priority
});
const history = await DecisionHistory.getByLeadId(req.params.leadId, { limit: 50 });
res.json({ success: true, lead_id: req.params.leadId, decisions, history, count: decisions.length });
} catch (err) {
res.status(500).json({ success: false, error: err.message });
}
});

// Phase 6: Executive Intelligence routes
app.use('/api/executive', executiveRoutes);

// Phase 6: Sales Intelligence routes
app.use('/api/sales', salesRoutes);

// Phase 7: AI Investigation Engine routes
app.use('/api/investigations', investigationRoutes);

// Phase 8: CEO AI Chat & Executive Copilot routes
app.use('/api/copilot', copilotRoutes);

// Phase 9: Continuous Learning Engine routes
app.use('/api/learning', learningRoutes);

// 404 handler
app.use((req, res) => {
res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
