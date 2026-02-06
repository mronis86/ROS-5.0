# companion-module-runofshow

Bitfocus Companion v3 module for Run of Show (ROS). Controls your ROS schedule via HTTP – no Electron or Python app required.

## Features

- **Load Cue** – Load any cue/row from the schedule
- **Start / Stop / Reset Timer** – Full timer control
- **Variables** – Current cue, segment name, timer state; plus **per-cue** label/value
- **Feedbacks** – Timer running, cue loaded, "loaded cue is (choice)"
- **Presets** – One preset per cue (auto-updates with Event ID); drag onto buttons for Load Cue + text + feedback

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
- **Sync interval (seconds)**: How often to fetch schedule/timer (5–600, default 60)

## Presets (drag and drop, auto-update by Event ID)

After you set **Event ID** and the module syncs, open the **Presets** tab in Companion. Under **Run of Show** → **Cues** you'll see one preset per cue (e.g. "CUE 1: Opening", "CUE 2: Keynote"). Preset button text is set to **CUE 1** or **CUE 1.1** (never just "1"). Each preset runs **Load Cue** for that cue and uses **Loaded cue is** feedback. Drag a preset onto a button to use it. The preset list updates when the schedule changes.

**Button text from cue (when not using presets):** Add the **Button text from cue** feedback to a button. Pick a **Cue** from the same dropdown as Load Cue, and **Show as**: **Cue** (e.g. CUE 1 or CUE 1.1) or **Segment** (e.g. Opening). The button text is set from that dropdown so you can show "CUE 1" or "Opening" without using a preset.

**Button text via variables (optional):** Use per-cue module variables in button text, or **Loaded cue is** feedback to style the button when that cue is loaded.

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
