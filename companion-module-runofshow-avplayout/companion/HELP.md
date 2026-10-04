# AV-Playout Sync (ROS)

Sync Run of Show countdown timers from **SINOR AV-Playout** (CasparCG) playback.

## Setup

1. Run AV-Playout (default `http://127.0.0.1:8080`) with CasparCG connected (green Caspar lamp).
2. In this module: set **API Base URL** (Railway), **Event ID**, **Day**, and **AV-Playout host/port**.
3. Arm a cue — module loads the ROS cue, calls `avplayout-arm`, and listens on AV-Playout `/ws` for telemetry.
4. When Caspar plays, `position` + `duration` → one-shot `avplayout-sync-align` so the ROS clock tracks remaining time.

## Cue number

**AV-Playout cue index** is 1-based in the current project rundown (same as Companion Generic HTTP `?index=N`).
