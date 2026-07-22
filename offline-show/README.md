# Offline Show System

Self-contained **local show mode** for ROS — separate from the Netlify/Railway app.

## Rules (why the last attempt broke)

1. **Do not import** from `../src/pages`, `../src/services`, or main `vite.config.ts`.
2. **Copy and trim** only what you need into `offline-show/ui/`.
3. **Online vs offline** is explicit in this app only — main hosted app is never modified.
4. **One folder** — server, UI, launcher, and docs live here.
5. **Self-contained deps** — `offline-show/` and `offline-show/ui/` have their own `package.json`. Launchers run `npm install` automatically; **repo root `npm install` is not required**.

## Folder layout

```
offline-show/
  README.md           ← you are here
  package.json        ← server deps (sqlite, express, socket.io)
  launcher/           ← .bat to start on show laptop
  server/             ← LAN master: API + SQLite + Socket.IO (:3004)
  ui/                 ← slim React app (Vite), own pages only
    src/
      pages/          ← EventList, RunOfShow, OfflineTimer, QuickMode
      components/
      services/       ← api-client + socket-client → LAN server only (phase 2+)
```

## Target pages (slim app — not full ROS)

| Page | Purpose |
|------|---------|
| Event list | Pick / open show |
| Run of show | Schedule + field edits |
| Timer (`/timer`) | Stage display + messages (one page; LAN socket, cloud-bridged when Cloud on) |
| Quick mode | Simple ad-hoc timers |
| Status bar | LAN health, go offline / back online (later) |

Skip: Admin, Content Review, Teleprompter, XML exports, OSC, etc.

## Phases

### Phase 1 — Shell ✅

- Local server on port **3004**, minimal UI home page

### Phase 2 — LAN database + API ✅ (current)

- SQLite in `offline-show/data/offline-show.db`
- REST: calendar events, run of show, timers, messages, completed cues, overtime
- Socket.IO: `joinEvent`, `requestSync`, broadcasts on save
- Home page: refresh + “Create sample event” (`POST /api/dev/seed-sample`)

### Phase 3 — Offline UI pages (in progress)

- **Event List** — copy of main `EventListPage` under `ui/src/pages/` (Tailwind + LAN `database.ts` / `api-client.ts`)
- Bottom **connectivity bar** (Internet / Railway / Neon / Local LAN)
- **Run of Show** — full copy of main `RunOfShowPage` + `ScheduleRow` (LAN sync via Socket.IO; Cloud on uses Railway through show server)
- **Timer** — `/timer?eventId=…` (copy of main `Clock`); ROS “Clock” and “Fullscreen timer” both open this route
- **Quick Mode** — ad-hoc timers; localStorage + show server API/socket sync
- Second laptop: `http://<show-laptop-ip>:3004` + websocket sync test

### Phase 4 — Cloud sync (optional)

- Show laptop only: pull from Railway before show, push after
- “Offline / Online” toggle in status bar
- **Railway API token** (connectivity bar → **API** button): paste an Integration token from Admin (`read` + `control` scopes). Or set `OFFLINE_RAILWAY_API_TOKEN` in the server environment.

## Run (download zip from ROS OSC modal)

1. Extract `offline-show.zip` anywhere (e.g. Desktop).
2. **Requires [Node.js](https://nodejs.org/)** on the show laptop (for `npm install` on first run).
3. Double-click `offline-show\launcher\start-standalone.bat`.
4. First run installs server dependencies and opens http://127.0.0.1:3004/ — UI is **pre-built** in `ui/dist` inside the zip.

## Run (from full ROS repo)

No repo root `npm install` needed — offline-show installs its own deps:

```bat
offline-show\launcher\start-offline-show.bat
```

This rebuilds the UI from source, then starts the server on port 3004.

**Desktop launcher with icon:** double-click `offline-show\launcher\create-desktop-shortcut.bat` once. That builds `ros-offline-show.ico` from the Sinor Track logo and places **ROS Offline Show** shortcuts on your Desktop and in `launcher\` (pin those — `.bat` files cannot carry a custom icon by themselves).

The launcher waits until `/health` responds before opening the browser (avoids Chrome `chrome-error://` if the tab opens too early).

Open http://127.0.0.1:3004/ manually if the auto-open tab failed — use a normal browser tab, not an embedded preview.

## Companion on the show LAN

Use the regular **Run of Show** Companion module; a separate offline module is
not required. Point its **API Base URL** at the offline show server:

- Companion on the show laptop: `http://127.0.0.1:3004`
- Companion on another LAN computer: `http://<show-laptop-ip>:3004`

Keep Companion pointed at this LAN URL throughout the show. In Cloud mode the
offline server proxies commands to Railway; in LAN-only mode it runs the same
timer commands against local SQLite. Give the show laptop a stable LAN address
and allow TCP port 3004 through Windows Firewall.

## Main app

Port **3003** (`npm run dev`) — unchanged. Do not add portable aliases to main Vite config.
