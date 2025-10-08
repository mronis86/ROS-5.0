const http = require('http');
const WebSocket = require('ws');
const os = require('os');

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OSC WebSocket Server Running');
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server,
    path: '/osc'
});

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
    console.log('🔌 WebSocket client connected');
    clients.add(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to OSC server',
        timestamp: new Date().toISOString()
    }));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📨 Received WebSocket message:', data);
            
            // Handle different message types
            if (data.type === 'osc') {
                handleOSCMessage(data.address, data.args);
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                }));
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        clients.delete(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Function to handle OSC messages
function handleOSCMessage(address, args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Received OSC message: ${address}`, args);
    
    // Handle different message types with pattern matching
    if (address === "/timer/start") {
        console.log(`🎯 Generic timer start command received`);
        broadcastToClients({
            type: 'osc_response',
            address: '/timer/started',
            args: ["generic", "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address === "/timer/stop") {
        console.log(`⏹️ Generic timer stop command received`);
        broadcastToClients({
            type: 'osc_response',
            address: '/timer/stopped',
            args: ["generic", "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address === "/timer/reset") {
        console.log(`🔄 Generic timer reset command received`);
        broadcastToClients({
            type: 'osc_response',
            address: '/timer/reset',
            args: ["generic", "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/timer/") && address.endsWith("/start")) {
        const timerId = address.split("/")[2] || args[0] || 'unknown';
        console.log(`🎯 Specific timer start command received for ID: ${timerId}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/timer/started',
            args: [timerId, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/timer/") && address.endsWith("/stop")) {
        const timerId = address.split("/")[2] || args[0] || 'unknown';
        console.log(`⏹️ Specific timer stop command received for ID: ${timerId}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/timer/stopped',
            args: [timerId, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/timer/") && address.endsWith("/reset")) {
        const timerId = address.split("/")[2] || args[0] || 'unknown';
        console.log(`🔄 Specific timer reset command received for ID: ${timerId}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/timer/reset',
            args: [timerId, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/subtimer/cue/") && address.endsWith("/start")) {
        // Handle /subtimer/cue/5/start format
        const cueNumber = address.split("/")[3] || 'unknown';
        console.log(`🎯 Sub-timer start command received for cue: ${cueNumber}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/subtimer/started',
            args: [cueNumber, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/subtimer/cue/") && address.endsWith("/stop")) {
        // Handle /subtimer/cue/5/stop format
        const cueNumber = address.split("/")[3] || 'unknown';
        console.log(`⏹️ Sub-timer stop command received for cue: ${cueNumber}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/subtimer/stopped',
            args: [cueNumber, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/subtimer/") && address.endsWith("/start")) {
        const subTimerId = address.split("/")[2] || args[0] || 'unknown';
        console.log(`🎯 Sub-timer start command received for ID: ${subTimerId}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/subtimer/started',
            args: [subTimerId, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/subtimer/") && address.endsWith("/stop")) {
        const subTimerId = address.split("/")[2] || args[0] || 'unknown';
        console.log(`⏹️ Sub-timer stop command received for ID: ${subTimerId}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/subtimer/stopped',
            args: [subTimerId, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address.startsWith("/cue/") && address.endsWith("/load")) {
        const cueId = address.split("/")[2] || args[0] || 'unknown';
        console.log(`📋 Cue load command received for: ${cueId}`);
        broadcastToClients({
            type: 'osc_response',
            address: '/cue/loaded',
            args: [cueId, "success"],
            timestamp: new Date().toISOString()
        });
    } else if (address === "/ping") {
        console.log("🏓 Ping received - responding with pong");
        broadcastToClients({
            type: 'osc_response',
            address: '/pong',
            args: ["server", "alive"],
            timestamp: new Date().toISOString()
        });
    } else {
        console.log(`❓ Unknown OSC message: ${address}`, args);
    }
}

// Function to broadcast to all connected clients
function broadcastToClients(message) {
    const messageStr = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageStr);
        }
    });
}

const PORT = 57121;
const HOST = '0.0.0.0'; // Listen on all network interfaces

// Get network IP for display
const networkInterfaces = os.networkInterfaces();
let networkIP = 'localhost';

// Find the first non-internal IPv4 address
for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
            networkIP = iface.address;
            break;
        }
    }
    if (networkIP !== 'localhost') break;
}

server.listen(PORT, HOST, () => {
    console.log(`🚀 OSC WebSocket Server running on port ${PORT}`);
    console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/osc`);
    console.log(`🌐 Network access: ws://${networkIP}:${PORT}/osc`);
    console.log(`📡 Listening for OSC messages from any IP address...`);
    console.log(`💡 To connect from another computer, use: ws://${networkIP}:${PORT}/osc`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down OSC WebSocket server...');
    server.close();
    process.exit(0);
});
