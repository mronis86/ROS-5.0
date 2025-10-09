# ✅ Local Server Setup - Complete!

## What Was Built

A fully functional local Node.js server that provides:

1. **REST API Endpoints** - All the same endpoints as Railway
2. **WebSocket Support** - Real-time updates via Socket.IO
3. **Neon Database Connection** - Connected to your cloud database
4. **VMIX Integration** - XML/CSV endpoints for live graphics
5. **CORS Enabled** - Works from any origin
6. **Network Access** - Accessible from other devices on your network

## Files Created/Modified

### New Files:
- `local-server.js` - Main server file (API + WebSocket)
- `start-local-dev.bat` - Easy startup script
- `LOCAL-SETUP-GUIDE.md` - Complete setup documentation
- `LOCAL-SERVER-SUMMARY.md` - This file

### Modified Files:
- `src/services/api-client.ts` - Updated to use port 3002
- `src/services/database.ts` - Updated to use port 3002
- `src/services/socket-client.ts` - Updated to use port 3002
- `src/services/sse-client.ts` - Updated to use port 3002
- `src/services/neon-backup-service.ts` - Updated to use port 3002

## Server Architecture

```
┌─────────────────────────────────────────┐
│     Local Development Environment       │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   React Dev Server (Port 3003)   │  │
│  │   - Vite HMR                     │  │
│  │   - Full React App               │  │
│  └──────────────────────────────────┘  │
│              ↓ HTTP Requests            │
│  ┌──────────────────────────────────┐  │
│  │  Local API Server (Port 3002)    │  │
│  │  - REST API Endpoints            │  │
│  │  - WebSocket (Socket.IO)         │  │
│  │  - XML/CSV for VMIX              │  │
│  └──────────────────────────────────┘  │
│              ↓ SQL Queries              │
│  ┌──────────────────────────────────┐  │
│  │     Neon Database (Cloud)        │  │
│  │  - PostgreSQL                    │  │
│  │  - SSL Connection                │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

## How to Use

### Quick Start:
```bash
# Double-click this file:
start-local-dev.bat
```

### Manual Start:
```bash
# Terminal 1: Start API Server
node local-server.js

# Terminal 2: Start React App
npm run dev
```

### Access URLs:
- **React App:** http://localhost:3003
- **API Server:** http://localhost:3002
- **Network:** http://192.168.1.232:3003

## API Endpoints

All endpoints are available at `http://localhost:3002`:

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

## WebSocket Events

Connect to `ws://localhost:3002`:

```javascript
const socket = io('http://localhost:3002');

socket.on('message', (data) => {
  const message = JSON.parse(data);
  // Handle updates
});
```

## Benefits

✅ **No Egress Costs** - All traffic stays local
✅ **Fast Performance** - No internet latency
✅ **Full Control** - Complete control over environment
✅ **Easy Testing** - Test changes immediately
✅ **Network Access** - Use from other devices
✅ **VMIX Ready** - Direct XML/CSV endpoints

## VMIX Integration

Use these URLs in VMIX Data Sources:

### Lower Thirds:
```
http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID
http://localhost:3002/api/lower-thirds.csv?eventId=YOUR_EVENT_ID
```

### Schedule:
```
http://localhost:3002/api/schedule.xml?eventId=YOUR_EVENT_ID
http://localhost:3002/api/schedule.csv?eventId=YOUR_EVENT_ID
```

### Custom Columns:
```
http://localhost:3002/api/custom-columns.xml?eventId=YOUR_EVENT_ID
http://localhost:3002/api/custom-columns.csv?eventId=YOUR_EVENT_ID
```

## Testing

1. **Test API Server:**
   ```bash
   curl http://localhost:3002/api
   ```

2. **Test XML Endpoint:**
   ```bash
   curl "http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID"
   ```

3. **Test CSV Endpoint:**
   ```bash
   curl "http://localhost:3002/api/lower-thirds.csv?eventId=YOUR_EVENT_ID"
   ```

4. **Test WebSocket:**
   Open browser console and run:
   ```javascript
   const socket = io('http://localhost:3002');
   socket.on('connect', () => console.log('Connected!'));
   socket.on('message', (data) => console.log('Message:', data));
   ```

## Troubleshooting

### Port Already in Use
```bash
npx kill-port 3002
```

### Database Connection Error
Check your `.env` file has `NEON_DATABASE_URL` or `DATABASE_URL`.

### React App Not Loading
```bash
# Kill all Node processes
taskkill /F /IM node.exe

# Restart
start-local-dev.bat
```

### VMIX Not Updating
1. Verify event ID is correct
2. Check server is running: `curl http://localhost:3002/api`
3. Test URL in browser first
4. Set VMIX refresh interval to 10 seconds

## Next Steps

1. ✅ Local server is running
2. ✅ React app is connected
3. ⏳ Wait for Railway to resume (for production)
4. ⏳ Test VMIX integration locally
5. ⏳ Deploy to production when Railway is back

## Production Deployment

When Railway resumes:
- Railway will auto-deploy from GitHub
- Netlify will use Railway API
- Everything will work again

For now, use the local setup for development and testing!

## Support

See `LOCAL-SETUP-GUIDE.md` for detailed documentation.

