# 🏠 Local Development Setup Guide

## Overview

This guide will help you run the ROS 5.0 application locally with a full-featured API + WebSocket server.

## What's Included

- **Local API Server** (Port 3002)
  - REST API endpoints for run-of-show data
  - XML/CSV endpoints for VMIX integration
  - WebSocket support for real-time updates
  - Connected to Neon database

- **React Dev Server** (Port 3003)
  - Full React application
  - Hot module reloading
  - Network access for other devices

## Prerequisites

1. **Node.js** (v16 or higher)
2. **npm** (comes with Node.js)
3. **Environment Variables** (`.env` file in project root)

## Quick Start

### Option 1: Use the Batch File (Windows)

Double-click `start-local-dev.bat` to start both servers automatically!

### Option 2: Manual Start

1. **Start the Local API Server:**
   ```bash
   node local-server.js
   ```

2. **Start the React Dev Server (in a new terminal):**
   ```bash
   npm run dev
   ```

## Access URLs

### On Your Computer:
- **React App:** http://localhost:3003
- **API Server:** http://localhost:3002

### On Other Devices (same network):
- **React App:** http://192.168.1.232:3003
- **API Server:** http://192.168.1.232:3002

## API Endpoints

The local API server provides the following endpoints:

### Run of Show Data
```
GET /api/run-of-show-data/:eventId
```

### Lower Thirds
```
GET /api/lower-thirds.xml?eventId=xxx
GET /api/lower-thirds.csv?eventId=xxx
```

### Schedule
```
GET /api/schedule.xml?eventId=xxx
GET /api/schedule.csv?eventId=xxx
```

### Custom Columns
```
GET /api/custom-columns.xml?eventId=xxx
GET /api/custom-columns.csv?eventId=xxx
```

## WebSocket Connection

The server also provides WebSocket support for real-time updates:

```javascript
// Connect to WebSocket
const socket = io('http://localhost:3002');

// Listen for updates
socket.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Update:', message);
});
```

## Environment Variables

Make sure your `.env` file contains:

```env
# Neon Database
NEON_DATABASE_URL=postgresql://neondb_owner:...@ep-noisy-salad-adtczvk3-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require

# Or use DATABASE_URL
DATABASE_URL=postgresql://neondb_owner:...@ep-icy-rice-adxvj3et-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require

# Neon Auth (for React)
VITE_STACK_PROJECT_ID='d3a5668a-2fa9-4880-b72f-fff9f003d465'
VITE_STACK_PUBLISHABLE_CLIENT_KEY='pck_scmsr0fg066qpx8h20ject6r39cfpy3ygg65md9cvjvc8'
STACK_SECRET_SERVER_KEY='ssk_tw30fp0qsha84b3e6kp5w6qhj7a167n4t045y3qab34t0'
```

## VMIX Integration

### Using Local Server with VMIX

1. Make sure the local API server is running
2. In VMIX, add a new Data Source
3. Choose XML or CSV
4. Use one of these URLs:

**Lower Thirds XML:**
```
http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID
```

**Lower Thirds CSV:**
```
http://localhost:3002/api/lower-thirds.csv?eventId=YOUR_EVENT_ID
```

**Schedule XML:**
```
http://localhost:3002/api/schedule.xml?eventId=YOUR_EVENT_ID
```

**Schedule CSV:**
```
http://localhost:3002/api/schedule.csv?eventId=YOUR_EVENT_ID
```

**Custom Columns XML:**
```
http://localhost:3002/api/custom-columns.xml?eventId=YOUR_EVENT_ID
```

**Custom Columns CSV:**
```
http://localhost:3002/api/custom-columns.csv?eventId=YOUR_EVENT_ID
```

5. Set refresh interval to 10 seconds
6. Click "Add"

## Troubleshooting

### Port Already in Use

If you see "Port 3002 is already in use":

```bash
# Kill the process on port 3002
npx kill-port 3002

# Or use the batch file
kill-port-3002.bat
```

### Database Connection Error

Make sure your `.env` file has the correct `NEON_DATABASE_URL` or `DATABASE_URL`.

### React App Not Loading

1. Check if port 3003 is available
2. Try clearing browser cache
3. Check console for errors

### VMIX Not Updating

1. Verify the event ID in the URL is correct
2. Check if the local API server is running
3. Test the URL in a browser first
4. Make sure VMIX refresh interval is set

## Network Access

To access the app from other devices on your network:

1. Find your computer's IP address (already shown: `192.168.1.232`)
2. Make sure Windows Firewall allows connections on ports 3002 and 3003
3. Use `http://192.168.1.232:3003` from other devices

## Stopping the Servers

- Press `Ctrl+C` in each terminal window
- Or close the terminal windows
- Or use `taskkill /F /IM node.exe` to kill all Node processes

## Benefits of Local Setup

✅ **No Egress Costs** - All data stays on your local network
✅ **Fast Performance** - No internet latency
✅ **Works Offline** - No internet connection required (except for initial database access)
✅ **Full Control** - Complete control over your environment
✅ **Easy Testing** - Test changes immediately

## Production Deployment

For production, use:
- **Railway** for the API + WebSocket server
- **Netlify** for the React app

See `DEPLOYMENT_INSTRUCTIONS.md` for details.

