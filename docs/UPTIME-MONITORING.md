# External uptime monitoring (Railway `/health`)

Outside watcher that hits the API health endpoint and emails you if it fails. Complements in-app Admin → Services and ops alert emails.

## Free setup (UptimeRobot)

1. Create a free account at [https://uptimerobot.com/](https://uptimerobot.com/).
2. **Add New Monitor**
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** `ROS Railway API health` (or similar)
   - **URL:** `https://ros-50-production.up.railway.app/health`  
     (If you use a different Railway host, use that host + `/health`.)
   - **Monitoring Interval:** 5 minutes (free tier)
3. Optional: **Keyword** monitoring — look for `healthy` so a bare HTTP 200 with the wrong body still alerts.
4. **Alert Contacts:** your email (confirm the activation link).
5. Save. Wait for the first green check.

## What it does / does not do

| Does | Does not |
|------|----------|
| Email when the API is unreachable or unhealthy | Replace in-app Admin health or Resend ops alerts |
| Tiny outbound responses (~negligible Railway egress) | Watch Netlify, Neon, or Upstash separately (add more monitors later if you want) |

If Railway sleeps when idle, pings keep it awake — usually desirable for a show API.

## Related

- Admin → **Services** section (live check from the browser)
- Admin → **Platform maintenance** (Node EOL / version planning)
- `docs/INFRASTRUCTURE-AND-SECURITY.md` — architecture overview
