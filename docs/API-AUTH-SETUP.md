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
```

Use the **same URL** for both (with/without `VITE_` prefix).

**Important:** `NEON_DATABASE_URL` on Railway must be the **same Neon branch** where Auth is enabled. Auth on `ep-icy-rice-...` with the database on a different branch will break access requests and approval.

Run migrations **026** and **027** on Neon if not already applied.

---

## 2. User flow (sign up + admin approval)

1. User clicks **Sign up** → Neon Auth creates their account
2. App submits an **access request** (status: `pending`)
3. User sees **“Awaiting approval”** — cannot use the app yet
4. Admin opens **Admin → Access requests** → Approve / Approve as admin / Reject
5. User clicks **Check again** (or refreshes) → full app access

**First user bootstrap:** If no approved admin exists yet, the first access request is **auto-approved as administrator**.

**Domain gate:** Approved email domains (`Admin → Approved email domains`) still apply at sign-up.

---

## 3. Legacy fallback (no Neon Auth URL)

If `VITE_NEON_AUTH_URL` is unset, the app falls back to **legacy email/password** (`api_users` / migration 026). Use Neon Auth for production.

---

## 4. Integration tokens (Companion / vMix)

Admin → **Integration API tokens** — scopes `read,control` for Companion.

When `REQUIRE_API_AUTH` is enabled, paste token into Companion **API Token** field.

---

## 5. Enable API lockdown (when ready)

| Variable | Value |
|----------|--------|
| `REQUIRE_API_AUTH` | `writes` then `all` |
| `ALLOW_LEGACY_PUBLIC_API` | `false` |

Rollout: web sign-in working → Companion tokens deployed → lock writes → lock reads.

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
