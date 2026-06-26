const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const webhookRoutes = require('./api/webhooks');
const { healthRoutes } = require('./api/health');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler }  = require('./middleware/errorHandler');
const { authenticate }  = require('./middleware/authenticate');
const { auditLogger }   = require('./middleware/auditLogger');
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
const fs   = require('fs');
const path = require('path');

// Phase 6: Sales Intelligence & Executive Intelligence
const executiveRoutes = require('./intelligence/routes/executive.routes');
const salesRoutes     = require('./intelligence/routes/sales.routes');

// Phase 7: AI Investigation Engine
const investigationRoutes = require('./intelligence/routes/investigation.routes');

// Phase 8: CEO AI Chat & Executive Copilot
const copilotRoutes = require('./copilot/routes/copilot.routes');

// Phase 9: Continuous Learning Engine
const learningRoutes = require('./learning/routes/learning.routes');

// Phase 10: Autonomous Revenue Operations
const operationsRoutes = require('./operations/routes/operations.routes');

// Phase 11: Revenue Intelligence & Forecasting
const revenueRoutes = require('./revenue/routes/revenue.routes');

// Phase 12: AI Platform Operations
const platformRoutes = require('./platform/routes/platform.routes');

// Phase 1 (Security): Auth routes + migration
const authRoutes  = require('./auth/routes/auth.routes');
const AuthService = require('./auth/AuthService');

const app = express();

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS — explicit allowed origins only (no wildcard) ───────────────────────
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman)
    if (!origin) return callback(null, true);
    if (_allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn('[CORS] Blocked origin:', origin);
    callback(new Error('CORS policy: origin not allowed - ' + origin));
  },
  credentials: true, // Required for HttpOnly cookie support
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/webhooks/') // Webhooks have their own limits
});
app.use(limiter);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Required for HttpOnly refresh token cookie

// ─── Request logging ─────────────────────────────────────────────────────────
app.use(requestLogger);

// ─── Auth migration (runs once at startup) ───────────────────────────────────
AuthService.runMigration().catch(err =>
  logger.error('[app] Auth migration failed:', err.message)
);

// ─── Bootstrap services ───────────────────────────────────────────────────────
bootstrapMemory().catch(err => logger.error('[app] Memory bootstrap failed:', err.message));
bootstrapIntelligence().catch(err => logger.error('[app] Intelligence bootstrap failed:', err.message));
bootstrapQualification().catch(err => logger.error('[app] Qualification bootstrap failed:', err.message));

// Bootstrap Phase 5: AI Decision Engine
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

// ─── Public routes (no auth required) ────────────────────────────────────────
app.use('/webhooks', webhookRoutes);
app.use('/', healthRoutes);
app.use('/webhooks/intelligence', ingestRoutes);

// ─── Auth routes (public — login/refresh/logout/register) ────────────────────
app.use('/api/auth', authRoutes);

// ─── API routes — all require JWT authentication ─────────────────────────────
// authenticate middleware: verifies Bearer token, attaches req.user
// auditLogger middleware: writes immutable audit row on response finish
app.use('/api', authenticate);
app.use('/api', auditLogger);

// Phase 2: Business Memory
app.use('/api/memory', memoryRoutes);

// Phase 3: Conversation Intelligence
app.use('/api/conversations', conversationRoutes);
app.get('/api/leads/:id/conversations', async (req, res) => {
  try {
    const ConversationAnalysis = require('./intelligence/models/ConversationAnalysis');
    const analyses = await ConversationAnalysis.findByLeadId(req.params.id);
    const latest   = await ConversationAnalysis.getLatestForLead(req.params.id);
    res.json({ success: true, lead_id: req.params.id, conversations: analyses, latest_analysis: latest, count: analyses.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Phase 4: Qualification Engine
app.use('/api/qualification', qualificationRoutes);
app.get('/api/leads/:id/qualification', async (req, res) => {
  try {
    const LeadQualification    = require('./qualification/models/LeadQualification');
    const QualificationHistory = require('./qualification/models/QualificationHistory');
    const qual    = await LeadQualification.findByLeadId(req.params.id);
    const history = await QualificationHistory.getByLeadId(req.params.id, 10);
    res.json({ success: true, lead_id: req.params.id, qualification: qual, history, history_count: history.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Phase 5: Decision Engine
app.use('/api/decisions', decisionRoutes);
app.get('/api/leads/:leadId/decisions', async (req, res) => {
  try {
    const decisions = await AIDecision.findByLeadId(req.params.leadId, { limit: parseInt(req.query.limit)||20, offset: parseInt(req.query.offset)||0, status: req.query.status, priority: req.query.priority });
    const history   = await DecisionHistory.getByLeadId(req.params.leadId, { limit: 50 });
    res.json({ success: true, lead_id: req.params.leadId, decisions, history, count: decisions.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Phase 6: Sales & Executive Intelligence
app.use('/api/executive', executiveRoutes);
app.use('/api/sales', salesRoutes);

// Phase 7: Investigation Engine
app.use('/api/investigations', investigationRoutes);

// Phase 8: CEO Copilot
app.use('/api/copilot', copilotRoutes);

// Phase 9: Learning Engine
app.use('/api/learning', learningRoutes);

// Phase 10: Revenue Operations
app.use('/api/operations', operationsRoutes);

// Phase 11: Revenue Intelligence
app.use('/api/revenue', revenueRoutes);

// Phase 12: Platform Operations
app.use('/api/platform', platformRoutes);

// ─── 404 + Error handlers ────────────────────────────────────────────────────
app.use((req, res) => { res.status(404).json({ error: 'Not found' }); });
app.use(errorHandler);

module.exports = app;
