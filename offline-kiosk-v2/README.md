# Offline Kiosk V2

Operator **appliance UI** for the remote-ops / multiview machine.

Operators only open this app. Offline Show and WebLinked (SDI/NDI) stay underneath. RemoteOp opens **VDO.Ninja** or **Meshcast** pages directly — no custom tile grid.

## Current phase: UX shell

Branch: `feature/offline-kiosk-v2`

Electron control surface using **SINOR Track** branding and tabs:

- **Status** — start Offline Show; LAN / Cloud / token (opens first; nothing armed)
- **Event** — calendar list (Upcoming/Past + search) once the show is running
- **Displays** — arm one Offline Show page URL into WebLinked (`POST /api/url` on `:7655`/`:7654`)
- **RemoteOp Multiview** — choose VDO.Ninja or Meshcast first, then embed in-panel

**Wired:** Offline Show start; session length popup (Testing / Live Event / Everyday) auto-stops show + WebLinked; LAN / Cloud / token; sync-from-cloud; calendar list; WebLinked start + arm/disarm (Stage Timer + Custom URL → `POST /api/url` on `:7654`).

**Not wired yet:** offline Photo/OpLarge pages; DeckLink/NDI output presets from the kiosk.

## Run (dev)

```bat
cd offline-kiosk-v2
npm install
npm start
```

Or: `launcher\start-offline-kiosk.bat`

## Show-PC install (download)

**Preferred (portable):** download **Offline Kiosk Portable** from ROS (OSC / Graphics Links), or build with `npm run dist`.  
Unzip → **START.bat**. Includes Electron + Offline Show + bundled Node + WebLinked. No system Node/npm.

Hosted as `ros-offline-kiosk-portable.zip` on the Railway downloads bucket (same pattern as PPT Bridge).

## Portable build

```bat
cd offline-kiosk-v2
npm install
npm run sync:weblinked
npm run dist
```

Requires Desktop `WebLinked-SDI\build\Release` (or Program Files\\WebLinked) for the sync step.  
Locales are trimmed to en-US to keep the pack closer to the ~155MB WebLinked zip size plus Electron/Node.

## Layout

```
offline-kiosk-v2/
  electron/                 kiosk main / preload / bridges
  renderer/                 operator UI
  engines/offline-show/     Offline Show engine (:3004)
  engines/weblinked/        Sinor WebLinked runtime (:7655 HTTP)
  launcher/                 start-offline-kiosk.bat
  package.json
```

- **Bundled Offline Show:** `engines/offline-show/` — sibling `ROS-5.0/offline-show/` left alone. Refresh: `npm run sync:offline-show`.
- **Bundled WebLinked:** `engines/weblinked/` runtime from `Desktop\WebLinked-SDI\build\Release` (source tree untouched). Refresh: `npm run sync:weblinked`.
- **Cloud default:** starting Offline Show turns **Cloud on** whenever an Integration token is saved.

## Planned next

1. Port Photo View + Operator Large into Offline Show (`:3004`)
2. Prefill RemoteOp from event Meshcast / VDO links when available
3. Optional NDI/DeckLink output presets from Displays
