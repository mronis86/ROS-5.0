const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const { exec } = require('child_process');

// Configuration
const PORT = 57130;
const HOST = 'localhost';

// Function to check if port is in use and kill it
function killPort(port) {
    return new Promise((resolve) => {
        exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
            if (stdout) {
                const lines = stdout.split('\n');
                const pids = new Set();
                
                lines.forEach(line => {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5) {
                        const pid = parts[parts.length - 1];
                        if (pid && pid !== '0') {
                            pids.add(pid);
                        }
                    }
                });
                
                if (pids.size > 0) {
                    console.log(`🔪 Found ${pids.size} process(es) using port ${port}, killing them...`);
                    pids.forEach(pid => {
                        exec(`taskkill /F /PID ${pid}`, (error) => {
                            if (!error) {
                                console.log(`✅ Killed process ${pid}`);
                            }
                        });
                    });
                    setTimeout(resolve, 1000); // Wait for processes to be killed
                } else {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    });
}

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
    const clientIP = ws._socket.remoteAddress;
    const timestamp = new Date().toLocaleTimeString();
    console.log(`🔌 [${timestamp}] WebSocket client connected from ${clientIP}`);
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
            const timestamp = new Date().toLocaleTimeString();
            console.log(`📨 [${timestamp}] Received from ${clientIP}:`, data.type, data.address || '');
            
            // Handle different message types
            if (data.type === 'osc') {
                handleOSCMessage(data.address, data.args);
            } else if (data.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString()
                }));
                console.log(`🏓 [${timestamp}] Pong sent to ${clientIP}`);
            }
        } catch (error) {
            console.error('❌ Error parsing WebSocket message:', error);
        }
    });
    
    ws.on('close', () => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`🔌 [${timestamp}] WebSocket client disconnected from ${clientIP}`);
        clients.delete(ws);
    });
    
    ws.on('error', (error) => {
        const timestamp = new Date().toLocaleTimeString();
        console.error(`❌ [${timestamp}] WebSocket error from ${clientIP}:`, error.message);
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

// Start server with port management
async function startServer() {
    console.log('🔍 Checking for existing processes on port', PORT);
    
    // Kill any existing processes on the port
    await killPort(PORT);
    
    // Start the server
    server.listen(PORT, HOST, () => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`🚀 [${timestamp}] OSC WebSocket Server started successfully!`);
        console.log(`📍 Server running on port ${PORT}`);
        console.log(`🔌 Local WebSocket: ws://localhost:${PORT}/osc`);
        console.log(`🌐 Network WebSocket: ws://${networkIP}:${PORT}/osc`);
        console.log(`📡 Listening for connections from any IP address...`);
        console.log(`💡 Connect from another computer using: ws://${networkIP}:${PORT}/osc`);
        console.log(`⏹️  Press Ctrl+C to stop the server`);
        console.log('─'.repeat(60));
    });
    
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} is already in use!`);
            console.error(`💡 Try running: netstat -ano | findstr :${PORT}`);
            console.error(`💡 Or kill the process and try again`);
        } else {
            console.error('❌ Server error:', error);
        }
        process.exit(1);
    });
}

// Start the server
startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n🛑 [${timestamp}] Shutting down OSC WebSocket server...`);
    console.log(`📊 Total connections handled: ${clients.size}`);
    
    // Close all client connections
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.close();
        }
    });
    
    server.close(() => {
        console.log(`✅ [${timestamp}] Server shutdown complete`);
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    const timestamp = new Date().toLocaleTimeString();
    console.error(`❌ [${timestamp}] Uncaught Exception:`, error.message);
    console.error(error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    const timestamp = new Date().toLocaleTimeString();
    console.error(`❌ [${timestamp}] Unhandled Rejection at:`, promise, 'reason:', reason);
});
