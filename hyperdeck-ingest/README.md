# ROS HyperDeck Ingest

Small **Python sidecar** (not Electron). Same auth as the vMix DataSource Bridge:

- API base URL + **Integration token** (`ros_itok_…`, **read** scope)
- REST poll of `/api/active-timers` (Companion / vMix pattern — not the old unauthenticated OSC app)

It connects to a Blackmagic HyperDeck on the LAN, records one clip per marked cue, then copies the closed file to an editor folder.

## What it does

1. Select the ROS event.
2. Connect to the HyperDeck (TCP **9993**).
3. **Start follow** — when a cue is **running** and marked **Record**, the deck records.
4. On timer **stop** (or next cue), it stops the deck and copies that clip to the **target folder**.
5. Destination name uses a pattern, default:

   `{date} {event} - {segment}` → `260512 Gala - Keynote`

   `{date}` is the **event** date as YYMMDD.

The HyperDeck clip name is a shorter sanitized `CUE12 Keynote` (deck limit ~56 chars). The pretty name is applied when copying.

## Auth (required)

Admin → **Integration tokens** → create a token with **read**. Paste the full `ros_itok_…` value.

This is **not** the old Python OSC GUI (that talked to the API before auth).

## Portable download (show / ingest PC — no Python)

The zip on **Graphics Links** contains a **PyInstaller exe** + `START.bat`. No Python on the target machine.

On a dev machine with Python 3.10+:

```bat
cd hyperdeck-ingest
build-portable.bat
cd ..
node scripts/zip-hyperdeck-ingest.js
```

Unzip on the ingest PC → run **START.bat**. Typical exe size is ~15–25 MB (one-file bundle).

Settings live in `%LOCALAPPDATA%\ros-hyperdeck-ingest\config.json`.

## Run from source (dev only)

```bat
cd hyperdeck-ingest
run.bat
```

Needs Python 3.10+ and `pip install -r requirements.txt`.

## Copy methods

- **FTP from HyperDeck** — after stop, pull the last clip (enable FTP on the deck; many models cannot share the disk *while* recording).
- **Folder on this PC** — if the SSD is mounted as a drive, point Source folder at it.

Always set **Target folder** (editor watch folder / share).

## Follow rules

- Records on **timer start / running**, not on Comms toggle alone.
- **Only record cues marked Record** is on by default (Comms / Rec column).
- **Start follow** asks for an auto-stop timer (default 2 hours, max 24, or Never). When it ends, follow stops, the current clip is copied if auto-copy is on, and the HyperDeck disconnects.
- Manual Record / Stop / Copy last clip are always available.

## Tokens

| Token | Example |
|---|---|
| `{date}` | `260512` |
| `{event}` | `Gala` |
| `{segment}` | `Keynote` |
| `{cue}` | `CUE 12` |
