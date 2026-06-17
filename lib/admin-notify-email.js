/**
 * Email approved app admins when a new access request is pending.
 *
 * Recipients: all rows in api_user_access with status=approved and is_admin=true
 * (same people who can use the Admin page).
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

module.exports = {
  notifyAdminsNewAccessRequest,
  getAdminNotifyRecipients,
  buildAccessRequestEmail,
  isAdminEmailNotifyConfigured,
};
