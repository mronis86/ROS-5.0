#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  if (!process.env.NEON_DATABASE_URL) {
    console.error('NEON_DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'neon_auth' ORDER BY 1`
    );
    console.log('neon_auth tables:', tables.rows.map((r) => r.table_name));

    for (const table of ['user', 'users_sync', 'session', 'account']) {
      try {
        const cols = await pool.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'neon_auth' AND table_name = $1
           ORDER BY ordinal_position`,
          [table]
        );
        if (cols.rows.length) {
          console.log(`\n${table} columns:`, cols.rows.map((r) => r.column_name).join(', '));
        }
      } catch (err) {
        console.log(`\n${table}:`, err.message);
      }
    }

    const role = await pool.query('SELECT current_user');
    console.log('\ncurrent_user:', role.rows[0].current_user);

    for (const priv of ['SELECT', 'DELETE']) {
      const r = await pool.query(
        `SELECT has_table_privilege(current_user, 'neon_auth.user', $1) AS ok`,
        [priv]
      );
      console.log(`neon_auth.user ${priv}:`, r.rows[0].ok);
    }

    const users = await pool.query(`SELECT id, email FROM neon_auth."user" ORDER BY "createdAt" DESC LIMIT 5`);
    console.log('\nrecent users:', users.rows);

    const fks = await pool.query(
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'neon_auth'
         AND ccu.table_name = 'user'`
    );
    console.log('\nFK refs to user:', fks.rows);

    if (process.argv[2]) {
      const email = process.argv[2].toLowerCase();
      const user = await pool.query(`SELECT id, email FROM neon_auth."user" WHERE LOWER(email) = $1`, [email]);
      console.log('\nlookup', email, user.rows);
      if (user.rows[0]) {
        const uid = user.rows[0].id;
        for (const table of ['member', 'invitation', 'session', 'account']) {
          const col = table === 'invitation' ? 'inviterId' : 'userId';
          const c = await pool.query(`SELECT COUNT(*)::int AS n FROM neon_auth.${table} WHERE "${col}" = $1`, [uid]);
          console.log(`${table}.${col}:`, c.rows[0].n);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
