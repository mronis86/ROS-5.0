/**
 * Access-request email notifications (Resend).
 *
 * Env on the machine running api-server (local .env or Railway):
 *   RESEND_API_KEY    — https://resend.com API key
 *   ADMIN_NOTIFY_FROM — e.g. "Run of Show <onboarding@resend.dev>" for testing
 *   APP_PUBLIC_ORIGIN — public app URL for portal links in email
 *   TRAINING_NOTIFY_EMAIL — admin notified when someone books training
 */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Accept `email@x.com` or `Name <email@x.com>` (or bare `<email@x.com>`). */
function parseEmailAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const angled = raw.match(/<([^>]+)>/);
  const candidate = normalizeEmail(angled ? angled[1] : raw);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate)) return '';
  return candidate;
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

async function sendViaResend({ to, subject, html, text, attachments }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.ADMIN_NOTIFY_FROM || '').trim();
  const recipients = Array.isArray(to) ? to : [to];
  const payload = { from, to: recipients, subject, html, text };
  if (Array.isArray(attachments) && attachments.length > 0) {
    payload.attachments = attachments;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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

async function getTrainingNotifyRecipients(pool) {
  const primary = parseEmailAddress(
    process.env.TRAINING_NOTIFY_EMAIL || process.env.ADMIN_PRIMARY_EMAIL || ''
  );
  if (primary) return [primary];
  const admins = await getAdminNotifyRecipients(pool);
  return admins.slice(0, 1).map(parseEmailAddress).filter(Boolean);
}

function buildTrainingBookingEmail(booking, { timezone, manageUrl } = {}) {
  const when = booking.startsAt
    ? new Date(booking.startsAt).toLocaleString('en-US', {
        timeZone: timezone || 'America/New_York',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const subject = `ROS training booked — ${booking.name || booking.email}`;
  const lines = [
    'Someone booked ROS application training.',
    '',
    `When: ${when}`,
    `Name: ${booking.name || ''}`,
    `Email: ${booking.email || ''}`,
    booking.company ? `Company: ${booking.company}` : '',
    booking.phone ? `Phone: ${booking.phone}` : '',
    booking.notes ? `Notes: ${booking.notes}` : '',
    manageUrl ? '' : '',
    manageUrl ? `Manage bookings: ${manageUrl}` : '',
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''));

  const text = lines.join('\n');
  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Someone booked <strong>ROS application training</strong>.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#555">When</td><td><strong>${escapeHtml(when)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Name</td><td>${escapeHtml(booking.name || '')}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#555">Email</td><td>${escapeHtml(booking.email || '')}</td></tr>
    ${booking.company ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Company</td><td>${escapeHtml(booking.company)}</td></tr>` : ''}
    ${booking.phone ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Phone</td><td>${escapeHtml(booking.phone)}</td></tr>` : ''}
    ${booking.notes ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Notes</td><td>${escapeHtml(booking.notes)}</td></tr>` : ''}
  </table>
  ${manageUrl ? `<p><a href="${escapeHtml(manageUrl)}">Open training management</a></p>` : ''}
</body></html>`;

  return { subject, text, html };
}

/** Email TRAINING_NOTIFY_EMAIL (or first admin) when a training slot is booked. */
async function notifyTrainingBooking(pool, booking, { timezone, manageUrl } = {}) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set — cannot email training booking');
    return;
  }
  const recipients = await getTrainingNotifyRecipients(pool);
  if (recipients.length === 0) {
    skipEmail(
      'no TRAINING_NOTIFY_EMAIL / ADMIN_PRIMARY_EMAIL and no approved admin recipients for training booking notice'
    );
    return;
  }
  const { subject, text, html } = buildTrainingBookingEmail(booking, { timezone, manageUrl });
  const result = await sendViaResend({ to: recipients, subject, html, text });
  console.log(
    `[admin-notify-email] Sent training booking notice to ${recipients.join(', ')}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

function buildTrainingBookingConfirmationEmail(booking, { timezone, icsUrl } = {}) {
  const name = String(booking.name || '').trim() || 'there';
  const when = booking.startsAt
    ? new Date(booking.startsAt).toLocaleString('en-US', {
        timeZone: timezone || 'America/New_York',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  const subject = when ? `ROS training confirmed — ${when}` : 'ROS training confirmed';
  const lines = [
    `Hi ${name},`,
    '',
    'Your ROS application training session is confirmed.',
    '',
    `When: ${when}`,
    '',
    'IMPORTANT — this is not on your calendar yet.',
    'You need to add it manually using one of these options:',
    '',
    '1) Open the attached .ics file and save/add the event when prompted.',
    icsUrl ? `2) Or download from this link and open it: ${icsUrl}` : '',
    '',
    'Gmail: open the attachment, then choose Add to Google Calendar.',
    'Outlook: open the attachment, then choose Save & Close or Add to calendar.',
    'Apple Calendar: double-click the attachment and confirm Add.',
    '',
    'If you need to reschedule, reply to this email or contact your Run of Show administrator.',
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''));
  const text = lines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>Your <strong>ROS application training</strong> session is confirmed.</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#555">When</td><td><strong>${escapeHtml(when)}</strong></td></tr>
  </table>
  <div style="margin:20px 0;padding:16px;border:2px solid #d97706;border-radius:8px;background:#fffbeb">
    <p style="margin:0 0 8px;font-weight:700;color:#92400e">Important: add this to your calendar</p>
    <p style="margin:0 0 12px;color:#78350f">This booking is <strong>not</strong> on your calendar automatically. Please save it now so you do not miss your session.</p>
    <ol style="margin:0;padding-left:20px;color:#78350f">
      <li style="margin-bottom:8px">Open the attached <strong>.ics</strong> file and accept when your calendar app prompts you.</li>
      ${
        icsUrl
          ? `<li style="margin-bottom:8px">Or <a href="${escapeHtml(icsUrl)}" style="font-weight:600">download the calendar file here</a> and open it.</li>`
          : ''
      }
      <li>Gmail: attachment → Add to Google Calendar. Outlook: attachment → Save &amp; Close. Apple Calendar: double-click → Add.</li>
    </ol>
  </div>
  <p style="color:#555;font-size:13px">If you need to reschedule, reply to this email or contact your Run of Show administrator.</p>
</body></html>`;

  return { subject, text, html };
}

/** Email the person who booked with confirmation + .ics calendar attachment. */
async function notifyTrainingBookingConfirmation(booking, { timezone, icsUrl, icsFilename, icsBody } = {}) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set — cannot email training confirmation');
    return;
  }
  const to = parseEmailAddress(booking.email);
  if (!to) {
    skipEmail('invalid booker email for training confirmation');
    return;
  }
  const { subject, text, html } = buildTrainingBookingConfirmationEmail(booking, { timezone, icsUrl });
  const attachments =
    icsBody && String(icsBody).trim()
      ? [
          {
            filename: icsFilename || 'ros-training.ics',
            content: Buffer.from(String(icsBody), 'utf8').toString('base64'),
          },
        ]
      : undefined;
  const result = await sendViaResend({ to, subject, html, text, attachments });
  console.log(
    `[admin-notify-email] Sent training confirmation to ${to}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

function contentReviewAppUrl(eventId, { creative = false } = {}) {
  const origin = (process.env.APP_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  const path = creative
    ? `/creative/event?eventId=${encodeURIComponent(eventId)}`
    : `/content-review?eventId=${encodeURIComponent(eventId)}`;
  return origin ? `${origin}${path}` : path;
}

function buildContentReviewAssignedEmail({ fullName, email, eventName, eventId, role }) {
  const name = String(fullName || '').trim() || normalizeEmail(email).split('@')[0] || 'there';
  const safeEvent = String(eventName || 'Event').trim() || 'Event';
  const roleLabel = role === 'creative' ? 'Creative reviewer' : 'Production reviewer';
  const url = contentReviewAppUrl(eventId, { creative: role === 'creative' });
  const subject = `Run of Show — assigned to content review (${safeEvent})`;
  const text = [
    `Hi ${name},`,
    '',
    `You were assigned as ${roleLabel} for content review on "${safeEvent}".`,
    '',
    'Open the review workspace:',
    url,
    '',
    'You will receive a digest email when there are review updates on events you are assigned to (after activity settles for a few minutes).',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>You were assigned as <strong>${escapeHtml(roleLabel)}</strong> for content review on <strong>${escapeHtml(safeEvent)}</strong>.</p>
  <p><a href="${escapeHtml(url)}">Open content review</a></p>
  <p style="color:#555;font-size:13px">You will receive a digest email when there are review updates on events you are assigned to (after activity settles for a few minutes).</p>
</body></html>`;
  return { subject, text, html };
}

