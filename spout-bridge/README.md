# ROS LED Spout Bridge

Portable **Windows** app that publishes LED graphics to [Spout](https://spout.zeal.co/) for Resolume, TouchDesigner, OBS, etc.

## Modes

| Mode | Source | Cue follow |
|------|--------|------------|
| **Live page** | Hosted `/led-output` (Netlify or local Vite) | Socket on the LED page (cloud/API) |
| **Offline prerender** | Local APNG, WebP, or WebM pack | Offline-show LAN server (`:3004`) |

Resolume always selects Spout sender **`ROS LED`** — only Spout's source changes.

## Requirements

- Windows 10/11 x64
- DirectX 11 GPU (NVIDIA/AMD recommended)
- [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) (usually already installed)
- `SpoutLibrary.dll` in `vendor/` (see [vendor/README.md](vendor/README.md))
- **Live mode:** Integration API token (`ros_itok_…`) with `read` scope
- **Prerender mode:** offline-show running + a baked pack (see below)
- **Bake script:** [ffmpeg](https://ffmpeg.org/) on PATH (APNG encoder)

## Quick start (live)

1. Copy `SpoutLibrary.dll` into `spout-bridge/vendor/`
2. Double-click `launcher/start-ros-led-spout.bat`
   Or from this folder: `npm install` then `npm start`
3. Source mode: **Live page**
4. Fill in app URL, API URL, token, event ID → **Test connection** → **Start Spout**
5. In Resolume, add Spout input → sender `ROS LED`

## Offline prerender workflow

### 1. Bake animations (before the show / while online)

With the ROS app running locally (`npm run dev` on `:3003`) or pointed at production:

```bash
# from repo root (spout-bridge deps installed)
npm run prerender:led-cues -- --eventId=<uuid> --token=<ros_itok_...>

# optional
#   --appUrl=http://localhost:3003
#   --apiUrl=https://ros-50-production.up.railway.app
#   --out=./led-prerenders/<eventId>
#   --width=1920 --height=1080 --holdSeconds=1
#   --format=apng
#   --formats=apng,webp,webm  # captures once, writes separate format folders
```

Output pack:

```text
led-prerenders/<eventId>/
  manifest.json
  cues/
    42-enter.apng
    42-enter-last.png
```

Choose **APNG** for the most accurate alpha, lossless **WebP** for smaller files, or experimental **WebM** for the smallest files. Selecting multiple formats captures each cue once and creates separate `APNG/`, `WebP/`, and `WebM/` pack folders. Resolume does not play these files — Spout does.

### 2. Run offline-show + Spout prerender

1. Start offline-show (`:3004`) and open the event.
2. Spout → Source mode **Offline prerender pack**
3. Browse to the pack folder, set Event ID, Offline show URL `http://127.0.0.1:3004`
4. **Test pack** → **Start Spout**
5. Load/run/stop cues in offline Run of Show — Spout plays matching `{itemId}-enter.apng`

Missing cue files stay clear and show a warning in the Spout status panel.

## How auth works (live)

The Electron main process injects `Authorization: Bearer <token>` on `{apiOrigin}/api/*` requests.

Config is saved under `%LOCALAPPDATA%/ros-led-spout/`.

## Build portable `.exe`

```bash
cd spout-bridge
npm install
npm run dist
```

## Troubleshooting

| Issue | Fix |
|--------|-----|
| API 401/403 | Regenerate token; `read` scope; matching event |
| Bake: ffmpeg not found | Install ffmpeg or pass `--ffmpeg=` path |
| Prerender: no animation on cue | Confirm `{itemId}-enter.apng` exists |
| Cue follow disconnected | Start offline-show on `:3004` |
| Black output | Use transparent LED background for keying |

## License

ROS app code: same as parent repo. SpoutLibrary.dll: BSD 2-Clause (Spout2 / Lynn Jarvis).
