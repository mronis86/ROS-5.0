# API authentication setup

## Overview

| Layer | Technology |
|-------|------------|
| **Web app users** | Neon Auth (Better Auth) — sign up / sign in |
| **Admin approval** | `api_user_access` table — pending until admin approves |
| **Integrations** (Companion, vVMix) | Scoped `api_integration_tokens` |
| **API enforcement** | `REQUIRE_API_AUTH` on Railway |

---

## 1. Enable Neon Auth in Neon Console

1. Open your Neon project → **Auth** → **Enable Auth**
2. On **Configuration**, copy the **Auth URL** (ends with `/neondb/auth`)
3. Set environment variables:

**Netlify (frontend):**
```bash
VITE_NEON_AUTH_URL=https://ep-xxx.neonauth....neon.build/neondb/auth
```

**Railway (API):**
```bash
NEON_AUTH_BASE_URL=https://ep-xxx.neonauth....neon.build/neondb/auth
# Optional if Netlify origin is not in Neon Domains list:
# NEON_AUTH_CLIENT_ORIGIN=https://your-site.netlify.app
```

Sign-in uses **server-side Neon Auth** (`POST /api/auth/neon-login`): the browser sends email/password to Railway, Railway talks to Neon directly, then issues a `ros_nsess_*` API token. This avoids broken cross-domain JWT handoff from the browser.

**Important:** `NEON_DATABASE_URL` on Railway must be the **same Neon branch** where Auth is enabled. Auth on `ep-icy-rice-...` with the database on a different branch will break access requests and approval.

Run migrations **026**, **027**, and **028** on Neon if not already applied.

Migration **028** (`api_neon_sessions`) is required for the Neon → Railway session exchange used by local/Netlify frontends.

---

## 2. User flow (sign up + admin approval)

1. User clicks **Sign up** → Neon Auth creates their account
2. App submits an **access request** (status: `pending`)
3. User sees **“Awaiting approval”** — cannot use the app yet
4. Admin opens **Admin → Access requests** → Approve / Approve as admin / Reject
5. User clicks **Check again** (or refreshes) → full app access

**First user bootstrap:** If no approved admin exists yet, the first access request is **auto-approved as administrator**.

**Domain gate:** Approved email domains (`Admin → Approved email domains`) still apply at sign-up.

**Email admins on new sign-up (optional):** When someone registers and is **pending** approval, the API emails every **approved admin** in `api_user_access` (`is_admin = true`). When an admin **approves** or **rejects** a request on the Admin page, the user receives an email too. No app URL is required in these emails.

Only two env vars on the API server (local `.env` or Railway):

```bash
RESEND_API_KEY=re_...
ADMIN_NOTIFY_FROM="Run of Show <onboarding@resend.dev>"
```

Use Resend’s test sender while developing; switch to your verified domain for production. Sign-up is not blocked if email fails. The first bootstrap admin is auto-approved and does not trigger this email.

### Production: verified domain (email all admins)

`onboarding@resend.dev` only delivers to **your Resend account email**. To notify every approved admin, verify a domain in Resend and point Railway at it.

**1. Resend → Domains → Add domain**

Add the domain you want to send from (e.g. `sinor.com` or `mail.sinor.com`). Resend shows DNS records to add at your DNS host:

| Type | Purpose |
|------|---------|
| **TXT** | Domain verification |
| **MX** | Bounce/complaint handling (if Resend asks for it) |
| **TXT (SPF)** | Sender policy |
| **CNAME (DKIM)** | Signing (often 2–3 records) |

Wait until Resend shows the domain as **Verified** (can take a few minutes to 48 hours depending on DNS).

**2. Railway → your API service → Variables**

Update (or add):

| Variable | Example value |
|----------|----------------|
| `RESEND_API_KEY` | `re_...` (same key as now) |
| `ADMIN_NOTIFY_FROM` | `Run of Show <noreply@yourdomain.com>` |

Rules:

- The address **must** use your **verified** domain (`noreply@`, `alerts@`, etc.).
- Display name is optional: `Run of Show <noreply@yourdomain.com>`.
- In Railway’s UI, paste the value **without** extra quotes unless your platform requires them.

**3. Redeploy Railway**

After saving variables, trigger a redeploy (or wait for auto-deploy). On startup, logs should show:

