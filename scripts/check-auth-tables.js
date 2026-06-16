#!/usr/bin/env node
/** Verify auth-related tables exist on Neon. Run: node scripts/check-auth-tables.js */
require('dotenv').config();
const { Pool } = require('pg');

const TABLES = [
  'api_users',
  'api_sessions',
  'api_integration_tokens',
  'api_user_access',
  'api_neon_sessions',
  'admin_approved_domains',
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    for (const table of TABLES) {
      const r = await pool.query(
        `SELECT to_regclass('public.' || $1) AS reg`,
        [table]
      );
      const ok = r.rows[0]?.reg != null;
      console.log(`${ok ? '✅' : '❌'} public.${table}`);
    }
    console.log('\nNeon Auth (managed): neon_auth.user — query in Neon SQL editor if needed.');
    console.log('NEON_AUTH_BASE_URL set:', Boolean(process.env.NEON_AUTH_BASE_URL?.trim()));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
