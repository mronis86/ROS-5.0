import * as Sentry from '@sentry/react';

/**
 * Optional Sentry for the Netlify SPA.
 * Set VITE_SENTRY_DSN at build time (Netlify env or local .env.local).
 * No DSN → no-op.
 */
export function initSentry(): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)?.trim() ||
      import.meta.env.MODE,
    // Errors only — leave Session Replay / high tracing off for free tier
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  // Console helper: __rosSentrySmokeTest() — bare `throw` in DevTools often never reaches Sentry
  (window as unknown as { __rosSentrySmokeTest?: () => string }).__rosSentrySmokeTest = () => {
    const err = new Error('Sentry smoke test web');
    Sentry.captureException(err);
    return 'Sent to Sentry (check ros-web Issues in ~30s)';
  };
}

export { Sentry };
