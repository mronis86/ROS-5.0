#!/usr/bin/env node
/**
 * Test user issue report emails.
 *
 *   node scripts/test-user-report.js           # email preview (no API)
 *   node scripts/test-user-report.js --live    # POST /api/ops/user-report (API must be running)
 *
 * Requires: NEON_DATABASE_URL, RESEND_API_KEY, ADMIN_NOTIFY_FROM
 * For --live in local dev: OPS_ALERTS_DISABLED=false on the API server
 */
require('dotenv').config();
const { Pool } = require('pg');
const {
  notifyAdminsOpsAlert,
  getAdminNotifyRecipients,
  isAdminEmailNotifyConfigured,
} = require('../lib/admin-notify-email');

const live = process.argv.includes('--live');
const apiBase = (process.env.VITE_API_BASE_URL || process.env.API_BASE_URL || 'http://localhost:3001').replace(
  /\/$/,
  ''
);

const sampleConsole = `[2026-06-17T12:00:00.000Z] ERROR: ReferenceError: setApiAccessToken is not defined
  at handleSetupSubmit (AccessPortalPage.tsx:85:7)

[2026-06-17T12:00:00.100Z] WINDOW-ERROR: Uncaught ReferenceError: setApiAccessToken is not defined`;

async function sendDirectEmailTest(pool) {
  console.log('\n[user-report] Direct email test…');
  await notifyAdminsOpsAlert(pool, {
    category: 'user_report',
    severity: 'info',
    title: 'Test user issue report (/test script)',
    summary: 'Dry run — Password setup finished but I was not taken to the event list — From: test-user@example.com',
    details: {
      message: 'Password setup finished but I was not taken to the event list',
      userNote: 'CLI dry run with sample console capture below.',
      page: '/access?token=…',
      userEmail: 'test-user@example.com',
      consoleLog: sampleConsole,
      test: 'yes',
      flaggedAt: new Date().toISOString(),
    },
  });
  console.log('      Sent.');
}

async function sendLiveApiTest() {
  console.log(`\n[user-report] Live API test → POST ${apiBase}/api/ops/user-report`);
  const res = await fetch(`${apiBase}/api/ops/user-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Live API test issue report',
      userNote: 'Sent by scripts/test-user-report.js --live',
      page: '/test-user-report.js',
      userEmail: 'test-user@example.com',
      consoleLog: sampleConsole,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  console.log('      API response:', data.message || 'ok');
  if (process.env.OPS_ALERTS_DISABLED !== 'false' && process.env.NODE_ENV !== 'production') {
    console.warn('      Note: set OPS_ALERTS_DISABLED=false on the API server for --live in local dev.');
  }
}

async function main() {
  if (!process.env.NEON_DATABASE_URL) {
    console.error('NEON_DATABASE_URL is not set in .env');
    process.exit(1);
  }
  if (!isAdminEmailNotifyConfigured()) {
    console.error('Set RESEND_API_KEY and ADMIN_NOTIFY_FROM in .env first.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });
  try {
    const recipients = await getAdminNotifyRecipients(pool);
    console.log('Approved admin recipients:', recipients.length ? recipients.join(', ') : '(none)');
    if (recipients.length === 0) {
      console.error('No approved admins found.');
      process.exit(1);
    }

    if (live) {
      await sendLiveApiTest();
    } else {
      await sendDirectEmailTest(pool);
    }

    console.log('\nDone — check admin inboxes and Resend dashboard.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
