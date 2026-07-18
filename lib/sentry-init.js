/**
 * Optional Sentry error reporting for the Railway API.
 * Set SENTRY_DSN (and optional SENTRY_ENVIRONMENT) on the host.
 * No DSN → no-op (local/dev safe).
 */

function initSentry() {
  const dsn = (process.env.SENTRY_DSN || '').trim();
  if (!dsn) {
    console.log('[sentry] disabled (no SENTRY_DSN)');
    return false;
  }

  const Sentry = require('@sentry/node');
  if (Sentry.isInitialized()) return true;

  Sentry.init({
    dsn,
    environment:
      (process.env.SENTRY_ENVIRONMENT || '').trim() ||
      process.env.NODE_ENV ||
      'development',
    // Errors only — keep free-tier egress/quota low
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  console.log(
    `[sentry] initialized (env=${process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'})`
  );
  return true;
}

function setupSentryExpressErrorHandler(app) {
  const Sentry = require('@sentry/node');
  if (!Sentry.isInitialized()) return;
  Sentry.setupExpressErrorHandler(app);
}

/** One-shot smoke test: GET /api/sentry-test → event in ros-api. Remove after verifying. */
function registerSentrySmokeTestRoute(app) {
  const Sentry = require('@sentry/node');
  if (!Sentry.isInitialized()) return;

  app.get('/api/sentry-test', (req, res) => {
    Sentry.captureException(new Error('Sentry smoke test api'));
    res.json({
      ok: true,
      message: 'Sent test error to Sentry (check ros-api Issues in ~30s)',
    });
  });
}

module.exports = {
  initSentry,
  setupSentryExpressErrorHandler,
  registerSentrySmokeTestRoute,
};
