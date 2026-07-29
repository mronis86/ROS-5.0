# ROS vMix DataSource Bridge

Portable Electron app that watches the **loaded / running cue** on Railway and selects the matching **row** in one or more **vMix Data Sources**.

It does **not** replace your XML/CSV feeds. vMix still pulls table data from Railway (or Sheets). This bridge only calls vMix `DataSourceSelectRow` when the cue changes.

## Requirements

- Windows (portable `.exe` via electron-builder)
- vMix with Web Controller / API enabled (default `http://127.0.0.1:8088`)
- Railway ROS API (`https://ros-50-production.up.railway.app`)
- Integration token with **`read`** scope (Admin → Integration tokens), when `REQUIRE_API_AUTH` is enabled

## Setup

1. Point a vMix Data Source at your ROS **schedule** XML or CSV feed (same event), e.g. Railway `/api/schedule.xml?eventId=…` or the Netlify live HTML/XML pages.
2. Create an integration token with `read` in Admin.
3. Run this app:
   - Double-click **`START.bat`** in `vmix-datasource-bridge\` (recommended), or
   - `launcher\start-ros-vmix-datasource.bat`, or
   - `npm start`, or
   - the portable `.exe` after `build-portable.bat`
4. Enter API URL + token, pick the event, test vMix, choose Data Source name(s).
5. In the **Sources** tab, add one binding per Data Source (and per Excel/Google **sheet** if needed). Use **Add sheet (same source)** to target another worksheet without re-picking the workbook.
6. Choose match mode per binding (Cue column or Row index). Disable a binding with the **On** checkbox without deleting it.
7. Click **Start**. Load a cue in ROS — the **Live** tab shows each source’s selected index.

## Launchers (Windows)

| File | Purpose |
|------|---------|
| `START.bat` | Start the Electron app (installs deps on first run) |
| `launcher\start-ros-vmix-datasource.bat` | Same start script |
| `launcher\create-desktop-shortcut.bat` | Desktop shortcut with app icon (pin to taskbar/Start) |
| `install-dependencies.bat` | `npm install` only |
| `build-portable.bat` | Build `dist\ROS-vMix-DataSource-Bridge-*-portable.exe` |

The window and portable `.exe` use `build\icon.ico`. For a desktop icon like Offline Show, run **`launcher\create-desktop-shortcut.bat`** once.

## Match modes

| Mode | Behavior |
|------|----------|
| Cue column | Normalize cue text (`CUE 12` ≈ `12`), find matching schedule item, select that index in vMix |
| Row index | `schedule_items.findIndex(id === item_id)` → that zero-based index |

Optional **day filter** on a binding limits which schedule rows are considered (must match how the feed is filtered).

## Dev

```bash
cd vmix-datasource-bridge
npm install
npm start
```

Or double-click `START.bat`.

Config is stored under `%LOCALAPPDATA%\ros-vmix-datasource\`.

## Portable build

```bash
cd vmix-datasource-bridge
npm install
npm run build:portable
```

Or double-click `build-portable.bat`.

Output: `dist/ROS-vMix-DataSource-Bridge-0.1.0-portable.exe`

## Notes

- Socket.IO uses `joinEvent` (same as Spout / web app). Polling `GET /api/active-timers/:eventId` is a fallback.
- Selection runs on `loaded` and `running`. Stopping a timer does **not** clear the Data Source row.
- If Data Source names do not appear from the vMix API XML, type the exact name from vMix’s Data Sources manager.
- Excel Data Sources may need a **table/sheet** name in the binding; XML/CSV usually leave it blank (`Name,,index`).
