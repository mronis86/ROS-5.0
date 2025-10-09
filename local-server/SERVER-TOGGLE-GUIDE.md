# 🔄 Server Toggle Feature

## What Was Added

A **toggle button** on the Event List page that lets you switch between LOCAL and RAILWAY servers with one click!

## How to Use

### Step 1: Open the Event List Page
```
http://localhost:3003
```

### Step 2: Look at the Top Banner

You'll see one of two banners:

**GREEN Banner:**
```
🏠 Connected to LOCAL Server (http://localhost:3002)  [Switch to RAILWAY]
```

**BLUE Banner:**
```
☁️ Connected to RAILWAY Server (https://ros-50-production.up.railway.app)  [Switch to LOCAL]
```

### Step 3: Click the Toggle Button

- Click **"Switch to LOCAL"** to force the app to use your local server
- Click **"Switch to RAILWAY"** to use the Railway cloud server

The page will automatically reload with the new server!

## Features

✅ **Visual Indicator** - Green = Local, Blue = Railway
✅ **One-Click Toggle** - Switch servers instantly
✅ **Persistent** - Your choice is saved in localStorage
✅ **Auto-Reload** - Page refreshes automatically after switching
✅ **Works Everywhere** - Affects all API calls throughout the app

## How It Works

1. **Toggle State** - Saved in localStorage as `forceLocalServer`
2. **Window Override** - Sets `window.__FORCE_LOCAL_API__` flag
3. **API Client** - Checks the flag before making requests
4. **Auto-Reload** - Refreshes page to clear any cached data

## Testing

### Test LOCAL Server:
1. Click "Switch to LOCAL"
2. Page reloads with GREEN banner
3. Events should load from `localhost:3002`
4. Check console: `API Base URL: http://localhost:3002`

### Test RAILWAY Server:
1. Click "Switch to RAILWAY"
2. Page reloads with BLUE banner
3. Events should load from Railway
4. Check console: `API Base URL: https://ros-50-production.up.railway.app`

## Troubleshooting

### "Toggle doesn't work"
1. Make sure local server is running: `node local-server.js`
2. Check console for errors
3. Try a hard refresh: `Ctrl+Shift+R`

### "Still showing wrong server after toggle"
1. Clear browser cache
2. Check localStorage: Open DevTools → Application → Local Storage
3. Look for `forceLocalServer` key

### "Local server not responding"
1. Verify server is running: `curl http://localhost:3002/api`
2. Check port 3002 is listening: `netstat -ano | findstr ":3002"`
3. Restart server: `node local-server.js`

## Benefits

✅ **Easy Testing** - Switch between servers instantly
✅ **No Code Changes** - No need to edit `.env` or restart
✅ **Visual Feedback** - Always know which server you're using
✅ **Persistent Choice** - Remembers your preference
✅ **Works Offline** - Use local server when Railway is down

## Use Cases

### Development:
- Toggle to LOCAL for testing changes
- No Railway egress costs
- Faster response times

### Production Testing:
- Toggle to RAILWAY to test live deployment
- Verify Railway is working
- Compare behavior between servers

### Railway Down:
- Toggle to LOCAL to keep working
- All features still work
- No interruption to your workflow

## Current Status

✅ **Toggle Button** - Added to Event List page
✅ **Visual Indicator** - Green/Blue banner
✅ **API Override** - Respects toggle in all API calls
✅ **Persistent State** - Saved in localStorage
✅ **Auto-Reload** - Refreshes after toggle

## Next Steps

1. Open http://localhost:3003
2. Look for the toggle button in the top banner
3. Click it to switch servers
4. Watch the banner change color
5. Verify events load from the correct server

**The toggle makes it super easy to test both servers!** 🎉

