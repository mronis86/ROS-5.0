# 🚀 How to Start Local Servers

## Quick Reference

Your local setup has **TWO servers** that work together:

1. **Local API Server** (Port 3002) - Handles data, WebSocket, VMIX
2. **React Dev Server** (Port 3003) - Your web app

## ✅ Current Status

Based on your terminal, both servers are **ALREADY RUNNING**:
- ✅ Local API Server: Port 3002 (PID 18768)
- ✅ React Dev Server: Port 3003

## 🎯 How to Start Servers

### Option 1: Start Both Servers (Recommended)

**Double-click this file:**
```
start-local-dev.bat
```

This will open TWO terminal windows:
- Window 1: Local API Server (Port 3002)
- Window 2: React Dev Server (Port 3003)

### Option 2: Start API Server Only

**Double-click this file:**
```
start-local-api-only.bat
```

Use this when:
- You only need VMIX integration
- You only need the API endpoints
- React app is already running

### Option 3: Manual Start (Terminal)

**Terminal 1 - API Server:**
```bash
node local-server.js
```

**Terminal 2 - React App:**
```bash
npm run dev
```

## 🔍 How to Check if Servers are Running

### Check API Server (Port 3002):
```bash
# PowerShell
curl http://localhost:3002/api

# Or open in browser:
http://localhost:3002/api
```

### Check React App (Port 3003):
```bash
# Open in browser:
http://localhost:3003
```

### Check Both Ports:
```bash
netstat -ano | findstr ":3002"
netstat -ano | findstr ":3003"
```

## 🛑 How to Stop Servers

### Stop All Node Processes:
```bash
taskkill /F /IM node.exe
```

### Stop Specific Port:
```bash
# Find process ID
netstat -ano | findstr ":3002"

# Kill that process (replace PID with actual number)
taskkill /F /PID 18768
```

### Stop from Terminal:
Press `Ctrl+C` in the terminal window running the server

## 📊 What Each Server Does

### Local API Server (Port 3002)
```
✅ REST API endpoints
✅ WebSocket for real-time updates
✅ XML/CSV endpoints for VMIX
✅ Connected to Neon database
✅ CORS enabled
✅ Network accessible
```

**Endpoints:**
- `/api/run-of-show-data/:eventId`
- `/api/lower-thirds.xml?eventId=xxx`
- `/api/lower-thirds.csv?eventId=xxx`
- `/api/schedule.xml?eventId=xxx`
- `/api/schedule.csv?eventId=xxx`
- `/api/custom-columns.xml?eventId=xxx`
- `/api/custom-columns.csv?eventId=xxx`

### React Dev Server (Port 3003)
```
✅ Full React application
✅ Hot module reloading
✅ Talks to local API server
✅ Network accessible
```

## 🧪 Testing Your Setup

### 1. Test API Server:
Open in browser:
```
http://localhost:3002/api
```

Should show:
```
Local API Server Running

Available endpoints:
- /api/run-of-show-data/:eventId
- /api/lower-thirds.xml?eventId=xxx
...
```

### 2. Test React App:
Open in browser:
```
http://localhost:3003
```

Should show the login page or event list.

### 3. Test WebSocket:
Open `test-local-server.html` in browser and click "Connect"

### 4. Test VMIX Endpoint:
Open in browser (replace with your event ID):
```
http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID
```

Should show XML data.

## 🌐 Network Access

### From Your Computer:
- React App: http://localhost:3003
- API Server: http://localhost:3002

### From Other Devices (same network):
- React App: http://192.168.1.232:3003
- API Server: http://192.168.1.232:3002

## 🔧 Troubleshooting

### "Port already in use"
```bash
# Kill the process on that port
npx kill-port 3002
npx kill-port 3003

# Or kill all Node processes
taskkill /F /IM node.exe

# Then restart
start-local-dev.bat
```

### "Cannot connect to database"
Check your `.env` file has:
```
NEON_DATABASE_URL=postgresql://...
```

### "Cannot connect to API server"
1. Check if API server is running:
   ```bash
   netstat -ano | findstr ":3002"
   ```

2. If not running, start it:
   ```bash
   node local-server.js
   ```

### "React app shows errors"
1. Check browser console for errors
2. Make sure API server is running
3. Try clearing browser cache
4. Restart React dev server

## 📝 Files Reference

### Batch Files:
- `start-local-dev.bat` - Start both servers
- `start-local-api-only.bat` - Start API server only

### Server Files:
- `local-server.js` - Local API + WebSocket server
- `server.js` - Old server (don't use, has Supabase code)

### Test Files:
- `test-local-server.html` - Interactive test page

### Documentation:
- `LOCAL-SETUP-GUIDE.md` - Complete setup guide
- `LOCAL-SERVER-SUMMARY.md` - Quick reference
- `HOW-TO-START-SERVERS.md` - This file

## 🎯 Quick Commands

```bash
# Start both servers
start-local-dev.bat

# Start API only
start-local-api-only.bat

# Check if running
netstat -ano | findstr ":3002"
netstat -ano | findstr ":3003"

# Stop all
taskkill /F /IM node.exe

# Test API
curl http://localhost:3002/api

# Open React app
start http://localhost:3003

# Open test page
start test-local-server.html
```

## ✅ Your Current Setup

Right now (based on terminal output):
- ✅ Local API Server is running on port 3002
- ✅ React Dev Server is running on port 3003
- ✅ WebSocket connections are working
- ✅ Database is connected

**You're all set! Just open http://localhost:3003 to use the app!**

