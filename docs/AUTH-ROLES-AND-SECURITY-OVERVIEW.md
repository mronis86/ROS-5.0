# Authentication, Roles & Security — Source Overview

**Purpose:** Drafting aid for a formal security / access-control document. Describes how ROS-5.0 login, approval, roles, and related systems work **as implemented today**.

**Related setup docs:** [API-AUTH-SETUP.md](./API-AUTH-SETUP.md), [INFRASTRUCTURE-AND-SECURITY.md](./INFRASTRUCTURE-AND-SECURITY.md)

**Out of date (do not use for formal docs):** `AUTHENTICATION_SETUP.md`, `NEON_AUTH_SETUP.md` (Stack Auth / old localStorage auth).

---

## 1. Systems involved

| System | What it does for ROS | Auth / security touch |
|--------|----------------------|------------------------|
| **Netlify** | Hosts the React SPA | Env: `VITE_NEON_AUTH_URL`, `VITE_API_BASE_URL`. Security headers via `netlify.toml`. No server-side auth on Netlify. |
| **Railway** | Express API + Socket.IO | Login proxy, session issuance, API middleware, admin key, rate limits, ops alerts. |
| **Neon (Postgres)** | App data + access tables | `api_user_access`, sessions, domains, event allowlists, integration tokens. |
| **Neon Auth (Better Auth)** | Identity (email/password) | Hosted IdP. Railway verifies credentials server-side; app does **not** trust Neon cookies alone for API access. |
| **Upstash Redis** | Graphics / feed cache | Server-to-Upstash only. End users do not authenticate to Redis. Many graphics feeds stay intentionally public. |
| **Resend** | Email (approval, login alerts) | API keys on Railway; not end-user login. |
| **Browser** | Session storage | API bearer token in `localStorage` (`ros_api_token`); admin key may use `sessionStorage`. |

```text
User browser (Netlify SPA)
        │
        │  email/password or access-request
        ▼
Railway API  ──────►  Neon Auth (verify identity)
        │
        │  approve/pending gates in Postgres
        ▼
Neon DB (api_user_access, api_neon_sessions, …)
        │
        ▼
Bearer token ros_nsess_*  ◄── returned to browser, stored locally
        │
        ▼
Later REST calls → Railway middleware → req.auth
```

---

## 2. Login & access lifecycle

### 2.1 High-level stages

1. **Identity** — User proves who they are (Neon Auth email/password after password is set).
2. **Access request / approval** — App account gated by `api_user_access.status` (`pending` → `approved` | `rejected`).
3. **API session** — Railway issues `ros_nsess_*`; hash stored in `api_neon_sessions`.
4. **App use** — Client sends `Authorization: Bearer <token>` on API calls; UI also applies client-side gates.
5. **Optional per-show role** — VIEWER / OPERATOR / EDITOR chosen in the app (UI/presence; see §4).

### 2.2 Request access (typical path)

1. User opens the app → login / access UI (`AuthModal`, `AuthGuard`).
2. Optional **domain check**: `POST /api/auth/check-domain`. If `admin_approved_domains` is empty, all domains are allowed; otherwise email domain must match.
3. User **requests access** (passwordless entry): `POST /api/auth/request-access` with email + name.
4. Row created/updated in `api_user_access` with status **`pending`** (unless bootstrap rules apply).
5. Admins may get email notification (Resend). User sees **Awaiting approval**.
6. After admin **approves**, user completes password setup via **access portal**, then signs in.

**First-admin bootstrap:** If no approved administrator exists yet, the first access request is **auto-approved as admin** (`is_admin = true`).

### 2.3 Sign-in (after approval + password)

1. Browser posts email/password to Railway: **`POST /api/auth/neon-login`**.
2. Railway calls Neon Auth server-side (`lib/neon-auth-server.js`) so the browser does not depend on cross-domain Neon JWT/cookie handoff.
3. Railway ensures/refreshes `api_user_access`, creates a session row, returns:
   - `ros_nsess_*` API token  
   - access flags (`status`, `is_admin`, `is_event_manager`, `dashboard_enabled`, etc.)
4. Client stores token via `setApiAccessToken` (`src/lib/sessionAuth.ts`) and user snapshot in localStorage.
5. **`AuthGuard`** only allows the full app when `accessStatus === 'approved'`.

### 2.4 What is *not* an httpOnly cookie session

