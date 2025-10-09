# 🔍 Debug: Local Server Connection

## What Was Added

### 1. Visual Server Status Banner
Added a banner at the top of the Event List page that shows which server you're connected to:
- **Green Banner** = 🏠 Connected to LOCAL Server
- **Blue Banner** = ☁️ Connected to RAILWAY Server

### 2. Console Logging
Added debug logs to the browser console:
```javascript
console.log('🌐 API Base URL:', import.meta.env.VITE_API_BASE_URL);
console.log('🌐 Environment:', import.meta.env.PROD ? 'Production' : 'Development');
```

## How to Test

### Step 1: Open the App
```
http://localhost:3003
```

### Step 2: Check the Banner
Look at the top of the Event List page:
- **Green banner "Connected to LOCAL Server"** = ✅ Working correctly!
- **Blue banner "Connected to RAILWAY Server"** = ❌ Still using Railway

### Step 3: Check Browser Console
Open browser DevTools (F12) and look for:
```
🔄 Loading events from Neon database...
🌐 API Base URL: http://localhost:3002
🌐 Environment: Development
```

### Step 4: Test API Directly
Open in browser:
```
http://localhost:3002/api/calendar-events
```

Should return JSON with your events.

## If Still Showing Railway

### Option 1: Hard Refresh
1. Open http://localhost:3003
2. Press `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
3. This clears the cache and reloads

### Option 2: Clear Browser Cache
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

### Option 3: Verify .env File
Check that `.env` has:
```env
VITE_API_BASE_URL=http://localhost:3002
```

### Option 4: Restart Everything
```bash
# Kill all Node processes
taskkill /F /IM node.exe

# Start local server
node local-server.js

# Start React app (in new terminal)
npm run dev
```

## Current Status

✅ **Local API Server** - Running on port 3002
✅ **React Dev Server** - Running on port 3003
✅ **Environment Variable** - Set in `.env`
✅ **Visual Indicator** - Added to Event List page
✅ **Debug Logging** - Added to console

## What to Look For

### In Browser:
- Green banner at top = Using local server ✅
- Blue banner at top = Using Railway ❌

### In Console:
- `API Base URL: http://localhost:3002` = Correct ✅
- `API Base URL: https://ros-50-production.up.railway.app` = Wrong ❌

### In Network Tab:
- Requests go to `localhost:3002` = Correct ✅
- Requests go to `ros-50-production.up.railway.app` = Wrong ❌

## Troubleshooting

### "Still seeing Railway"
1. Make sure you restarted the React server AFTER adding the `.env` variable
2. Clear browser cache (Ctrl+Shift+R)
3. Check `.env` file has `VITE_API_BASE_URL=http://localhost:3002`

### "Green banner but no events"
1. Check local server is running: `curl http://localhost:3002/api/calendar-events`
2. Check database has events
3. Check browser console for errors

### "Can't connect to local server"
1. Verify server is running: `netstat -ano | findstr ":3002"`
2. If not running: `node local-server.js`
3. Test endpoint: `curl http://localhost:3002/api`

## Next Steps

Once you see the **GREEN banner** and events load:
1. ✅ Local setup is working!
2. ✅ You can use the app without Railway
3. ✅ VMIX can use local endpoints
4. ✅ Everything works offline

**The green banner is your confirmation that you're using the local server!** 🎉

