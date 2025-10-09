# ROS Local Server - Node.js Edition

**Complete Local API + WebSocket Server for Run of Show**

This package provides a standalone Node.js server that runs both the API and WebSocket services locally, allowing you to:
- Access the full Run of Show application without Railway
- Generate VMIX XML/CSV feeds locally
- Use WebSocket for real-time updates
- Run on your local network

---

## 📦 What's Included

- **server.js** - Main Node.js server (API + WebSocket)
- **start-server.bat** - One-click startup script (Windows)
- **package.json** - Node.js dependencies
- Complete documentation and guides

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** (Download from https://nodejs.org)
- **Neon Database URL** (from your `.env` file)

### Installation

1. **Extract this folder** to your desired location

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create `.env` file** in this folder with your database URL:
   ```
   NEON_DATABASE_URL=postgresql://your_neon_connection_string
   DATABASE_URL=postgresql://your_neon_connection_string
   ```

4. **Start the server:**
   - **Windows**: Double-click `start-server.bat`
   - **Mac/Linux**: Run `node server.js`

5. **Server will start on:**
   - Local: http://localhost:3002
   - Network: http://YOUR_IP:3002

---

## 🌐 Using with React App

### Option A: Use with Full React App

1. Extract this server package
2. Start this server (port 3002)
3. Start the React app separately (port 3003)
4. Toggle to "Local Server" mode in the Event List page

### Option B: Standalone API Only

Use this server just for VMIX XML/CSV endpoints:
- http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID
- http://localhost:3002/api/schedule.csv?eventId=YOUR_EVENT_ID
- http://localhost:3002/api/custom-columns.xml?eventId=YOUR_EVENT_ID

---

## 📡 Available Endpoints

### Calendar Events
- `GET /api/calendar-events` - List all events

### Run of Show Data
- `GET /api/run-of-show-data/:eventId` - Get event data
- `POST /api/run-of-show-data/:eventId` - Update event data

### VMIX XML/CSV Feeds
- `GET /api/lower-thirds.xml?eventId=X` - Lower thirds XML
- `GET /api/lower-thirds.csv?eventId=X` - Lower thirds CSV
- `GET /api/schedule.xml?eventId=X` - Schedule XML
- `GET /api/schedule.csv?eventId=X` - Schedule CSV
- `GET /api/custom-columns.xml?eventId=X` - Custom columns XML
- `GET /api/custom-columns.csv?eventId=X` - Custom columns CSV

### WebSocket
- `ws://localhost:3002` - Real-time updates

---

## 🔧 Configuration

### Port Configuration
Default port is **3002**. To change:
1. Edit `server.js`
2. Find: `const PORT = process.env.PORT || 3002;`
3. Change to your desired port

### Network Access
The server listens on `0.0.0.0` by default, making it accessible from:
- Same computer: http://localhost:3002
- Local network: http://192.168.1.X:3002 (your IP)
- Other devices on network: http://YOUR_IP:3002

---

## 🐛 Troubleshooting

### "Port already in use"
```bash
# Windows
netstat -ano | findstr :3002
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:3002 | xargs kill -9
```

### "Cannot find module"
```bash
npm install
```

### "Database connection failed"
- Check your `.env` file exists
- Verify `NEON_DATABASE_URL` is correct
- Test connection: https://console.neon.tech

### Server not accessible from network
- Check Windows Firewall settings
- Allow Node.js through firewall
- Verify your local IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)

---

## 📚 Additional Documentation

- **LOCAL-SETUP-GUIDE.md** - Detailed setup instructions
- **HOW-TO-START-SERVERS.md** - Starting both React + API servers
- **SERVER-TOGGLE-GUIDE.md** - Switching between Railway and Local
- **DEBUG-LOCAL-SERVER.md** - Debugging tips

---

## 🆚 Local Server vs Railway

| Feature | Local Server | Railway |
|---------|-------------|---------|
| **Cost** | Free | Egress charges |
| **Speed** | Fastest (LAN) | Internet dependent |
| **Setup** | Requires Node.js | Zero setup |
| **Network** | Local only | Global access |
| **Use Case** | Production/Testing | Remote access |

---

## 💡 Best Practices

1. **For Production Events**: Use local server to avoid egress costs
2. **For Remote Access**: Use Railway when accessing from different locations
3. **For VMIX**: Use local server endpoints (no internet lag)
4. **For Development**: Use local server with React app

---

## 🔐 Security Notes

- This server has CORS enabled for all origins (development mode)
- For production, consider restricting CORS to specific domains
- Keep your `.env` file secure and never commit it to git
- Use environment variables for sensitive data

---

## 📞 Support

For issues or questions:
1. Check the documentation files included
2. Verify Node.js and dependencies are installed
3. Check server logs for error messages
4. Ensure database connection is working

---

## 📄 License

Part of the Run of Show Timer application.
