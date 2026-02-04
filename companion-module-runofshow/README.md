# companion-module-runofshow

Bitfocus Companion v3 module for Run of Show (ROS). Controls your ROS schedule via HTTP – no Electron or Python app required.

## Features

- **Load Cue** – Load any cue/row from the schedule
- **Start / Stop / Reset Timer** – Full timer control
- **Variables** – Current cue, segment name, timer state
- **Feedbacks** – Timer running, cue loaded

## Installation

### Option A: Developer module path

1. Set Companion's **Developer** → **Module path** to the **parent folder** that contains `companion-module-runofshow`.  
   Example: if the module is at `C:\...\ROS-5.0\companion-module-runofshow`, set the path to `C:\...\ROS-5.0`.

2. Ensure `companion/manifest.json` exists (required for Companion v3 to detect the module).

3. From the module folder, run:
   ```bash
   yarn install   # or: npm install
   yarn package   # or: npx companion-module-build
   ```
   (Requires Node.js 22+ and Yarn 4, or use npm.)

4. Restart Companion and add the "Run of Show" module.

### Option B: Import as package

1. From the module folder: `yarn install` then `yarn package` (or `npx companion-module-build`).
2. In Companion: **Modules** → **Import module package** → choose the generated `.tgz` file.

## Configuration

- **API Base URL**: Default `https://ros-50-production.up.railway.app`
- **Event ID**: From your Run of Show web app (Events list)
- **Day**: 1–10 for multi-day events

## API

This module calls the Run of Show Railway API directly:

- `GET /api/calendar-events` – List events
- `GET /api/run-of-show-data/:eventId` – Schedule/cues
- `GET /api/active-timers/:eventId` – Current timer state
- `POST /api/cues/load` – Load cue
- `POST /api/timers/start` – Start timer
- `POST /api/timers/stop` – Stop timer
- `POST /api/timers/reset` – Reset timer

## License

MIT
