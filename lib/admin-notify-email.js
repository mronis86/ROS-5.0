/**
 * Access-request email notifications (Resend).
 *
 * Env on the machine running api-server (local .env or Railway):
 *   RESEND_API_KEY    — https://resend.com API key
 *   ADMIN_NOTIFY_FROM — e.g. "Run of Show <onboarding@resend.dev>" for testing
 *   APP_PUBLIC_ORIGIN — public app URL for portal links in email
 */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isAdminEmailNotifyConfigured() {
  return !!(process.env.RESEND_API_KEY || '').trim() && !!(process.env.ADMIN_NOTIFY_FROM || '').trim();
}

function skipEmail(reason) {
  console.warn(`[admin-notify-email] Skipped: ${reason}`);
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

function buildAccessRequestSubmittedEmail({ fullName, email, portalUrl }) {
  const safeEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || safeEmail.split('@')[0] || 'User';
  const subject = 'Run of Show — access request received';
  const text = [
    `Hi ${name},`,
    '',
    'We received your request for access to Run of Show.',
    'An administrator will review your request. Use the link below to check your status:',
    '',
    portalUrl,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>We received your request for access to <strong>Run of Show</strong>.</p>
  <p>An administrator will review your request. Use the link below to check your status or set up your account after approval:</p>
  <p><a href="${escapeHtml(portalUrl)}">View your access status</a></p>
  <p style="color:#555;font-size:13px">Or copy this link: ${escapeHtml(portalUrl)}</p>
</body></html>`;

  return { subject, text, html };
}

function buildAccessApprovedEmail({ fullName, email, isAdmin, portalUrl }) {
  const safeEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || safeEmail.split('@')[0] || 'User';
  const subject = 'Run of Show — your access has been approved';
  const lines = [
    `Hi ${name},`,
    '',
    'Your access request for Run of Show has been approved.',
    isAdmin ? 'You were approved as an administrator.' : '',
    '',
    portalUrl
      ? 'Open the link below to set your password and sign in:'
      : 'Sign in to the app to get started.',
    portalUrl || '',
  ].filter(Boolean);
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>Your access request for <strong>Run of Show</strong> has been approved.</p>
  ${isAdmin ? '<p>You were approved as an <strong>administrator</strong>.</p>' : ''}
  ${
    portalUrl
      ? `<p><a href="${escapeHtml(portalUrl)}">Set up your password and continue</a></p>
  <p style="color:#555;font-size:13px">Or copy this link: ${escapeHtml(portalUrl)}</p>`
      : '<p>Sign in to the app to get started.</p>'
  }
</body></html>`;

  return { subject, text, html };
}

function buildAccessRejectedEmail({ fullName, email, notes, portalUrl }) {
  const safeEmail = normalizeEmail(email);
  const name = String(fullName || '').trim() || safeEmail.split('@')[0] || 'User';
  const noteText = String(notes || '').trim();
  const subject = 'Run of Show — access request update';
  const lines = [
    `Hi ${name},`,
    '',
    'Your access request for Run of Show was not approved.',
    noteText ? `Note: ${noteText}` : null,
    '',
    portalUrl ? `View details: ${portalUrl}` : null,
    '',
    'Contact your administrator if you believe this is a mistake.',
  ].filter((line) => line !== null);
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>Your access request for <strong>Run of Show</strong> was not approved.</p>
  ${noteText ? `<p><strong>Note:</strong> ${escapeHtml(noteText)}</p>` : ''}
  ${portalUrl ? `<p><a href="${escapeHtml(portalUrl)}">View your access status</a></p>` : ''}
  <p>Contact your administrator if you believe this is a mistake.</p>
</body></html>`;

  return { subject, text, html };
}

function buildLoginSecurityFlagEmail({
  stage,
  email,
  ip,
  attemptsUsed,
  attemptsLimit,
  attemptsRemaining,
  lockoutMinutes,
  flaggedAt,
  endpoint,
}) {
  const safeEmail = normalizeEmail(email) || '(unknown)';
  const when = flaggedAt ? new Date(flaggedAt) : new Date();
  const whenLabel = Number.isNaN(when.getTime())
    ? ''
    : `${when.toLocaleString('en-US', { timeZone: 'UTC' })} UTC`;
  const isLockout = stage === 'lockout';
  const subject = isLockout
    ? `Run of Show — security alert: sign-in lockout (${safeEmail})`
    : `Run of Show — security flag: failed sign-in attempts (${safeEmail})`;

  const summary = isLockout
    ? `Sign-in was blocked after ${attemptsLimit} failed attempts. The account is locked for about ${lockoutMinutes} minutes.`
    : `${attemptsUsed} failed sign-in attempts were detected. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remain before a ${lockoutMinutes}-minute lockout.`;

  const lines = [
    isLockout
      ? 'Security alert: repeated failed sign-in attempts triggered a lockout.'
      : 'Security flag: repeated failed sign-in attempts detected.',
    '',
    summary,
    '',
    `Email: ${safeEmail}`,
    `IP address: ${ip || '(unknown)'}`,
    `Attempts: ${attemptsUsed} of ${attemptsLimit}`,
  ];
  if (!isLockout) lines.push(`Attempts remaining: ${attemptsRemaining}`);
  if (endpoint) lines.push(`Endpoint: ${endpoint}`);
  if (whenLabel) lines.push(`Time: ${whenLabel}`);
  lines.push('', 'Review this activity in Admin if the account may be under attack or compromised.');
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p><strong>${isLockout ? 'Security alert' : 'Security flag'}:</strong> ${
    isLockout
      ? 'Repeated failed sign-in attempts triggered a lockout.'
      : 'Repeated failed sign-in attempts were detected.'
  }</p>
  <p>${escapeHtml(summary)}</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td>${escapeHtml(safeEmail)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">IP address</td><td>${escapeHtml(ip || '(unknown)')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Attempts</td><td>${escapeHtml(`${attemptsUsed} of ${attemptsLimit}`)}</td></tr>
    ${
      !isLockout
        ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Attempts remaining</td><td>${escapeHtml(String(attemptsRemaining))}</td></tr>`
        : ''
    }
    ${endpoint ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Endpoint</td><td>${escapeHtml(endpoint)}</td></tr>` : ''}
    ${whenLabel ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Time</td><td>${escapeHtml(whenLabel)}</td></tr>` : ''}
  </table>
  <p>Review this activity in <strong>Admin</strong> if the account may be under attack or compromised.</p>
</body></html>`;

  return { subject, text, html };
}

function formatOpsDetails(details) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function buildOpsAlertEmail({ category, severity, title, summary, details }) {
  const safeTitle = String(title || 'Operational alert').trim();
  const safeSummary = String(summary || '').trim();
  const categoryLabel = String(category || 'ops').replace(/_/g, ' ');
  const severityLabel = String(severity || 'info').toUpperCase();
  const subject = `Run of Show — ${severityLabel}: ${safeTitle}`;
  const detailText = formatOpsDetails(details);
  const when =
    details?.flaggedAt && !Number.isNaN(new Date(details.flaggedAt).getTime())
      ? `${new Date(details.flaggedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC`
      : '';

  const lines = [
    `Category: ${categoryLabel}`,
    `Severity: ${severityLabel}`,
    '',
    safeSummary,
  ];
  if (detailText) {
    lines.push('', detailText);
  }
  if (when) lines.push('', `Time: ${when}`);
  lines.push('', 'Review Railway logs and the Admin page if action is needed.');
  const text = lines.join('\n');

  const detailRows = Object.entries(details || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top">${escapeHtml(key)}</td><td style="white-space:pre-wrap">${escapeHtml(String(value))}</td></tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p><strong>${escapeHtml(severityLabel)}</strong> — ${escapeHtml(categoryLabel)}</p>
  <p>${escapeHtml(safeSummary)}</p>
  ${
    detailRows
      ? `<table style="border-collapse:collapse;margin:16px 0">${detailRows}</table>`
      : ''
  }
  <p>Review <strong>Railway logs</strong> and the <strong>Admin</strong> page if action is needed.</p>
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
  const recipients = Array.isArray(to) ? to : [to];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: recipients, subject, html, text }),
    signal: AbortSignal.timeout(15000),
  });

  const detail = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Resend HTTP ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }

  let resendId = null;
  try {
    const parsed = JSON.parse(detail);
    resendId = parsed?.id || null;
  } catch {
    /* ignore */
  }
  return { resendId, recipients };
}

async function notifyAdminsOpsAlert(pool, { category, severity, title, summary, details }) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server (Railway)');
    return;
  }

  const recipients = await getAdminNotifyRecipients(pool);
  if (recipients.length === 0) {
    skipEmail('no approved admins in api_user_access to notify');
    return;
  }

  const { subject, text, html } = buildOpsAlertEmail({ category, severity, title, summary, details });
  const result = await sendViaResend({ to: recipients, subject, html, text });
  console.log(
    `[admin-notify-email] Sent ops alert (${category || 'ops'}) to ${recipients.length} admin(s): ${recipients.join(', ')}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyAdminsLoginSecurityFlag(
  pool,
  { stage, email, ip, attemptsUsed, attemptsLimit, attemptsRemaining, lockoutMinutes, flaggedAt, endpoint }
) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server (Railway)');
    return;
  }

  const recipients = await getAdminNotifyRecipients(pool);
  if (recipients.length === 0) {
    skipEmail('no approved admins in api_user_access to notify');
    return;
  }

  const { subject, text, html } = buildLoginSecurityFlagEmail({
    stage,
    email,
    ip,
    attemptsUsed,
    attemptsLimit,
    attemptsRemaining,
    lockoutMinutes,
    flaggedAt,
    endpoint,
  });
  const result = await sendViaResend({ to: recipients, subject, html, text });
  console.log(
    `[admin-notify-email] Sent login security ${stage} alert to ${recipients.length} admin(s): ${recipients.join(', ')}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyAdminsNewAccessRequest(pool, { email, fullName, requestedAt }) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server (Railway)');
    return;
  }

  const recipients = await getAdminNotifyRecipients(pool);
  if (recipients.length === 0) {
    skipEmail('no approved admins in api_user_access to notify');
    return;
  }

  const { subject, text, html } = buildAccessRequestEmail({ fullName, email, requestedAt });
  const result = await sendViaResend({ to: recipients, subject, html, text });
  console.log(
    `[admin-notify-email] Sent admin alert to ${recipients.length} admin(s): ${recipients.join(', ')}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyUserAccessRequestSubmitted({ email, fullName, portalUrl }) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server (Railway)');
    return;
  }
  const to = normalizeEmail(email);
  if (!to) {
    skipEmail('access request submitter email missing');
    return;
  }
  if (!portalUrl) {
    skipEmail(`portal URL missing for ${to} — set APP_PUBLIC_ORIGIN on Railway`);
    return;
  }

  const { subject, text, html } = buildAccessRequestSubmittedEmail({ fullName, email: to, portalUrl });
  const result = await sendViaResend({ to, subject, html, text });
  console.log(
    `[admin-notify-email] Sent access portal link to ${to}` + (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyUserAccessApproved({ email, fullName, isAdmin, portalUrl }) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server (Railway)');
    return;
  }
  const to = normalizeEmail(email);
  if (!to) {
    skipEmail('approved user email missing');
    return;
  }

  const { subject, text, html } = buildAccessApprovedEmail({ fullName, email: to, isAdmin, portalUrl });
  const result = await sendViaResend({ to, subject, html, text });
  console.log(
    `[admin-notify-email] Sent approval notice to ${to}` + (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyUserAccessRejected({ email, fullName, notes, portalUrl }) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set on the API server (Railway)');
    return;
  }
  const to = normalizeEmail(email);
  if (!to) {
    skipEmail('rejected user email missing');
    return;
  }

  const { subject, text, html } = buildAccessRejectedEmail({ fullName, email: to, notes, portalUrl });
  const result = await sendViaResend({ to, subject, html, text });
  console.log(
    `[admin-notify-email] Sent rejection notice to ${to}` + (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

module.exports = {
  notifyAdminsNewAccessRequest,
  notifyAdminsLoginSecurityFlag,
  notifyAdminsOpsAlert,
  notifyUserAccessRequestSubmitted,
  notifyUserAccessApproved,
  notifyUserAccessRejected,
  getAdminNotifyRecipients,
  buildAccessRequestEmail,
  buildAccessRequestSubmittedEmail,
  buildAccessApprovedEmail,
  buildAccessRejectedEmail,
  buildLoginSecurityFlagEmail,
  buildOpsAlertEmail,
  isAdminEmailNotifyConfigured,
};
