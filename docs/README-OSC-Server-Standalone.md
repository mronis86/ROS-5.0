# Standalone OSC Server

A terminal-based Node.js OSC server that provides direct Supabase integration for your Run of Show application.

## 🚀 Features

- **Direct Supabase Integration**: Connects directly to your Supabase database
- **Real-time Database Updates**: Updates `is_active` status and timer states
- **Multi-user Support**: Changes are visible to all users immediately
- **Browser Independent**: Works when browser is closed or minimized
- **Terminal Logging**: Color-coded terminal output with timestamps
- **No GUI Dependencies**: Lightweight and server-friendly

## 📋 Prerequisites

- Node.js installed
- OSC library: `npm install osc`
- Access to your Supabase database

## 🛠️ Installation

1. Install the OSC library:
   ```bash
   npm install osc
   ```

2. Start the server:
   ```bash
   node osc-server-standalone.js
   ```
   
   Or use the batch file:
   ```bash
   start-osc-server.bat
   ```

## 📡 OSC Commands

The server listens on `localhost:57130` and responds to these OSC commands:

### Event Management
- `/event/load <eventId>` - Load an event by ID
- `/status` - Get current server status

### Cue Control
- `/cue/load <cue>` - Load a cue by name (e.g., "CUE7")

### Timer Control
- `/timer/start <itemId>` - Start timer for a specific item
- `/timer/stop <itemId>` - Stop timer for a specific item
- `/timer/reset <itemId>` - Reset timer for a specific item

## 💡 Example Usage

1. **Load an event:**
   ```
   /event/load e8a036e9-11f8-4415-8f20-0c0f27771d8c
   ```

2. **Load a cue:**
   ```
   /cue/load CUE7
   ```

3. **Start a timer:**
   ```
   /timer/start 1758547916045
   ```

4. **Check status:**
   ```
   /status
   ```

## 🔧 Configuration

OSC control talks to the Railway API / Neon database (not Supabase). Prefer `api-server.js` and the ROS-OSC-Control / Companion paths documented elsewhere.

- **API**: `https://ros-50-production.up.railway.app` (or local `api-server.js`)
- **OSC Port**: `57130`
- **OSC Host**: `localhost`

## 📊 Database Updates

Timer/cue state is persisted via the Railway API into Neon (`active_timers`, run-of-show data, etc.).

## 🎯 Benefits Over Browser OSC Modal

| Feature | Browser OSC Modal | Standalone OSC Server |
|---------|------------------|---------------------|
| Database Updates | ✅ | ✅ |
| Multi-user Support | ✅ | ✅ |
| Browser Required | ❌ | ✅ |
| Works When Browser Closed | ❌ | ✅ |
| Server Deployment | ❌ | ✅ |
| Terminal Logging | ❌ | ✅ |
| Lightweight | ❌ | ✅ |

## 🚨 Troubleshooting

### Server Won't Start
- Check if port 57121 is available
- Ensure Node.js and OSC library are installed
- Verify Railway API / Neon connectivity

### Database Updates Not Working
- Check Supabase connection
- Verify event ID is correct
- Check terminal logs for error messages

### OSC Messages Not Received
- Verify OSC client is sending to `localhost:57130`
- Check firewall settings
- Ensure OSC message format is correct

## 📝 Logs

The server provides color-coded terminal output:

- 🟢 **Green**: Success messages
- 🔴 **Red**: Error messages  
- 🟡 **Yellow**: Warning messages
- 🔵 **Blue**: OSC message received
- 🟣 **Cyan**: Status information

## 🔄 Integration with Existing System

This standalone server works alongside your existing setup:

- **React App** (port 3003) - Browser interface
- **Node.js Server** (port 3002) - API endpoints
- **Standalone OSC Server** (port 57130) - OSC control

All three can run simultaneously without conflicts.

## 🛑 Stopping the Server

Press `Ctrl+C` in the terminal to gracefully shutdown the server.

## 📞 Support

If you encounter issues:

1. Check the terminal logs for error messages
2. Verify your Supabase connection
3. Ensure the event ID is correct
4. Check that the OSC client is sending to the correct port
