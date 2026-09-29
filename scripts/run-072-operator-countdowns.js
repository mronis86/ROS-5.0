/**
 * Apply migrations/072_create_operator_countdowns.sql against NEON_DATABASE_URL.
 * Usage: node scripts/run-072-operator-countdowns.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    console.error('NEON_DATABASE_URL missing');
    process.exit(1);
  }
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '072_create_operator_countdowns.sql'),
    'utf8'
  );
  await client.query(sql);
  const r = await client.query(`SELECT to_regclass('public.operator_countdowns') AS t`);
  console.log('operator_countdowns =', r.rows[0].t);
  await client.end();
}

main().catch((e) => {
  console.error('MIG_FAIL', e.message);
  process.exit(1);
});
