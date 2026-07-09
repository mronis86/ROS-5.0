/**
 * User-initiated issue reports emailed to admins (Resend via ops alerts).
 *
 * Env (optional):
 *   USER_REPORT_RATE_LIMIT_MAX=10
 *   USER_REPORT_RATE_LIMIT_WINDOW_MIN=60
 *   USER_REPORT_ALERT_COOLDOWN_MIN=15
 *   USER_REPORT_CONSOLE_LOG_MAX_CHARS=12000
 */

const { rateLimit } = require('express-rate-limit');
const { queueOpsAlert } = require('./ops-alerts');

function readPositiveInt(name, fallback) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function sanitizeText(value, maxLen) {
  return String(value || '')
    .trim()
    .slice(0, maxLen);
}

function clientIp(req) {
  return (req?.ip || req?.socket?.remoteAddress || 'unknown').toString();
}

function buildUserReportPayload(req, body = {}) {
  const auth = req.auth;
  const reporterEmail =
    sanitizeText(body.userEmail, 320) ||
    (auth?.email ? sanitizeText(auth.email, 320) : '') ||
    undefined;
  const reporterName =
    sanitizeText(body.userName, 200) ||
    (auth?.fullName ? sanitizeText(auth.fullName, 200) : '') ||
    undefined;
  const includeConsole = body.includeConsoleLog !== false;
  const consoleMax = readPositiveInt('USER_REPORT_CONSOLE_LOG_MAX_CHARS', 12000);
  const consoleLog = includeConsole ? sanitizeText(body.consoleLog, consoleMax) : undefined;

  return {
    message: sanitizeText(body.message, 500) || 'User reported an issue',
    userNote: sanitizeText(body.userNote, 2000) || undefined,
    page: sanitizeText(body.page, 500) || undefined,
    userEmail: reporterEmail,
    userName: reporterName,
    userAgent: sanitizeText(body.userAgent || req.headers['user-agent'], 400) || undefined,
    consoleLog,
    ip: clientIp(req),
    flaggedAt: new Date().toISOString(),
    test: body.test === true,
  };
}

async function sendUserIssueReport(pool, req, body = {}) {
  const report = buildUserReportPayload(req, body);
  if (!report.message) {
    return { ok: false, status: 400, error: 'Message is required.' };
  }

  const pageLabel = report.page || 'unknown page';
  const summaryParts = [report.message];
  if (report.userNote) summaryParts.push(`Note: ${report.userNote}`);
  if (report.userEmail) summaryParts.push(`From: ${report.userEmail}`);

  const dedupeKey = [
    'user_report',
    report.page || '',
    report.message.slice(0, 80),
    report.userEmail || report.ip,
  ].join(':');

  await queueOpsAlert(pool, {
    category: 'user_report',
    severity: report.test ? 'info' : 'warning',
    title: report.test
      ? `Test user issue report (${pageLabel})`
      : `User reported an issue (${pageLabel})`,
    summary: summaryParts.join(' — ').slice(0, 500),
    details: {
      message: report.message,
      userNote: report.userNote,
      page: report.page,
      userEmail: report.userEmail,
      userName: report.userName,
      userAgent: report.userAgent,
      consoleLog: report.consoleLog,
      ip: report.ip,
      test: report.test ? 'yes' : undefined,
      flaggedAt: report.flaggedAt,
    },
    dedupeKey,
    cooldownMinutes: readPositiveInt('USER_REPORT_ALERT_COOLDOWN_MIN', 15),
  });

  return { ok: true };
}

function buildUserReportLimiter() {
  const windowMin = readPositiveInt('USER_REPORT_RATE_LIMIT_WINDOW_MIN', 60);
  return rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: readPositiveInt('USER_REPORT_RATE_LIMIT_MAX', 10),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many issue reports. Please wait before sending another.' },
  });
}

function registerUserReportRoutes(app, pool) {
  const limiter = buildUserReportLimiter();

  app.post('/api/ops/user-report', limiter, async (req, res) => {
    try {
      const result = await sendUserIssueReport(pool, req, req.body || {});
      if (!result.ok) {
        return res.status(result.status || 400).json({ error: result.error || 'Could not send report.' });
      }
      return res.json({ ok: true, message: 'Report sent to administrators. Thank you.' });
    } catch (err) {
      console.error('[user-report]', err);
      return res.status(500).json({ error: 'Could not send report.' });
    }
  });

  console.log(
    `[user-report] enabled limit=${readPositiveInt('USER_REPORT_RATE_LIMIT_MAX', 10)}/${readPositiveInt('USER_REPORT_RATE_LIMIT_WINDOW_MIN', 60)}m`
  );
}

module.exports = {
  registerUserReportRoutes,
  sendUserIssueReport,
  buildUserReportPayload,
};
