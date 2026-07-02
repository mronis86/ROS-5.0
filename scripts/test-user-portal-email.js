#!/usr/bin/env node
/**
 * Send a test "access request received" email to a specific address (portal link).
 * Uses .env in project root (same as api-server).
 *
 *   node scripts/test-user-portal-email.js user@example.com
 */
require('dotenv').config();
const {
  notifyUserAccessRequestSubmitted,
  isAdminEmailNotifyConfigured,
  buildAccessRequestSubmittedEmail,
} = require('../lib/admin-notify-email');
const { buildAccessPortalUrl } = require('../lib/access-portal');

async function main() {
  const to = (process.argv[2] || '').trim().toLowerCase();
  if (!to || !to.includes('@')) {
    console.error('Usage: node scripts/test-user-portal-email.js user@example.com');
    process.exit(1);
  }
  if (!isAdminEmailNotifyConfigured()) {
    console.error('Set RESEND_API_KEY and ADMIN_NOTIFY_FROM in .env (or Railway) first.');
    process.exit(1);
  }

  const origin = (process.env.APP_PUBLIC_ORIGIN || 'http://localhost:3003').replace(/\/$/, '');
  const portalUrl = buildAccessPortalUrl(origin, 'ros_portal_test_' + '0'.repeat(64));

  console.log('From:', process.env.ADMIN_NOTIFY_FROM);
  console.log('To:', to);
  console.log('Portal URL (test):', portalUrl);
  console.log('Subject:', buildAccessRequestSubmittedEmail({ fullName: 'Test User', email: to, portalUrl }).subject);

  await notifyUserAccessRequestSubmitted({
    email: to,
    fullName: 'Test User (portal email dry run)',
    portalUrl,
  });
  console.log('Done — check the inbox and Resend dashboard → Emails.');
  console.log(
    'Note: with onboarding@resend.dev, Resend only delivers to the email on your Resend account until you verify a domain.'
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
