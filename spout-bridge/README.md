# ROS LED Spout Bridge

Portable **Windows** app that loads the hosted **LED Output** page for an event and publishes frames to [Spout](https://spout.zeal.co/) for Resolume, TouchDesigner, OBS, etc.

## Requirements

- Windows 10/11 x64
- DirectX 11 GPU (NVIDIA/AMD recommended)
- [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) (usually already installed)
- `SpoutLibrary.dll` in `vendor/` (see [vendor/README.md](vendor/README.md))
- Integration API token (`ros_itok_…`) from **Admin → Integration API tokens** with `read` scope

## Quick start (development)

1. Copy `SpoutLibrary.dll` into `spout-bridge/vendor/`
2. Double-click `launcher/start-ros-led-spout.bat`  
   Or from this folder: `npm install` then `npm start`
3. Fill in:
   - **Hosted app URL** — `http://localhost:3003` for local dev, or your Netlify ROS URL when deployed
   - **API base URL** — Railway API (default: `https://ros-50-production.up.railway.app`)
   - **API token** — event-scoped integration token
   - **Event ID** — show UUID
4. **Test connection** → **Start Spout**
5. In Resolume (or other app), add a **Spout** input and select sender name (default `ROS LED`)

## How auth works (Option A)

The Electron main process registers a `webRequest` hook on `{apiOrigin}/api/*` and injects:

```
Authorization: Bearer <your ros_itok_ token>
```

The LED output page loads without login (`/led-output` bypasses the main app shell). URLs include `key=1` for true transparent or solid-color broadcast output. API calls from the page to Railway are authenticated automatically. Socket.IO cue follow works as on the normal output page (no token required today).

Config is saved to `%APPDATA%/ros-led-spout/ros-led-spout-config.json` (Electron `userData`).

## Build portable `.exe`

```bash
cd spout-bridge
npm install
# ensure vendor/SpoutLibrary.dll exists
npm run dist
```

Output: `dist/ROS-LED-Spout-0.1.0-portable.exe` (and unpacked folder). Copy `vendor/SpoutLibrary.dll` next to the portable exe if not bundled.

## Folder layout

```
spout-bridge/
  electron/           Main process, Spout sender, output window
  renderer/           Config UI
  vendor/             SpoutLibrary.dll (you provide)
  launcher/           start-ros-led-spout.bat
  package.json
```

## Resolution notes

Default output size is **1920×1080 @ 60fps**. The capture window requests that frame rate from Chromium (`setFrameRate`), and Spout publishes on a **fixed timer** at your configured FPS. When the LED page is static, the last frame is **held and re-sent** so receivers get a steady stream.

The status line shows `Publish: ~60 fps (target 60)` — actual rate should match target within a few fps.

The hosted LED canvas is designed at 3840×2160 internally; scaling matches a browser window at the chosen capture size.

## Troubleshooting

| Issue | Fix |
|--------|-----|
| API 401/403 | Regenerate token; ensure `read` scope and matching `event_id` |
| Spout DLL missing | Copy into `vendor/` per README |
| Resolume sees no sender | Confirm Start Spout is running; check GPU preference (High performance) in Windows Graphics Settings |
| App crashes on Start Spout | Set Windows Graphics → High performance for Electron; ensure `SpoutLibrary.dll` matches v2.007.x from [Spout2 releases](https://github.com/leadedge/Spout2/releases) |
| Terminal cache errors | Usually harmless; app now uses `%LOCALAPPDATA%\\ros-led-spout` for cache. Close duplicate Electron instances if errors persist |
| ~1 fps publish rate | Restart after update; ensure Vite/dev app is running at the App URL; load a cue so the LED page animates |
| Black output | Set LED background to transparent in LED Set page for keying |
| Dual GPU laptop | Set this app to use discrete GPU in Windows settings |

## License

ROS app code: same as parent repo. SpoutLibrary.dll: BSD 2-Clause (Spout2 / Lynn Jarvis).
