const osc = require('osc');

// Create OSC server
const udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 57121,
    remoteAddress: "127.0.0.1",
    remotePort: 57122
});

// Open the port
udpPort.open();

// Handle incoming OSC messages
udpPort.on("message", function (oscMessage) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Received OSC message:`, oscMessage);
    
    // Handle different message types with pattern matching
    if (oscMessage.address.startsWith("/timer/") && oscMessage.address.endsWith("/start")) {
        const timerId = oscMessage.address.split("/")[2] || oscMessage.args[0] || 'unknown';
        console.log(`🎯 Timer start command received for ID: ${timerId}`);
        // Add your timer start logic here
        udpPort.send({
            address: "/timer/started",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address.startsWith("/timer/") && oscMessage.address.endsWith("/stop")) {
        const timerId = oscMessage.address.split("/")[2] || oscMessage.args[0] || 'unknown';
        console.log(`⏹️ Timer stop command received for ID: ${timerId}`);
        // Add your timer stop logic here
        udpPort.send({
            address: "/timer/stopped",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address.startsWith("/timer/") && oscMessage.address.endsWith("/reset")) {
        const timerId = oscMessage.address.split("/")[2] || oscMessage.args[0] || 'unknown';
        console.log(`🔄 Timer reset command received for ID: ${timerId}`);
        // Add your timer reset logic here
        udpPort.send({
            address: "/timer/reset",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address.startsWith("/timer/") && oscMessage.address.endsWith("/load")) {
        const timerId = oscMessage.address.split("/")[2] || oscMessage.args[0] || 'unknown';
        console.log(`📥 Timer load command received for ID: ${timerId}`);
        // Add your timer loading logic here
        udpPort.send({
            address: "/timer/loaded",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address.startsWith("/cue/") && oscMessage.address.endsWith("/load")) {
        const cueId = oscMessage.address.split("/")[2] || oscMessage.args[0] || 'unknown';
        console.log(`📋 Cue load command received for: ${cueId}`);
        // Add your cue loading logic here
        udpPort.send({
            address: "/cue/loaded",
            args: [cueId, "success"]
        });
    } else if (oscMessage.address === "/timer/start") {
        const timerId = oscMessage.args[0] || 'unknown';
        console.log(`🎯 Timer start command received for ID: ${timerId}`);
        udpPort.send({
            address: "/timer/started",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address === "/timer/stop") {
        const timerId = oscMessage.args[0] || 'unknown';
        console.log(`⏹️ Timer stop command received for ID: ${timerId}`);
        udpPort.send({
            address: "/timer/stopped",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address === "/timer/reset") {
        const timerId = oscMessage.args[0] || 'unknown';
        console.log(`🔄 Timer reset command received for ID: ${timerId}`);
        udpPort.send({
            address: "/timer/reset",
            args: [timerId, "success"]
        });
    } else if (oscMessage.address === "/cue/load") {
        const cueName = oscMessage.args[0] || 'unknown';
        console.log(`📋 Cue load command received for: ${cueName}`);
        udpPort.send({
            address: "/cue/loaded",
            args: [cueName, "success"]
        });
    } else if (oscMessage.address === "/ping") {
        console.log("🏓 Ping received - responding with pong");
        udpPort.send({
            address: "/pong",
            args: ["server", "alive"]
        });
    } else {
        console.log(`❓ Unknown OSC message: ${oscMessage.address}`, oscMessage.args);
    }
});

// Handle port ready
udpPort.on("ready", function () {
    console.log("🎵 OSC Server is running on port 57121");
    console.log("📡 Listening for OSC messages...");
    console.log("🔗 Connect your OSC client to: 127.0.0.1:57121");
});

// Handle errors
udpPort.on("error", function (err) {
    console.error("OSC Server Error:", err);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down OSC server...');
    udpPort.close();
    process.exit(0);
});

console.log("🚀 Starting OSC Server...");
