# Master vs was-duration-v3 Branch — Function Comparison

This document compares **master** with **was-duration-v3-2026-02-03** so we can confirm no core functionality is lost.

---

## 1. Core overtime logic (unchanged on branch)

These behaviors are **the same** on both branches; only **when** they run is gated by mode:

| Behavior | Master | Branch (was-duration-v3) |
|----------|--------|--------------------------|
| **Overtime calculation** | `overtimeSeconds = elapsed - totalSeconds`, `overtimeMinutes` rounded | **Same formula.** |
| **Saving overtime** | `DatabaseService.saveOvertimeMinutes(event.id, itemId, overtimeMinutes)` | **Same call.** Only runs when `showModeRef.current === 'in-show'`. |
| **Broadcasting overtime** | `socket.emit('overtimeUpdate', { event_id, item_id, overtimeMinutes })` | **Same payload.** Only emitted when In-Show. |
| **Show start overtime** | Set when START cue timer stopped; `socket.emit('showStartOvertimeUpdate', ...)` | **Same.** Only calculated/emitted when `showModeRef.current === 'in-show'`. |
| **Cumulative overtime** | `cumulativeOvertimeByItemId` includes `showStartOvertime` for rows at/after START | **Same.** No change to formula. |
| **START cue display** | START row shows `showStartOvertime` (from play press), not duration overtime | **Same.** Branch comment clarifies; logic unchanged. |

So: **core overtime math and persistence are not altered** — they are only skipped in Rehearsal mode.

---

## 2. Where the branch adds gates (Rehearsal vs In-Show)

| Location | Master | Branch |
|----------|--------|--------|
| **Previously running timers on load** | Always calculates and saves/broadcasts overtime for running timers. | If `showModeRef.current === 'rehearsal'`, skips save/broadcast; else same as master. |
| **Socket `onOvertimeUpdate`** | Always applies incoming overtime to state; if `item_id === startCueId` also sets `showStartOvertime`. | If not In-Show, ignores message. In In-Show: applies overtime to state; **does not** set `showStartOvertime` from this event (START still only from `showStartOvertimeUpdate`). |
| **Socket `onShowStartOvertimeUpdate`** | Updates `showStartOvertime` and `startCueId`. | Same, but only when In-Show; ignored in Rehearsal. |
| **Socket `onOvertimeReset`** | (If present) resets overtime state. | Same behavior when In-Show; can be ignored in Rehearsal if desired. |
| **`toggleTimer`** | Always computes duration overtime, saves, emits. For START cue, computes and emits show start overtime. | **Same computation.** Saves/emits only when `showModeRef.current === 'in-show'`. Show start overtime block runs only when `startCueId === itemId && showModeRef.current === 'in-show'`. |

So: **no new formulas** — only “run this block only in In-Show” (or “skip in Rehearsal”).

---

## 3. New features on branch (additive)

| Feature | Master | Branch |
|---------|--------|--------|
| **Rehearsal / In-Show mode** | N/A (always “live” behavior). | Toggle with confirmation modals; `showMode` state + `showModeRef`. |
| **Start column in Rehearsal** | Always shows calculated start time with overtime. | In Rehearsal: Start column shows **scheduled time only** (no overtime badge). In In-Show: same as master. |
| **Track was durations** | N/A. | Checkbox (Operators). When on: store original duration when timer stops; show “was X min” under duration when different; restore originals on Reset. |
| **Reset button** | Clears completed/timer state; does not restore durations. | If “Track was durations” is on: also restores durations from `originalDurations` and saves run-of-show. |
| **ConfirmModal** | N/A. | New component for mode switch confirmations (no browser `confirm`). |
| **ScheduleRow** | No “was” or mode. | Optional `originalDuration`, `showWasUnderDuration`, `showMode`; “was X min” line; Start column uses scheduled time in Rehearsal. |

None of these remove or replace master behavior; they add options and one extra display path (Rehearsal Start = scheduled only).

---

## 4. Master behavior that must remain (verification checklist)

- [x] **Overtime calculation** — Same formula; only gated by In-Show.
- [x] **Save overtime to DB** — Same API; only called in In-Show.
- [x] **Emit `overtimeUpdate`** — Same payload; only in In-Show.
- [x] **Show start overtime** — Still set only when START cue timer stopped in In-Show; START row still shows this value.
- [x] **Cumulative overtime** — Same logic; includes `showStartOvertime`.
- [x] **Socket handlers** — Same behavior when In-Show; Rehearsal only ignores incoming overtime/show-start updates.
- [x] **Reset** — Still clears completed/timers and emits reset; branch adds optional “restore durations” when “Track was durations” is on.

---

## 5. Files changed vs master

| File | Change summary |
|------|----------------|
| **RunOfShowPage.tsx** | Added mode state, ref, confirm modals, “Track was durations” and original-duration logic; gated overtime save/broadcast and socket handling by `showModeRef`; Reset can restore durations; UI for mode toggle and checkbox (Operators). |
| **ScheduleRow.tsx** | New optional props `originalDuration`, `showWasUnderDuration`, `showMode`; Start column scheduled-only in Rehearsal; “was X min” under duration when applicable; memo compare includes `showMode`. |
| **ConfirmModal.tsx** | New file; reusable confirmation modal for mode switch. |

**Socket-client / API / Database** — No changes to overtime APIs or event names; branch only uses them conditionally.

---

## 6. Summary

- **Core overtime logic** (calculation, DB save, socket emit, show start overtime, cumulative overtime) is **unchanged**; it is only **skipped in Rehearsal** and **run in In-Show**.
- **Master behavior is preserved** when mode is In-Show.
- **New behavior** is additive: Rehearsal mode (scheduled-only Start, no overtime tracking), “Track was durations,” “was X min” display, and optional duration restore on Reset.

Use this checklist when re-implementing or merging to ensure no function is lost relative to master.
