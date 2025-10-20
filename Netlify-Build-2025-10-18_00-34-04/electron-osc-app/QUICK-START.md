# ROS OSC Control - Quick Start Guide

## 🚀 Getting Started in 5 Minutes

### Step 1: Install Dependencies

Open PowerShell or Command Prompt in the `ros-osc-control` folder and run:

```bash
npm install
```

This will install:
- Electron (desktop app framework)
- osc (OSC message handling)
- axios (API communication)
- dotenv (configuration)

### Step 2: Configure the App

The `.env` file is already created with defaults. You can edit it if needed:

```env
API_MODE=LOCAL                          # Use LOCAL for testing, RAILWAY for production
LOCAL_API_URL=http://localhost:3001     # Your local api-server.js
RAILWAY_API_URL=https://your-app.railway.app
OSC_LISTEN_PORT=57121
OSC_LISTEN_HOST=0.0.0.0
```

### Step 3: Start Your API Server

**Make sure `api-server.js` is running!**

From the main project folder (ROS-5.0):
```bash
node api-server.js
```

You should see:
```
Server running on port 3001
```

### Step 4: Start the OSC Control App

Double-click: `start-ros-osc-control.bat`

Or from command line:
```bash
npm start
```

The app window will open and you'll see:
- Event list on the left
- OSC log on the right
- Green "OSC Listening" indicator in the header

### Step 5: Select an Event

Click on any event card to load its schedule. You'll now see:
- Run of Show schedule table
- Current cue display at the top
- Timer status

### Step 6: Test OSC Commands

#### Option A: Use the Test Script

Open a new terminal in the `ros-osc-control` folder:

```bash
node test-osc-commands.js
```

This will automatically send test commands and you'll see them appear in the OSC log.

#### Option B: Manual Testing with QLab, TouchOSC, etc.

Configure your OSC controller to send messages to:
- **IP Address**: `127.0.0.1` (or your computer's IP if remote)
- **Port**: `57121`

Send these commands:
- `/ros/load 1` - Load cue with ID 1
- `/ros/start` - Start the loaded cue
- `/ros/stop` - Stop the cue

## 📡 OSC Command Reference

| Command | Args | Example | Description |
|---------|------|---------|-------------|
| `/ros/load` | integer | `/ros/load 5` | Load cue by database ID |
| `/ros/load_by_cue` | string | `/ros/load_by_cue "1.0"` | Load by cue number |
| `/ros/start` | none | `/ros/start` | Start current cue timer |
| `/ros/stop` | none | `/ros/stop` | Stop current cue timer |
| `/ros/next` | none | `/ros/next` | Load next cue |
| `/ros/prev` | none | `/ros/prev` | Load previous cue |
| `/ros/goto` | integer | `/ros/goto 10` | Go to row 10 |

## 🎯 Testing Workflow

1. **Load a cue**: 
   ```
   /ros/load 1
   ```
   ✅ App shows "LOADED" status, cue number, and timer at 00:00:00

2. **Start the timer**:
   ```
   /ros/start
   ```
   ✅ Status changes to "RUNNING", timer starts counting down

3. **Stop the timer**:
   ```
   /ros/stop
   ```
   ✅ Status returns to idle, timer stops

4. **Navigate cues**:
   ```
   /ros/next
   ```
   ✅ Loads the next cue in the schedule

## 🔍 Troubleshooting

### OSC Messages Not Appearing in Log

1. **Check the port**: Make sure nothing else is using port 57121
2. **Check firewall**: Windows Firewall might block OSC messages
   - Go to Windows Firewall settings
   - Allow Electron through the firewall
3. **Check IP address**: If sending from another device, use your computer's actual IP (not 127.0.0.1)

### API Connection Failed

1. **Is api-server.js running?** Check that you see "Server running on port 3001"
2. **Correct API mode?** Make sure `API_MODE=LOCAL` in .env
3. **Check console**: Open DevTools (Ctrl+Shift+I) to see error messages

### No Events Showing

1. **Database connection**: Make sure api-server.js is connected to your Neon database
2. **Events exist**: Check that you have events in the `calendar_events` table
3. **API URL correct**: Verify the LOCAL_API_URL or RAILWAY_API_URL in .env

### App Closes Immediately

1. **Dependencies installed?** Run `npm install` again
2. **Port conflict**: Something else might be using port 57121
3. **Check logs**: Look at the terminal output for error messages

## 🎛️ Integration with QLab

### QLab Setup

1. In QLab, create a Network cue
2. Set Destination: Your computer's IP (or `127.0.0.1` if QLab is on same computer)
3. Set Port: `57121`
4. Set Type: `UDP`
5. Enter OSC command, e.g., `/ros/load 1`

### Example QLab Cue List

```
Cue 1: Network - /ros/load 1
Cue 2: Wait 0.5s
Cue 3: Network - /ros/start
Cue 4: Wait [auto-continue on timer complete]
Cue 5: Network - /ros/next
Cue 6: Wait 0.5s
Cue 7: Network - /ros/start
```

## 🌐 Remote Control Setup

To control from another computer or device:

1. **Find your computer's IP address**:
   - Windows: `ipconfig` (look for IPv4 Address)
   - Or use the `get-ip-address.bat` script in the main folder

2. **Update OSC Controller**:
   - Set destination IP to your computer's IP (e.g., `192.168.1.100`)
   - Keep port as `57121`

3. **Firewall**:
   - Allow inbound connections on port 57121
   - Windows Firewall → Advanced Settings → Inbound Rules → New Rule → Port 57121 UDP

## 💡 Tips

- **Keep the app open**: The app uses power save blocking, so it won't sleep even when minimized
- **OSC Log**: Watch the right sidebar to confirm commands are being received
- **Multi-client sync**: Changes made via OSC will sync to the web interface and vice versa
- **Development mode**: Run `npm run dev` to open DevTools for debugging

## 📞 Need Help?

1. Check the OSC Log sidebar - does the message appear there?
2. Check DevTools console (Ctrl+Shift+I) for JavaScript errors
3. Check api-server.js terminal output for API errors
4. Verify your database connection is working

## 🎬 Ready to Go!

You now have a powerful OSC-controlled Run of Show system that:
- Never sleeps or pauses
- Receives OSC commands reliably
- Syncs with your web interface
- Shows real-time timer status
- Logs all OSC activity

Enjoy! 🚀

