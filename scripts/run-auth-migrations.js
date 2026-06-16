#!/usr/bin/env node
/** Apply auth migrations 026–028 on Neon. Run: node scripts/run-auth-migrations.js */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS = [
  '026_create_api_auth_tables.sql',
  '027_create_api_user_access.sql',
  '028_create_api_neon_sessions.sql',
];

const TABLES = [
  'api_users',
  'api_sessions',
  'api_integration_tokens',
  'api_user_access',
  'api_neon_sessions',
];

async function tableExists(pool, name) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rowCount > 0;
}

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error('NEON_DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const host = new URL(url).hostname;
    console.log('Neon host:', host);
    console.log('\nBefore:');
    for (const t of TABLES) {
      console.log(`  ${(await tableExists(pool, t)) ? 'OK' : 'MISSING'} public.${t}`);
    }

    for (const file of MIGRATIONS) {
      const sqlPath = path.join(__dirname, '..', 'migrations', file);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`\nApplying ${file}...`);
      await pool.query(sql);
      console.log(`  done`);
    }

    console.log('\nAfter:');
    for (const t of TABLES) {
      console.log(`  ${(await tableExists(pool, t)) ? 'OK' : 'MISSING'} public.${t}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
