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

## Run from source (dev PC with Python)

```bat
cd hyperdeck-ingest
run.bat
```

Needs Python 3.10+ and `pip install -r requirements.txt`.

## Portable exe (show / ingest PC — no Python)

On a machine that has Python:

```bat
cd hyperdeck-ingest
build-portable.bat
```

Copy `dist\ROS-HyperDeck-Ingest.exe` to the ingest PC and double-click. Typical size is tens of MB, not a 150+ MB Electron portable.

Settings live in `%LOCALAPPDATA%\ros-hyperdeck-ingest\config.json`.

In the ROS web app the zip is on **Graphics Links** (same download row as the vMix bridge): **HyperDeck Ingest**.

## Copy methods

- **FTP from HyperDeck** — after stop, pull the last clip (enable FTP on the deck; many models cannot share the disk *while* recording).
- **Folder on this PC** — if the SSD is mounted as a drive, point Source folder at it.

Always set **Target folder** (editor watch folder / share).

## Follow rules

- Records on **timer start / running**, not on Comms toggle alone.
- **Only record cues marked Record** is on by default (Comms / Rec column).
- Manual Record / Stop / Copy last clip are always available.

## Tokens

| Token | Example |
|---|---|
| `{date}` | `260512` |
| `{event}` | `Gala` |
| `{segment}` | `Keynote` |
| `{cue}` | `CUE 12` |
