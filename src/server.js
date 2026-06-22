// MYL SMS Agent Server - startup
process.stdout.write('[server.js] Starting...\n');

require('dotenv').config();

process.stdout.write('[server.js] dotenv loaded\n');

const PORT = process.env.PORT || 3000;

process.stdout.write(`[server.js] PORT=${PORT}\n`);

let app;
try {
      app = require('./app');
      process.stdout.write('[server.js] app.js loaded successfully\n');
} catch (err) {
      process.stderr.write(`[server.js] FATAL: Failed to load app.js: ${err.message}\n`);
      process.stderr.write(err.stack + '\n');
      process.exit(1);
}

// Start HTTP server immediately so healthcheck passes
let server;
try {
      server = app.listen(PORT, '0.0.0.0', () => {
              process.stdout.write(`[server.js] MYL SMS Agent running on port ${PORT}\n`);
              process.stdout.write(`[server.js] Environment: ${process.env.NODE_ENV || 'development'}\n`);
      });
} catch (err) {
      process.stderr.write(`[server.js] FATAL: Failed to start HTTP server: ${err.message}\n`);
      process.exit(1);
}

// Then attempt database connection and scheduler (non-blocking)
async function initializeServices() {
      if (!process.env.DATABASE_URL) {
              process.stdout.write('[server.js] DATABASE_URL not set - running without database\n');
              return;
      }

  try {
          const { connectDatabase } = require('./database/connection');
          await connectDatabase();
          process.stdout.write('[server.js] Database connected successfully\n');

        const { startFollowUpScheduler } = require('./workflows/followUpScheduler');
          startFollowUpScheduler();
          process.stdout.write('[server.js] Follow-up scheduler started\n');
  } catch (error) {
          process.stderr.write(`[server.js] Services init failed: ${error.message}\n`);
          process.stdout.write('[server.js] Server running in degraded mode\n');
  }
}

initializeServices();

process.on('unhandledRejection', (reason, promise) => {
      process.stderr.write(`[server.js] Unhandled Rejection: ${reason}\n`);
});

process.on('uncaughtException', (error) => {
      process.stderr.write(`[server.js] Uncaught Exception: ${error.message}\n`);
      process.stderr.write(error.stack + '\n');
      process.exit(1);
});

process.on('SIGTERM', () => {
      process.stdout.write('[server.js] SIGTERM received, shutting down\n');
      if (server) {
              server.close(() => {
                        process.exit(0);
              });
      }
});
