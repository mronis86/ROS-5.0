#!/bin/bash

echo "========================================"
echo "WebSocket Python OSC App - Starting"
echo "========================================"
echo

echo "Starting WebSocket-based OSC Control Panel..."
echo
echo "Features:"
echo "- Real-time updates via WebSocket"
echo "- Minimal egress usage (API-only)"
echo "- Same OSC commands as before"
echo "- Automatic reconnection"
echo

python websocket_osc_app.py

echo
echo "OSC App has been closed."
