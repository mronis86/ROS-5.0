const osc = require('osc');
const http = require('http');

// Supabase configuration (same as your existing server.js)
const SUPABASE_URL = 'https://huqijhevmtgardkyeowa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk';

// OSC Server configuration
const OSC_PORT = 57122;  // Different port to avoid conflict with Python OSC GUI
const OSC_HOST = 'localhost';

// Global state
let currentEventId = null;
let scheduleData = null;
let activeItemId = null;
let activeTimers = {};

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

// Logging function with colors and timestamps
function log(message, color = 'white') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

// Fetch event data from Supabase
async function fetchEventData(eventId) {
    try {
        log(`🔍 Fetching event data for: ${eventId}`, 'cyan');
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/run_of_show_data?event_id=eq.${eventId}`, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data && data.length > 0) {
            scheduleData = data[0];
            currentEventId = eventId;
            log(`✅ Loaded ${scheduleData.schedule_items?.length || 0} schedule items`, 'green');
            return true;
        } else {
            log(`❌ No event found with ID: ${eventId}`, 'red');
            return false;
        }
    } catch (error) {
        log(`❌ Error fetching event data: ${error.message}`, 'red');
        return false;
    }
}

// Update Supabase database
async function updateDatabase(updates) {
    if (!currentEventId) {
        log('❌ No event loaded, cannot update database', 'red');
        return false;
    }

    try {
        log(`🔄 Updating database: ${JSON.stringify(updates)}`, 'yellow');
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/run_of_show_data?id=eq.${currentEventId}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        log('✅ Database updated successfully', 'green');
        return true;
    } catch (error) {
        log(`❌ Error updating database: ${error.message}`, 'red');
        return false;
    }
}

// Find schedule item by ID
function findScheduleItem(itemId) {
    if (!scheduleData?.schedule_items) return null;
    return scheduleData.schedule_items.find(item => item.id === itemId);
}

// Find schedule item by cue
function findScheduleItemByCue(cue) {
    if (!scheduleData?.schedule_items) return null;
    return scheduleData.schedule_items.find(item => item.cue === cue);
}

// Handle OSC messages
function handleOSCMessage(message) {
    const address = message.address;
    const args = message.args || [];
    
    log(`📨 OSC Message: ${address} ${args.map(arg => typeof arg === 'string' ? `"${arg}"` : arg).join(' ')}`, 'blue');

    try {
        // Handle different OSC commands
        if (address === '/cue/load') {
            const cue = args[0];
            if (cue) {
                loadCue(cue);
            }
        } else if (address === '/timer/start') {
            const itemId = args[0];
            if (itemId) {
                startTimer(itemId);
            }
        } else if (address === '/timer/stop') {
            const itemId = args[0];
            if (itemId) {
                stopTimer(itemId);
            }
        } else if (address === '/timer/reset') {
            const itemId = args[0];
            if (itemId) {
                resetTimer(itemId);
            }
        } else if (address === '/event/load') {
            const eventId = args[0];
            if (eventId) {
                loadEvent(eventId);
            }
        } else if (address === '/status') {
            sendStatus();
        } else {
            log(`❓ Unknown OSC command: ${address}`, 'yellow');
        }
    } catch (error) {
        log(`❌ Error handling OSC message: ${error.message}`, 'red');
    }
}

// Load a cue
async function loadCue(cue) {
    log(`🎯 Loading cue: ${cue}`, 'cyan');
    
    if (!scheduleData) {
        log('❌ No event data loaded', 'red');
        return;
    }

    const item = findScheduleItemByCue(cue);
    if (item) {
        activeItemId = item.id;
        log(`✅ Loaded cue: ${cue} (Item ID: ${item.id})`, 'green');
        
        // Update database
        await updateDatabase({
            activeItemId: item.id,
            updated_at: new Date().toISOString()
        });
    } else {
        log(`❌ Cue not found: ${cue}`, 'red');
    }
}

// Start a timer
async function startTimer(itemId) {
    log(`⏰ Starting timer for item: ${itemId}`, 'cyan');
    
    if (!scheduleData) {
        log('❌ No event data loaded', 'red');
        return;
    }

    const item = findScheduleItem(itemId);
    if (item) {
        activeTimers[itemId] = {
            startTime: Date.now(),
            isRunning: true
        };
        
        log(`✅ Started timer for item: ${itemId}`, 'green');
        
        // Update database
        await updateDatabase({
            activeTimers: activeTimers,
            updated_at: new Date().toISOString()
        });
    } else {
        log(`❌ Item not found: ${itemId}`, 'red');
    }
}

// Stop a timer
async function stopTimer(itemId) {
    log(`⏹️ Stopping timer for item: ${itemId}`, 'cyan');
    
    if (activeTimers[itemId]) {
        activeTimers[itemId].isRunning = false;
        activeTimers[itemId].stopTime = Date.now();
        
        log(`✅ Stopped timer for item: ${itemId}`, 'green');
        
        // Update database
        await updateDatabase({
            activeTimers: activeTimers,
            updated_at: new Date().toISOString()
        });
    } else {
        log(`❌ Timer not found: ${itemId}`, 'red');
    }
}

// Reset a timer
async function resetTimer(itemId) {
    log(`🔄 Resetting timer for item: ${itemId}`, 'cyan');
    
    if (activeTimers[itemId]) {
        delete activeTimers[itemId];
        log(`✅ Reset timer for item: ${itemId}`, 'green');
        
        // Update database
        await updateDatabase({
            activeTimers: activeTimers,
            updated_at: new Date().toISOString()
        });
    } else {
        log(`❌ Timer not found: ${itemId}`, 'red');
    }
}

// Load an event
async function loadEvent(eventId) {
    log(`📅 Loading event: ${eventId}`, 'cyan');
    
    const success = await fetchEventData(eventId);
    if (success) {
        log(`✅ Event loaded successfully`, 'green');
    }
}

// Send status information
function sendStatus() {
    log(`📊 Status:`, 'cyan');
    log(`   Event ID: ${currentEventId || 'None'}`, 'white');
    log(`   Schedule Items: ${scheduleData?.schedule_items?.length || 0}`, 'white');
    log(`   Active Item: ${activeItemId || 'None'}`, 'white');
    log(`   Active Timers: ${Object.keys(activeTimers).length}`, 'white');
    
    // Send status via OSC
    if (oscServer) {
        oscServer.send({
            address: '/status/response',
            args: [
                currentEventId || 'None',
                scheduleData?.schedule_items?.length || 0,
                activeItemId || 'None',
                Object.keys(activeTimers).length
            ]
        });
    }
}

// Create OSC server
let oscServer;

function startOSCServer() {
    try {
        oscServer = new osc.UDPPort({
            localAddress: OSC_HOST,
            localPort: OSC_PORT,
            metadata: true
        });

        oscServer.on('ready', () => {
            log(`🚀 OSC Server started on ${OSC_HOST}:${OSC_PORT}`, 'green');
        });

        oscServer.on('message', (message) => {
            handleOSCMessage(message);
        });

        oscServer.on('error', (error) => {
            log(`❌ OSC Server error: ${error.message}`, 'red');
        });

        oscServer.open();
    } catch (error) {
        log(`❌ Failed to start OSC server: ${error.message}`, 'red');
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    log('🛑 Shutting down OSC server...', 'yellow');
    if (oscServer) {
        oscServer.close();
    }
    process.exit(0);
});

// Start the server
log('🎬 Starting Standalone OSC Server...', 'bright');
log('📡 Features:', 'cyan');
log('   • Direct Supabase integration', 'white');
log('   • Database updates in real-time', 'white');
log('   • Multi-user support', 'white');
log('   • Works when browser is closed', 'white');
log('   • Terminal-based logging', 'white');
log('', 'white');

startOSCServer();

// Display available commands
log('📋 Available OSC Commands:', 'cyan');
log('   /event/load <eventId>     - Load an event', 'white');
log('   /cue/load <cue>          - Load a cue by name', 'white');
log('   /timer/start <itemId>     - Start timer for item', 'white');
log('   /timer/stop <itemId>     - Stop timer for item', 'white');
log('   /timer/reset <itemId>    - Reset timer for item', 'white');
log('   /status                  - Get current status', 'white');
log('', 'white');
log('💡 Example: Load event and start timer', 'cyan');
log('   /event/load e8a036e9-11f8-4415-8f20-0c0f27771d8c', 'white');
log('   /cue/load CUE7', 'white');
log('   /timer/start 1758547916045', 'white');
log('', 'white');
