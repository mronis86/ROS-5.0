# Run of Show – Mitti Sync (experimental)

Separate Companion module: **Mitti cue playback → ROS timer sync**, as an alternative to Resolume Sync. Does not change the production `companion-module-runofshow` module.

## How it differs from Resolume

| | Resolume | Mitti |
|---|---|---|
| Live position | Normalized 0–1 OSC | `/mitti/cueTimeLeft` + `/mitti/currentCueTRT` |
| Duration while idle | Can sample clip slope | **TRT only for the current cue** — must select (or play) that cue |
| Pull updated file TRT | Trigger clip + sample | **Select → read TRT → restore previous cue** |

## Live sync flow

1. **Arm Mitti sync** — loads ROS cue, calls `mitti-arm`, listens for OSC feedback.
2. When Mitti plays, module reads `cueTimeLeft` / `currentCueTRT`.
3. One-shot `POST /api/timers/mitti-sync-align` (not per-tick HTTP).
4. Clients get `timerUpdated` with `time_source: 'mitti'` and count down locally.

## Pull TRT (file replaced / duration changed)

Mitti only publishes TRT for the **current** cue. Use **Pull Mitti TRT into ROS cue duration**:

1. Optionally note the cue you need to return to (`restoreCueNumber`, or leave `0` to use last known current from OSC).
2. Module sends `/mitti/{N}/select` for the cue whose media changed.
3. Waits for `/mitti/currentCueTRT` (and can request `/mitti/resendOSCFeedback`).
4. Writes that duration into the ROS cue.
5. Re-selects the restore cue so show position is unchanged.

Does **not** play the sampled cue — select only.

## Setup

### 1. Companion module path

Point **Developer → Module path** at the parent folder:

```text
C:\Users\audre\OneDrive\Desktop\ROS-5.0
```

You should see **Run of Show: Mitti Sync** alongside Resolume Sync and the main module.

### 2. Install

```bash
cd companion-module-runofshow-mitti
npm install
```

Restart Companion after install.

### 3. Mitti OSC

In Mitti Preferences:

1. Enable **OSC Controls** (input port **51000**).
2. Enable **OSC Feedback** → Companion PC IP, port **51001** (match module listen port).

Useful feedback:

- `/mitti/cueTimeLeft`
- `/mitti/currentCueTRT`
- `/mitti/togglePlay`

### 4. API

Run/deploy `api-server.js` with:

- `POST /api/timers/mitti-arm`
- `POST /api/timers/mitti-disarm`
- `POST /api/timers/mitti-sync-align`
- `POST /api/timers/mitti-end`

## Test without Mitti

Use **Manual Mitti align** with duration + remaining to verify the API path.

## Rollback

Disable/delete this module instance in Companion. Main Run of Show module is unchanged.
