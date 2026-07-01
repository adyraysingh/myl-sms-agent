'use strict';
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    min: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 3000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    statement_timeout: 8000,
    query_timeout: 8000,
});

pool.on('error', (err) => { console.error('[pool] Unexpected client error', err.message); });
pool.on('connect', () => { console.log('[pool] New DB connection established'); });
pool.on('acquire', () => {});
pool.on('remove', () => {});

module.exports = pool;
