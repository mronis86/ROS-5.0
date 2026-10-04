# Companion Module — AV-Playout Sync (ROS)

Sync Run of Show timers from **SINOR AV-Playout** (CasparCG) the same way Mitti / Resolume sync work.

## Flow

1. **Arm AV-Playout sync** — loads ROS cue, `POST /api/timers/avplayout-arm`, connects to AV-Playout `/ws`.
2. Optionally fires AV-Playout cue via `POST /api/transport/play { index }`.
3. WebSocket telemetry (`position` + `duration`) → `POST /api/timers/avplayout-sync-align`.
4. ROS / Clock countdown locks to remaining time (`duration - position`).

## Config

| Field | Default |
|-------|---------|
| API Base URL | Railway production |
| Event ID / Day | From ROS URL |
| AV-Playout host | `127.0.0.1` |
| AV-Playout port | `8080` |

Caspar **Live** lamp in AV-Playout must be green (OSC telemetry) for remaining time to update.
