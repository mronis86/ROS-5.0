const osc = require('osc');
const readline = require('readline');
const os = require('os');

// Get network IP for server connection
const networkInterfaces = os.networkInterfaces();
let serverIP = '127.0.0.1'; // Default to localhost

// Find the first non-internal IPv4 address
for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
            serverIP = iface.address;
            break;
        }
    }
    if (serverIP !== '127.0.0.1') break;
}

// Create OSC client
const udpPort = new osc.UDPPort({
    localAddress: '0.0.0.0',
    localPort: 57131, // Different port for client
    remoteAddress: serverIP,
    remotePort: 57130, // Server port
    metadata: true
});

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let isConnected = false;

udpPort.on('ready', () => {
    console.log(`🎯 OSC CLI Client connected to server on ${serverIP}:57130`);
    console.log('📋 Available commands:');
    console.log('   set-event <eventId>     - Set the current event');
    console.log('   cue <cueName>           - Load a cue');
    console.log('   timer-start <itemId>    - Start timer');
    console.log('   timer-stop <itemId>     - Stop timer');
    console.log('   timer-reset <itemId>    - Reset timer');
    console.log('   status                  - Get status');
    console.log('   list-cues               - List available cues');
    console.log('   list-events             - List available events');
    console.log('   quit                    - Exit');
    console.log('');
    console.log('💡 Example: set-event ea4ca3b2-d517-4efe-8e1c-e47b62a99b0b');
    console.log('');
    isConnected = true;
    promptUser();
});

udpPort.on('message', (oscMsg, timeTag, info) => {
    if (oscMsg.address === '/event/set') {
        console.log(`✅ Event set: ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/cue/loaded') {
        console.log(`✅ Cue loaded: ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/timer/started') {
        console.log(`✅ Timer started: ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/timer/stopped') {
        console.log(`✅ Timer stopped: ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/timer/reset') {
        console.log(`✅ Timer reset: ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/status/info') {
        console.log(`📊 Status: ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/cues/list') {
        console.log(`📋 ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/events/list') {
        console.log(`📋 ${oscMsg.args[0].value}`);
    } else if (oscMsg.address === '/error') {
        console.log(`❌ Error: ${oscMsg.args[0].value}`);
    }
    promptUser();
});

udpPort.on('error', (err) => {
    console.error('❌ OSC Client Error:', err.message);
    process.exit(1);
});

function promptUser() {
    if (isConnected) {
        rl.question('OSC> ', (input) => {
            const [command, ...args] = input.trim().split(' ');
            
            switch (command.toLowerCase()) {
                case 'set-event':
                    if (args.length === 0) {
                        console.log('❌ Usage: set-event <eventId>');
                        promptUser();
                        return;
                    }
                    udpPort.send({
                        address: "/set-event",
                        args: [{ type: "s", value: args[0] }]
                    });
                    break;
                    
                case 'cue':
                    if (args.length === 0) {
                        console.log('❌ Usage: cue <cueName>');
                        promptUser();
                        return;
                    }
                    udpPort.send({
                        address: "/cue/load",
                        args: [{ type: "s", value: args[0] }]
                    });
                    break;
                    
                case 'timer-start':
                    if (args.length === 0) {
                        console.log('❌ Usage: timer-start <itemId>');
                        promptUser();
                        return;
                    }
                    udpPort.send({
                        address: "/timer/start",
                        args: [{ type: "s", value: args[0] }]
                    });
                    break;
                    
                case 'timer-stop':
                    if (args.length === 0) {
                        console.log('❌ Usage: timer-stop <itemId>');
                        promptUser();
                        return;
                    }
                    udpPort.send({
                        address: "/timer/stop",
                        args: [{ type: "s", value: args[0] }]
                    });
                    break;
                    
                case 'timer-reset':
                    if (args.length === 0) {
                        console.log('❌ Usage: timer-reset <itemId>');
                        promptUser();
                        return;
                    }
                    udpPort.send({
                        address: "/timer/reset",
                        args: [{ type: "s", value: args[0] }]
                    });
                    break;
                    
                case 'status':
                    udpPort.send({
                        address: "/status",
                        args: []
                    });
                    break;
                    
                case 'list-cues':
                    udpPort.send({
                        address: "/list-cues",
                        args: []
                    });
                    break;
                    
                case 'list-events':
                    udpPort.send({
                        address: "/list-events",
                        args: []
                    });
                    break;
                    
                case 'quit':
                case 'exit':
                    console.log('👋 Goodbye!');
                    udpPort.close();
                    rl.close();
                    process.exit(0);
                    break;
                    
                default:
                    console.log('❌ Unknown command. Type "quit" to exit.');
                    promptUser();
                    break;
            }
        });
    }
}

udpPort.open();
