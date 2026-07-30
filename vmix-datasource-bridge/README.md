# ROS vMix DataSource Bridge

Electron app that watches the **loaded / running cue** on Railway and selects the matching **row** in one or more **vMix Data Sources**.

It does **not** replace your XML/CSV feeds. vMix still pulls table data from Railway (or Sheets). This bridge only calls vMix `DataSourceSelectRow` when the cue changes.

## Requirements

- Windows + **Node.js 18+** (first run installs Electron via `npm install`)
- vMix with Web Controller / API enabled (default `http://127.0.0.1:8088`)
- Railway ROS API + integration token with **`read`** scope when auth is enabled

## Setup (show / vMix PC)

1. Copy the `vmix-datasource-bridge` folder (or unzip the Graphics download).
2. Double-click **`START.bat`** (installs deps on first run, then opens the app).
3. Connections: API URL + token, pick event, **Test vMix**.
4. Sources: type the **exact Data Source name** from vMix Data Sources Manager  
   (vMix usually does **not** list Data Sources in its web API).
5. Sheet blank for XML/CSV; set sheet for Excel/Google Sheets.
6. **Start**, then load a cue in ROS.

## Match modes

| Mode | Behavior |
|------|----------|
| Cue column | Normalize cue text (`CUE 12` ≈ `12`), find matching schedule item |
| Row index | Schedule order index in the feed |

## Dev

```bash
cd vmix-datasource-bridge
npm install
npm start
```

Config: `%LOCALAPPDATA%\ros-vmix-datasource\`

## Notes

- Socket.IO `joinEvent` + timer poll fallback.
- Selection on `loaded` / `running`.
- Names are case-sensitive and must match vMix exactly.
- Row select Value: with sheet → `Name,Sheet,Index`; without sheet → `Name,Index` (UTC-style), then `Name,,Index` fallback.
