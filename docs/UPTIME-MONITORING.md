# External uptime monitoring (Railway `/health`)

Outside watcher that hits the API health endpoint and emails you if it fails. Complements in-app Admin → Services and ops alert emails.

## Endpoints

| URL | Use | Neon query? |
|-----|-----|-------------|
| `GET /health` | **UptimeRobot** — API process is up | **No** |
| `GET /health/deep` | Admin Services, manual DB checks | Yes (`SELECT 1`) + Upstash ping |

Both return JSON with `status: "healthy"` when OK (keyword monitoring can look for `healthy`).

## Free setup (UptimeRobot)

1. Create a free account at [https://uptimerobot.com/](https://uptimerobot.com/).
2. **Add New Monitor**
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** `ROS Railway API health` (or similar)
   - **URL:** `https://ros-50-production.up.railway.app/health`  
     (If you use a different Railway host, use that host + `/health` — **not** `/health/deep`.)
   - **Monitoring Interval:** 5 minutes (free tier)
3. Optional: **Keyword** monitoring — look for `healthy` so a bare HTTP 200 with the wrong body still alerts.
4. **Alert Contacts:** your email (confirm the activation link).
5. Save. Wait for the first green check.

Optional second monitor on `/health/deep` every 15–30 minutes if you want external alerts when Neon is down but Railway is still up.

## What it does / does not do

| Does | Does not |
|------|----------|
| Email when the API process is unreachable | Query Neon on every ping (live `/health` only) |
| Tiny outbound responses (~negligible Railway egress) | Replace in-app Admin health or Resend ops alerts |
| Keep Railway awake if you use short intervals | Watch Netlify or Resend separately (Admin adds those) |

If Railway sleeps when idle, pings keep it awake — usually desirable for a show API.

## Related

- Admin → **Services** section (uses `/health/deep` from the browser)
- Admin → **Platform maintenance** (Node EOL / version planning)
- `docs/INFRASTRUCTURE-AND-SECURITY.md` — architecture overview
