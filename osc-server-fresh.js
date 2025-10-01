const osc = require('osc');
const { createClient } = require('@supabase/supabase-js');
const os = require('os');

// Supabase configuration
const SUPABASE_URL = 'https://huqijhevmtgardkyeowa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// OSC Server configuration - Using a completely different port
const OSC_PORT = 57130;  // Different port to avoid any conflicts
const OSC_HOST = 'localhost';

// Global state
let currentEventId = null;
let scheduleData = [];
let activeItemId = null;
let activeTimers = {}; // { itemId: { startTime: Date, duration: number, isRunning: boolean } }

// Helper for logging with timestamp and color
function log(message, colorCode = '\x1b[0m') {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`\x1b[90m[${timestamp}]\x1b[0m ${colorCode}${message}\x1b[0m`);
}

// Get network IP address
function getNetworkIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Start OSC Server
async function startOSCServer() {
    // Start the OSC server
    const udpPort = new osc.UDPPort({
        localAddress: '0.0.0.0',
        localPort: OSC_PORT,
        metadata: true
    });

    udpPort.on('error', (err) => {
        log(`❌ OSC Error: ${err.message}`, '\x1b[31m');
    });

udpPort.on('ready', () => {
    log('🎬 Starting Fresh Standalone OSC Server...', '\x1b[36m');
    log('📡 Features:', '\x1b[36m');
    log('   • Direct Supabase integration', '\x1b[36m');
    log('   • Database updates in real-time', '\x1b[36m');
    log('   • Multi-user support', '\x1b[36m');
    log('   • Works when browser is closed', '\x1b[36m');
    log('   • Terminal-based logging', '\x1b[36m');
        log('', '\x1b[36m');
    log('📋 Available OSC Commands:', '\x1b[36m');
    log('   /set-event <eventId>     - Set the current event to work with', '\x1b[36m');
    log('   /cue/<cueName>/load      - Load a cue (e.g., /cue/1/load)', '\x1b[36m');
    log('   /timer/start             - Start main timer', '\x1b[36m');
    log('   /timer/stop              - Stop main timer', '\x1b[36m');
    log('   /timer/reset             - Reset main timer', '\x1b[36m');
    log('   /subtimer/cue/<cueNumber>/start   - Start sub-timer', '\x1b[36m');
    log('   /subtimer/cue/<cueNumber>/stop    - Stop sub-timer', '\x1b[36m');
    log('   /status                  - Get current status', '\x1b[36m');
    log('   /list-cues               - List available cues', '\x1b[36m');
        log('', '\x1b[36m');
    log('💡 Example: Set event and start timer', '\x1b[36m');
    log('   /set-event ea4ca3b2-d517-4efe-8e1c-e47b62a99b0b', '\x1b[36m');
    log('   /cue/load CUE1', '\x1b[36m');
    log('   /timer/start <itemId>', '\x1b[36m');
        log('', '\x1b[36m');
        
        const networkIP = getNetworkIP();
    log(`🚀 OSC Server started on ${networkIP}:${OSC_PORT}`, '\x1b[32m');
    log(`🌐 Network access: Use ${networkIP}:${OSC_PORT} from other devices`, '\x1b[32m');
});

    // OSC Message Handler
udpPort.on('message', async (oscMsg, timeTag, info) => {
    log(`📨 OSC Message: ${oscMsg.address} ${oscMsg.args.map(a => a.value).join(' ')}`, '\x1b[33m');

    const addressParts = oscMsg.address.split('/').filter(Boolean);
    const command = addressParts[0];
    const subCommand = addressParts[1];

        log(`🔍 Parsed: command="${command}", subCommand="${subCommand}", args=[${oscMsg.args.map(a => a.value).join(', ')}]`, '\x1b[90m');

    try {
        if (command === 'set-event') {
                const eventId = oscMsg.args[0]?.value;
                if (!eventId) {
                    throw new Error('Event ID is required');
                }
                await loadEventData(eventId);
                udpPort.send({
                    address: "/event/set",
                    args: [{ type: "s", value: eventId }]
                }, info.address, info.port);
            } else if (command === 'list-events') {
                await listEvents(udpPort, info.address, info.port);
            } else if (command === 'cue') {
                // Handle /cue/<cueNumber>/load format
                if (subCommand && addressParts.length >= 3) {
                    const cueNumber = subCommand;
                    const action = addressParts[2];
                    if (action === 'load') {
                        await loadCue(cueNumber);
                        udpPort.send({
                            address: "/cue/loaded",
                            args: [{ type: "s", value: cueNumber }]
                        }, info.address, info.port);
                    }
                } else if (subCommand === 'load') {
                    // Handle /cue/load <cueName> format
                    const cueName = oscMsg.args[0]?.value;
                    if (!cueName) {
                        throw new Error('Cue name is required');
                    }
                    await loadCue(cueName);
                    udpPort.send({
                        address: "/cue/loaded",
                        args: [{ type: "s", value: cueName }]
                    }, info.address, info.port);
                }
            } else if (command === 'timer') {
                if (subCommand === 'start') {
                await startTimer();
                udpPort.send({
                    address: "/timer/started",
                    args: [{ type: "s", value: "Timer started" }]
                }, info.address, info.port);
                } else if (subCommand === 'stop') {
                await stopTimer();
                udpPort.send({
                    address: "/timer/stopped",
                    args: [{ type: "s", value: "Timer stopped" }]
                }, info.address, info.port);
                } else if (subCommand === 'reset') {
                await resetMainTimer();
                udpPort.send({
                    address: "/timer/reset",
                    args: [{ type: "s", value: "Timer reset" }]
                }, info.address, info.port);
                }
            } else if (command === 'subtimer') {
                if (subCommand === 'cue') {
                    const cueNumber = addressParts[2];
                    const action = addressParts[3];
                    if (cueNumber && (action === 'start' || action === 'stop')) {
                        await handleSubTimer(cueNumber, action);
                        udpPort.send({
                            address: action === 'start' ? "/subtimer/started" : "/subtimer/stopped",
                            args: [{ type: "s", value: cueNumber }, { type: "s", value: "success" }]
                    }, info.address, info.port);
                }
            }
        } else if (command === 'status') {
                await sendStatus(udpPort, info.address, info.port);
        } else if (command === 'list-cues') {
                await listCues(udpPort, info.address, info.port);
        } else {
            log(`❌ Unknown OSC command: ${oscMsg.address}`, '\x1b[31m');
            udpPort.send({
                address: "/error",
                args: [{ type: "s", value: `Unknown command: ${oscMsg.address}` }]
            }, info.address, info.port);
        }
    } catch (error) {
        log(`❌ Error processing OSC message: ${error.message}`, '\x1b[31m');
        udpPort.send({
            address: "/error",
            args: [{ type: "s", value: `Server error: ${error.message}` }]
        }, info.address, info.port);
    }
});

    // Start the UDP port
udpPort.open();
}

