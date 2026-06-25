const pool = require('./db/pool');
const runMigrations = require('./db/migrations/runner');

async function bootstrapMemory() {
  try {
    console.log('[Memory] Bootstrapping Business Memory Engine...');
    await pool.query('SELECT NOW()');
    console.log('[Memory] Database connection established');
    await runMigrations();
    console.log('[Memory] Business Memory Engine ready');
  } catch (err) {
    console.error('[Memory] Bootstrap failed:', err.message);
  }
}

module.exports = {
  bootstrapMemory,
  LeadMemory: require('./models/LeadMemory'),
  LeadEvent: require('./models/LeadEvent'),
  EmailEvent: require('./models/EmailEvent'),
  Conversation: require('./models/Conversation'),
  RetellCall: require('./models/RetellCall'),
  SalesIQChat: require('./models/SalesIQChat'),
  CRMTask: require('./models/CRMTask'),
  CRMNote: require('./models/CRMNote'),
  FollowUp: require('./models/FollowUp'),
  MemoryService: require('./services/MemoryService'),
  TimelineService: require('./services/TimelineService'),
  ProfileService: require('./services/ProfileService'),
  memoryRoutes: require('./routes/memory.routes'),
  ingestRoutes: require('./routes/ingest.routes')
};
