# Sentry setup (errors only)

Catches uncaught errors in the Netlify SPA and Railway API and emails you via Sentry alerts. Complements UptimeRobot (uptime) and Admin/Ultritouch health panels (live status).

**Free-tier friendly:** no Session Replay, `tracesSampleRate: 0` (errors only). Egress is negligible.

On the API, `Sentry.init()` runs **before** `require('express')` so Express request instrumentation works.

## Projects

| Sentry project | Env var | Where |
|---|---|---|
| `ros-web` | `VITE_SENTRY_DSN` | Netlify build env **or** local `.env.local` before building the upload folder |
| `ros-api` | `SENTRY_DSN` | Railway Variables |

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

1. Site → **Environment variables** → add `VITE_SENTRY_DSN` (ros-web DSN).
2. Trigger a new deploy / clear cache and deploy.

### Manual folder upload (`netlify-*-V2`)

1. Put in **repo-root** `.env.local` (gitignored):

   ```text
   VITE_SENTRY_DSN=https://...@....ingest.sentry.io/...
   VITE_SENTRY_ENVIRONMENT=production
   ```

2. Rebuild the dated folder (`create-netlify-dated.ps1` or `npm run build` then copy), then upload.

If you upload a folder built **without** `VITE_SENTRY_DSN`, the browser app will not send errors to Sentry.

## Smoke test

1. Deploy with DSNs set.
2. Temporarily throw in the UI or hit an API path that errors.
3. Confirm the issue appears in the matching Sentry project and email arrives.
4. Remove the test throw.

## Related

- Uptime: [UPTIME-MONITORING.md](./UPTIME-MONITORING.md)
- Ops emails (Resend): `lib/ops-alerts.js` — still runs alongside Sentry