// Supabase Functions
async function loadEventData(eventId) {
    try {
        log(`📅 Loading event: ${eventId}`, '\x1b[34m');
        
        // Fetch event data from run_of_show_data table
        const { data: eventData, error: eventError } = await supabase
            .from('run_of_show_data')
            .select('schedule_items')
            .eq('event_id', eventId)
            .single();

        if (eventError) {
            throw new Error(`Failed to load event data: ${eventError.message}`);
        }

        if (!eventData) {
            throw new Error(`Event not found: ${eventId}`);
        }

        scheduleData = eventData.schedule_items || [];
        currentEventId = eventId;

        log(`✅ Event '${eventId}' loaded with ${scheduleData.length} schedule items.`, '\x1b[32m');
        
    } catch (error) {
        log(`❌ Error loading event: ${error.message}`, '\x1b[31m');
        throw error;
    }
}

async function listEvents(udpPort, remoteAddress, remotePort) {
    try {
        log('📋 Fetching available events from calendar_events...', '\x1b[34m');
        
        const { data: events, error } = await supabase
            .from('calendar_events')
            .select('id, name, created_at')
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Failed to fetch events: ${error.message}`);
        }

        log(`📋 Listed ${events.length} events from calendar_events`, '\x1b[34m');

        // Send events as OSC messages
        events.forEach((event, index) => {
            udpPort.send({
                address: "/events/list",
                args: [
                    { type: "s", value: `${index + 1}. Event ID: ${event.id}\n   Name: ${event.name}\n   Created: ${event.created_at}` }
                ]
            }, remoteAddress, remotePort);
        });
        
    } catch (error) {
        log(`❌ Error listing events: ${error.message}`, '\x1b[31m');
        udpPort.send({
            address: "/error",
            args: [{ type: "s", value: `Failed to list events: ${error.message}` }]
        }, remoteAddress, remotePort);
    }
}

async function loadCue(cueName) {
    if (!currentEventId) {
        throw new Error('No event loaded. Please set an event first.');
    }

    log(`🎯 Loading cue: ${cueName}`, '\x1b[34m');

    // Find the cue in the schedule
    const item = scheduleData.find(item => 
        item.cue === cueName || 
        item.customFields?.cue === cueName ||
        item.customFields?.cue === `CUE${cueName}`
    );

    if (!item) {
        throw new Error(`Cue ${cueName} not found in event schedule`);
    }

    // Load the cue by updating active_timers table (handle unique constraint)
    const { data, error } = await supabase
        .from('active_timers')
        .upsert({
            event_id: currentEventId,
            item_id: item.id.toString(),
            user_id: 'osc-server',
            is_running: false,
            is_active: true,
            started_at: new Date().toISOString(),
            duration_seconds: 0
        }, {
            onConflict: 'event_id,item_id'
        });

    if (error) {
        throw new Error(`Failed to load cue: ${error.message}`);
    }

    // Update active item
    activeItemId = item.id;
    
    log(`✅ Cue '${cueName}' loaded successfully (Item ID: ${item.id})`, '\x1b[32m');
}

async function startTimer() {
    if (!currentEventId) {
        throw new Error('No event loaded. Please set an event first.');
    }
    
    // Find the active item
    const activeItem = scheduleData.find(item => item.id === activeItemId);
    if (!activeItem) {
        throw new Error('No active item found for timer start');
    }

    log(`⏰ Starting timer for item: ${activeItemId}`, '\x1b[34m');

    // Start timer by updating active_timers table
    const { data, error } = await supabase
        .from('active_timers')
        .upsert({
            event_id: currentEventId,
            item_id: activeItem.id.toString(),
            user_id: 'osc-server',
            is_running: true,
            is_active: true,
            started_at: new Date().toISOString(),
            duration_seconds: (activeItem.durationHours || 0) * 3600 + 
                            (activeItem.durationMinutes || 0) * 60 + 
                            (activeItem.durationSeconds || 0)
        }, {
            onConflict: 'event_id,item_id'
        });

    if (error) {
        throw new Error(`Failed to start timer: ${error.message}`);
    }

    log(`✅ Timer started for item: ${activeItemId}`, '\x1b[32m');
}

async function stopTimer() {
    if (!currentEventId) {
        throw new Error('No event loaded. Please set an event first.');
    }
    
    log(`⏹️ Stopping timer for item: ${activeItemId}`, '\x1b[34m');

    // Stop timer by updating active_timers table
    const { error } = await supabase
        .from('active_timers')
        .update({ is_running: false })
        .eq('event_id', currentEventId)
        .eq('item_id', activeItemId.toString());

    if (error) {
        throw new Error(`Failed to stop timer: ${error.message}`);
    }

    log(`✅ Timer stopped for item: ${activeItemId}`, '\x1b[32m');
}

async function resetMainTimer() {
    if (!currentEventId) {
        throw new Error('No event loaded. Please set an event first.');
    }
    
    log(`🔄 Resetting main timer...`, '\x1b[34m');
    
    // Find the currently active item
    const activeItem = scheduleData.find(item => item.id === activeItemId);
    
    if (activeItem) {
        log(`🔄 Found active item: ${activeItem.id}`, '\x1b[34m');
        
        // Stop the timer
        await stopTimer();
        
        // Clear loaded state
        await clearLoadedState(activeItem.id);
        
        // Clear active item status in database
        await updateScheduleItemStatus(activeItem.id, false);
        
        // Clear active_timers table entry
        await clearActiveTimerInSupabase(activeItem.id);
        
        log(`✅ Reset main timer completed for active item: ${activeItem.id}`, '\x1b[34m');
    } else {
        log(`⚠️ No active item found, clearing all timer states...`, '\x1b[33m');
        
        // Clear all active timers for this event
        await clearAllActiveTimersForEvent();
        
        log(`✅ Reset completed - cleared all timer states for event`, '\x1b[34m');
    }
}

async function handleSubTimer(cueNumber, action) {
    if (!currentEventId) {
        throw new Error('No event loaded. Please set an event first.');
    }

    log(`🎯 Sub-timer ${action} for cue: ${cueNumber}`, '\x1b[34m');
    
    // Find the item with the specified cue number
    const item = scheduleData.find(item => item.cue === cueNumber);
    if (!item) {
        throw new Error(`Cue ${cueNumber} not found in event schedule`);
    }
    
    if (action === 'start') {
    // Calculate total duration in seconds
    const totalSeconds = (item.durationHours || 0) * 3600 + 
                        (item.durationMinutes || 0) * 60 + 
                        (item.durationSeconds || 0);

    // Calculate row number (1-based)
        const rowNumber = scheduleData.findIndex(s => s.id === item.id) + 1;

        // Get cue display
        const cueDisplay = item.customFields?.cue || item.cue || `CUE ${cueNumber}`;

        // Start sub-timer by updating sub_cue_timers table
        const { data, error } = await supabase
            .from('sub_cue_timers')
            .upsert({
                event_id: currentEventId,
                item_id: item.id.toString(),
                sub_cue_id: item.id.toString(),
                user_id: 'osc-server',
                started_at: new Date().toISOString(),
                is_running: true,
                is_active: true,
                duration_seconds: totalSeconds,
                row_is: rowNumber,
                cue_is: cueDisplay,
                timer_id: item.timerId,
                remaining_seconds: totalSeconds
            }, {
                onConflict: 'event_id,item_id'
            });

        if (error) {
            throw new Error(`Failed to start sub-timer: ${error.message}`);
        }

        log(`✅ Started sub-timer for cue '${cueNumber}' (Item ID: ${item.id})`, '\x1b[32m');
    } else if (action === 'stop') {
        // Stop sub-timer by updating sub_cue_timers table
        const { data, error } = await supabase
            .from('sub_cue_timers')
            .update({ 
                is_running: false,
                is_active: false
            })
            .eq('event_id', currentEventId)
            .eq('item_id', item.id.toString());

        if (error) {
            throw new Error(`Failed to stop sub-timer: ${error.message}`);
        }

        log(`✅ Stopped sub-timer for cue '${cueNumber}' (Item ID: ${item.id})`, '\x1b[32m');
    }
}

async function clearLoadedState(itemId) {
    try {
        // Clear loaded state by removing from active_timers
        const { error } = await supabase
            .from('active_timers')
            .delete()
            .eq('event_id', currentEventId)
            .eq('item_id', itemId.toString());
        
        if (error) {
            log(`⚠️ Failed to clear loaded state: ${error.message}`, '\x1b[33m');
        }
    } catch (error) {
        log(`⚠️ Error clearing loaded state: ${error.message}`, '\x1b[33m');
    }
}

async function updateScheduleItemStatus(itemId, isActive) {
    try {
        // Update the schedule item status in the database
        const { error } = await supabase
            .from('run_of_show_data')
            .update({
                schedule_items: scheduleData.map(item => 
                    item.id === itemId ? { ...item, is_active: isActive } : item
                )
            })
            .eq('event_id', currentEventId);
            
        if (error) {
            log(`⚠️ Failed to update schedule item status: ${error.message}`, '\x1b[33m');
        }
    } catch (error) {
        log(`⚠️ Error updating schedule item status: ${error.message}`, '\x1b[33m');
    }
}

async function clearActiveTimerInSupabase(itemId) {
    try {
        const { error } = await supabase
            .from('active_timers')
            .delete()
            .eq('event_id', currentEventId)
            .eq('item_id', itemId.toString());
            
        if (error) {
            log(`⚠️ Failed to clear active timer: ${error.message}`, '\x1b[33m');
        }
    } catch (error) {
        log(`⚠️ Error clearing active timer: ${error.message}`, '\x1b[33m');
    }
}

async function clearAllActiveTimersForEvent() {
    try {
        const { error } = await supabase
            .from('active_timers')
            .delete()
            .eq('event_id', currentEventId);
            
        if (error) {
            log(`⚠️ Failed to clear all active timers: ${error.message}`, '\x1b[33m');
        } else {
            log(`✅ Cleared all active timers for event ${currentEventId}`, '\x1b[32m');
        }
    } catch (error) {
        log(`⚠️ Error clearing all active timers: ${error.message}`, '\x1b[33m');
    }
}

async function listCues(udpPort, remoteAddress, remotePort) {
    if (!currentEventId) {
        udpPort.send({
            address: "/error",
            args: [{ type: "s", value: "No event loaded. Please set an event first." }]
        }, remoteAddress, remotePort);
        return;
    }
    
    log('📋 Listing available cues...', '\x1b[34m');

    // Extract unique cues from schedule
    const cues = [...new Set(scheduleData.map(item => item.cue).filter(Boolean))];

    cues.forEach((cue, index) => {
        udpPort.send({
            address: "/cues/list",
            args: [
                { type: "s", value: `${index + 1}. ${cue}` }
            ]
        }, remoteAddress, remotePort);
    });
}

async function sendStatus(udpPort, remoteAddress, remotePort) {
    const statusMessage = currentEventId 
        ? `Event: ${currentEventId}, Items: ${scheduleData.length}, Active: ${activeItemId || 'None'}`
        : 'No event loaded';
    
    udpPort.send({
        address: "/status/info",
        args: [{ type: "s", value: statusMessage }]
    }, remoteAddress, remotePort);
    log('✅ Status sent.', '\x1b[34m');
}

// Start the server
startOSCServer().catch(error => {
    log(`❌ Failed to start server: ${error.message}`, '\x1b[31m');
    process.exit(1);
});