#!/usr/bin/env node
/**
 * Send test training booking emails (admin notice + booker confirmation with .ics).
 * Uses .env in project root (same as api-server).
 *
 *   node scripts/test-training-booking-email.js booker@example.com
 */
require('dotenv').config();
const {
  notifyTrainingBooking,
  notifyTrainingBookingConfirmation,
  isAdminEmailNotifyConfigured,
  buildTrainingBookingConfirmationEmail,
} = require('../lib/admin-notify-email');
const { buildTrainingInviteIcs } = require('../lib/training-booking');

async function main() {
  const to = (process.argv[2] || '').trim().toLowerCase();
  if (!to || !to.includes('@')) {
    console.error('Usage: node scripts/test-training-booking-email.js booker@example.com');
    process.exit(1);
  }
  if (!isAdminEmailNotifyConfigured()) {
    console.error('Set RESEND_API_KEY and ADMIN_NOTIFY_FROM in .env (or Railway) first.');
    process.exit(1);
  }

  const origin = (process.env.APP_PUBLIC_ORIGIN || 'http://localhost:3003').replace(/\/$/, '');
  const timezone = (process.env.TRAINING_TIMEZONE || 'America/New_York').trim();
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + 7);
  startsAt.setHours(14, 0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  const booking = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test Booker',
    email: to,
    company: 'Test Company',
    phone: '555-0100',
    notes: 'Dry-run training email test',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };

  const icsBody = buildTrainingInviteIcs(booking, { origin });
  const icsFilename = 'invite.ics';
  const icsUrl = `${origin}/api/training/booking/${booking.id}/ics`;

  console.log('From:', process.env.ADMIN_NOTIFY_FROM);
  console.log('Booker:', to);
  console.log('Admin notify:', process.env.TRAINING_NOTIFY_EMAIL || process.env.ADMIN_PRIMARY_EMAIL || '(first approved admin)');
  console.log(
    'Confirmation subject:',
    buildTrainingBookingConfirmationEmail(booking, { timezone, icsUrl }).subject
  );

  await notifyTrainingBookingConfirmation(booking, {
    timezone,
    icsUrl,
    icsFilename,
    icsBody,
    origin,
  });
  console.log('Sent booker confirmation with .ics attachment.');

  const adminRecipient =
    (process.env.TRAINING_NOTIFY_EMAIL || process.env.ADMIN_PRIMARY_EMAIL || '').trim();
  if (adminRecipient) {
    await notifyTrainingBooking(null, booking, {
      timezone,
      manageUrl: `${origin}/training/manage`,
    });
    console.log('Sent admin booking notice.');
  } else {
    console.log('Skipped admin notice — set TRAINING_NOTIFY_EMAIL or ADMIN_PRIMARY_EMAIL to test it.');
  }

  console.log('Done — check inboxes and Resend dashboard → Emails.');
  console.log(
    'Note: with onboarding@resend.dev, Resend only delivers to the email on your Resend account until you verify a domain.'
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
