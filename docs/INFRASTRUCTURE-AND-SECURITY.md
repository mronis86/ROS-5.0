# ROS 5.0 — Infrastructure, Services & IT Reference

This document describes the external services (Netlify, Railway, Neon, Google, Upstash), how Bitfocus Companion integrates and receives updates, security considerations, and GitHub/branch/backup practices. It is intended for IT, DevOps, and anyone managing or auditing the Run of Show (ROS) application.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Netlify](#2-netlify)
3. [Railway](#3-railway)
4. [Neon](#4-neon)
5. [Google](#5-google)
6. [Upstash](#6-upstash)
7. [Bitfocus Companion — How It Talks and Gets Updates](#7-bitfocus-companion--how-it-talks-and-gets-updates)
8. [Security](#8-security)
9. [GitHub, Branches & Backups](#9-github-branches--backups)
10. [Environment Variables Reference](#10-environment-variables-reference)
11. [Checklist for New Deployments](#11-checklist-for-new-deployments)

---

## 1. Architecture Overview

- **Frontend (React/Vite):** Hosted on **Netlify**. Serves the single-page app (SPA), static assets, and downloadable zips (Companion module, OSC apps).
- **API (Node/Express):** Hosted on **Railway**. Single source of truth for all app data; the frontend and Companion always use this API in production.
- **Database:** **Neon** (serverless PostgreSQL). Used by the Railway API for events, run-of-show data, timers, backups metadata, and auth-related tables.
- **Cache:** **Upstash** (Redis REST API). Used by the API to cache Lower Thirds XML/CSV, Schedule XML/CSV, and Custom Columns XML/CSV for fast reads by vMix, Singular.Live, etc., without hitting Neon on every request.
- **Google:** Optional. **Google Drive API** for weekly backup of upcoming events to a Shared Drive folder; **Google Sheets** export is available via the app (user provides Apps Script Web App URL).
- **Companion:** Bitfocus Companion module runs on the operator’s machine; it **polls the Railway API** (no WebSocket from Companion) to get events, schedule, and active timer, and sends **HTTP POST/PUT** to load cue, start/stop/reset timer, and sub-timers.

**Data flow (simplified):**

- Browser (Netlify) ↔ **Railway API** (REST + Socket.IO for real-time).
- Companion ↔ **Railway API** (REST only, configurable poll interval).
- Railway API ↔ **Neon** (PostgreSQL).
- Railway API ↔ **Upstash** (Redis REST) for graphics cache.
- Railway API ↔ **Google Drive** (optional, for backup).

---

## 2. Netlify

### What It Is

Netlify hosts the **frontend** (built React app). Deploys can be triggered by **Git** (e.g. push to `main`) or by **manual upload** of a built folder (e.g. `netlify-YYYY-MM-DD`).

### Configuration

- **Config file:** `netlify.toml` at the **repository root**.
- **Build command:** `bash netlify/build.sh` (see `netlify/build.sh`).
- **Publish directory:** `dist` (Vite output).
- **Node version:** 20.19.0 (set in `netlify.toml`).

### Build Process (netlify/build.sh)

1. Writes `public/build-info.txt` (build date, commit) so the publish dir is not served from stale cache.
2. Builds the **portable Electron OSC app** in `ros-osc-control` (`npm run build:portable`).
3. Installs root dependencies (`npm ci`).
4. Builds **full Companion module zip** (with `node_modules`, ~18MB) via `scripts/zip-companion-module-full.js`.
5. Runs Vite build (`npm run build`), which runs `prebuild` (zips slim Companion module + Python OSC app) and outputs to `dist`.

### Redirects & Headers

- **Redirects:** Specific paths for zip downloads (e.g. `/companion-module-runofshow.zip`, `/ROS-OSC-Control-portable.zip`) are served as static files; `/*` goes to `/index.html` for SPA routing.
- **Security headers** (in `netlify.toml`):
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Caching:** `/assets/*` has long cache; `*.html` has `max-age=0, must-revalidate`.

### Environment Variables (Netlify)

- **`VITE_API_BASE_URL`** (optional but recommended): Set to the Railway API base URL (e.g. `https://ros-50-production.up.railway.app`). If unset, the app still uses the hardcoded Railway URL when not on localhost; setting it explicitly avoids surprises and supports alternate API hosts.

### IT Notes

- Netlify does **not** run the API or connect to Neon/Upstash directly; all data goes through the Railway API.
- Outbound traffic: browser → Railway (API + Socket.IO), and optionally to Google (Sheets/Apps Script) when the user configures it.
- Ensure Netlify’s deploy domain (e.g. `https://your-site.netlify.app`) is added to the **Railway API CORS/Socket.IO allowed origins** (see [Railway](#3-railway) and [Security](#8-security)).

---

## 3. Railway

### What It Is

Railway runs the **Node.js API server** (`api-server.js`). It is the only backend in production; the frontend (Netlify or local) and Companion always talk to this API.

### Role in the Stack

- Serves REST API (events, run-of-show data, timers, backups, admin, etc.).
- Connects to **Neon** (PostgreSQL) via `NEON_DATABASE_URL`.
- Uses **Upstash** (Redis REST) when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set.
- Optional **Google Drive** backup when `GOOGLE_SERVICE_ACCOUNT_JSON` (or Admin-stored JSON) and Drive folder ID are configured.
- **Socket.IO** for real-time updates (timers, schedule, presence, script/teleprompter sync) to browsers.
- **SSE** endpoint: `GET /api/events/:eventId/stream` for event-stream updates (alternative to Socket.IO for some clients).

### CORS / Socket.IO Origins

In **production** (`NODE_ENV=production`), Socket.IO and CORS are restricted to an explicit list of origins in `api-server.js`, e.g.:

- `http://localhost:3003`, `http://localhost:3000`
- `https://your-app.netlify.app`
- `https://your-app.vercel.app`

**For a new Netlify (or custom) domain:** add the exact origin (e.g. `https://your-site-name.netlify.app`) to the `cors.origin` array in `api-server.js` and **redeploy** the API on Railway. Otherwise, Socket.IO and some fetch requests may be blocked by CORS.

### Health Check

- **URL:** `https://<railway-host>/health`
- Returns JSON with `status`, database and Upstash status, and optional metadata (e.g. Node version, uptime). Use this for monitoring and load balancers.

### IT Notes

- All persistent data (events, run of show, timers, backups metadata, approved domains, backup config) lives in **Neon**; Railway is stateless except for in-memory Socket.IO state.
- Environment variables (see [Environment Variables](#10-environment-variables-reference)) must be set in Railway’s **Variables**; redeploy after changes.
- Egress: Railway → Neon, Upstash, Google APIs. The app reduces egress by caching graphics feeds in Upstash and by limiting broadcast frequency where applicable (e.g. script sync).

---

## 4. Neon

### What It Is

Neon is a **serverless PostgreSQL** database. The Railway API uses it as the only persistent store for application data.

### What Is Stored

- **Calendar events** and **run_of_show_data** (schedule items, custom columns, settings).
- **active_timers**, **sub_cue_timers**, **completed_cues**, **show_start_overtime**, **overtime_minutes**, **start_cue_selection**.
- **change_log**, **timer_messages**.
- **Backups:** `admin_backup` (or equivalent) table for Neon-stored run-of-show backups (created from the Run of Show UI).
- **Admin:** `admin_approved_domains` (allowed login domains), `admin_backup_config` (Google Drive folder ID, weekly backup toggle, optional stored service account JSON).
- Auth-related tables (e.g. **Neon Auth** / `neon_auth.users_sync`) if used; see project auth docs.

### Connection (API)

- **Env var:** `NEON_DATABASE_URL` (connection string, e.g. `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`).
- **Pooling:** The API uses `pg.Pool` with:
  - `max: 3` connections (to reduce Neon compute usage).
  - `idleTimeoutMillis: 30000`, `allowExitOnIdle: true` to allow Neon to scale down when idle.

### Migrations / Schema

- Schema changes (new tables, columns) are applied via **migrations** (e.g. migration 022 for backup config, 023, 024 for approved domains). These must be run against the **same Neon database** that the Railway API uses (same `NEON_DATABASE_URL`).
- If the API reports “table does not exist,” run the corresponding migration SQL in the Neon SQL Editor (or via your migration runner) on the correct branch.

### Neon Backups (In-App)

- The **Neon backup** feature in the app stores snapshots of run-of-show data in a **table in the same Neon database** (not Neon’s built-in point-in-time recovery). Used for “Restore from backup” in the Run of Show UI.
- Backups are created and listed via the API (`/api/backups/...`). Ensure the backup table exists (migrations) and that the API has the right permissions.

### IT Notes

- **Secrets:** `NEON_DATABASE_URL` contains credentials; store only in env vars (Railway, local `.env`) and **never** in the repo.
- **Branching:** Neon supports branches; the app typically uses one branch (e.g. main) for production. If you use multiple branches, ensure the API’s `NEON_DATABASE_URL` points to the intended branch.
- **Availability:** Database availability directly affects the API; monitor Neon dashboard and the API `/health` endpoint.

---

## 5. Google

### What Is Used

1. **Google Drive API** — Optional weekly backup of **upcoming** run-of-show events to a Google Drive folder (Shared Drive recommended). Backups are organized in weekly subfolders (e.g. `2026-W06`).
2. **Google Sheets** — Optional. Users can push Lower Thirds / Schedule / Custom Columns data to a Sheet via a **Google Apps Script Web App** URL they provide (no server-side Google credential required for that flow).

### Google Drive Backup (Admin)

- **Setup:** See `docs/GOOGLE-DRIVE-BACKUP-SETUP.md`.
- **Credentials:** A **service account** JSON key. It can be:
  - Stored in the **Admin backup config** in the database (paste in Admin UI, then “Save”; value is not shown again), or
  - Set as the **API env var** `GOOGLE_SERVICE_ACCOUNT_JSON` (full JSON string) on Railway.
- **Drive folder:** Must be a folder in a **Shared Drive** (or shared with the service account email). The service account is added as **Editor**. Folder ID is set in Admin (from the URL `drive.google.com/drive/folders/FOLDER_ID`).
- **Scopes:** Drive only (`https://www.googleapis.com/auth/drive`).
- **Run:** “Run backup now” in Admin works with or without “Enable weekly backup.” “Enable weekly backup” is for use with an external cron that calls the backup endpoint; the app does not run a built-in cron on Railway.

### Google Sheets Export

- **User-facing:** User enters their **Google Apps Script Web App** URL. The app sends data (e.g. CSV/JSON) to that URL (e.g. via `fetch` with `mode: 'no-cors'`). No Google credential is stored in the app for this; the Apps Script runs under the user’s Google account.
- **Docs:** `docs/GOOGLE-SHEETS-TROUBLESHOOTING.md`, `docs/GOOGLE-SHEETS-FEATURES.md`, and `docs/BACKUP-VIA-GOOGLE-APPS-SCRIPT.md` (alternative backup via script).

### IT Notes

- **Service account JSON** is sensitive; restrict access (Admin role, env vars only in secure env).
- **Data residency:** Google Drive/Sheets data is subject to Google’s terms and region; document where backup data is stored if required by policy.
- **Audit:** Optionally log when backup runs (Admin or cron) and who has access to the Shared Drive folder.

---

## 6. Upstash

### What It Is

Upstash provides **serverless Redis** accessed via a **REST API**. The Railway API uses it as a **cache** for pre-rendered graphics feeds so that vMix, Singular.Live, etc. can request XML/CSV without hitting the Neon database on every request.

### What Is Cached

- **Lower Thirds:** XML and CSV per event.
- **Schedule:** XML and CSV per event.
- **Custom Columns:** XML and CSV per event.

Keys are like `lower-thirds-xml-<eventId>`, `schedule-csv-<eventId>`, etc. TTL is typically 3600 seconds (1 hour); cache is regenerated when run-of-show data is saved.

### API Endpoints (Read Path)

- Cached read endpoints (e.g. `/api/upstash/lower-thirds-xml/:eventId`) first try **Upstash**; on cache miss, the API may generate from Neon and then populate the cache (depending on implementation). This reduces Neon load and improves latency for graphics.

### Configuration

- **Env vars (Railway):** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- If either is missing, the API skips Upstash (no cache); graphics endpoints may still work by reading from Neon or returning errors depending on route.

### IT Notes

- **Data in Upstash:** Cached copies of run-of-show–derived content (XML/CSV). No user passwords or auth tokens are stored there.
- **Token:** Treat `UPSTASH_REDIS_REST_TOKEN` as secret; store only in env.
- **Availability:** If Upstash is down, cached endpoints may fail or fall back to DB; monitor `/health` (reports Upstash configured/working) if you rely on graphics feeds.

---

## 7. Bitfocus Companion — How It Talks and Gets Updates

### What Is Companion

**Bitfocus Companion** is software that runs on the operator’s machine (e.g. Stream Deck / control surface). The **Run of Show Companion module** (`companion-module-runofshow`) lets operators load cues, start/stop/reset timers, and start/stop sub-timers by pressing buttons. The module does **not** use OSC for talking to the ROS API; it uses **HTTP (REST)** only.

### Configuration (Module)

- **API Base URL:** Default `https://ros-50-production.up.railway.app`; can be changed (e.g. to a different Railway URL or local API for testing).
- **Event ID:** The event UUID from the ROS web app (Events list).
- **Day:** 1–10 (for multi-day events).
- **Sync interval:** “Enable sync interval” and “Sync interval (seconds)” (5–600). When enabled, the module **polls** the API at that interval.
- **Auto-disable sync after (hours):** Optional; turns off polling after N hours (0 = never).

### How Companion Gets Updates

- **Polling only.** The module does **not** open a WebSocket or SSE connection to the API. It:
  - Calls `GET /api/calendar-events` to refresh the event list.
  - Calls `GET /api/run-of-show-data/:eventId` to refresh schedule items for the selected day.
  - Calls `GET /api/active-timers/:eventId` to refresh the current timer.
- Polling runs at the configured **sync interval** (e.g. every 60 seconds). After each fetch, it updates internal state, variables, and feedbacks (button highlights).
- **Timer display:** While a timer is running, the module also runs a **local 1-second tick** to update elapsed/remaining time for variables and feedbacks (no extra API call per second).

### How Companion Sends Commands

All commands are **HTTP** to the Railway API:

- **Load cue:** `POST /api/cues/load` (body: `event_id`, `item_id`, `user_id: 'companion'`, `cue_is`, `duration_seconds`).
- **Start timer:** `POST /api/timers/start` (`event_id`, `item_id`, `user_id: 'companion'`).
- **Stop timer:** `POST /api/timers/stop` (`event_id`, `item_id`).
- **Reset timer:** `POST /api/timers/reset` (`event_id`).
- **Sub-timers:** `POST /api/sub-cue-timers` (start), `PUT /api/sub-cue-timers/stop` (stop).

Before loading a new cue, the module may call **stop** on the current timer and sub-timers so elapsed/overtime is saved.

### Where the Module Gets Its Build

- **Slim zip:** `companion-module-runofshow.zip` (no `node_modules`; user runs `npm install` in the module).
- **Full zip:** `companion-module-runofshow-full.zip` (includes `node_modules`, ~18MB). Built on Netlify via `scripts/zip-companion-module-full.js` and served from the frontend (OSC Control panel download link).

### OSC (Separate from Companion Module)

- **OSC** is used by other parts of the system (e.g. **ROS-OSC-Control** Electron app, **ros-osc-python-app**) to control cues/timers, often over the local network. The **API** exposes REST endpoints for cues/timers; Companion calls those REST endpoints. The Electron/Python OSC apps may send OSC messages that are then translated into API calls or may call the API directly (see `api-server.js` OSC-related routes and `ros-osc-control` docs). So: **Companion module = REST to Railway; OSC = separate control path**, possibly talking to the same API or to local OSC targets.

### IT Notes

- **Network:** Companion needs **outbound HTTPS** to the Railway API URL (and optionally to a custom API URL). No inbound ports are required on the operator machine for the module.
- **Credentials:** The module does not send login credentials; it assumes the API is public or protected by other means (e.g. approved domains for the web app; Companion actions are not authenticated by the current API).
- **Updates:** To get new module behavior, users reinstall/update the module (e.g. re-download the full zip from the app and re-add the module in Companion).

---

## 8. Security

### Authentication (Web App)

- The web app uses **Neon Auth** (or similar); users sign in and sessions are validated. **Approved domains** are stored in Neon (`admin_approved_domains`). Only users from approved domains (or all domains if the list is empty) can use the app; the API may enforce this for certain routes. See `docs/AUTHENTICATION_SETUP.md` and `docs/NEON_AUTH_SETUP.md` if present.

### Admin Endpoints

- Admin endpoints (e.g. `/api/admin/presence`, `/api/admin/backup-config`, `/api/admin/approved-domains`, `/api/admin/disconnect-user`, `/api/admin/stop-timer`) are protected by a **query key** (and optional **PIN** for 2-layer auth).
- **API (Railway):** Set `ADMIN_KEY` (defaults to `1615` if unset) and optionally `ADMIN_PIN`. If `ADMIN_PIN` is set, every admin request must include both `key` and `pin` (e.g. `?key=...&pin=...`). The Admin page login form has a Password field (key) and an optional PIN field; both are sent with each request.
- **Frontend (Netlify):** You can set `VITE_ADMIN_KEY` so the unlock form expects that key instead of the built-in default. Restrict Admin access to trusted users/networks; treat the key and PIN as secrets and rotate if exposed.
- **Optional second gate (puzzle):** Set `ADMIN_PUZZLE_COLORS` on the API (e.g. `red,green,blue`) to require a color-selection puzzle after the password. The admin must pick the correct colors from a grid of 12; only those who know the configured colors can complete login.

### CORS and Socket.IO

- In production, the API allows only configured origins for Socket.IO and CORS. Add every legitimate frontend origin (Netlify, custom domain, staging) to avoid broken real-time features and to reduce CSRF surface.

### Secrets Management

- **Never commit:** `NEON_DATABASE_URL`, `UPSTASH_REDIS_REST_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`, admin key, any API keys.
- **Use:** Railway Variables, Netlify env (only non-secret build-time vars like `VITE_API_BASE_URL`), local `.env` / `.env.local` (and ensure they are in `.gitignore`).
- **Google JSON:** Stored in DB (Admin backup config) or in `GOOGLE_SERVICE_ACCOUNT_JSON`; both must be access-controlled.

### Headers (Netlify)

- The app sends security headers (see [Netlify](#2-netlify)); they help prevent clickjacking, XSS, and MIME sniffing.

### Data in Transit

- Netlify and Railway serve over **HTTPS**. Neon and Upstash connections use TLS. Ensure no downgrade to HTTP for the app or API in production.

### Companion and API

- Companion module actions are **unauthenticated** HTTP calls to the API. If the API URL is public, anyone who knows the base URL and event IDs could call the same endpoints. For stricter control, consider API keys or IP allowlisting for Companion or for the cue/timer endpoints (would require code changes).

---

## 9. GitHub, Branches & Backups

### Repository and Branches

- **Default branch:** Often `main` or `master`. Netlify can deploy from a specific branch (e.g. `main`).
- **Workflow:** Feature work can be done in branches; merge to the deploy branch to trigger Netlify (if connected) and to keep production in sync. Railway typically deploys from the same repo (same branch or a linked branch).

### What Not to Commit

- **`.env`, `.env.local`** — Contain secrets (Neon URL, Upstash token, Google JSON, etc.). Must be in `.gitignore`.
- **Build artifacts** — `dist/`, `node_modules/`, zips under `public/` that are regenerated in CI (optional to ignore if you want them in repo; Netlify rebuilds them).
- **Secrets and keys** — No API keys, passwords, or service account JSON in the repo.

### Backups (Application Data)

- **Neon (DB):** Neon’s own backup/PITR (if enabled on your plan). Application-level “backups” are:
  - **In-Neon backups:** Stored in the `admin_backup` (or equivalent) table; created from the Run of Show UI (manual/auto). Restore from the same UI.
  - **Google Drive backup:** Optional weekly (or manual) export of upcoming events to a Shared Drive folder; see [Google](#5-google).
- **Code and config:** In Git. Important config (e.g. list of env var names and which service they belong to) can be documented in this file or in a private runbook; actual values stay in env/secrets.

### Branch Strategy Suggestion

- **main / master:** Production; Netlify and Railway point here (or to a release tag).
- **develop / staging:** Optional; can have a separate Netlify site and Railway service (or different env vars) for staging. Ensure staging CORS/origins are added if you use Socket.IO from staging.
- **Feature branches:** Short-lived; merge after review. Avoid long-lived branches that diverge from main.

### Restoring from Backup

- **Neon table backups:** Use “Restore from backup” in the Run of Show UI for the chosen event.
- **Google Drive:** Download JSON/CSV from the Drive folder and re-import or use custom tooling if needed.
- **Code:** Revert or re-deploy from a previous Git commit/tag.

---

## 10. Environment Variables Reference

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEON_DATABASE_URL` | Railway (required), local API | PostgreSQL connection string for Neon. |
| `UPSTASH_REDIS_REST_URL` | Railway | Upstash Redis REST URL (optional). |
| `UPSTASH_REDIS_REST_TOKEN` | Railway | Upstash Redis REST token (optional). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Railway | Full JSON key for Google Drive backup (optional; can use Admin-stored key instead). |
| `NODE_ENV` | Railway | `production` for prod; affects CORS/Socket.IO origins. |
| `PORT` | Railway | Server port (Railway often sets this). |
| `VITE_API_BASE_URL` | Netlify, local dev | Base URL of the API (e.g. Railway URL). Optional; app has default. |
| `ADMIN_KEY` | Railway (API) | Secret for Admin API; defaults to `1615` if unset. |
| `ADMIN_PIN` | Railway (API) | Optional second factor; if set, admin requests must include matching `pin`. |
| `VITE_ADMIN_KEY` | Netlify (build) | Admin password expected by the login form; optional (app has default). |
| `ADMIN_PUZZLE_COLORS` | Railway (API) | Comma-separated colors (e.g. `red,green,blue`) to enable the post-password puzzle; leave unset to skip. |

- **Local dev:** Copy `.env.example` to `.env` or `.env.local` and fill in; do not commit. Use `VITE_API_BASE_URL=http://localhost:3001` (or your local API port) when running the API locally.

---

## 11. Checklist for New Deployments

- [ ] **Neon:** Create project/DB if new; run migrations; set `NEON_DATABASE_URL` on Railway.
- [ ] **Railway:** Set all required env vars; add Netlify (and staging) origin to CORS/Socket.IO in `api-server.js` and redeploy.
- [ ] **Netlify:** Connect repo (or configure manual deploy); set build command and publish dir; optionally set `VITE_API_BASE_URL`.
- [ ] **Upstash:** Create Redis database if using cache; set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` on Railway.
- [ ] **Google Drive backup (optional):** Create service account, Shared Drive folder, share folder with service account; set folder ID and JSON (Admin or `GOOGLE_SERVICE_ACCOUNT_JSON`) and run a test backup.
- [ ] **Admin:** Add production (and staging) domains to **Approved domains** in Admin so login works.
- [ ] **Companion:** Point API Base URL to the production Railway URL; ensure operators have correct Event ID and sync interval.
- [ ] **Secrets:** Confirm no secrets in repo; rotate any that were ever committed or shared inappropriately.
- [ ] **Monitoring:** Use `/health` on Railway for availability; consider alerts on 5xx or DB/Upstash failures.

---

*Document version: 2026-02-20. For detailed steps on individual services, see the referenced docs in `docs/`.*