The primary ROS API credential is a **bearer token in `localStorage`**, not an httpOnly cookie. Treat XSS as high impact on session theft. Neon Auth may still use its own cookies on Neon’s domain; those are not the API session the SPA relies on for Railway.

### 2.5 Key implementation files

| Area | Path |
|------|------|
| Client auth service | `src/services/auth-service.ts` |
| Token helpers | `src/lib/sessionAuth.ts` |
| App gate | `src/components/AuthGuard.tsx` |
| Auth UI / context | `src/contexts/AuthContext.tsx`, auth modal components |
| API middleware | `lib/api-auth.js` |
| Neon Auth server proxy | `lib/neon-auth-server.js` |
| Admin key gate | `lib/admin-auth.js` |
| API wiring | `api-server.js` |

---

## 3. Platform account types (Admin · Event Manager · Regular user)

ROS has **three primary account types** for approved people. The Admin UI labels them **Admin**, **Event manager**, and **User**. In this doc we call the last one **Regular user**.

These are **server-backed** flags on `api_user_access`. They control *platform* access (menus, approval tools, admin pages). They are separate from the in-show pick of VIEWER / OPERATOR / EDITOR (§4).

All three types must still be **`status = approved`** (and complete password setup) before they can use the SPA.

### 3.1 Admin

| | |
|--|--|
| **Flag** | `is_admin = true` |
| **Who** | Platform operators / owners |
| **Can** | Full **Admin** UI; approve / reject / delete access requests; grant or revoke Event Manager, dashboard, and admin flags; manage approved email domains; unrestricted event lists (bypass allowlists); always access production dashboard; satisfy many admin API routes with their session (without sharing `ADMIN_KEY`) |
| **Cannot be demoted carelessly** | Last approved admin cannot be deleted |
| **Bootstrap** | First access request when no admin exists is auto-approved as Admin |

Frontend: `canAccessAdmin(user)` → also implies Access Manager and dashboard access.

### 3.2 Event Manager

| | |
|--|--|
| **Flag** | `is_event_manager = true` (and usually `is_admin = false`) |
| **Who** | Trusted staff who manage people access without full system ops |
| **Can** | Open **Access Manager** (approve / reject users); same user-access workflows admins use for onboarding; use the app as a normal show user once approved |
| **Cannot** | Full Admin UI / dangerous platform ops reserved for admins; not an admin just because they manage access |
| **Granted by** | An Admin toggles “Event manager” on an approved user (Admin page) |

Frontend: `canAccessAccessManager(user)` → true for Event Managers **and** Admins. Nav may show Access Manager for managers who are not admins.

### 3.3 Regular user

| | |
|--|--|
| **Flags** | Approved, `is_admin = false`, `is_event_manager = false` |
| **Who** | Typical show crew / producers / clients using the Run of Show app |
| **Can** | Sign in; see events they are allowed to see; open shows; choose a **per-event** role (VIEWER / OPERATOR / EDITOR); edit or operate only as the UI role allows |
| **Cannot** | Access Manager; Admin UI; manage other users’ approval |
| **Optional extras** | `dashboard_enabled` may be turned on by an Admin so they can use `/dashboard` without becoming Admin or Event Manager; event allowlist rows may limit which events they see |

This is the default account type after an Admin (or Event Manager) **approves** a pending request without promoting them.

### 3.4 How the three types relate

```text
                    ┌─────────────┐
                    │   Admin     │  full platform + Access Manager + dashboard
                    └──────┬──────┘
                           │ can grant
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      Event Manager   Regular user   (optional flags)
      Access Manager  show work only  e.g. dashboard_enabled
      only            + in-show role
```

| Account type | Access Manager | Admin UI | Production dashboard | Use shows (after approval) |
|--------------|----------------|----------|----------------------|----------------------------|
| **Admin** | Yes | Yes | Always | Yes (all events) |
| **Event Manager** | Yes | No | Only if `dashboard_enabled` | Yes (allowlist rules apply) |
| **Regular user** | No | No | Only if `dashboard_enabled` | Yes (allowlist rules apply) |

### 3.5 Supporting gates (apply across types)

