# Branch push verification — was-duration-v3-2026-02-03

**Date checked:** After Cursor crash recovery  
**Purpose:** Confirm the was-duration work was committed and pushed to GitHub.

---

## 1. Local vs GitHub (origin)

| What | Value |
|------|--------|
| **Branch** | `was-duration-v3-2026-02-03` |
| **Local HEAD** | `c1c28ada3513f576383e3490cda9f997f627c538` |
| **origin/was-duration-v3-2026-02-03** | `c1c28ada3513f576383e3490cda9f997f627c538` |

**Result:** Local and remote are the same commit — the branch on GitHub matches your last push.

---

## 2. What is in that commit (c1c28ad)

**Message:**  
`Rehearsal/In-Show mode, Track was durations, Reset restores to was`

**Included changes:**
- Rehearsal vs In-Show toggle with confirm modals; overtime only tracked in In-Show
- Track was durations: when checked, show "was X min" under duration when changed (e.g. 5 min → 6 min shows "was 5 min")
- Reset button: when Track was durations is on, revert all durations to original (was) values and save
- ConfirmModal component for mode switch; ScheduleRow shows scheduled-only Start in Rehearsal
- docs: MASTER-VS-WAS-DURATION-V3-COMPARISON.md for merge verification

**Files in commit:**

| File | Change |
|------|--------|
| `docs/MASTER-VS-WAS-DURATION-V3-COMPARISON.md` | Added (83 lines) |
| `src/components/ConfirmModal.tsx` | Added (70 lines) |
| `src/pages/RunOfShowPage.tsx` | Modified (+234 / -38 net) |
| `src/pages/ScheduleRow.tsx` | Modified (+29 / -1 net) |

**Total:** 4 files changed, 378 insertions, 38 deletions.

---

## 3. Uncommitted changes (after the crash)

These files are modified in your working tree but **not** in commit c1c28ad (not pushed):

- `api-server.js`
- `env.example`
- `netlify/build.sh`
- `package.json`
- `ros-osc-control/src/renderer/styles.css`
- `ros-osc-python-app/run.sh`
- `src/App.tsx`
- `src/components/OSCModalSimplified.tsx`
- `src/index.css`
- `src/pages/ClockPage.tsx`
- `src/pages/FullScreenTimerPage.tsx`
- `src/pages/GreenRoomPage.tsx`
- `src/pages/PhotoViewPage.tsx`
- `src/pages/ReportsPage.tsx`
- `src/pages/RunOfShowPage.tsx`
- `src/pages/ScheduleRow.tsx`
- `src/services/socket-client.ts`
- `vite.config.ts`
- `websocket-python-osc/websocket_osc_app.py`

So: the was-duration feature set is safely on GitHub in commit c1c28ad. Any differences in `RunOfShowPage.tsx` or `ScheduleRow.tsx` (or others) are **only** in your working copy until you commit and push again.

---

## 4. Conclusion

- The was-duration-v3 work **is** committed and **is** on GitHub at the same commit as your local branch.
- Nothing from that feature set was lost in the crash.
- You have additional uncommitted edits; commit and push those only if you want them on the branch.
