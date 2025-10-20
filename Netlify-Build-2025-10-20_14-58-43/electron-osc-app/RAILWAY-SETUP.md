# Railway Setup - ROS OSC Control

## ✅ Configured for Railway!

The Electron OSC Control app is now configured to use **Railway** by default, just like your browser does.

## 🌐 Current Setup

**Both interfaces now use Railway:**
- ✅ Browser → Railway WebSocket (https://ros-50-production.up.railway.app)
- ✅ Electron OSC App → Railway API (https://ros-50-production.up.railway.app)
- ✅ OSC commands → Railway API
- ✅ All synced via Railway's Socket.IO

## 🚀 How It Works Now

```
OSC Controller (QLab, etc.)
    ↓ /cue/1/load
Electron App (OSC Server on port 57121)
    ↓
Railway API (https://ros-50-production.up.railway.app)
    ↓ Updates database
    ↓ Broadcasts Socket.IO
    ├─→ Browser A receives update ✅
    ├─→ Browser B receives update ✅
    └─→ Electron App receives update ✅
```

## 📁 Configuration

The `.env` file is set to:
```env
API_MODE=RAILWAY
RAILWAY_API_URL=https://ros-50-production.up.railway.app
```

## 🎯 Benefits of Railway Mode

✅ **No local server needed** - api-server.js doesn't need to run locally  
✅ **Works from anywhere** - As long as you have internet  
✅ **Same as browser** - Uses exact same backend  
✅ **Multi-device sync** - All devices sync via Railway  
✅ **Reliable** - Railway's infrastructure is more stable than local  

## 🧪 Testing

### 1. Start the Electron App
```bash
cd ros-osc-control
npm start
```

### 2. Verify Railway Connection
In the app's DevTools console, you should see:
```
📋 Config loaded: {apiMode: 'RAILWAY', apiUrl: 'https://ros-50-production.up.railway.app', ...}
✅ Socket.IO connected!
```

### 3. Load an Event
Click on an event - it will load from Railway database

### 4. Send OSC Command
```bash
node test-osc-commands.js
```

Or from your OSC controller:
```
/cue/1/load
/timer/start
```

### 5. Verify in Browser
Open your browser to RunOfShowPage - you should see the cue load/start in real-time!

## 🔧 Switching Back to Local

If you want to use local mode later:

1. Edit `.env`:
   ```env
   API_MODE=LOCAL
   ```

2. Make sure `api-server.js` is running locally on port 3001

3. Restart the Electron app

## ✅ Success Indicators

**When Railway mode is working:**
- ✅ Events load from Railway database
- ✅ Socket.IO connects to Railway
- ✅ OSC commands update the browser in real-time
- ✅ Browser updates sync to Electron app
- ✅ No "ERR_CONNECTION_REFUSED" errors for Railway URLs

## 🎉 You're Ready!

The OSC Control system now works with Railway, matching your browser setup perfectly!

**Test it and let me know if OSC commands now update the browser!** 🚀