| Gate | Mechanism | Notes |
|------|-----------|--------|
| **Pending / approved / rejected** | `status` | Must be approved before any of the three types can use the SPA |
| **Production dashboard** | `dashboard_enabled` | Admins always allowed; others only if flagged |
| **Event allowlist** | `api_user_event_access` | If rows exist for a user, only those events; empty = all events; **Admins unrestricted** |
| **Approved email domains** | `admin_approved_domains` | Who may request access; empty list = allow all domains |

Frontend helpers:

- `canAccessAdmin` → Admin only  
- `canAccessAccessManager` → Admin **or** Event Manager  
- `canAccessProductionDashboard` → Admin **or** `dashboard_enabled`

### 3.6 Ops / break-glass (`ADMIN_KEY`)

Separate from the three **user account types**. Env **`ADMIN_KEY`** on Railway unlocks `/api/admin/*` (header `X-Admin-Key`, Bearer, or legacy `?key=` for some scripts). Optional Admin UI color puzzle (`ADMIN_PUZZLE_COLORS`). Production expects `ADMIN_KEY` to be set.

---

## 4. Per-event show roles (VIEWER / OPERATOR / EDITOR)

These apply **inside a show** for any approved account type (Admin, Event Manager, or Regular user). An Admin who opens a show can still pick VIEWER / OPERATOR / EDITOR for that session’s UI behavior.

Chosen when launching or joining a show (`RoleSelectionModal` and related flow). Stored in **localStorage** (and may be mirrored to `user_sessions` / Socket presence as `userRole`).

| Role | Intended UI behavior |
|------|----------------------|
| **VIEWER** | Read-only; blocked from schedule/content edits in the UI |
| **OPERATOR** | In-show timing / cue-duration style control; **not** full editorial content fields (program, segment, shot, notes, PPT, Q&A, etc.) |
| **EDITOR** | Full content and settings editing; participates in change logging |

### Important limitation (document this clearly)

**These roles are enforced in the client UI, not as a hard server authorization model.**  
A holder of an approved API session (or an open anonymous API if lockdown is off) can call the same REST save/timer endpoints regardless of VIEWER vs EDITOR. Treat VIEWER/OPERATOR/EDITOR as **operational / presence roles**, not cryptographic authorization.

Related collaborative feature: **per-row edit locks** (Socket.IO) reduce overwrite races between concurrent editors; they are not a substitute for role ACLs.

---

## 5. API authentication & lockdown

### 5.1 Credentials the API accepts

| Credential | Prefix / shape | Purpose |
|------------|----------------|---------|
| Neon API session | `ros_nsess_*` | Web app users after login |
| Legacy session | `ros_sess_*` | Older `api_users` path if Neon Auth URL unset |
| Integration token | `ros_itok_*` | Companion / automation; scoped (`read`, `control`, `write`, `admin`, `backup:export`, optional event bind) |
| Neon JWT / session | Alternative resolve path | JWKS / get-session fallbacks in middleware |
| Admin key | Shared secret | Ops admin routes |

### 5.2 `REQUIRE_API_AUTH` (Railway env)

| Value | Behavior |
|-------|----------|
| **`none`** (default) | Backward compatible; many routes remain callable without a token when legacy public API is allowed |
| **`writes`** | Mutating methods need a valid Bearer (with listed exceptions) |
| **`all`** | Non-public `/api/*` need a token |

**Always / intentionally more open examples:**

- Auth bootstrap paths (login, request-access, domain check, etc.)
- Graphics XML/CSV caches and some public schedule feed reads
- Selected LED / companion-style public exceptions as coded in `lib/api-auth.js`

Related flag: `ALLOW_LEGACY_PUBLIC_API` (defaults true when require = `none`).

### 5.3 Other controls present today

- Helmet on the API
- Auth rate limiting (`lib/auth-rate-limit.js`) — typically on in production
- Password policy on setup/register-style paths
- Login security email alerts / ops alerts (unauthorized API, bad admin key)
- Timing-safe compare for `ADMIN_KEY`
- Netlify SPA security headers
- Per-row edit locks + schedule version OCC (concurrency / data integrity, not identity)

---

## 6. Socket.IO, presence, and graphics

| Channel | Auth posture today |
|---------|-------------------|
| **Socket.IO** (presence, timers, row locks) | Handshake is **not** Bearer-authenticated like REST. Clients self-report identity/role on join events. Trust boundary is weaker than REST under lockdown. |
| **Graphics / XML / CSV feeds** | Often **public by design** for vMix / Singular / external tools, even when `REQUIRE_API_AUTH=all`. Treat feed URLs as shareable-capability URLs. |
| **HTTP CORS** | Configured permissively (`origin: true` style) — document as a residual risk if writing a threat model. |
| **Socket CORS** | Allowlist of origins (may include placeholders; must match real Netlify host in production). |

