# 🚀 Local Run of Show Server

This setup provides a simple way to run the Run of Show application locally with full functionality.

## 🎯 What This Includes

- ✅ **Full React App** - Complete Run of Show interface from `Electron-React-Backup`
- ✅ **Real-time Supabase Integration** - Live timer updates and database sync
- ✅ **OSC Server** - External control via OSC commands (port 57121)
- ✅ **Professional UI** - Exact same interface as the main app

## 🚀 Quick Start

### Option 1: Batch File (Windows)
```bash
# Double-click this file or run in Command Prompt:
start-local-server.bat
```

### Option 2: PowerShell (Windows)
```powershell
# Right-click and "Run with PowerShell" or run in PowerShell:
.\start-local-server.ps1
```

### Option 3: Manual (Any OS)
```bash
# Navigate to the React app directory
cd Electron-React-Backup

# Install dependencies
npm install

# Start React server (port 3003)
npm start

# In another terminal, start OSC server
node standalone-osc-server.js
```

## 🌐 Access the App

Once running, open your browser to:
**http://localhost:3003**

## 🎵 OSC Commands

The OSC server listens on **port 57121** and accepts these commands:

- `/runofshow/load_cue [cueId]` - Load a specific cue
- `/runofshow/start_timer` - Start the current timer
- `/runofshow/stop_timer` - Stop the current timer
- `/runofshow/reset_timer` - Reset the current timer

## 🔧 Features

- **Real-time Updates**: Live timer synchronization across multiple browsers
- **Database Integration**: Full Supabase connectivity with real data
- **Professional Interface**: Complete Run of Show functionality
- **OSC Control**: External automation and control
- **Multi-display Support**: Works with multiple monitors
- **Change Tracking**: Real-time change logging and history

## 🛑 Stopping the Servers

To stop the servers:
1. Close the command windows that opened
2. Or press `Ctrl+C` in each terminal window

## 📁 Files Created

- `start-local-server.bat` - Windows batch file launcher
- `start-local-server.ps1` - PowerShell launcher
- `Electron-React-Backup/standalone-osc-server.js` - OSC server
- `README-Local-Server.md` - This documentation

## 🎉 Benefits

This approach gives you:
- **100% functionality** of the main Run of Show app
- **No custom development** needed
- **Real Supabase integration** with live updates
- **Professional interface** with all features
- **OSC automation** support
- **Easy deployment** - just run the batch file

Perfect for local testing, demos, or standalone deployment! 🚀