```text
📧 Admin emails: Resend configured (from Run of Show <noreply@yourdomain.com>)
```

**4. Verify locally (optional) then production**

```bash
node scripts/check-admin-email-setup.js
node scripts/test-admin-notify-email.js --login
```

Check all admin inboxes and the Resend dashboard → **Emails** for delivery status.

**Test locally (before Netlify):**

1. Add `RESEND_API_KEY` and `ADMIN_NOTIFY_FROM` to `.env`
2. Ensure at least one approved admin exists in the database
3. Dry run all admin emails: `node scripts/test-admin-notify-email.js`
   - Login security only: `node scripts/test-admin-notify-email.js --login`
   - API/security ops alerts: `node scripts/test-admin-notify-email.js --ops`
4. Full flow: uncomment `VITE_API_BASE_URL=http://localhost:3001` in `.env`, run `npm run api` and `npm run dev`, sign up as a new user

When satisfied, add the same two vars to Railway and redeploy. You do not need a Netlify URL for email to work.

---

## 3. Legacy fallback (no Neon Auth URL)

If `VITE_NEON_AUTH_URL` is unset, the app falls back to **legacy email/password** (`api_users` / migration 026). Use Neon Auth for production.

---

## 4. Integration tokens (Companion / vMix)

Admin → **Integration API tokens** — scopes `read,control` for Companion.

When `REQUIRE_API_AUTH` is enabled, paste token into Companion **API Token** field.

---

## 5. Enable API lockdown (rollout)

**Phase 1 — `writes` (recommended first):**

- Blocks anonymous **POST/PUT/DELETE** (timer start, save run-of-show, etc.).
- **GET** polling still works without a token (Companion sync keeps working until you add a token for **commands**).

**Phase 2 — `all` (optional, later):**

- Blocks anonymous **reads** too (full audit fix for GET leaks).

| Variable | Value |
|----------|--------|
| `REQUIRE_API_AUTH` | `writes` then optionally `all` |
| `ALLOW_LEGACY_PUBLIC_API` | leave **unset** or `false` |

### Rollout checklist

1. **Deploy** latest frontend (sends `ros_nsess_*` on all save/timer calls).
2. **Sign in** to the web app and smoke-test save + timer.
3. **Admin → Integration API tokens** → create token with scopes `read, control` (name e.g. "Companion show floor").
4. **Companion module config** → paste token in **API Token** field → test load cue / start timer.
5. **Railway** → set `REQUIRE_API_AUTH=writes` → redeploy API.
6. Re-test web app (signed in) + Companion commands.
7. Later: `REQUIRE_API_AUTH=all` + ensure Companion token includes `read` (already included in step 3).

**vMix / Netlify graphics URLs** are separate feeds and are not affected by Railway `REQUIRE_API_AUTH`.

**Offline show** (LAN port 3004) is unaffected for LAN-only mode. For **cloud sync / Cloud on reconnect**, paste an Integration API token in the offline app connectivity bar (**API** button), or set `OFFLINE_RAILWAY_API_TOKEN` on the show server. Token needs scopes **`read` + `control` + `write`** when `REQUIRE_API_AUTH` is enabled (`write` is required to upload schedule + active timer; `control` alone is enough for Companion cue/timer routes but not for reconnect snapshot POSTs).

---

## 6. Verify Neon Auth on Railway

After deploy, logs should show:
```
[api-auth] Neon Auth JWT validation enabled (https://ep-xxx.../auth)
```

If missing, set `NEON_AUTH_BASE_URL` on Railway and redeploy.

---

## 7. Trusted domains (fix “Invalid origin”)

Neon Auth checks the browser **Origin** header. Only `http://localhost:*` is allowed automatically.

| Where you open the app | What to do |
|------------------------|------------|
| `http://localhost:3003` | Should work (ensure **Allow Localhost** is on in Neon → Settings → Auth) |
| `http://192.168.x.x:3003` (Vite Network URL) | **Not** auto-trusted — use localhost, or add the full origin in **Auth → Configuration → Domains** |
| Netlify production | Add `https://your-site.netlify.app` under **Auth → Configuration → Domains**, then redeploy Netlify |

Example domain entries (no trailing slash):

```
http://localhost:3003
http://192.168.1.232:3003
https://your-site.netlify.app
```
