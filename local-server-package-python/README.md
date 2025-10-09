# Run of Show - Local Server (Python Version)

## 📦 What's Included

This package contains everything you need to run the Run of Show application locally using **Python only** (no Node.js required):

- **React Web Application** - Full-featured Run of Show interface
- **Python API Server** - Serves data for VMIX integration on port 3002
- **Database Connection** - Connects to your Neon PostgreSQL database
- **All VMIX Endpoints** - XML and CSV data feeds for Lower Thirds, Schedule, and Custom Columns

## 🚀 Quick Start

### Prerequisites

You need **Python 3.8 or higher** installed on your computer. Download it from:
- https://www.python.org/downloads/

**IMPORTANT:** During Python installation, check the box that says **"Add Python to PATH"**!

### Installation & Running

**EASY WAY - Just Double-Click:**
1. Extract this ZIP file to a folder
2. Double-click `START-SERVER.bat`
3. Wait for dependency installation (first time only - takes 1-2 minutes)
4. The server will start automatically!

**Manual Way:**
1. Open Command Prompt or PowerShell
2. Navigate to this folder: `cd path/to/local-server-package-python`
3. Install dependencies: `pip install -r requirements.txt` (first time only)
4. Start server: `python server.py`

## 🌐 Access the Application

Once the server is running, open your browser and go to:

- **Main App**: http://localhost:3002
- **API Server**: http://localhost:3002/api

## 🎬 VMIX Integration URLs

Use these URLs in VMIX Data Sources:

### Lower Thirds
- **XML**: `http://localhost:3002/api/lower-thirds.xml?eventId=YOUR_EVENT_ID`
- **CSV**: `http://localhost:3002/api/lower-thirds.csv?eventId=YOUR_EVENT_ID`

### Schedule
- **XML**: `http://localhost:3002/api/schedule.xml?eventId=YOUR_EVENT_ID`
- **CSV**: `http://localhost:3002/api/schedule.csv?eventId=YOUR_EVENT_ID`

### Custom Columns
- **XML**: `http://localhost:3002/api/custom-columns.xml?eventId=YOUR_EVENT_ID`
- **CSV**: `http://localhost:3002/api/custom-columns.csv?eventId=YOUR_EVENT_ID`

**Note:** Replace `YOUR_EVENT_ID` with your actual event ID from the app.

## 🔧 Configuration

### Database Setup

The `.env` file contains your database connection string. If you need to update it:

1. Open `.env` in a text editor (Notepad, VS Code, etc.)
2. Update the `NEON_DATABASE_URL` with your database connection string
3. Save the file
4. Restart the server

### Change Port

To change from port 3002 to another port:

1. Open `server.py` in a text editor
2. Find the line `PORT = 3002`
3. Change to your desired port (e.g., `PORT = 8000`)
4. Save and restart the server

## 📊 Features

- ✅ Full Run of Show scheduling interface
- ✅ VMIX integration (XML/CSV data feeds)
- ✅ Works completely offline (after initial setup)
- ✅ No Node.js required - Python only!
- ✅ Lower Thirds, Schedule, and Custom Columns support
- ✅ Real-time data from Neon database
- ✅ One-click startup

## 🛠 Troubleshooting

### Python not found
- Make sure Python is installed: run `python --version` in command prompt
- If not found, download from https://www.python.org/downloads/
- **During installation, check "Add Python to PATH"!**

### Dependencies won't install
- Make sure you have internet connection for first-time setup
- Try running: `python -m pip install --upgrade pip`
- Then: `pip install -r requirements.txt`

### Server won't start
- Make sure port 3002 is not in use by another application
- Check that `.env` file exists and has the database URL
- Verify Python version: `python --version` (should be 3.8 or higher)

### Can't access the app
- Make sure the server is running (you should see "Server Started!")
- Try http://localhost:3002 in your browser
- Check your firewall isn't blocking Python

### VMIX can't connect
- Make sure the local server is running
- Use the full URL with your event ID
- Check that VMIX can access localhost (some network configurations block this)

## 💡 Why Python Version?

- ✅ **No Node.js needed** - Only requires Python
- ✅ **Simpler setup** - Python is already needed for the Graphics Generator
- ✅ **One language** - Everything runs on Python
- ✅ **Same functionality** - All features work identically
- ✅ **Lighter weight** - Fewer dependencies

## 📝 Dependencies

This server uses only 2 Python packages:
- `psycopg2-binary` - PostgreSQL database connection
- `python-dotenv` - Environment variable loading

## 🆘 Support

For issues or questions, check the main Run of Show documentation or contact support.

## 📄 License

Proprietary - All rights reserved

