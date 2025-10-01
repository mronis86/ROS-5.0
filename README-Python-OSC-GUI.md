# Python OSC GUI - Standalone Control Panel

This is a standalone Python application that provides OSC control functionality independent of the browser. It's perfect for situations where you need OSC control even when the browser is minimized, closed, or not visible.

## Features

- **Standalone Operation**: Works completely independently of the browser
- **OSC Server**: Built-in OSC server that listens for external commands
- **Supabase Integration**: Direct connection to your Supabase database (read-only)
- **GUI Interface**: Easy-to-use tkinter interface
- **Real-time Logging**: See all OSC messages and actions in real-time
- **Schedule Management**: Load and view your event schedule
- **Timer Control**: Start, stop, and reset timers via OSC or GUI
- **Sub-timer Support**: Control indented items (sub-cues)

## ⚠️ Important Note

**This Python OSC GUI is currently READ-ONLY**. It can:
- ✅ Load and display your event data from Supabase
- ✅ Respond to OSC commands and control timers locally
- ✅ Send OSC responses back to external controllers
- ❌ **Cannot update the Supabase database** (no `is_active` status updates)

For database updates, use the browser-based OSC modal or Node.js server.

## Installation

### Prerequisites
- Python 3.7 or higher
- Internet connection for Supabase access

### Setup
1. **Install Python dependencies:**
   ```bash
   pip install -r python-osc-requirements.txt
   ```

2. **Test the connection:**
   ```bash
   python test-supabase-connection.py
   ```
   You should see ✅ messages if everything is working.

3. **Run the application:**
   ```bash
   python python-osc-gui.py
   ```
   
   Or use the batch file:
   ```bash
   start-python-osc-gui.bat
   ```

4. **Test OSC server (optional):**
   ```bash
   python test-osc-server.py
   ```

## Usage

### 1. OSC Configuration
- **Host**: Set the IP address to listen on (default: localhost)
- **Port**: Set the OSC port (default: 57121)
- **Connect**: Start/stop the OSC server

### 2. Event Configuration
- **Event ID**: Enter your event ID from the Run of Show system
- **Load Event**: Fetch schedule data from Supabase
- **Schedule Items**: View all schedule items with their cues

### 3. OSC Controls
- **Cue Name**: Enter a cue name (1, 1.1, 1A, etc.)
- **Load Cue**: Load a specific cue
- **Start/Stop/Reset Timer**: Control the main timer
- **Sub-Timer ID**: Enter a sub-timer ID for indented items
- **Start/Stop Sub-Timer**: Control sub-timers

### 4. Message Log
- View all OSC messages received
- See system actions and responses
- Clear log when needed

## OSC Commands

The application responds to these OSC commands:

### Main Cue Commands
- `/cue/1/load` - Load cue 1
- `/cue/1.1/load` - Load cue 1.1
- `/cue/1A/load` - Load cue 1A

### Timer Commands
- `/timer/start` - Start the main timer
- `/timer/stop` - Stop the main timer
- `/timer/reset` - Reset all timers

### Sub-Timer Commands
- `/subtimer/SUB1/start` - Start sub-timer SUB1
- `/subtimer/SUB1/stop` - Stop sub-timer SUB1

## Advantages Over Browser-Based OSC

### ✅ **Always Works**
- Browser minimized: ✅ Works
- Browser in another tab: ✅ Works
- Browser closed: ✅ Works
- Computer locked: ✅ Works
- No internet: ✅ Works (for local OSC)

### ✅ **Independent Operation**
- No browser dependency
- No React app dependency
- Direct Supabase connection
- Standalone application

### ✅ **Reliable**
- No browser crashes
- No JavaScript errors
- No network timeouts
- Consistent performance

## Troubleshooting

### Common Issues

1. **"Supabase not available"**
   - Make sure you're in the project directory
   - Check that `src/services/supabase.py` exists
   - Verify Supabase credentials

2. **"OSC Server failed to start"**
   - Check if port 57121 is already in use
   - Try a different port
   - Run as administrator if needed

3. **"No event found"**
   - Verify the Event ID is correct
   - Check Supabase connection
   - Ensure the event exists in the database

### Debug Mode
Run with debug output:
```bash
python python-osc-gui.py --debug
```

## Integration with Existing System

This Python OSC GUI can work alongside your existing browser-based system:

1. **Both systems can run simultaneously**
2. **Both connect to the same Supabase database**
3. **Both respond to the same OSC commands**
4. **Use the Python GUI as a backup/alternative**

## File Structure

```
python-osc-gui.py              # Main application
python-osc-requirements.txt    # Python dependencies
start-python-osc-gui.bat       # Windows batch file to run
README-Python-OSC-GUI.md      # This documentation
```

## Support

If you encounter issues:
1. Check the message log in the application
2. Verify Python and dependencies are installed
3. Ensure Supabase connection is working
4. Check that the Event ID is correct

The Python OSC GUI provides a robust, standalone alternative to browser-based OSC control, ensuring your system works reliably even when the browser is not available.
