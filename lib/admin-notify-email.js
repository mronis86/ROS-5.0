/**
 * Access-request email notifications (Resend).
 *
 * Env on the machine running api-server (local .env or Railway):
 *   RESEND_API_KEY    — https://resend.com API key
 *   ADMIN_NOTIFY_FROM — e.g. "Run of Show <onboarding@resend.dev>" for testing
 */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAdminEmailNotifyConfigured() {
  return !!(process.env.RESEND_API_KEY || '').trim() && !!(process.env.ADMIN_NOTIFY_FROM || '').trim();
}

async function getAdminNotifyRecipients(pool) {
  try {
    const r = await pool.query(
      `SELECT email FROM public.api_user_access
       WHERE status = 'approved' AND is_admin = TRUE
         AND email IS NOT NULL AND TRIM(email) <> ''`
    );
    return r.rows.map((row) => normalizeEmail(row.email)).filter(Boolean);
  } catch (err) {
    if (err.code === '42P01') return [];
    throw err;
  }
}

function buildAccessRequestEmail({ fullName, email, requestedAt }) {
  const safeEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || safeEmail.split('@')[0] || 'User';
  const when = requestedAt ? new Date(requestedAt) : new Date();
  const whenLabel = Number.isNaN(when.getTime())
    ? ''
    : `${when.toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;

  const subject = `Run of Show — new access request (${safeEmail})`;
  const lines = [
    'A new user requested access to Run of Show.',
    '',
    `Name: ${name}`,
    `Email: ${safeEmail}`,
  ];
  if (whenLabel) lines.push(`Requested: ${whenLabel}`);
  lines.push('', 'Sign in to Admin and approve them under Access requests.');
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>A new user requested access to <strong>Run of Show</strong>.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#555">Name</td><td><strong>${escapeHtml(name)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td>${escapeHtml(safeEmail)}</td></tr>
    ${whenLabel ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Requested</td><td>${escapeHtml(whenLabel)}</td></tr>` : ''}
  </table>
  <p>Sign in to <strong>Admin</strong> and approve them under <strong>Access requests</strong>.</p>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.ADMIN_NOTIFY_FROM || '').trim();
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

async function notifyAdminsNewAccessRequest(pool, { email, fullName, requestedAt }) {
  if (!isAdminEmailNotifyConfigured()) return;

  const recipients = await getAdminNotifyRecipients(pool);
  if (recipients.length === 0) {
    console.warn('[admin-notify-email] No approved admins in api_user_access. Skipping notification.');
    return;
  }

  const { subject, text, html } = buildAccessRequestEmail({ fullName, email, requestedAt });
  await sendViaResend({ to: recipients, subject, html, text });
  console.log(`[admin-notify-email] Sent to ${recipients.length} admin(s): ${recipients.join(', ')}`);
}

function buildAccessApprovedEmail({ fullName, email, isAdmin }) {
  const safeEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || safeEmail.split('@')[0] || 'User';
  const subject = 'Run of Show — your access has been approved';
  const lines = [
    `Hi ${name},`,
    '',
    'Your access request for Run of Show has been approved.',
    isAdmin ? 'You were approved as an administrator.' : '',
    '',
    'Sign in to the app to get started.',
  ].filter(Boolean);
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>Your access request for <strong>Run of Show</strong> has been approved.</p>
  ${isAdmin ? '<p>You were approved as an <strong>administrator</strong>.</p>' : ''}
  <p>Sign in to the app to get started.</p>
</body></html>`;

  return { subject, text, html };
}

function buildAccessRejectedEmail({ fullName, email, notes }) {
  const safeEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || safeEmail.split('@')[0] || 'User';
  const noteText = String(notes || '').trim();
  const subject = 'Run of Show — access request update';
  const lines = [
    `Hi ${name},`,
    '',
    'Your access request for Run of Show was not approved.',
    noteText ? '' : null,
    noteText ? `Note: ${noteText}` : null,
    '',
    'Contact your administrator if you believe this is a mistake.',
  ].filter((line) => line !== null);
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>Your access request for <strong>Run of Show</strong> was not approved.</p>
  ${noteText ? `<p><strong>Note:</strong> ${escapeHtml(noteText)}</p>` : ''}
  <p>Contact your administrator if you believe this is a mistake.</p>
</body></html>`;

  return { subject, text, html };
}

async function notifyUserAccessApproved({ email, fullName, isAdmin }) {
  if (!isAdminEmailNotifyConfigured()) return;
  const to = normalizeEmail(email);
  if (!to) return;

  const { subject, text, html } = buildAccessApprovedEmail({ fullName, email: to, isAdmin });
  await sendViaResend({ to, subject, html, text });
  console.log(`[admin-notify-email] Sent approval notice to ${to}`);
}

async function notifyUserAccessRejected({ email, fullName, notes }) {
  if (!isAdminEmailNotifyConfigured()) return;
  const to = normalizeEmail(email);
  if (!to) return;

  const { subject, text, html } = buildAccessRejectedEmail({ fullName, email: to, notes });
  await sendViaResend({ to, subject, html, text });
  console.log(`[admin-notify-email] Sent rejection notice to ${to}`);
}

module.exports = {
  notifyAdminsNewAccessRequest,
  notifyUserAccessApproved,
  notifyUserAccessRejected,
  getAdminNotifyRecipients,
  buildAccessRequestEmail,
  buildAccessApprovedEmail,
  buildAccessRejectedEmail,
  isAdminEmailNotifyConfigured,
};
