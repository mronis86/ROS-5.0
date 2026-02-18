# Plan: User Domain Admin Auth

**Feature:** Approved email domains—only users whose email domain is in the Admin-controlled list can sign in. Others are rejected.

**Status:** Plan (not yet implemented)  
**Estimated effort:** 4–6 hours

---

## Overview

| Component | Purpose |
|-----------|---------|
| **admin_approved_domains** table | Stores allowed domains (e.g. `company.com`, `partner.org`) |
| **Admin API** | CRUD for domains (protected by `?key=1615`) |
| **Public API** | `POST /api/auth/check-domain` — checks email domain without requiring login |
| **Admin UI** | Section in Admin page to add/remove domains |
| **Auth flow** | Before sign-in, validate email domain; reject if not in list |

**Empty list behavior:** If no domains are configured, **allow all** (backward compatible).

---

## Phase 1: Database

### Migration 024: `admin_approved_domains` table

**File:** `migrations/024_create_admin_approved_domains.sql`

```sql
-- Approved email domains for sign-in. Managed by Admin.
-- Empty table = allow all (backward compatible).

CREATE TABLE IF NOT EXISTS public.admin_approved_domains (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_approved_domains_domain
  ON public.admin_approved_domains (LOWER(domain));

COMMENT ON TABLE public.admin_approved_domains IS 'Domains allowed to sign in; empty = allow all';
```

**Action:** Run this migration on Neon (same DB as `NEON_DATABASE_URL`).

---

## Phase 2: API Endpoints

### 2.1 Public: `POST /api/auth/check-domain`

**Purpose:** Check if an email's domain is allowed (called before sign-in, no auth required).

**Request:**
```json
{ "email": "user@company.com" }
```

**Response (allowed):**
```json
{ "allowed": true }
```

**Response (rejected):**
```json
{ "allowed": false, "message": "Your email domain is not on the approved list. Contact an administrator." }
```

**Logic:**
1. Extract domain from email: `email.split('@')[1]?.toLowerCase()`
2. If invalid email → `{ allowed: false, message: "Invalid email" }`
3. If `admin_approved_domains` is empty → `{ allowed: true }`
4. Else query: `SELECT 1 FROM admin_approved_domains WHERE LOWER(domain) = $1`
5. Return `{ allowed: true }` if found, else `{ allowed: false, message: "..." }`

**Security:** Public endpoint; only returns `allowed` and a generic message—never the list of domains. Consider rate limiting.

---

### 2.2 Admin: `GET /api/admin/approved-domains?key=1615`

**Purpose:** List approved domains (Admin only).

**Response:**
```json
{
  "domains": ["company.com", "partner.org"]
}
```

---

### 2.3 Admin: `POST /api/admin/approved-domains?key=1615`

**Purpose:** Add a domain.

**Request:**
```json
{ "domain": "company.com" }
```

**Response:**
```json
{ "ok": true, "domains": ["company.com", "partner.org"] }
```

**Logic:** Normalize to lowercase, trim, validate format (no spaces, has at least one dot), insert or ignore duplicate.

---

### 2.4 Admin: `DELETE /api/admin/approved-domains/:domain?key=1615`

**Purpose:** Remove a domain. URL-encode the domain (e.g. `company.com`).

**Response:**
```json
{ "ok": true, "domains": ["partner.org"] }
```

---

## Phase 3: Frontend

### 3.1 Auth service (`src/services/auth-service.ts`)

**Change in `signIn(email, fullName)`:**

1. Call `POST /api/auth/check-domain` with `{ email }` (use `getApiBaseUrl()` from `api-client`).
2. If `allowed: false` → return `{ error: { message: response.message || "Domain not approved" } }` and stop.
3. If network/API error → optionally allow through (fail open) or reject (fail closed). **Recommend: fail closed** for security.
4. If `allowed: true` → continue with existing sign-in logic (create user, store in localStorage).

---

### 3.2 Auth modal (`src/components/AuthModal.tsx`)

- Already displays `result.error.message`; no structural change.
- Optional: add a small hint under the email field: “Your email domain must be on the approved list.”

---

### 3.3 Admin page (`src/pages/AdminPage.tsx`)

Add new section: **"Approved Email Domains"**

**UI:**
- List of current domains (e.g. chips or table rows)
- Input + "Add domain" button
- Delete button per domain
- Helper text: “Only users with these email domains can sign in. Empty = allow all.”

**State:**
- `approvedDomains: string[]`
- `approvedDomainsLoading`, `approvedDomainsError`
- `addDomainInput`, `addDomainLoading`

**Effects:**
- On unlock: fetch `GET /api/admin/approved-domains`
- Add: `POST /api/admin/approved-domains` with `{ domain: addDomainInput }`
- Remove: `DELETE /api/admin/approved-domains/:domain`

**Placement:** After Backup config section (or similar). Reuse existing Admin section styling (card, border, padding).

---

## Phase 4: Testing & Rollout

### Manual tests

1. **Empty list:** No domains → any email can sign in.
2. **With domains:** Add `company.com` → `user@company.com` succeeds, `user@gmail.com` fails.
3. **Case insensitivity:** `User@COMPANY.COM` should succeed.
4. **Admin UI:** Add/remove domains, verify list updates.
5. **Invalid domain:** Adding `notavaliddomain` → validation error or graceful handling.

### Deployment order

1. Run migration 024 on Neon.
2. Deploy API (with new endpoints).
3. Deploy frontend (with auth + Admin UI changes).

---

## File checklist

| File | Action |
|------|--------|
| `migrations/024_create_admin_approved_domains.sql` | Create |
| `api-server.js` | Add 4 routes (check-domain, admin GET/POST/DELETE) |
| `src/services/auth-service.ts` | Add domain check before sign-in |
| `src/pages/AdminPage.tsx` | Add Approved Domains section |
| `docs/PLAN-USER-DOMAIN-ADMIN-AUTH.md` | This plan |

---

## Optional enhancements (future)

- **Fail open vs fail closed:** Env var `DOMAIN_CHECK_FAIL_CLOSED=true` to decide behavior when API is unreachable.
- **Rate limiting:** Limit `POST /api/auth/check-domain` by IP to prevent abuse.
- **Audit log:** Log rejected sign-in attempts (email domain, timestamp) for Admin visibility.
