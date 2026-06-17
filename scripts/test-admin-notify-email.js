#!/usr/bin/env node
/**
 * Send a test "new access request" email to all approved admins in api_user_access.
 * Uses .env in project root (same as api-server).
 *
 *   node scripts/test-admin-notify-email.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const {
  notifyAdminsNewAccessRequest,
  getAdminNotifyRecipients,
  isAdminEmailNotifyConfigured,
} = require('../lib/admin-notify-email');

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

    await notifyAdminsNewAccessRequest(pool, {
      email: 'new-user@example.com',
      fullName: 'Test User (notify dry run)',
      requestedAt: new Date().toISOString(),
    });
    console.log('Done — check those inboxes (and Resend dashboard).');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
