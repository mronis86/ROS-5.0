# ROS 5.0 - Run of Show Timer System

A comprehensive run of show timer system with OSC control, real-time synchronization, and multi-device support.

## 🚀 Quick Start

### Start the Electron OSC Control App
```bash
# Navigate to the Electron app
cd ros-osc-control

# Install dependencies and start
npm install
npm start
```

### Start the Web Application
```bash
# Install dependencies
npm install

# Start the development server
npm start
```

### Start Local API Server
```bash
# Start the local API server (for local development)
node api-server.js
```

## 📚 Documentation

All project documentation has been organized in the **[docs/](./docs/)** folder:

- **[📖 Documentation Index](./docs/README.md)** - Complete documentation overview
- **[🎬 Project Overview](./docs/PROJECT-README.md)** - Main project documentation
- **[⚡ OSC System](./docs/ROS-OSC-COMPLETE.md)** - Complete OSC system guide
- **[🖥️ Electron App](./docs/ROS-OSC-ELECTRON-SUMMARY.md)** - Electron OSC control app

## 🎯 Key Features

- **Real-time OSC Control** - Control timers via OSC commands
- **Multi-device Sync** - Browser and Electron apps sync in real-time
- **Railway Integration** - Cloud-hosted backend with Neon database
- **Day Management** - Multi-day event support with day filtering
- **Socket.IO Updates** - Real-time updates across all connected devices

## 🎵 OSC Commands

- `/cue/1/load` - Load cue 1
- `/timer/start` - Start timer
- `/timer/stop` - Stop timer
- `/set-day 2` - Switch to Day 2 (multi-day events)
- `/list-cues` - List available cues

## 🏗️ Project Structure

```
ROS-5.0/
├── docs/                    # All documentation
├── ros-osc-control/         # Electron OSC control app
├── websocket-python-osc/    # Python OSC GUI
├── src/                     # React web application
├── api-server.js           # Local API server
└── server.js               # Main web server
```

## 📖 More Information

See the **[docs/](./docs/)** folder for complete setup instructions, troubleshooting guides, and detailed documentation.
