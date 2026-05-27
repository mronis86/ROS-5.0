# Run of Show – Resolume (experimental)

Separate Companion module for testing **Resolume clip playback → ROS timer sync** without changing the production `companion-module-runofshow` module.

## What it does

1. **Arm Resolume sync** – loads a ROS cue and listens for OSC from Resolume.
2. When the armed clip plays, the module infers clip duration from the first ~120ms of normalized position (0–1).
3. Sends **one** HTTP call to `POST /api/timers/resolume-sync-align` with inferred duration + remaining time.
4. ROS clients receive `timerUpdated` over WebSocket with `time_source: 'resolume'` and count down locally (no per-tick HTTP).

## Setup

### 1. Companion module path

Point **Developer → Module path** at the **parent folder** that contains both modules:

```text
C:\Users\audre\OneDrive\Desktop\ROS-5.0
```

You should see **Run of Show** and **Run of Show (Resolume)** as separate instances.

### 2. Install dependencies

```bash
cd companion-module-runofshow-resolume
npm install
```

Restart Companion after install.

### 3. Resolume OSC output

On the **media server**, configure Resolume OSC output to send to the **Companion PC IP** (not localhost on the media PC):

- **Target IP:** Companion machine on your LAN  
- **Target port:** same as **OSC listen port** in module config (default **7002**)

Add outputs for the layer/clip you arm, at minimum:

- `/composition/layers/{layer}/clips/{clip}/transport/position`
- `/composition/layers/{layer}/clips/{clip}/connect` (optional; helps detect play)

Layer and clip numbers must match the **Arm Resolume sync** action options.

### 4. API

Deploy or run `api-server.js` with the new endpoints:

- `POST /api/timers/resolume-sync-align`
- `POST /api/timers/resolume-end`

## Test without Resolume

Use **Manual Resolume align** with duration + remaining seconds to verify the API path before wiring OSC.

## Rollback

Disable or delete this module instance in Companion. The original **Run of Show** module is unchanged.
