# Companion Module — AV-Playout Sync (ROS)

Sync Run of Show timers from **SINOR AV-Playout** (CasparCG), or run AV-Playout transport directly without picking a ROS cue.

## Direct transport (no cue / layer select)

| Action | What it does |
|--------|----------------|
| **AV Direct: Play / Fire** | `POST /api/transport/play` — current cue, or optional 1-based index |
| **AV Direct: Pause** | `POST /api/transport/pause` |
| **AV Direct: Resume** | `POST /api/transport/resume` |
| **AV Direct: Stop** | `POST /api/transport/stop` (+ optional clear) |
| **AV Direct: Load** | Cue up current / index without taking |
| **Arm (current)** | Uses loaded ROS cue if present; otherwise AV-only arm + optional fire |
| **Send Time** | Pushes live AV remaining/duration to the armed or loaded ROS cue |

Event ID is optional for direct Play / Pause / Stop. Send Time needs Event ID + a loaded/armed ROS cue.

## ROS sync flow

1. **Arm AV-Playout sync** — loads ROS cue, `POST /api/timers/avplayout-arm`, connects to AV-Playout `/ws`.
2. Optionally fires AV-Playout cue via `POST /api/transport/play { index }`.
3. WebSocket telemetry (`position` + `duration`) → `POST /api/timers/avplayout-sync-align`.
4. ROS / Clock countdown locks to remaining time (`duration - position`).

## Config

| Field | Default |
|-------|---------|
| API Base URL | Railway production |
| Event ID / Day | From ROS URL (optional for direct transport) |
| AV-Playout host | `127.0.0.1` |
| AV-Playout port | `8080` |

Caspar **Live** lamp in AV-Playout must be green (OSC telemetry) for remaining time to update.
