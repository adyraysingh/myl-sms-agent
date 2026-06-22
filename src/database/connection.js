const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client', err);
});

async function connectDatabase() {
  const client = await pool.connect();
  logger.info('PostgreSQL database connected');
  client.release();
  return pool;
}

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

module.exports = { pool, connectDatabase, query };
