# Mid-show API down — short runbook

Use this if Railway/API fails **during a live show**. Goal: keep the show going, fix cloud later.

Health URL: `https://ros-50-production.up.railway.app/health`  
(Expect JSON with `"status":"healthy"`. UptimeRobot should email you if this fails.)

---

## 1. Confirm (1 minute)

- Open the health URL above (or check the UptimeRobot alert).
- If the Netlify app loads but timers/saves fail → treat as **API/Railway** problem.
- If the whole site is blank → also check Netlify status; still fall back for the show.

## 2. During the show — do not debug production

- Stop trying to “fix Railway” mid-cues.
- Switch to your **known fallback**:
  - **Previous / legacy run-of-show system** (if that is what you keep for redundancy), and/or
  - **Offline show** package / local workflow you already use when cloud is unavailable.
- Tell operators: cloud sync may be stale; run from the fallback as source of truth until after the event.

## 3. After the show

1. Re-check `/health` and Railway logs/dashboard.
2. Re-check Netlify deploy if the SPA was affected.
3. Confirm Neon/Upstash only if health still fails after Railway is up.
4. Restore normal ROS cloud workflow once health is green and a quick timer test works.
5. Note what failed (time, symptom, which fallback you used) for a short post-mortem.

## 4. What this is not

- Not a full disaster-recovery or code restore guide — see [RECOVERY_GUIDE.md](./RECOVERY_GUIDE.md) for git/backup recovery.
- Extended offline improvements are a **future** project; this page only documents the fallback you already intend to use.

## Related

- [UPTIME-MONITORING.md](./UPTIME-MONITORING.md) — free external monitor setup  
- Admin → **Services** — live status + uptime / Dependabot notes  
- [INFRASTRUCTURE-AND-SECURITY.md](./INFRASTRUCTURE-AND-SECURITY.md) — stack overview  
- [OFFLINE-RESILIENCE-PLAN.md](./OFFLINE-RESILIENCE-PLAN.md) — planned failover, reconnect, clock-sync, and rehearsal improvements