---

## 7. Suggested narrative for a formal document

Use this outline when writing the external / auditor / client-facing version:

1. **Purpose & scope** — Web app + Railway API + Neon; exclude offline hardware tools unless in scope.
2. **Identity provider** — Neon Auth (Better Auth); credentials verified server-side via Railway.
3. **Authorization layers**
   - Layer A: Account approval (`pending` / `approved`)
   - Layer B: **Platform account types** — Admin, Event Manager, Regular user (+ optional dashboard / event allowlist / domains)
   - Layer C: API lockdown (`REQUIRE_API_AUTH`) + integration token scopes
   - Layer D: In-show roles (VIEWER / OPERATOR / EDITOR) — UI only; state residual risk
4. **Account types in detail** — who is Admin vs Event Manager vs Regular user; what each can do (§3)
5. **Session model** — Bearer token lifecycle, logout, storage location
6. **Break-glass ops** — `ADMIN_KEY` (not the same as Admin user accounts)
7. **Integrations** — Scoped tokens vs public graphics
8. **Data protection** — Neon TLS, env secrets on Railway/Netlify, no secrets in git (`.env` ignored)
9. **Threats & residual risks** — §8 below
10. **Operational procedures** — Approving Regular users, promoting Event Managers / Admins, domain list, rotating keys, enabling lockdown

---

## 8. Residual risks & honesty checklist

Call these out explicitly in any formal security write-up:

| Topic | Current posture |
|-------|-----------------|
| Default API lockdown | Off (`REQUIRE_API_AUTH=none`) unless operators enable it |
| In-show roles | Not server-enforced |
| Socket presence / locks | Not Bearer-bound to approved sessions |
| Graphics feeds | Public by design |
| Token storage | `localStorage` (XSS risk) |
| CORS (HTTP) | Permissive |
| Admin key in query string | Legacy `?key=` still supported for some tooling |
| Dual backends | Localhost API vs Railway = separate identity/presence universes |

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **Admin** | Platform account (`is_admin`); full Admin UI + Access Manager |
| **Event Manager** | Platform account (`is_event_manager`); Access Manager only, not full Admin |
| **Regular user** | Approved account with neither flag; show work only (Admin UI label: **User**) |
| **Neon Auth** | Hosted Better Auth identity for email/password users |
| **`api_user_access`** | App’s approval + privilege row per user |
| **`ros_nsess_*`** | Railway-issued API session token for the SPA |
| **Access Manager** | UI for approving users; Admins + Event Managers |
| **Integration token** | Scoped automation credential (`ros_itok_*`) |
| **VIEWER / OPERATOR / EDITOR** | Per-event UI roles for the Run of Show page (any account type) |
| **OCC** | Optimistic concurrency on schedule saves (`version` column) |

---

## 10. Quick reference — “who can do what”

| Action | Public | Pending | Regular user | Event Manager | Admin | ADMIN_KEY |
|--------|--------|---------|--------------|---------------|-------|-----------|
| Request access / domain check | Yes | — | — | — | — | — |
| Sign in (Neon login) | Yes | Yes | Yes | Yes | Yes | — |
| Use full SPA | No | No | Yes | Yes | Yes | — |
| Open shows / pick VIEWER·OPERATOR·EDITOR | No | No | Yes | Yes | Yes | N/A |
| Approve / reject users (Access Manager) | No | No | No | Yes | Yes | Via admin API |
| Grant Event Manager or Admin flags | No | No | No | No | Yes | Via admin API |
| Full Admin UI / domains / dangerous ops | No | No | No | No | Yes | Yes |
| Production dashboard | No | No | If `dashboard_enabled` | If `dashboard_enabled` | Always | Via admin paths as configured |
| Bypass event allowlist | No | No | No | No | Yes | N/A |
| Mutate API without token | Often yes* | — | — | — | — | — |

\* Until `REQUIRE_API_AUTH` is raised and legacy public API disabled.

---

*Generated as an internal source overview from the ROS-5.0 codebase. Update this file when auth migrations or lockdown defaults change.*
