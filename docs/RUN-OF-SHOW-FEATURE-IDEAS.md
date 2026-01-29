# Run of Show: Feature Ideas & Potential Additions

Research-backed ideas for pages and features to add to the event run-of-show application.  
*(Sources: Script Elephant, Rundown Studio, LASSO/Shoflo, Cuez, BizBash, Eventbrite, Rundown Creator, XTimer, and industry best practices.)*

---

## 1. What You Already Have

The app already covers many core run-of-show needs:

- **Rundown / schedule** with timers, cues, durations, sub-cues
- **Real-time sync** and **viewer presence** (who's on which event)
- **Reports & printing**, **Agenda import**, **Excel import**
- **Lower thirds**, **scripts**, **teleprompter**
- **Backups**, **change log**, **role-based access** (Viewer / Editor / Operator)
- **Breakout rooms**, **Green Room**, **Clock**, **Photo View**

The list below focuses on **additions**, not replacements.

---

## 2. Pages & Features to Consider

### A. Rehearsal / Dry-Run Mode

- **"Rehearsal mode"** toggle: run timers and cues as normal, but **don't persist** edits to the live run of show (or clearly tag them as rehearsal-only).
- Optional **rehearsal-only view** (simplified rundown + timers + notes, hide lower thirds / graphics if desired).
- Use case: dry run without touching production data.

### B. Pre-Show Checklist Page

- **Dedicated checklist page** (e.g. `/checklist`) with sections such as:
  - **Tech**: internet, mics, playback, lighting, sight lines
  - **Content**: slides, videos, spell-check, formats
  - **People**: speaker arrival, mic check, teleprompter comfort
- Simple checkboxes; optionally tie to an **event** (e.g. "Pre-show checklist for Event X").
- Aligns with [BizBash](https://www.bizbash.com/production-strategy/audiovisual-lighting/article/13232524/checklist-8-things-to-double-check-at-an-events-runthrough)-style run-through checklists.

### C. Show Caller / Director View

- **Caller-focused view**: large countdown, "next cue," "current segment," minimal clutter.
- Optional **"call script"** column (what the show caller says at each cue).
- Complements Operator role and existing timers.

### D. Department-Specific Views

- **View filters** (extend existing Filter View):
  - e.g. "Audio" view (audio-related cues only), "Video," "Lighting."
- Same rundown, different visibility by role or toggle.

### E. Global Elements / Shared Blocks

- **Reusable blocks** (e.g. "Intro," "Sponsor read," "Speaker bio – X"):
  - Define once, insert into multiple events or segments.
  - Edit in one place → update everywhere (similar to "Global Elements" in Rundown Studio).

### F. Confidential / Hidden Segments

- **"Confidential"** (or "Hide from some roles") on specific rows:
  - e.g. surprises, sensitive speaker notes, embargoed segments.
- Viewers (and optionally some editors) see a placeholder; Operator/caller sees full detail.

### G. Version History & Rollback

- **Version history** for the run of show (or per event):
  - Manual "Save version" or automatic snapshots (e.g. every N minutes).
  - **Rollback**: "Restore to 2:00 PM version" before or during show.
- Builds on existing backups and change log.

### H. Integrations & Exports

- **Export**: PDF rundown, CSV, **print-optimized** one-pager (extend current reports).
- **Integrations** (if desired later):
  - Teleprompter hardware (e.g. Autoscript-style)
  - Broadcast/graphics (TriCaster, Ross, Chyron) for lower thirds
  - Calendar (link "Show start" to a calendar event)

### I. Countdown / "Time to Show" Dashboard

- **"Time to show"** page or widget:
  - Countdown to doors, show start, or next segment.
- Optional **fullscreen mode** for control room or green room.
- Could extend the existing **Clock** page or live as a separate "Countdown" view.

### J. Run-of-Show Templates

- **Templates**: save a run of show (or standard segments) as a template → "Create event from template."
- Speeds up creation for recurring show formats.

---

## 3. Summary Table

| Idea | Type | Effort (rough) | Fits current ROS |
|------|------|----------------|------------------|
| Rehearsal mode | Feature / mode | Medium | Yes – extends timers & edits |
| Pre-show checklist | New page | Low–Medium | Yes – new route + UI |
| Show caller view | New view/page | Low–Medium | Yes – new view over same data |
| Department filters | Feature | Low | Yes – extend Filter View |
| Global / shared blocks | Feature | Medium–High | Yes – new data model |
| Confidential segments | Feature | Medium | Yes – role-based visibility |
| Version history + rollback | Feature | Medium–High | Yes – builds on backups |
| Countdown dashboard | Page / widget | Low | Yes – Clock page or new |
| Templates | Feature | Medium | Yes – "Duplicate event"–style |

---

## 4. Suggested Order to Tackle

- **Quick wins:** Pre-show checklist page, countdown dashboard, stronger show-caller view (reuse existing timers + cues).
- **Next:** Rehearsal mode, department filters, confidential segments.
- **Larger:** Global blocks, version history + rollback, templates.

---

*Last updated: 2026-01-24*
