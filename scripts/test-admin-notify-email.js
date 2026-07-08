#!/usr/bin/env node
/**
 * Dry-run all admin notification emails (Resend → approved admins in api_user_access).
 * Uses .env in project root (same as api-server).
 *
 *   node scripts/test-admin-notify-email.js           # send all test emails
 *   node scripts/test-admin-notify-email.js --access  # access request only
 *   node scripts/test-admin-notify-email.js --login   # login security warning + lockout
 *   node scripts/test-admin-notify-email.js --ops     # API error + security ops alerts
 *
 * Requires: NEON_DATABASE_URL, RESEND_API_KEY, ADMIN_NOTIFY_FROM
 */
require('dotenv').config();
const { Pool } = require('pg');
const {
  notifyAdminsNewAccessRequest,
  notifyAdminsLoginSecurityFlag,
  notifyAdminsOpsAlert,
  getAdminNotifyRecipients,
  isAdminEmailNotifyConfigured,
} = require('../lib/admin-notify-email');

const args = new Set(process.argv.slice(2));
const runAll = args.size === 0;
const runAccess = runAll || args.has('--access');
const runLogin = runAll || args.has('--login');
const runOps = runAll || args.has('--ops');

const flaggedAt = new Date().toISOString();

async function sendAccessRequestTest(pool) {
  console.log('\n[1/6] Access request email…');
  await notifyAdminsNewAccessRequest(pool, {
    email: 'new-user@example.com',
    fullName: 'Test User (access request dry run)',
    requestedAt: flaggedAt,
  });
  console.log('      Sent.');
}

async function sendLoginSecurityTests(pool) {
  console.log('\n[2/6] Login security flag (5 failed attempts)…');
  await notifyAdminsLoginSecurityFlag(pool, {
    stage: 'warning',
    email: 'suspicious-login@example.com',
    ip: '203.0.113.10',
    attemptsUsed: 5,
    attemptsLimit: 8,
    attemptsRemaining: 3,
    lockoutMinutes: 15,
    flaggedAt,
    endpoint: '/api/auth/neon-login',
  });
  console.log('      Sent.');

  console.log('\n[3/6] Login security lockout (8 failed attempts)…');
  await notifyAdminsLoginSecurityFlag(pool, {
    stage: 'lockout',
    email: 'suspicious-login@example.com',
    ip: '203.0.113.10',
    attemptsUsed: 8,
    attemptsLimit: 8,
    attemptsRemaining: 0,
    lockoutMinutes: 15,
    flaggedAt,
    endpoint: '/api/auth/neon-login',
  });
  console.log('      Sent.');
}

async function sendOpsAlertTests(pool) {
  console.log('\n[4/6] API error ops alert…');
  await notifyAdminsOpsAlert(pool, {
    category: 'api_error',
    severity: 'critical',
    title: 'Test API error 500 on GET /api/calendar-events',
    summary: 'Dry run — simulated internal server error from the API.',
    details: {
      statusCode: 500,
      method: 'GET',
      path: '/api/calendar-events',
      ip: '127.0.0.1',
      durationMs: 42,
      flaggedAt,
    },
  });
  console.log('      Sent.');

  console.log('\n[5/6] Unauthorized API access ops alert…');
  await notifyAdminsOpsAlert(pool, {
    category: 'security_unauthorized_api',
    severity: 'warning',
    title: 'Repeated unauthorized API access (203.0.113.10)',
    summary: 'Dry run — 10 unauthorized requests to protected API routes from this IP in 15 minutes.',
    details: {
      ip: '203.0.113.10',
      path: '/api/calendar-events',
      method: 'GET',
      attempts: 10,
      windowMinutes: 15,
      flaggedAt,
    },
  });
  console.log('      Sent.');

  console.log('\n[6/6] Admin key + integration security alerts…');
  await notifyAdminsOpsAlert(pool, {
    category: 'security_admin_denied',
    severity: 'warning',
    title: 'Invalid admin API credentials attempted',
    summary: 'Dry run — someone tried an admin route with a bad ADMIN_KEY.',
    details: {
      ip: '203.0.113.44',
      path: '/api/admin/presence',
      method: 'GET',
      flaggedAt,
    },
  });
  console.log('      Sent admin-denied.');

  await notifyAdminsOpsAlert(pool, {
    category: 'security_integration_forbidden',
    severity: 'warning',
    title: 'Integration token permission denied',
    summary: 'Dry run — integration token attempted an action outside its scope.',
    details: {
      ip: '203.0.113.55',
      path: '/api/admin/backup-config',
      method: 'POST',
      tokenName: 'Companion test token',
      flaggedAt,
    },
  });
  console.log('      Sent integration-forbidden.');
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
      console.error('No approved admins found. Approve at least one user as admin in the Admin page first.');
      process.exit(1);
    }

    const sections = [];
    if (runAccess) sections.push('access');
    if (runLogin) sections.push('login');
    if (runOps) sections.push('ops');
    console.log(`Sending test emails: ${sections.join(', ')}`);

    if (runAccess) await sendAccessRequestTest(pool);
    if (runLogin) await sendLoginSecurityTests(pool);
    if (runOps) await sendOpsAlertTests(pool);

    console.log('\nDone — check admin inboxes and the Resend dashboard.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
