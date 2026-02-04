# ROS OSC Control (Python – Electron-style)

Python Tkinter app that mirrors the **Electron ROS OSC Control** flow:

- **No sign-in** – events load directly from the API
- **Upcoming / Past** – filter events by date (tabs like the Electron app)
- **Click to load** – select an event and click **Load Event** (or double-click the row) to open it and control Run of Show

## Flow

1. **Event list** – Choose **Upcoming** or **Past**, then pick an event.
2. **Load event** – Click **Load Event** or double-click the event row.
3. **Run of Show** – View schedule, change day, use OSC; log in the bottom panel.
4. **Back to Events** – Return to the event list without signing out.

## Requirements

- Python 3.8+
- `requests`, `python-socketio` (see `requirements.txt`)

## Setup

```bash
cd ros-osc-python-app
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Or use:

- **Windows:** `run.bat`
- **Mac/Linux:** `./run.sh`

## API / Server

- Default API: `https://ros-50-production.up.railway.app`
- Override with env: `API_BASE_URL=http://localhost:3002 python app.py`

## OSC (same port as Electron)

- OSC server runs on port **57121** (UDP), same as the Electron app so you can use either app interchangeably with the same OSC clients.
- Override with env: `OSC_LISTEN_PORT=57121` (default is 57121).
- Same commands as the Electron app: `/set-event`, `/cue/<name>/load`, `/timer/start`, `/timer/stop`, `/timer/reset`, `/timer/adjust/+1`, `/timer/adjust/-1`, `/timer/adjust/+5`, `/timer/adjust/-5`, `/subtimer/cue/<n>/start`, `/subtimer/cue/<n>/stop`, `/set-day`, `/get-day`, `/status`, etc.

## Differences from `websocket-python-osc`

- No Authentication tab; events load on startup.
- Upcoming vs Past filter instead of a single list.
- Single “Load Event” action (or double-click) to open an event, then Run of Show view with Back to Events.
