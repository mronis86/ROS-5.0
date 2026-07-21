# Offline ROS resilience plan

Planning note for strengthening the local ROS fallback during beta testing.

## Recommendation

Do **not** rewrite the core timer math unless testing reveals measurable drift.
The current LAN model—local server, SQLite, Socket.IO, and anchored
`started_at` time—is suitable for show countdowns.

Prioritize reliable failover, clear reconnect ownership, periodic time
resynchronization, and rehearsals. These improve offline operations without
adding an Ontime-style server tick engine.

## Implementation order

### 1. Explicit offline-first failover

- Present one clear operating mode: **Cloud connected** or **LAN-only**.
- If Railway or the internet becomes unavailable, make switching to LAN
  obvious and avoid requiring operators to search through settings.
- When cloud connectivity returns, show a prominent **Back online / Sync?**
  prompt.
- Do not silently replace an active local cue with stale cloud state.

### 2. Define reconnect authority

- Document and enforce which system wins after an outage.
- Proposed rule: once the show has continued in LAN-only mode, the **local
  live timer and local show state are authoritative** until an operator
  explicitly approves synchronization.
- Prevent dual-master behavior where cloud and local systems both believe
  they own the live timer.
- Preserve local `started_at` and active timer state when pushing back to
  cloud.

### 3. Refresh server time periodically

- Re-request or rebroadcast `serverTime` periodically while connected.
- Refresh it on Socket.IO reconnect, browser tab focus, and device wake.
- Keep using the existing `started_at` + clock-offset model; this is a small
  hardening measure, not a timer-engine rewrite.
- Record offset changes during testing so unusual device-clock drift is
  visible.

### 4. Maintain and rehearse a practice kit

- Keep a current `offline-show.zip` on the designated show laptop.
- Pull the event locally before the show and verify it opens without cloud
  access.
- Run a drill with Wi-Fi/internet disabled and, where relevant, both network
  adapters tested.
- Start, stop, adjust, and display timers from a second LAN device.
- Restore connectivity and rehearse the reconnect/sync decision.
- Record the drill date and any gaps found.

### 5. Keep OBS and display URLs current

- Use the current Netlify URL while cloud-connected or the show laptop's
  `http://<LAN-IP>:3004` URL while LAN-only.
- Enable OBS **Shutdown source when not visible** where appropriate.
- Remove stale Netlify URLs from browser sources.
- This prevents obsolete clients from polling protected cloud routes and
  generating misleading unauthorized-API alerts.

## Later, only if testing shows a need

### Back off after HTTP 401 responses

Stop or substantially slow repeated polling after authentication fails.
This reduces alert noise and wasted requests; it does not improve timer
accuracy.

### Fill LAN API gaps

Audit cloud routes used by the offline UI and implement missing local
equivalents. The known example is duration adjustment if it still depends on
the cloud route.

### One-way export to stock Ontime

Consider a ROS-to-Ontime export only if the team still needs Ontime as an
independent familiar fallback. Treat it as a one-way snapshot, not live
two-way synchronization.

### Ontime-style high-frequency server tick

A roughly 32 ms server tick and full playback state machine would be a major
architecture change. It is probably unnecessary unless rehearsals show that
the existing anchored wall-clock model cannot meet an identified timing
requirement.

## Beta acceptance checks

- A prepared event opens and runs with internet disabled.
- Two LAN clients remain aligned during a long-running timer.
- Browser focus/sleep/reconnect does not leave a visibly stale clock.
- Loss of Railway does not stop the active local timer.
- Reconnecting does not overwrite local live state without confirmation.
- The operator can clearly identify whether cloud or LAN is authoritative.
- OBS/browser displays stop polling when unused and use current URLs.

## Related

- [SHOW-DOWN-RUNBOOK.md](./SHOW-DOWN-RUNBOOK.md)
- [RECOVERY_GUIDE.md](./RECOVERY_GUIDE.md)
- [`offline-show/README.md`](../offline-show/README.md)
