# AV-Playout Sync (ROS)

Control **SINOR AV-Playout** / CasparCG from Companion, and optionally sync remaining time into Run of Show.

## Direct control (standalone)

Use the **AV Direct** actions / presets when you are not tying playback to a specific ROS row:

- **Play / Fire** — fires the current AV cue (set index `0`), or a 1-based rundown index
- **Pause / Resume / Stop / Load** — transport only; no Event ID required
- **Arm (current)** — arms listening without picking a cue dropdown. If a ROS cue is already loaded, syncs to that row; otherwise AV-only
- **Send Time** — pushes live AV duration/remaining to the armed or currently loaded ROS cue (needs Event ID)

## ROS sync setup

1. Run AV-Playout (default `http://127.0.0.1:8080`) with CasparCG connected (green Caspar lamp).
2. In this module: set **API Base URL** (Railway), **Event ID**, **Day**, and **AV-Playout host/port**.
3. Arm a cue (or Arm current) — module listens on AV-Playout `/ws` for telemetry.
4. When Caspar plays, `position` + `duration` → `avplayout-sync-align` so the ROS clock tracks remaining time.

## Cue number

**AV-Playout cue index** is 1-based in the current project rundown. Use `0` for “current / selected” on direct Play / Load / Arm current.
