# Real "Viewers" Presence — No User System Rebuild

This doc explains how to replace **mock viewers** with **real presence** using your **existing** user setup and WebSocket infra, with minimal changes.

---

## What you have today

| Piece | How it works |
|-------|----------------|
| **Users** | `auth-service`: sign-in with email + full name. User has `id`, `email`, `full_name`, `role` (VIEWER/EDITOR/etc.). Stored in `localStorage` as `ros_user_session`. |
| **WebSocket** | `socket-client` connects to `api-server` (Socket.IO). Run of Show calls `connect(eventId)`, emits `joinEvent(eventId)`, `leaveEvent` on disconnect. |
| **Server** | `api-server.js` puts sockets in `event:${eventId}` rooms. No presence logic yet. |
| **UI** | `ActiveViewersContext` holds `viewers[]`. RunOfShowPage sets **mock** viewers; AppHeader shows **"X viewers · View details"** and a modal with the list. |

No new tables, no new auth flow, no new login. We only add **presence over the existing socket**.

---

## How it works (conceptually)

1. **Client (Run of Show):** When the user is on an event and the socket connects, send **"I'm viewing this event"** with `eventId` + **current user** from `useAuth()`: `userId`, `userName` (`full_name` or `email`), `userRole` (`role`).
2. **Server:** Keep an **in-memory** map: *event → list of viewers* (or *socket → event + user*). On **join**: add viewer, broadcast updated list to `event:${eventId}`. On **disconnect**: remove that socket’s viewer, broadcast again.
3. **Client:** Listen for **"presence updated"** messages. Update `ActiveViewersContext` with the new list. AppHeader already shows count + modal; no UI changes.

Result: everyone in the same event room sees the same **viewers** list, and the header **"X viewers"** / modal reflect who’s actually viewing.

---

## What to change (minimal)

### 1. **API server (`api-server.js`)**

- **In-memory presence**
  - `presenceByEvent`: `Map<eventId, Map<socketId, { userId, userName, userRole }>>`
  - `socketToEvent`: `Map<socketId, eventId>` so we know which event to update on disconnect.

- **New Socket handler: `presenceJoin`**
  - Payload: `{ eventId, userId, userName, userRole }`.
  - Store in `presenceByEvent` and `socketToEvent`.
  - Build list of viewers for that event (e.g. from `presenceByEvent.get(eventId).values()`).
  - `io.to('event:' + eventId).emit('update', { type: 'presenceUpdated', data: viewersList })`.

- **`disconnect`**
  - Look up `socketId` in `socketToEvent` → `eventId`.
  - Remove that socket from `presenceByEvent.get(eventId)` and from `socketToEvent`.
  - Rebuild viewers list for that event, broadcast `presenceUpdated` again.

- **Optional:** On `leaveEvent`, treat it like a “soft leave” and remove that socket from presence for that event (if you ever leave without disconnecting). Can add later.

No DB, no new API routes. Just Socket.IO + two Maps.

### 2. **Socket client (`socket-client.ts`)**

- **Callbacks:** Add `onPresenceUpdated?: (viewers: { userId: string; userName: string; userRole: string }[]) => void`.

- **`update` handler:** In the `switch (message.type)`, add `case 'presenceUpdated': this.callbacks.onPresenceUpdated?.(message.data); break`.

- **New method:** `sendPresence(eventId: string, user: { userId: string; userName: string; userRole: string })`  
  - Emit `presenceJoin` with `{ eventId, ...user }`.

### 3. **Run of Show page (`RunOfShowPage.tsx`)**

- **Auth:** `const { user } = useAuth();`

- **Replace mock viewers**  
  - Remove the `useEffect` that sets static mock viewers.

- **Use real presence:**
  - When **connecting** the socket (in the same `useEffect` where you call `socketClient.connect`):
    - In `onConnectionChange(true)`: if `user` and `event?.id`, call `socketClient.sendPresence(event.id, { userId: user.id, userName: user.full_name || user.email, userRole: user.role })`.
  - Add **`onPresenceUpdated`** to the socket callbacks:  
    `(list) => setViewers(list)`.
  - On **`onConnectionChange(false)`** (disconnect): `setViewers([])`.

- **Initial sync**  
  - The server broadcasts `presenceUpdated` when someone joins. New joiners get the list when they `presenceJoin`; existing clients get it from the same broadcast. Optional: server could also send current presence to the joining socket only right after `presenceJoin` (e.g. emit to `socket.id`), but broadcasting to the room is enough.

### 4. **AppHeader / modal**

- No code changes. They already read `viewers` from `ActiveViewersContext` and show **"X viewers"** + modal.

### 5. **Users**

- No changes. Keep using `user.id`, `user.full_name` / `user.email`, `user.role` from `useAuth()` → `auth-service`.  
- **Note:** `user.id` is `user_${Date.now()}` per sign-in. Same person, two tabs = two entries in presence. That’s fine for “who’s viewing” and doesn’t require a new user system.

---

## Edge cases (without rebuilding users)

| Case | Handling |
|------|----------|
| **User not signed in** | Don’t call `sendPresence`. They won’t appear in the list. You can hide the “viewers” UI when `!user` if you want. |
| **Same user, multiple tabs** | Each tab has its own socket; both can `presenceJoin`. List may show same name twice. Acceptable for now. |
| **Tab hidden / WebSocket disconnected** | You already disconnect when tab is hidden. On disconnect, server removes that socket from presence and broadcasts. List updates. |
| **Reconnect** | On `onConnectionChange(true)`, call `sendPresence` again. Server adds you back and broadcasts. |

---

## Summary

- **Users:** Use existing auth; no rebuild.
- **Presence:** In-memory on the server, keyed by `eventId` and `socketId`.
- **Client:** Send `presenceJoin` when connected (with current user), subscribe to `presenceUpdated`, and update `setViewers`.  
- **UI:** Already done; **"X viewers"** and the modal stay as they are.

This gives you real “viewing this event” presence with small, localized changes and no new user model or DB migrations.
