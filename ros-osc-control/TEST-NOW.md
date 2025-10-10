# 🧪 TEST NOW - Step by Step

## ✅ What Should Be Running

Check that you have these open:

1. **Electron App Window** - "ROS OSC Control" (just started)
2. **Browser Window** - RunOfShowPage at http://localhost:3003
3. **PowerShell** - api-server.js running (optional if using Railway)

## 🎯 Test 1: Verify Electron App

**In the Electron app window:**

✅ You should see:
- Header: "🎬 ROS OSC Control"
- OSC status indicator (should turn GREEN)
- Two event cards: "CO 100" and "NEON TEST"
- OSC Log sidebar on the right
- Bottom right shows: "Listening on: 0.0.0.0:57121"

✅ In DevTools (should open automatically):
```
🚀 Initializing ROS OSC Control...
📋 Config loaded: {apiMode: 'RAILWAY', apiUrl: 'https://ros-50-production.up.railway.app', ...}
✅ Events loaded: 2
✅ Socket.IO connected!
📡 Joined event room: event:XXXXX
```

❌ If OSC status is RED or stuck on "Initializing":
- Check the main terminal for errors
- Port 57121 might be in use

## 🎯 Test 2: Load an Event

**In the Electron app:**
- Click on **"NEON TEST"** event card

✅ You should see:
- Page switches to Run of Show view
- Event name at top: "NEON TEST"
- Schedule table loads with cues
- Current cue display shows "No CUE Selected"

✅ In DevTools console:
```
🎬 Event selected: XXXXX NEON TEST
📡 Connecting to Socket.IO
✅ Socket.IO connected!
✅ Schedule loaded: XX items
```

## 🎯 Test 3: Send OSC Command

**Open a NEW terminal/PowerShell:**
```bash
cd C:\Users\audre\OneDrive\Desktop\ROS-5.0\ros-osc-control
node test-osc-commands.js
```

✅ In test script terminal, you should see:
```
✅ OSC Test Client Ready
📤 Sending: /cue/1/load
📤 Sending: /cue/1.1/load
📤 Sending: /timer/start
...
```

✅ In Electron app OSC Log (right sidebar):
```
[TIME] RECEIVED /cue/1/load
[TIME] RECEIVED /cue/1.1/load
[TIME] RECEIVED /timer/start
...
```

## 🎯 Test 4: Browser Updates from OSC

**In your browser (RunOfShowPage):**

When the test script runs, watch the browser:

✅ After `/cue/1/load`:
- Top bar shows: "LOADED - CUE 1"
- Timer shows duration (not counting)
- Row 1 highlighted in yellow

✅ After `/timer/start`:
- Status changes to: "RUNNING - CUE 1" (green)
- Timer starts counting down
- Progress bar fills

✅ After `/timer/stop`:
- Timer stops
- Status returns to idle

✅ In browser console:
```
📡 Socket.IO update received: timerUpdated
✅ RunOfShow: Active timer updated via WebSocket
```

## 🎯 Test 5: Electron App Updates from Browser

**In your browser:**
- Click the LOAD button on a different cue (e.g., CUE 2)

**In the Electron app:**

✅ Should update to show:
- Current cue: CUE 2
- Status: LOADED
- Schedule table highlights CUE 2

✅ In Electron DevTools console:
```
📨 Socket.IO update received: {type: 'timerUpdated', ...}
🔄 Handling timer update
```

## ✅ Success!

If all tests pass, you have a **fully functional OSC control system**!

## 🎬 Real-World Usage

### From QLab:

1. Create a Network cue
2. Destination: `127.0.0.1`
3. Port: `57121`
4. Type: `UDP`
5. Message: `/cue/1/load`

### From TouchOSC:

1. Add OSC button
2. OSC Message: `/cue/1/load`
3. Host: Your computer's IP
4. Port (outgoing): `57121`

### From Python Script:

```python
from pythonosc import udp_client

client = udp_client.SimpleUDPClient("127.0.0.1", 57121)
client.send_message("/cue/1/load", [])
client.send_message("/timer/start", [])
```

## 🔧 Troubleshooting

### "OSC not initializing"
- Check port 57121 isn't in use: `netstat -ano | findstr :57121`
- Kill the process or change port in .env

### "Events don't load"
- Check Railway is accessible: Visit https://ros-50-production.up.railway.app/health
- Check DevTools for error messages

### "Browser doesn't update from OSC"
- Verify browser shows "Socket.IO connected"
- Check browser is using same event as Electron app
- Hard refresh browser (Ctrl+Shift+R)

### "Electron app doesn't update from browser"
- Check Electron console shows "Socket.IO connected"
- Verify same event loaded in both

## 📋 What's Working

Based on your earlier console logs, **OSC IS working!** You saw:
```
user_id: 'osc-electron-app'
✅ RunOfShow: Active timer updated via WebSocket
```

This proves OSC commands are reaching Railway and updating the browser!

## 🎉 Final Step

**Just test it one more time** to confirm everything is syncing:

1. Send OSC: `/cue/1/load`
2. Watch browser update
3. Click LOAD in browser
4. Watch Electron app update

**If both directions work, you're done!** 🚀

