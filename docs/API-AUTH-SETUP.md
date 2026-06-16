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
