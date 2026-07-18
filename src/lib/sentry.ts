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
}

export { Sentry };
