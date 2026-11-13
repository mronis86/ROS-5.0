# Run of Show (ROS)

Control your Run of Show schedule directly from Bitfocus Companion. No Electron or Python app required – this module talks to your Railway API natively.

## Configuration

- **API Base URL**: Your Run of Show API (default: https://ros-50-production.up.railway.app)
- **Event ID**: Paste the event ID from the Run of Show web app (Events list). Copy it from the URL or event details.
- **Day**: Day number for multi-day events (1–10).

## Actions

### Main Timer
- **Load Cue** – Select a cue/row from the schedule and load it as the active cue.
- **Start Timer** – Start the timer for the currently loaded cue.
- **Stop Timer** – Stop the running timer.
- **Reset Timer** – Reset all timers for the event (clears loaded cue, timers, etc.).

### Sub-Timers (like OSC `/subtimer/cue/5/start` and `/subtimer/cue/5/stop`)
- **Start Sub-Timer** – Start a sub-timer for an indented cue (select cue from dropdown).
- **Stop Sub-Timer** – Stop a sub-timer. Choose a specific cue or "All sub-timers" to stop all.

### Timer Duration Adjust
- **Timer +1 min** – Add 1 minute to the active timer duration.
- **Timer -1 min** – Subtract 1 minute from the active timer duration.
- **Timer +5 min** – Add 5 minutes to the active timer duration.
- **Timer -5 min** – Subtract 5 minutes from the active timer duration.

### LED Text Graphics
- **LED Clear Output** – Clears the transparent LED output page for this event (same as **Clear Output** on the LED Layouts page). All connected `/led-output` browser sources hide their content.

### DSM

Two separate paths — do not mix them on the same Companion button:

**Layout overrides (manual only)**
- **DSM · 16:9** and **DSM · Full** only change the DSM Clock frame. They never press PPT / LED / VIDEO still buttons.

**Still buttons (PPT / LED / VIDEO)**
- In module settings, set **page / row / column** for LED, VID, and PPT. Put Ultrix / ATEM / vMix / OBS / Ross Talk on those buttons.
- Press the **DSM · PPT / LED / VIDEO** presets anytime from Companion (dry-run / override).
- Or auto-press when a schedule row has the **DSM checkbox** and that cue is **loaded** (with **Press DSM still on cue load** ON). Row mode **Full** updates clock layout only — no still press.
- **Do not** put ROS DSM still actions on those same Ultrix/ATEM buttons — nesting double-fires.
- **Do not** also Trigger from `dsm_fire` / `dsm_mode` onto the same buttons if cue-load press is ON.
- Enable Companion **HTTP Server** (default `http://127.0.0.1:8000`). Rows/columns are usually **0-based**.

## Variables

- **Current Cue** – The cue label of the loaded item.
- **Current Segment Name** – The segment name of the loaded item.
- **Timer Running** – "Yes" or "No".
- **Event Name** – The name of the selected event.
- **dsm_mode** – led / vid / ppt / full / 16x9.
- **dsm_fire** – increments on still presses (not on 16:9/Full layout overrides).
- **dsm_source** – manual, cue_load, or layout_override.

## Feedbacks

- **Timer Running** – True when the timer is running.
- **Cue Loaded** – True when a cue is loaded.

## Getting the Event ID

1. Open the Run of Show web app.
2. Go to the Events list.
3. The event ID is in the URL when you open an event, or you can inspect the event object. It's typically a UUID or numeric ID.
