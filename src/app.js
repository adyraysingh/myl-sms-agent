const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const webhookRoutes = require('./api/webhooks');
const { healthRoutes } = require('./api/health');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/authenticate');
const { auditLogger } = require('./middleware/auditLogger');
const logger = require('./utils/logger');

const memoryRoutes = require('./memory/routes/memory.routes');
const ingestRoutes = require('./memory/routes/ingest.routes');
const { bootstrapMemory } = require('./memory');

const conversationRoutes = require('./intelligence/routes/conversation.routes');
const { bootstrapIntelligence } = require('./intelligence');

const qualificationRoutes = require('./qualification/routes/qualification.routes');
const { bootstrapQualification } = require('./qualification');

const decisionRoutes = require('./decisions/routes/decision.routes');
const AIDecision = require('./decisions/models/AIDecision');
const DecisionHistory = require('./decisions/models/DecisionHistory');
const DecisionProcessor = require('./decisions/services/DecisionProcessor');
const pool = require('./memory/db/pool');
const fs = require('fs');
const path = require('path');

const executiveRoutes = require('./intelligence/routes/executive.routes');
const salesRoutes = require('./intelligence/routes/sales.routes');
const investigationRoutes = require('./intelligence/routes/investigation.routes');
const copilotRoutes = require('./copilot/routes/copilot.routes');
const learningRoutes = require('./learning/routes/learning.routes');
const operationsRoutes = require('./operations/routes/operations.routes');
const revenueRoutes = require('./revenue/routes/revenue.routes');
const platformRoutes = require('./platform/routes/platform.routes');

const authRoutes = require('./auth/routes/auth.routes');
const AuthService = require('./auth/AuthService');

// Phase 2: Durable Infrastructure
const WorkerRegistry = require('./queue/WorkerRegistry');
const JobQueue = require('./queue/JobQueue');
const chaosTestRoutes = require('./queue/chaos-test.routes');

// Phase 3: Learning Engine
const LearningScheduler = require('./learning/services/LearningScheduler');

const app = express();

app.use(helmet());

const _allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
origin: (origin, callback) => {
if (!origin) return callback(null, true);
if (_allowedOrigins.includes(origin)) return callback(null, true);
logger.warn('[CORS] Blocked origin:', origin);
callback(new Error('CORS policy: origin not allowed - ' + origin));
},
credentials: true,
methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

const limiter = rateLimit({
windowMs: 15 * 60 * 1000, max: 100,
message: { error: 'Too many requests, please try again later.' },
standardHeaders: true, legacyHeaders: false,
skip: (req) => req.path.startsWith('/webhooks/')
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestLogger);

AuthService.runMigration().catch(err =>
logger.error('[app] Auth migration failed:', err.message)
);

bootstrapMemory().catch(err => logger.error('[app] Memory bootstrap failed:', err.message));
bootstrapIntelligence().catch(err => logger.error('[app] Intelligence bootstrap failed:', err.message));
bootstrapQualification().catch(err => logger.error('[app] Qualification bootstrap failed:', err.message));

(async () => {
try {
const migrationPath = path.join(__dirname, 'decisions', 'db', 'migrations', '004_ai_decisions.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
await pool.query(sql);
console.log('[DecisionEngine] Phase 5 migration: SUCCESS');
DecisionProcessor.startQueueProcessor(30000);
console.log('[DecisionEngine] Phase 5 AI Decision Engine initialized successfully');
} catch (err) { logger.error('[app] Decision Engine initialization failed:', err.message); }
})();

// Phase 2: Run job queue migration and start workers
(async () => {
try {
const queueMigrationPath = path.join(__dirname, 'queue', 'migrations', '012_job_queue.sql');
const queueSql = fs.readFileSync(queueMigrationPath, 'utf8');
await pool.query(queueSql);
console.log('[WorkerRegistry] Phase 2 queue migration: SUCCESS');
WorkerRegistry.start();
console.log('[WorkerRegistry] Phase 2 durable workers started');
} catch (err) {
logger.error('[app] Queue initialization failed:', err.message);
logger.warn('[app] Running without durable queues - jobs will use in-memory fallback');
}
})();

// Phase 3: Run learning migration and start scheduler
(async () => {
try {
const learningMigration3 = path.join(__dirname, 'learning', 'db', 'migrations', '013_phase3_learning.sql');
const learningSql3 = fs.readFileSync(learningMigration3, 'utf8');
await pool.query(learningSql3);
console.log('[LearningScheduler] Phase 3 learning migration: SUCCESS');
LearningScheduler.start();
console.log('[LearningScheduler] Phase 3 learning scheduler started');
} catch (err) {
logger.error('[app] Phase 3 learning initialization failed:', err.message);
}
})();

app.use('/webhooks', webhookRoutes);
app.use('/', healthRoutes);
app.use('/webhooks/intelligence', ingestRoutes);
app.use('/api/auth', authRoutes);

app.use('/api', authenticate);
app.use('/api', auditLogger);

app.use('/api/memory', memoryRoutes);
app.use('/api/conversations', conversationRoutes);
app.get('/api/leads/:id/conversations', async (req, res) => {
try {
const ConversationAnalysis = require('./intelligence/models/ConversationAnalysis');
const analyses = await ConversationAnalysis.findByLeadId(req.params.id);
const latest = await ConversationAnalysis.getLatestForLead(req.params.id);
res.json({ success: true, lead_id: req.params.id, conversations: analyses, latest_analysis: latest, count: analyses.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.use('/api/qualification', qualificationRoutes);
app.get('/api/leads/:id/qualification', async (req, res) => {
try {
const LeadQualification = require('./qualification/models/LeadQualification');
const QualificationHistory = require('./qualification/models/QualificationHistory');
const qual = await LeadQualification.findByLeadId(req.params.id);
const history = await QualificationHistory.getByLeadId(req.params.id, 10);
res.json({ success: true, lead_id: req.params.id, qualification: qual, history, history_count: history.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.use('/api/decisions', decisionRoutes);
app.get('/api/leads/:leadId/decisions', async (req, res) => {
try {
const decisions = await AIDecision.findByLeadId(req.params.leadId, { limit: parseInt(req.query.limit)||20, offset: parseInt(req.query.offset)||0, status: req.query.status, priority: req.query.priority });
const history = await DecisionHistory.getByLeadId(req.params.leadId, { limit: 50 });
res.json({ success: true, lead_id: req.params.leadId, decisions, history, count: decisions.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.use('/api/executive', executiveRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/investigations', investigationRoutes);
app.use('/api/copilot', copilotRoutes);
app.use('/api/learning', learningRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/platform', platformRoutes);

// Phase 2: Queue management API
app.get('/api/queue/stats', authenticate, async (req, res) => {
try {
const stats = await WorkerRegistry.getFullStats();
res.json({ success: true, ...stats, retrieved_at: new Date().toISOString() });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/queue/dlq', authenticate, async (req, res) => {
try {
const dlq = await JobQueue.getDLQ(req.query.queue || null, parseInt(req.query.limit || '50'));
res.json({ success: true, dlq, count: dlq.length });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/queue/dlq/:id/replay', authenticate, async (req, res) => {
try {
const job = await JobQueue.replayDLQ(parseInt(req.params.id), req.user?.email || 'admin');
res.json({ success: true, replayed_job: job });
} catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Phase 2 Chaos Testing Routes (authenticated)
app.use('/api/queue/chaos', chaosTestRoutes);

app.use((req, res) => { res.status(404).json({ error: 'Not found' }); });
app.use(errorHandler);

module.exports = { app, WorkerRegistry };
