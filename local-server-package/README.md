# Run of Show - Local Server Package

## 📦 What's Included

This package contains everything you need to run the Run of Show application locally on your computer:

- **React Web Application** - Full-featured Run of Show interface
- **API Server** - Serves data for VMIX integration
- **WebSocket Server** - Real-time updates across all connected devices
- **Database Connection** - Connects to your Neon PostgreSQL database

## 🚀 Quick Start

### Prerequisites

You need **Node.js** installed on your computer. Download it from:
- https://nodejs.org/ (Download the LTS version)

### Installation & Running

**EASY WAY - Just Double-Click:**
1. Extract this ZIP file to a folder
2. Double-click `START-LOCAL-SERVER.bat`
3. Wait for installation (first time only - takes 2-3 minutes)
4. The server will start automatically!

**Manual Way:**
1. Open Command Prompt or PowerShell
2. Navigate to this folder: `cd path/to/local-server-package`
3. Install dependencies: `npm install` (first time only)
4. Start server: `npm start`

## 🌐 Access the Application

Once the server is running, open your browser and go to:

- **Main App**: http://localhost:3002
- **API Server**: http://localhost:3002/api

## 🎬 VMIX Integration URLs

Use these URLs in VMIX Data Sources:

### Lower Thirds
- XML: `http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID`
- CSV: `http://localhost:3002/api/lower-thirds.csv?eventId=YOUR_EVENT_ID`

### Schedule
- XML: `http://localhost:3002/api/schedule.xml?eventId=YOUR_EVENT_ID`
- CSV: `http://localhost:3002/api/schedule.csv?eventId=YOUR_EVENT_ID`

### Custom Columns
- XML: `http://localhost:3002/api/custom-columns.xml?eventId=YOUR_EVENT_ID`
- CSV: `http://localhost:3002/api/custom-columns.csv?eventId=YOUR_EVENT_ID`

**Note:** Replace `YOUR_EVENT_ID` with your actual event ID from the app.

## 🔧 Configuration

### Database Setup

The `.env` file contains your database connection string. If you need to update it:

1. Open `.env` in a text editor
2. Update the `NEON_DATABASE_URL` with your database connection string
3. Save the file
4. Restart the server

### Ports

The server runs on port **3002** by default. If you need to change this:

1. Open `server.js` in a text editor
2. Find `const PORT = 3002;`
3. Change to your desired port
4. Save and restart

## 📊 Features

- ✅ Full Run of Show scheduling interface
- ✅ Real-time timer synchronization
- ✅ VMIX integration (XML/CSV data feeds)
- ✅ WebSocket real-time updates
- ✅ Works completely offline (after first setup)
- ✅ No cloud dependencies while running
- ✅ Lower Thirds, Schedule, and Custom Columns support

## 🛠 Troubleshooting

### Server won't start
- Make sure Node.js is installed: run `node --version` in command prompt
- Make sure port 3002 is not in use by another application
- Check that `.env` file exists and has the database URL

### Can't access the app
- Make sure the server is running (you should see "Server running on port 3002")
- Try http://localhost:3002 in your browser
- Check your firewall isn't blocking Node.js

### VMIX can't connect
- Make sure the local server is running
- Use the full URL with your event ID
- Check that VMIX can access localhost (some network configurations block this)

## 📝 Notes

- The server must be running for VMIX to access the data
- Data is fetched from your Neon database in real-time
- Auto-refreshes every 10 seconds
- WebSocket provides instant updates when data changes

## 🆘 Support

For issues or questions, check the main Run of Show documentation or contact support.

## 📄 License

Proprietary - All rights reserved

