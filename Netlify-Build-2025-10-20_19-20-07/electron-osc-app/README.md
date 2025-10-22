# ROS OSC Control - Electron App

A dedicated Electron application for controlling Run of Show events via OSC commands. This app **never sleeps** when minimized and continuously listens for OSC commands to control timers and cues.

## Features

✅ **Never Sleeps** - Uses Electron's power save blocker to prevent the app from sleeping  
✅ **OSC Control** - Receives OSC messages to load, start, and stop cues  
✅ **Event Selection** - Browse and select events from your API  
✅ **Run of Show Display** - Full schedule display with current cue and timer status  
✅ **OSC Log** - Real-time log of all incoming OSC messages  
✅ **Local/Railway Toggle** - Switch between local API and Railway deployment  
✅ **Real-time Sync** - Syncs with your API server to show accurate timer states

## Installation

1. **Navigate to the app directory:**
   ```bash
   cd ros-osc-control
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure the app:**
   - Copy `.env` file and edit it with your settings
   - Set `API_MODE` to `LOCAL` or `RAILWAY`
   - Set your Railway URL if using Railway mode

## Running the App

### Windows
Double-click `start-ros-osc-control.bat` or run:
```bash
npm start
```

### Development Mode (with DevTools)
```bash
npm run dev
```

## Configuration

Edit the `.env` file:

```env
# API Mode - Choose LOCAL or RAILWAY
API_MODE=LOCAL

# Local API URL (when running api-server.js locally)
LOCAL_API_URL=http://localhost:3001

# Railway API URL (your deployed Railway backend)
RAILWAY_API_URL=https://your-app.railway.app

# OSC Configuration
OSC_LISTEN_PORT=57121
OSC_LISTEN_HOST=0.0.0.0
```

## OSC Commands

The app listens for OSC messages on **port 57121** (configurable in `.env`).

**These commands EXACTLY match the OSC Modal in RunOfShowPage.tsx**

### Main Cue Commands

Load cues by their cue number:

| OSC Address | Description | Example |
|------------|-------------|---------|
| `/cue/{cueNumber}/load` | Load a cue by cue number | `/cue/1/load`<br>`/cue/1.1/load`<br>`/cue/1A/load` |

### Timer Commands

Control the main timer:

| OSC Address | Description |
|------------|-------------|
| `/timer/start` | Start the currently loaded cue timer |
| `/timer/stop` | Stop the currently running timer |
| `/timer/reset` | Reset the timer |

### Sub-Timer Commands

Control sub-timers (indented cues):

| OSC Address | Description | Example |
|------------|-------------|---------|
| `/subtimer/cue/{cueNumber}/start` | Start sub-timer for a cue | `/subtimer/cue/5/start` |
| `/subtimer/cue/{cueNumber}/stop` | Stop sub-timer for a cue | `/subtimer/cue/5/stop` |

### Multi-Day Commands

Handle multi-day events:

| OSC Address | Arguments | Description |
|------------|-----------|-------------|
| `/set-day` | `<dayNumber>` | Set the current day (integer) |
| `/get-day` | — | Get the current day |
| `/list-cues` | — | List all cues for current day |

### Example OSC Messages

**From QLab:**
```
/cue/1/load          # Load cue 1
/cue/1.1/load        # Load cue 1.1
/cue/1A/load         # Load cue 1A
/timer/start         # Start timer
/timer/stop          # Stop timer
/subtimer/cue/5/start # Start sub-timer for cue 5
```

**Testing with oscpack or similar:**
```bash
# Load cue 1
oscsend localhost 57121 /cue/1/load

# Load cue 1.1
oscsend localhost 57121 /cue/1.1/load

# Start timer
oscsend localhost 57121 /timer/start

# Stop timer
oscsend localhost 57121 /timer/stop

# Set day to 2
oscsend localhost 57121 /set-day i 2
```

## Usage

1. **Start the app** - The OSC server starts automatically
2. **Switch API mode** - Use the dropdown in the header to switch between Local/Railway
3. **Select an event** - Click on an event card to load its schedule
4. **View Run of Show** - See all cues, their status, and the current timer
5. **Send OSC commands** - Use your OSC controller to trigger actions
6. **Monitor OSC Log** - Check the right sidebar to see all incoming OSC messages

## How It Works

### Power Save Blocking
The app uses Electron's `powerSaveBlocker` to prevent the system from sleeping or the display from dimming. This ensures OSC commands are always received, even when the app is minimized.

### OSC Integration
- Uses the `osc` npm package for robust OSC message handling
- Listens on UDP port 57121 (default)
- Parses incoming OSC messages and translates them to API calls

### API Synchronization
- Connects to your existing `api-server.js` or Railway deployment
- Loads events and schedules
- Syncs timer state every 5 seconds
- Sends load/start/stop commands via REST API

### Multi-Client Sync
The app works alongside your web interface. When you load/start a cue via OSC, other browsers will see the change through the WebSocket/SSE system.

## Troubleshooting

### OSC Messages Not Received
- Check firewall settings - allow port 57121
- Verify OSC device is sending to the correct IP address
- Check the OSC Log sidebar for incoming messages
- Try using `0.0.0.0` (all interfaces) instead of `127.0.0.1`

### API Connection Failed
- Make sure `api-server.js` is running if using LOCAL mode
- Verify your Railway URL is correct if using RAILWAY mode
- Check the console for error messages

### App Goes to Sleep
- The app should never sleep due to power save blocking
- If it does, check the console for power save blocker status
- Make sure Electron is up to date

## Development

The app structure:
```
ros-osc-control/
├── src/
│   ├── main.js          # Electron main process (OSC server, IPC)
│   └── renderer/
│       ├── index.html   # UI layout
│       ├── styles.css   # Styling
│       └── app.js       # Renderer logic (UI, API calls)
├── .env                 # Configuration
├── package.json         # Dependencies
└── README.md           # This file
```

## License

MIT

