/**
 * Preview or send a content review digest for one assignee.
 *
 * Usage:
 *   node scripts/test-content-review-digest.js <access_id>
 *   node scripts/test-content-review-digest.js <access_id> --send
 *
 * Requires NEON_DATABASE_URL and (for --send) RESEND_API_KEY + ADMIN_NOTIFY_FROM.
 */
require('dotenv').config();
const { Pool } = require('pg');
const {
  ensureNotifyPendingTable,
  processDueContentReviewDigests,
  buildDigestForAssignee,
} = require('../lib/content-review-notify-digest');
const { buildContentReviewDigestEmail, isAdminEmailNotifyConfigured } = require('../lib/admin-notify-email');

async function main() {
  const accessId = process.argv[2];
  const shouldSend = process.argv.includes('--send');
  if (!accessId) {
    console.error('Usage: node scripts/test-content-review-digest.js <access_id> [--send]');
    process.exit(1);
  }
  if (!process.env.NEON_DATABASE_URL) {
    console.error('NEON_DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });
  try {
    await ensureNotifyPendingTable(pool);
    const digest = await buildDigestForAssignee(pool, accessId);
    if (!digest) {
      console.log('No actionable content review todos for this assignee right now.');
      return;
    }

    const email = buildContentReviewDigestEmail(digest);
    console.log('To:', digest.email);
    console.log('Subject:', email.subject);
    console.log('\n--- text ---\n');
    console.log(email.text);

    if (!shouldSend) {
      console.log('\nDry run only. Pass --send to email via Resend.');
      return;
    }

    if (!isAdminEmailNotifyConfigured()) {
      console.error('Resend is not configured (RESEND_API_KEY + ADMIN_NOTIFY_FROM).');
      process.exit(1);
    }

    await pool.query(
      `INSERT INTO public.content_review_notify_pending (access_id, notify_after, updated_at)
       VALUES ($1, NOW() - INTERVAL '1 minute', NOW())
       ON CONFLICT (access_id) DO UPDATE SET
         notify_after = NOW() - INTERVAL '1 minute',
         updated_at = NOW()`,
      [accessId]
    );
    const sent = await processDueContentReviewDigests(pool);
    console.log(`\nDigest worker processed; emails sent: ${sent}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
