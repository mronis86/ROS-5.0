# Debug Steps - ROS OSC Control

## What to Check Now

The app has been updated with better error handling and logging. Follow these steps:

### 1. Restart the App

Close the app completely and start again:
```bash
cd ros-osc-control
npm start
```

Or use: `start-everything.bat`

### 2. Check Terminal Output

In the terminal where you started the app, you should see:

```
🚀 App ready, creating window...
🔋 Power save blocker enabled - app will never sleep
🔋 Power save blocker ID: 1
🔋 Is preventing sleep: true
🎵 Initializing OSC...
📡 Creating OSC UDP Port...
   Address: 0.0.0.0
   Port: 57121
📡 Opening OSC port...
📡 OSC port opening...
🌐 Renderer loaded, ready to send messages
✅ OSC UDP Server listening on 0.0.0.0:57121
```

**If you see errors here**, tell me what they say!

### 3. Check DevTools Console

The app now opens DevTools automatically. Look at the Console tab:

**You should see:**
```
🌐 DOM loaded, initializing...
🚀 Initializing ROS OSC Control...
📋 Getting config from main process...
📋 Config loaded: {apiMode: 'LOCAL', apiUrl: 'http://localhost:3001', ...}
📡 Setting up IPC listeners...
🎯 Setting up event listeners...
📥 Loading events...
✅ Events loaded: X
✅ Initialization complete
```

**If you see errors**, screenshot them or tell me what they say!

### 4. Check OSC Status

In the app window, look at the header:
- Does the status indicator turn **GREEN**?
- Does it say "OSC Listening on 0.0.0.0:57121"?

**If it stays red**, check the terminal for OSC errors.

### 5. Try Clicking an Event

Click on an event card. In DevTools Console, you should see:
```
🎬 Event selected: X EventName 2024-XX-XX
📥 Loading schedule for event: X
✅ Schedule loaded: X items
✅ Event loaded successfully
```

**If you see an error instead**, tell me what it says!

### 6. Common Issues & Fixes

#### Issue: OSC Port Error
```
Error: listen EADDRINUSE: address already in use
```

**Fix:** Port 57121 is already in use. 

Find what's using it:
```bash
netstat -ano | findstr :57121
```

Kill that process or change the port in `.env`:
```
OSC_LISTEN_PORT=57122
```

#### Issue: Events Don't Load
```
Error loading events: Network Error
```

**Fix:** API server not running or wrong URL.

Check:
1. Is `api-server.js` running? (Should see "Server running on port 3001")
2. Is `LOCAL_API_URL=http://localhost:3001` in `.env`?
3. Try visiting http://localhost:3001/health in your browser

#### Issue: Can't Click Events
```
Cannot read property 'textContent' of null
```

**Fix:** Event cards didn't render properly.

Check DevTools Console for errors during event loading.

### 7. Test OSC Commands

If OSC status is green, try sending a test command:

```bash
node test-osc-commands.js
```

You should see messages appear in the OSC Log sidebar (right side of app).

### 8. Report Back

Tell me:
1. ✅ or ❌ OSC status indicator (green or red?)
2. ✅ or ❌ Events loaded?
3. ✅ or ❌ Can click events and see schedule?
4. Any error messages from Terminal or DevTools

This will help me fix any remaining issues! 🔍

