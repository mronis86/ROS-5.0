# WebSocket OSC Control Panel

A Python GUI application for controlling your Run of Show system via OSC commands and WebSocket connections.

## 🚀 Features

- **Real-time WebSocket connection** to your API server
- **OSC server** for external control from other applications
- **Authentication system** with sign-in/sign-up
- **Event management** with Neon database integration
- **Multi-day event support**
- **Comprehensive logging** with color-coded messages
- **Timer control** via OSC commands

## 📋 Requirements

- Python 3.8 or higher
- Internet connection to your API server

## 🛠️ Installation

### Option 1: Automatic Installation (Recommended)
1. **Run `install.bat`** - This will install all required dependencies
2. **Run `run.bat`** - This will start the application

### Option 2: Manual Installation
1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the application:**
   ```bash
   python websocket_osc_app.py
   ```

## 🎯 Usage

### Starting the Application
1. **Double-click `run.bat`** or run `python websocket_osc_app.py`
2. **The application will start** with 4 tabs:
   - **Authentication** - Sign in/up or use guest mode
   - **Events** - View and select events
   - **OSC Server** - OSC command reference
   - **Log** - Activity log with color-coded messages

### Authentication
- **Sign In/Sign Up** - Use the Authentication tab
- **Guest Mode** - Click "Load Events (No Auth)" for quick access

### OSC Commands
The OSC server runs on port **57130** by default. Supported commands:

```
/set-event <eventId>              - Set current event
/list-events                      - List all events  
/cue/<cueName>/load               - Load a cue
/timer/start                      - Start main timer
/timer/stop                       - Stop main timer
/timer/reset                      - Reset main timer
/subtimer/cue/<cueNumber>/start   - Start sub-timer
/subtimer/cue/<cueNumber>/stop    - Stop sub-timer
/status                           - Get current status
/list-cues                        - List available cues
/set-day <dayNumber>               - Set current day (1-7)
/get-day                          - Get current day
```

### Multi-Day Events
1. **Load an event** using `/set-event <eventId>`
2. **Set the day** using `/set-day <dayNumber>`
3. **List cues for that day** using `/list-cues`
4. **Load and control cues** as normal

## 🔧 Configuration

### API Server - Easy Server Switching with GUI Toggle! 🎉

The app includes a **built-in GUI toggle** to switch between Railway and Local Server - no code editing required!

#### How to Switch Servers:
1. **Open the app** and go to the **Authentication tab**
2. **Look for "🌐 Server Selection"** at the top
3. **Choose your server:**
   - **🚂 Railway (Remote Access)** - Default, works from anywhere
   - **🏠 Local Server** - For local network use (http://localhost:3002)
4. **Click your choice** - the app will automatically reconnect!

#### Option 1: Railway (Default - Remote Access)
- **URL:** `https://ros-50-production.up.railway.app`
- **Use when:** Accessing from anywhere, multiple locations
- **Benefits:** No setup needed, works globally

#### Option 2: Local Server (Local Network)
- **URL:** `http://localhost:3002`
- **Use when:** Running on local network, avoiding egress costs
- **Benefits:** Faster response, no internet required, free
- **Requirements:** Local Node.js server must be running on port 3002

### OSC Server
- **Port:** 57130 (default)
- **Protocol:** UDP
- **Address:** localhost

## 📊 Log Tab Features

- **Color-coded messages:**
  - 🟢 **Green** - Success messages
  - 🔴 **Red** - Error messages  
  - 🟠 **Orange** - Warning messages
  - ⚫ **Black** - Info messages

- **Test buttons:**
  - **Clear Log** - Clear the log display
  - **Test OSC Connection** - Test OSC connectivity
  - **Test WebSocket** - Test WebSocket connection
  - **Add Test Message** - Add a test log entry

## 🌐 WebSocket Integration

The app connects to your API server via WebSocket for real-time updates:
- **Timer updates** - Real-time timer status
- **Event changes** - Schedule updates
- **State synchronization** - Keeps all connected clients in sync

## 🔧 Troubleshooting

### Connection Issues
- **Check your internet connection**
- **Verify API server is running**
- **Check firewall settings** (port 57130 for OSC)

### Authentication Issues
- **Use guest mode** if authentication fails
- **Check API server authentication endpoints**

### OSC Issues
- **Test OSC connection** using the Log tab
- **Check port 57130** is not blocked
- **Verify OSC client** is sending to correct address

## 📁 File Structure

```
websocket-python-osc/
├── websocket_osc_app.py      # Main application
├── requirements.txt          # Python dependencies
├── install.bat               # Installation script
├── run.bat                   # Run script
└── README.md                 # This file
```

## 🚀 Quick Start

1. **Download the folder**
2. **Run `install.bat`** (first time only)
3. **Run `run.bat`** to start
4. **Go to Authentication tab** and sign in or use guest mode
5. **Go to Events tab** and select an event
6. **Use OSC commands** to control your system

## 📞 Support

For issues or questions:
- **Check the Log tab** for error messages
- **Test connections** using the Log tab buttons
- **Verify API server** is accessible from your network

---

**WebSocket OSC Control Panel** - Real-time control of your Run of Show system! 🎉