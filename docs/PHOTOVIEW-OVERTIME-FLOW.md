# Photo Page: How It Gets Overtime Updates and Adjusts Displayed Start Times

## 1. State (PhotoViewPage)

- **`overtimeMinutes`** – `Record<number, number>`: per-cue **duration** overtime (e.g. cue ran 5 min over → +5).
- **`showStartOvertime`** – number: **show start** overtime (e.g. show started 20 min late → +20).
- **`startCueId`** – which row is the START cue (show start overtime applies from this row onward).

## 2. How PhotoView Gets Overtime Updates

### A. On load / event select

- **`DatabaseService.getOvertimeMinutes(event.id)`** → `setOvertimeMinutes(overtimeData)`.
- **`DatabaseService.getShowStartOvertime(event.id)`** → `setShowStartOvertime(overtimeValue)`, and START cue from schedule (`isStartCue`).

### B. Every 20 seconds (ONLY source of updates)

A sync runs every 20 seconds that fetches schedule, overtime, START cue, and day start times. The UI shows **"Sync in: Xs"**.

### C. WebSocket (ignored for overtime/schedule/start/duration)

Photo page does not apply WebSocket updates for overtime, schedule, START cue, or durations. The callbacks for these are no-ops. Timer state (running/loaded) and clock sync still come from WebSocket.

## 3. How Displayed Start Times Are Adjusted

**`calculateStartTimeWithOvertime(index)`**:

1. Gets **base** start time from **`calculateStartTime(index)`** (scheduled time from master start + durations of earlier rows).
2. Computes **total overtime** for that row:
   - Finds START cue index; only considers rows from START onward (same day, non-indented).
   - Sums **`overtimeMinutes[item.id]`** for all previous non-indented rows in that range.
   - Adds **`showStartOvertime`** once (for START cue and every row after it).
3. If total is 0, returns base start time.
4. Otherwise: parses base time (12h), converts to 24h minutes, adds `totalOvertimeMinutes`, converts back to 12h and returns that string.

So displayed start time = **scheduled start + (sum of previous cues’ duration overtimes) + show start overtime** (if row is at or after START).

## 4. Where It Can Break

- **Client never receives overtime:** Server sends **direct** `'overtimeUpdate'` and `'showStartOvertimeUpdate'`. The socket client only has **`socket.on('update', message)`** and switches on `message.type`. So it never sees the direct events unless we add **`socket.on('overtimeUpdate', ...)`** and **`socket.on('showStartOvertimeUpdate', ...)`**.
- **Stale closure:** Socket callbacks are created in a `useEffect` that depends on `event?.id` (and maybe `user`). If `event` or `startCueId` changes and the effect doesn’t re-run, callbacks can see old `event` or `startCueId` and ignore valid updates.
- **START cue vs duration overtime:** If PhotoView sets `showStartOvertime` from every `overtimeUpdate` for the START cue, a later duration-only update can overwrite the real show start. Prefer: update `showStartOvertime` only from **`showStartOvertimeUpdate`**; use **`overtimeUpdate`** only for **`overtimeMinutes`** (and optionally for START cue’s show start only when no dedicated event exists).
