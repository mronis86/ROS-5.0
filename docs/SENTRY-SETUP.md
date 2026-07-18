# Sentry setup (errors only)

Catches uncaught errors in the Netlify SPA and Railway API and emails you via Sentry alerts. Complements UptimeRobot (uptime) and Admin/Ultritouch health panels (live status).

**Free-tier friendly:** no Session Replay, `tracesSampleRate: 0` (errors only). Egress is negligible.

On the API, `Sentry.init()` runs **before** `require('express')` so Express request instrumentation works.

## Projects

| Sentry project | Env var | Where |
|---|---|---|
| `ros-web` (React) | `VITE_SENTRY_DSN` | Netlify build env **or** local `.env.local` before building the upload folder |
| `ros-api` (Node) | `SENTRY_DSN` | Railway Variables |

Optional: `VITE_SENTRY_ENVIRONMENT=production` / `SENTRY_ENVIRONMENT=production`.

Local DSNs can live in `sentry/dsn.txt` (gitignored). Never commit DSNs.

## Railway (API)

1. Railway → your API service → **Variables**.
2. Add `SENTRY_DSN` = DSN from Sentry project **ros-api**.
3. Optional: `SENTRY_ENVIRONMENT=production`.
4. Redeploy. Logs should show `[sentry] initialized`.

Without `SENTRY_DSN`, the API logs `[sentry] disabled` and runs normally.

## Netlify (web)

Vite embeds `VITE_*` at **build time**.

### Git-connected Netlify

1. Site → **Environment variables** → add `VITE_SENTRY_DSN` (ros-web DSN — not the Node DSN).
2. Trigger a new deploy / clear cache and deploy.

### Manual folder upload (`netlify-*-V2`)

1. Put in **repo-root** `.env.local` (gitignored):

   ```text
   VITE_SENTRY_DSN=https://...@....ingest.sentry.io/...
   VITE_SENTRY_ENVIRONMENT=production
   ```

2. Rebuild the dated folder, then upload.

If you upload a folder built **without** `VITE_SENTRY_DSN`, the browser app will not send errors to Sentry.

## Verify / re-test

Use Sentry’s project UI (**Issues**, or “Send a test event” if offered). Confirm alert email rules exist on **both** React and Node projects (“new issue” → email).

Admin → **Services** also summarizes how Sentry fits next to uptime and ops emails.

## Setup checklist warnings in Sentry UI

Safe to ignore for now (we intentionally skipped these):

- **Source maps** — we disable public source maps for privacy; stack traces stay minified. Optional later.
- **Session Replay / Performance tracing** — off to protect free quota.
- **“Finish SDK setup” wizard** — often stays visible; use **Issues**, not the install checklist.

## Related

- Uptime: [UPTIME-MONITORING.md](./UPTIME-MONITORING.md)
- Ops emails (Resend): `lib/ops-alerts.js` — still runs alongside Sentry (e.g. unauthorized API)
- Admin → Services — in-app notes
