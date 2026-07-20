# Mitti Sync (Run of Show)

Experimental Companion module: sync Run of Show timers from **Mitti** via OSC feedback.

## Actions

- **Arm Mitti sync** — load main cue, `mitti-arm`, listen for feedback
- **Arm Mitti sync (sub-cue)** — load parent, arm sub-cue
- **Disarm / End Mitti sync** — clear arm / release `time_source: mitti`
- **Manual Mitti align** — test API without OSC
- **Pull Mitti TRT into ROS cue duration** — select cue → read `currentCueTRT` → restore previous cue (for updated media files)
- **Load Cue / Stop Timer**

## Variables

- `$(ros-mitti:mitti_armed)`, `mitti_sync_status`, `mitti_cue_number`, `estimated_drift`, …

## Feedbacks

- Armed (purple), aligned (green), sync pulse (cyan 2s)

## Mitti setup

1. OSC Controls on (input **51000**).
2. OSC Feedback → Companion PC, port **51001**.
3. Set Event ID + API URL in module config.
4. Arm with matching Mitti cue number.

See [README.md](../README.md) for TRT pull details.
