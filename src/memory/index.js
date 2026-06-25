const pool = require('./db/pool');
const runMigrations = require('./db/migrations/runner');

// Lazy-load models and services to avoid startup errors
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
  get LeadMemory() { return require('./models/LeadMemory'); },
  get LeadEvent() { return require('./models/LeadEvent'); },
  get EmailEvent() { return require('./models/EmailEvent'); },
  get Conversation() { return require('./models/Conversation'); },
  get RetellCall() { return require('./models/RetellCall'); },
  get SalesIQChat() { return require('./models/SalesIQChat'); },
  get CRMTask() { return require('./models/CRMTask'); },
  get CRMNote() { return require('./models/CRMNote'); },
  get FollowUp() { return require('./models/FollowUp'); },
  get MemoryService() { return require('./services/MemoryService'); },
  get TimelineService() { return require('./services/TimelineService'); },
  get ProfileService() { return require('./services/ProfileService'); },
  get memoryRoutes() { return require('./routes/memory.routes'); },
  get ingestRoutes() { return require('./routes/ingest.routes'); }
};
