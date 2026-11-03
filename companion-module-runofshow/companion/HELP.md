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

### DSM + Ross Talk
- **DSM · Full / LED / VID / PPT** – Sets DSM Clock layout and sends the matching Ross Talk TCP command (if Ross Talk is enabled in module settings).
- Enable **Ross Talk**, set host/port, and paste the four command strings your switcher expects.
- With **Send on cue load** ON, loading a cue that has the ROS **DSM** column checkbox enabled automatically sends that row’s mode (from ROS, OSC, or Companion Load Cue).

## Variables

- **Current Cue** – The cue label of the loaded item.
- **Current Segment Name** – The segment name of the loaded item.
- **Timer Running** – "Yes" or "No".
- **Event Name** – The name of the selected event.
- **Last DSM mode** – full / led / vid / ppt.
- **Last Ross Talk status** – ok / error / disabled.

## Feedbacks

- **Timer Running** – True when the timer is running.
- **Cue Loaded** – True when a cue is loaded.

## Getting the Event ID

1. Open the Run of Show web app.
2. Go to the Events list.
3. The event ID is in the URL when you open an event, or you can inspect the event object. It's typically a UUID or numeric ID.
