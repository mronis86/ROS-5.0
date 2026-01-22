# Socket.IO Fix - Real-Time Updates

## 🔍 The Problem

When you sent OSC commands or clicked Load in the browser, the other interface didn't update. This was because **the Electron app wasn't listening to real-time updates!**

### What Was Happening:

```
Browser clicks LOAD
    ↓
Calls /api/cues/load  
    ↓
api-server.js updates database ✅
    ↓
api-server.js broadcasts via Socket.IO ✅
    ↓
❌ Electron app NOT listening! ← THE PROBLEM
```

## ✅ The Solution

Added Socket.IO client to the Electron app!

### Now It Works Like This:

```
OSC Command or Browser Click
    ↓
Calls /api/cues/load  
    ↓
api-server.js updates database ✅
    ↓
api-server.js broadcasts: io.emit('update', { type: 'timerUpdated', data: ... })
    ↓
✅ Electron app receives update via Socket.IO!
    ↓
✅ Browser receives update via Socket.IO!
    ↓
BOTH interfaces sync in real-time! 🎉
```

## 📡 What Was Added

### 1. **Socket.IO Client Package**
Added to `package.json`:
```json
"socket.io-client": "^4.5.4"
```

### 2. **Socket Connection Function**
In `src/renderer/app.js`:
```javascript
function connectToSocketIO(eventId) {
  socket = io(config.apiUrl);
  socket.on('connect', () => {
    socket.emit('join-event', eventId);  // Join event room
  });
  
  socket.on('update', (data) => {
    if (data.type === 'timerUpdated') {
      handleTimerUpdate(data.data);  // Update UI!
    }
  });
}
```

### 3. **Real-Time Update Handlers**
```javascript
function handleTimerUpdate(timerData) {
  // When OSC or Browser loads/starts a cue
  activeItemId = timerData.item_id;
  activeTimers[itemId] = timerData.is_running;
  updateCurrentCueDisplay();  // Update UI in real-time!
}
```

## 🧪 How to Test

### Setup:
1. Run `install-dependencies.bat` or `npm install` in ros-osc-control folder
2. Start everything: `start-everything.bat`
3. Open browser to RunOfShowPage
4. Load an event in BOTH the browser AND the Electron app

### Test Real-Time Sync:

**Test 1: OSC → Browser**
```bash
# Send OSC command
node test-osc-commands.js
# Or: oscsend localhost 57121 /cue/1/load
```
✅ **Browser should update** to show "LOADED" status

**Test 2: Browser → Electron App**
- Click LOAD button in browser
✅ **Electron app should update** to show "LOADED" status

**Test 3: Electron → Browser**
- Send OSC: `/timer/start`
✅ **Browser should show "RUNNING"** and timer counting down

## 📊 Socket.IO Events

The app now listens for these Socket.IO events from api-server.js:

| Event | Type | Triggered By |
|-------|------|--------------|
| `update` | `timerUpdated` | Load CUE, Start timer |
| `update` | `timerStopped` | Stop timer |

## 🔧 Files Changed

- ✅ `package.json` - Added socket.io-client
- ✅ `src/renderer/app.js` - Added Socket.IO connection & handlers
- ✅ `start-everything.bat` - Updated to check for socket.io-client
- ✅ `install-dependencies.bat` - New install script

## 🎉 Result

Now the OSC Control app works **EXACTLY like RunOfShowPage.tsx**:
- ✅ Receives real-time updates via Socket.IO
- ✅ Syncs with browser when OSC commands are sent
- ✅ Syncs with OSC app when browser buttons are clicked
- ✅ All clients see the same state in real-time

**The missing piece was Socket.IO! Now it's fixed!** 🚀

