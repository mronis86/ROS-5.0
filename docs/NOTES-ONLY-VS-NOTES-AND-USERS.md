# Notes-Only vs Notes-and-Users Branches

Two deployable variants:

| Branch | Contents | Use when |
|--------|----------|----------|
| **`notes-only`** | Notes fixes only (editor line breaks + report printing). No viewers/presence. | Safer revert; deploy without user presence. |
| **`Notes-and-Users-2026-01-24`** | Notes fixes **and** real presence (Viewers menu, WebSocket, api-server). | Full feature set including "who's viewing" in Run of Show menu. |

**Notes fixes (both branches):**
- **Run of Show:** Excel-imported notes with `\n` show as separate lines in the notes editor (via `notesForEditor`).
- **Reports:** Notes render with line breaks in print (via `notesForPrint` + `escapeHtml` + `white-space: pre-line`).

**Presence (Notes-and-Users only):**
- Menu → Viewers (N), modal with who's viewing the event.
- WebSocket presence in `api-server.js`; `sendPresence` / `onPresenceUpdated` in socket-client; `ActiveViewersContext`.

To revert from presence without losing notes: deploy or switch to **`notes-only`**.