function buildContentReviewActivityEmail(job) {
  const eventName = String(job.eventName || 'Event').trim() || 'Event';
  const modifier = String(job.modifierName || 'Someone').trim() || 'Someone';
  const cueLabel = `Cue ${job.cueId}`;
  const stageLabel = job.stage === 'ros' ? 'ROS Show' : 'Creative Content';
  const url = contentReviewAppUrl(job.eventId, { creative: job.targetRole === 'creative' });

  let action = 'updated content review';
  if (job.reason === 'reviewer_comment') action = `left a review comment on ${cueLabel} (${stageLabel})`;
  else if (job.reason === 'creative_response') action = `posted a creative response on ${cueLabel}`;
  else if (job.reason === 'needs_review') action = `marked ${cueLabel} (${stageLabel}) as Needs Review`;
  else if (job.reason === 'edits_made') action = `marked ${cueLabel} as Edits made`;
  else if (job.reason === 'approved') action = `approved ${cueLabel} (${stageLabel})`;

  const excerpt = job.comment?.text ? String(job.comment.text).trim().slice(0, 280) : '';
  const subject = `Run of Show — content review update (${eventName})`;
  const textLines = [
    `${modifier} ${action} on "${eventName}".`,
    '',
    excerpt ? `Message: ${excerpt}${excerpt.length >= 280 ? '…' : ''}` : '',
    '',
    'Open content review:',
    url,
  ].filter(Boolean);
  const text = textLines.join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111">
  <p><strong>${escapeHtml(modifier)}</strong> ${escapeHtml(action)} on <strong>${escapeHtml(eventName)}</strong>.</p>
  ${excerpt ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid #6366f1;background:#f8fafc;color:#334155">${escapeHtml(excerpt)}${excerpt.length >= 280 ? '…' : ''}</blockquote>` : ''}
  <p><a href="${escapeHtml(url)}">Open content review</a></p>
</body></html>`;

  return { subject, text, html };
}

async function notifyContentReviewAssigned({ email, fullName, eventName, eventId, role }) {
  if (!isAdminEmailNotifyConfigured()) {
    skipEmail('RESEND_API_KEY or ADMIN_NOTIFY_FROM not set — cannot email content review assignee');
    return;
  }
  const to = normalizeEmail(email);
  if (!to) {
    skipEmail('content review assignee email missing');
    return;
  }
  const { subject, text, html } = buildContentReviewAssignedEmail({
    fullName,
    email: to,
    eventName,
    eventId,
    role,
  });
  const result = await sendViaResend({ to, subject, html, text });
  console.log(
    `[admin-notify-email] Sent content review assignment to ${to}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyContentReviewActivity(job) {
  if (!isAdminEmailNotifyConfigured()) return;
  const recipients = (job.recipients || [])
    .map((r) => normalizeEmail(r.email))
    .filter(Boolean);
  if (!recipients.length) return;
  const { subject, text, html } = buildContentReviewActivityEmail(job);
  const result = await sendViaResend({ to: recipients, subject, html, text });
  console.log(
    `[admin-notify-email] Sent content review activity to ${recipients.join(', ')}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

function formatDigestEventDate(dateStr) {
  if (!dateStr) return '';
  const when = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(when.getTime())) return String(dateStr).slice(0, 10);
  return when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildContentReviewDigestEmail(digest) {
  const name =
    String(digest.fullName || '').trim() ||
    normalizeEmail(digest.email).split('@')[0] ||
    'there';
  const events = Array.isArray(digest.events) ? digest.events : [];
  const eventCount = events.length;
  const totalCues = events.reduce((sum, ev) => sum + (ev.cues?.length || 0), 0);

  const subject =
    eventCount === 1
      ? `Run of Show — content review todos (${events[0].eventName})`
      : `Run of Show — content review todos (${eventCount} events)`;

  const textSections = [];
  const htmlSections = [];

  for (const ev of events) {
    const dateLabel = formatDigestEventDate(ev.eventDate);
    const url = contentReviewAppUrl(ev.eventId, { creative: ev.role === 'creative' });
    textSections.push(`${ev.eventName}${dateLabel ? ` (${dateLabel})` : ''}`);
    htmlSections.push(
      `<div style="margin:20px 0 8px"><strong style="font-size:16px">${escapeHtml(ev.eventName)}</strong>${
        dateLabel ? ` <span style="color:#64748b;font-size:14px">${escapeHtml(dateLabel)}</span>` : ''
      }</div>`
    );
    for (const cue of ev.cues || []) {
      textSections.push(`  · ${cue.label} — ${cue.reason}`);
      htmlSections.push(
        `<div style="margin:4px 0 4px 12px;color:#334155">· <strong>${escapeHtml(cue.label)}</strong> — ${escapeHtml(cue.reason)}</div>`
      );
    }
    textSections.push(`  Open: ${url}`, '');
    htmlSections.push(
      `<p style="margin:8px 0 0 12px"><a href="${escapeHtml(url)}">Open content review</a></p>`
    );
  }

  const origin = (process.env.APP_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  const dashboardUrl = origin ? `${origin}/dashboard` : '/dashboard';

  const text = [
    `Hi ${name},`,
    '',
    `You have ${totalCues} content review item${totalCues === 1 ? '' : 's'} waiting across ${eventCount} event${eventCount === 1 ? '' : 's'}:`,
    '',
    ...textSections,
    'View all events on your dashboard:',
    dashboardUrl,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;line-height:1.5;color:#111;max-width:640px">
  <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
  <p>You have <strong>${totalCues}</strong> content review item${totalCues === 1 ? '' : 's'} waiting across <strong>${eventCount}</strong> event${eventCount === 1 ? '' : 's'}:</p>
  ${htmlSections.join('')}
  <p style="margin-top:24px"><a href="${escapeHtml(dashboardUrl)}">Open production dashboard</a></p>
  <p style="color:#64748b;font-size:13px;margin-top:24px">This digest is sent after review activity settles. Only assigned reviewers receive these emails.</p>
</body></html>`;

  return { subject, text, html };
}

async function notifyContentReviewDigest(digest) {
  if (!isAdminEmailNotifyConfigured()) return;
  const to = normalizeEmail(digest?.email);
  if (!to) {
    skipEmail('content review digest recipient email missing');
    return;
  }
  if (!digest?.events?.length) return;

  const { subject, text, html } = buildContentReviewDigestEmail(digest);
  const result = await sendViaResend({ to, subject, html, text });
  console.log(
    `[admin-notify-email] Sent content review digest to ${to}` +
      (result.resendId ? ` (resend id: ${result.resendId})` : '')
  );
}

async function notifyContentReviewAssignedBatch(assignees, { eventName, eventId }) {
  for (const row of assignees || []) {
    try {
      await notifyContentReviewAssigned({
        email: row.email,
        fullName: row.full_name,
        eventName,
        eventId,
        role: row.assignee_role,
      });
    } catch (err) {
      console.warn('[admin-notify-email] content review assignment email failed:', err.message);
    }
  }
}

module.exports = {
  notifyAdminsNewAccessRequest,
  notifyAdminsLoginSecurityFlag,
  notifyAdminsOpsAlert,
  notifyUserAccessRequestSubmitted,
  notifyUserAccessApproved,
  notifyUserAccessRejected,
  notifyTrainingBooking,
  notifyTrainingBookingConfirmation,
  getAdminNotifyRecipients,
  getTrainingNotifyRecipients,
  buildAccessRequestEmail,
  buildAccessRequestSubmittedEmail,
  buildAccessApprovedEmail,
  buildAccessRejectedEmail,
  buildLoginSecurityFlagEmail,
  buildOpsAlertEmail,
  buildTrainingBookingEmail,
  buildTrainingBookingConfirmationEmail,
  isAdminEmailNotifyConfigured,
  notifyContentReviewAssigned,
  notifyContentReviewActivity,
  notifyContentReviewDigest,
  notifyContentReviewAssignedBatch,
  buildContentReviewAssignedEmail,
  buildContentReviewActivityEmail,
  buildContentReviewDigestEmail,
};
