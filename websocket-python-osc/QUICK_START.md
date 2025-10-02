# 🚀 Quick Start Guide

## Get Started in 3 Steps!

### 1️⃣ Install Dependencies
**Double-click `install.bat`** - This installs everything you need

### 2️⃣ Start the App  
**Double-click `run.bat`** - This starts the WebSocket OSC Control Panel

### 3️⃣ Connect & Control
1. **Go to "Authentication" tab**
2. **Click "Load Events (No Auth)"** for quick access
3. **Go to "Events" tab** and select an event
4. **Use OSC commands** to control your system!

## 🎯 What You Get

- **Real-time WebSocket connection** to your API server
- **OSC server** running on port 57130
- **Event management** with Neon database
- **Timer control** via OSC commands
- **Comprehensive logging** with color-coded messages

## 🔧 OSC Commands

Send these commands to `localhost:57130`:

```
/set-event <eventId>     - Load an event
/cue/1/load              - Load cue 1
/timer/start             - Start timer
/timer/stop              - Stop timer
/status                  - Get status
```

## 📊 Log Tab

- **Green messages** = Success ✅
- **Red messages** = Errors ❌  
- **Orange messages** = Warnings ⚠️
- **Black messages** = Info ℹ️

## 🆘 Need Help?

- **Check the Log tab** for error messages
- **Use "Test OSC Connection"** button
- **Use "Test WebSocket"** button
- **All activity is logged** with timestamps

---

**Ready to control your Run of Show system!** 🎉