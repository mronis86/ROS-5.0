#!/usr/bin/env node
/**
 * Verify Resend + admin recipient setup before sending production emails.
 *
 *   node scripts/check-admin-email-setup.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const {
  getAdminNotifyRecipients,
  isAdminEmailNotifyConfigured,
} = require('../lib/admin-notify-email');

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '(not set)';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function parseFromAddress(fromValue) {
  const raw = String(fromValue || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function fromDomain(email) {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : '';
}

async function main() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const fromRaw = (process.env.ADMIN_NOTIFY_FROM || '').trim();
  const fromEmail = parseFromAddress(fromRaw);
  const domain = fromDomain(fromEmail);

  console.log('--- Resend / admin email setup ---\n');
  console.log('RESEND_API_KEY:      ', apiKey ? maskSecret(apiKey) : '(not set)');
  console.log('ADMIN_NOTIFY_FROM:   ', fromRaw || '(not set)');
  console.log('Parsed from address: ', fromEmail || '(none)');
  console.log('From domain:         ', domain || '(none)');
  console.log('Configured:          ', isAdminEmailNotifyConfigured() ? 'yes' : 'no');

  if (fromEmail.endsWith('@resend.dev')) {
    console.log('\n⚠️  Using @resend.dev — Resend only delivers to your Resend account email.');
    console.log('   Switch ADMIN_NOTIFY_FROM to a verified custom domain to email all admins.');
  } else if (domain) {
    console.log(`\n✓  Using custom domain "${domain}".`);
    console.log('   Confirm this domain shows Verified in Resend → Domains before going live.');
  }

  if (!process.env.NEON_DATABASE_URL) {
    console.log('\nNEON_DATABASE_URL is not set — cannot list admin recipients.');
    process.exit(isAdminEmailNotifyConfigured() ? 0 : 1);
  }

  const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });
  try {
    const recipients = await getAdminNotifyRecipients(pool);
    console.log(`\nApproved admin recipients (${recipients.length}):`);
    if (recipients.length === 0) {
      console.log('  (none — approve at least one admin in the Admin page)');
    } else {
      for (const email of recipients) console.log(`  - ${email}`);
    }

    console.log('\nNext steps:');
    if (!isAdminEmailNotifyConfigured()) {
      console.log('  1. Set RESEND_API_KEY and ADMIN_NOTIFY_FROM in Railway (or .env).');
    }
    if (fromEmail.endsWith('@resend.dev')) {
      console.log('  2. In Resend → Domains, verify your domain (DNS records).');
      console.log('  3. On Railway, set ADMIN_NOTIFY_FROM to e.g.:');
      console.log('     Run of Show <noreply@yourdomain.com>');
      console.log('  4. Redeploy Railway, then run: node scripts/test-admin-notify-email.js --login');
    } else {
      console.log('  1. Ensure domain is Verified in Resend → Domains.');
      console.log('  2. Match Railway ADMIN_NOTIFY_FROM to that domain.');
      console.log('  3. Redeploy Railway, then run: node scripts/test-admin-notify-email.js');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
