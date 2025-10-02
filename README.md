# OSC GUI Application

A Python GUI application that functions as an OSC server, capable of authenticating with Supabase, listing events, and processing OSC commands to update Supabase tables.

## Features

- **OSC Server**: Listens for OSC commands on port 57130
- **Supabase Integration**: Authenticates users and manages event data
- **Event Management**: View and select events with filtering and search
- **Schedule Management**: Load and manage event schedules with auto-refresh
- **Timer Controls**: Process OSC commands for cue loading and timer management
- **Real-time Updates**: Auto-refresh functionality for schedule changes

## 🚀 Optimized Python Live Graphics Generator

A modern Python desktop application for generating live graphics files for VMIX:

- **✅ WebSocket + API + Neon Database** - Real-time updates
- **✅ 90%+ Egress Reduction** - Minimal data usage
- **✅ Multiple Output Formats** - XML/CSV for VMIX
- **✅ Cross-Platform** - Works on Windows, Mac, Linux

**Quick Start:**
```bash
# Run from main directory
start_optimized_graphics.bat

# Or navigate to folder
cd optimized-python-graphics
run_optimized_graphics.bat
```

**Location:** `optimized-python-graphics/` folder

## Installation

1. **Install Python 3.8+** (if not already installed)

2. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the Application**:
   ```bash
   python "fixed_osc_gui_app (8).py"
   ```

## Usage

### Authentication
- Use the "Authentication" tab to sign in with your Supabase credentials
- Or use "Load Events (No Auth)" for basic functionality without authentication

### Events
- Switch to the "Events" tab to view available events
- Use filters to find specific events (recent, today, this week, this month, past)
- Search by event name or location
- Select an event to view its schedule

### OSC Commands
The application listens for OSC commands on port 57130:

- `/cue/<cueNumber>/load` - Load a specific cue
- `/timer/start` - Start the main timer
- `/timer/stop` - Stop the main timer
- `/timer/reset` - Reset all timers and highlighting
- `/subtimer/cue/<cueNumber>/start` - Start a sub-cue timer
- `/subtimer/cue/<cueNumber>/stop` - Stop a sub-cue timer

### Auto-Refresh
- Enable "Auto-refresh schedule (30s)" to automatically check for schedule changes
- The app will notify you when new items are added to the schedule

## Requirements

- Python 3.8 or higher
- Internet connection for Supabase integration
- Port 57130 available for OSC communication

## Troubleshooting

- **Authentication Issues**: Make sure you're signed in through the Authentication tab
- **OSC Connection Issues**: Ensure port 57130 is not blocked by firewall
- **Schedule Not Loading**: Check your internet connection and Supabase credentials

## Support

For issues or questions, check the Log tab for detailed error messages and debugging information.