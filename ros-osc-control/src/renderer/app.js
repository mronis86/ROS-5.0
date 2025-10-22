const { ipcRenderer } = require('electron');
const axios = require('axios');
const io = require('socket.io-client');

// State
let config = {};
let currentEvent = null;
let schedule = [];
let selectedDay = 1;
let activeItemId = null;
let timerProgress = {};
let activeTimers = {};
let timerInterval = null;
let autoRefreshInterval = null;
let autoRefreshEnabled = false;
let autoRefreshSeconds = 60;
let socket = null;
let clockOffset = 0; // Offset between client and server clocks in ms
let disconnectTimer = null; // Timer for auto-disconnect
let disconnectTimeoutMinutes = 0; // 0 = never disconnect
// Detect user's local timezone
let eventTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
let allEvents = []; // Global events array

// Initialize
async function init() {
  console.log('🚀 Initializing ROS OSC Control...');
  console.log('🌍 Detected local timezone:', eventTimezone);
  
  try {
    // Get config from main process
    console.log('📋 Getting config from main process...');
    config = await ipcRenderer.invoke('get-config');
    console.log('📋 Config loaded:', config);
    
    // Update UI with config
    document.getElementById('apiModeSelect').value = config.apiMode;
    document.getElementById('oscAddress').textContent = `${config.oscHost}:${config.oscPort}`;
    
    // Setup IPC listeners first
    console.log('📡 Setting up IPC listeners...');
    setupIPCListeners();
    
    // Setup event listeners
    console.log('🎯 Setting up event listeners...');
    setupEventListeners();
    
    // Setup timezone selector
    setupTimezoneSelector();
    
    // Load events
    console.log('📥 Loading events...');
    await loadEvents();
    
    console.log('✅ Initialization complete');
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    throw error;
  }
}

// Start disconnect timer based on user selection
function startDisconnectTimer(minutes) {
  // Clear existing timer
  stopDisconnectTimer();
  
  if (minutes === 0) {
    console.log('⏰ Disconnect timer: Never (running indefinitely)');
    return;
  }
  
  disconnectTimeoutMinutes = minutes;
  const ms = minutes * 60 * 1000;
  
  console.log(`⏰ Disconnect timer started: ${minutes} minutes`);
  
  disconnectTimer = setTimeout(() => {
    if (socket && socket.connected) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      let timeText = '';
      if (hours > 0) timeText += `${hours}h `;
      if (mins > 0) timeText += `${mins}m`;
      
      console.log(`⏰ Auto-disconnect timer expired (${timeText.trim()}) - showing notification and disconnecting WebSocket`);
      
      // Show notification FIRST
      showDisconnectNotification(timeText.trim());
      
      // Then disconnect (small delay to ensure notification is visible)
      setTimeout(() => {
        if (socket && socket.connected) {
          socket.disconnect();
          console.log('🔌 WebSocket disconnected after timer expiry');
        }
        // Stop timer updates to prevent continued polling
        stopTimerUpdates();
        console.log('⏹️ Timer updates stopped');
      }, 100);
    }
  }, ms);
}

// Show disconnect notification with reconnect option
function showDisconnectNotification(duration) {
  console.log('📢 Showing disconnect notification:', duration);
  
  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'disconnect-backdrop';
  
  // Create notification
  const notification = document.createElement('div');
  notification.className = 'disconnect-notification';
  notification.innerHTML = `
    <div class="disconnect-content">
      <div class="disconnect-icon">🔌</div>
      <div class="disconnect-message">
        <h4>Connection Closed</h4>
        <p>Auto-disconnected after ${duration}</p>
      </div>
      <button class="reconnect-btn" id="reconnectBtn">🔄 Reconnect</button>
    </div>
  `;
  
  document.body.appendChild(backdrop);
  document.body.appendChild(notification);
  console.log('✅ Disconnect notification added to DOM');
  
  // Handle reconnect button
  document.getElementById('reconnectBtn').addEventListener('click', () => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    backdrop.style.animation = 'fadeOut 0.3s ease-out';
    
    setTimeout(() => {
      if (notification.parentNode) document.body.removeChild(notification);
      if (backdrop.parentNode) document.body.removeChild(backdrop);
    }, 300);
    
    // Reconnect to Socket.IO and show timer modal again
    if (currentEvent) {
      connectToSocketIO(currentEvent.id);
    } else {
      showToast('No event selected. Please select an event first.', 'error');
    }
  });
}

// Stop disconnect timer
function stopDisconnectTimer() {
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
    console.log('🛑 Disconnect timer stopped');
  }
}

// Setup timezone selector
function setupTimezoneSelector() {
  const timezoneSelect = document.getElementById('timezoneSelect');
  
  if (timezoneSelect) {
    // Set initial value to detected local timezone
    timezoneSelect.value = eventTimezone;
    console.log('🌍 Timezone selector initialized with detected timezone:', eventTimezone);
    
    // Add change listener
    timezoneSelect.addEventListener('change', (e) => {
      const selectedTimezone = e.target.value;
      eventTimezone = selectedTimezone;
      console.log('🌍 Timezone override changed to:', selectedTimezone);
      
      // Reload events with new timezone
      loadEvents();
    });
  }
}

// Update timezone selector value
function updateTimezoneSelector() {
  const timezoneSelect = document.getElementById('timezoneSelect');
  if (timezoneSelect) {
    console.log('🌍 Updating timezone selector...');
    console.log('🌍 Current eventTimezone:', eventTimezone);
    console.log('🌍 Selector current value:', timezoneSelect.value);
    
    timezoneSelect.value = eventTimezone;
    
    console.log('🌍 Selector new value:', timezoneSelect.value);
    console.log('🌍 Timezone selector updated to:', eventTimezone);
  } else {
    console.log('🌍 ❌ Timezone selector element not found');
  }
}

// Setup event listeners
function setupEventListeners() {
  // Event tabs (upcoming/past)
  document.querySelectorAll('.event-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;
      
      // Update active tab
      document.querySelectorAll('.event-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Load filtered events
      loadEvents(filter);
    });
  });
  
  // API mode selector
  document.getElementById('apiModeSelect').addEventListener('change', async (e) => {
    const newMode = e.target.value;
    config = await ipcRenderer.invoke('set-api-mode', newMode);
    console.log('🔧 API mode changed:', config);
    showToast(`API mode changed to ${newMode}`);
    
    // Reload events
    await loadEvents();
  });
  
  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    if (currentEvent) {
      await loadEventSchedule(currentEvent.id, selectedDay);
    } else {
      await loadEvents();
    }
    showToast('🔄 Refreshed');
  });
  
  // Auto-refresh checkbox
  document.getElementById('autoRefreshCheckbox').addEventListener('change', (e) => {
    autoRefreshEnabled = e.target.checked;
    const intervalSelect = document.getElementById('autoRefreshInterval');
    intervalSelect.disabled = !autoRefreshEnabled;
    
    if (autoRefreshEnabled) {
      autoRefreshSeconds = parseInt(intervalSelect.value);
      startAutoRefresh();
      showToast(`✅ Auto-refresh enabled (${autoRefreshSeconds}s)`);
      console.log(`✅ Auto-refresh enabled: ${autoRefreshSeconds} seconds`);
    } else {
      stopAutoRefresh();
      showToast('⏹️ Auto-refresh disabled');
      console.log('⏹️ Auto-refresh disabled');
    }
  });
  
  // Auto-refresh interval selector
  document.getElementById('autoRefreshInterval').addEventListener('change', (e) => {
    autoRefreshSeconds = parseInt(e.target.value);
    console.log(`⏰ Auto-refresh interval changed to: ${autoRefreshSeconds} seconds`);
    
    if (autoRefreshEnabled) {
      stopAutoRefresh();
      startAutoRefresh();
      showToast(`⏰ Auto-refresh: ${autoRefreshSeconds}s`);
    }
  });
  
  // Back to events button
  document.getElementById('backToEventsBtn').addEventListener('click', () => {
    showPage('eventListPage');
    currentEvent = null;
    schedule = [];
    activeItemId = null;
    stopTimerUpdates();
    stopDisconnectTimer(); // Stop disconnect timer when leaving event
    stopAutoRefresh(); // Stop auto-refresh when leaving event
    
    // Disconnect socket when leaving event
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  });
  
  // Clear log button
  document.getElementById('clearLogBtn').addEventListener('click', () => {
    const logContainer = document.getElementById('oscLog');
    logContainer.innerHTML = '<div class="log-entry system"><div class="log-time">--:--:--</div><div class="log-message">Log cleared</div></div>';
  });
  
  // Day selector
  document.getElementById('daySelect').addEventListener('change', async (e) => {
    selectedDay = parseInt(e.target.value);
    console.log('📅 Day changed to:', selectedDay);
    
    if (currentEvent) {
      // Update the schedule for the selected day
      await loadEventSchedule(currentEvent.id, selectedDay);
      showToast(`Switched to Day ${selectedDay}`);
    }
  });
}

// Setup IPC listeners for OSC commands
function setupIPCListeners() {
  // OSC status updates
  ipcRenderer.on('osc-status', (event, data) => {
    console.log('📡 OSC Status:', data);
    const statusEl = document.getElementById('oscStatus');
    if (data.status === 'listening') {
      statusEl.classList.add('active');
      statusEl.querySelector('.status-text').textContent = `OSC Listening on ${data.host}:${data.port}`;
    }
  });
  
  // OSC message received (for display only)
  ipcRenderer.on('osc-message', (event, data) => {
    console.log('📨 OSC Message:', data);
    // This is handled by osc-log-update
  });
  
  // OSC log updates
  ipcRenderer.on('osc-log-update', (event, logEntry) => {
    addLogEntry(logEntry);
  });
  
  // OSC commands to execute
  ipcRenderer.on('osc-command', (event, data) => {
    console.log('🎯 OSC Command:', data);
    handleOSCCommand(data.command, data.data);
  });
}

// Handle OSC commands
async function handleOSCCommand(command, data) {
  console.log('🎯 Executing OSC command:', command, data);
  
  if (!currentEvent) {
    console.warn('⚠️ No event loaded, cannot execute command');
    return;
  }
  
  switch (command) {
    case 'load-cue':
      await loadCueById(data.itemId);
      break;
    case 'start-cue':
      await startCue();
      break;
    case 'stop-cue':
      await stopCue();
      break;
    case 'load-cue-by-number':
      await loadCueByCueNumber(data.cueNumber);
      break;
    case 'next-cue':
      await loadNextCue();
      break;
    case 'prev-cue':
      await loadPrevCue();
      break;
    case 'goto-row':
      await gotoRow(data.rowNumber);
      break;
    case 'set-day':
      await setDay(data.day);
      break;
    case 'get-day':
      await getDay();
      break;
    case 'list-cues':
      await listCues();
      break;
    case 'reset-timer':
      await resetTimer();
      break;
    case 'start-subtimer':
      await startSubTimer(data.cueNumber);
      break;
    case 'stop-subtimer':
      await stopSubTimer(data.cueNumber);
      break;
    case 'adjust-timer':
      await adjustTimer(data.minutes);
      break;
    default:
      console.warn('⚠️ Unknown OSC command:', command);
  }
}

// Load events from API
async function loadEvents(filter = 'upcoming') {
  console.log('📥 Loading events from API...');
  const eventList = document.getElementById('eventList');
  eventList.innerHTML = '<div class="loading">Loading events...</div>';
  
  try {
    const response = await axios.get(`${config.apiUrl}/api/calendar-events`);
    allEvents = response.data;
    console.log('✅ Events loaded:', allEvents.length);
    console.log('📋 Events data:', allEvents);
    
    // Each event uses its own timezone from NEON database
    console.log('🌍 Each event will use its own timezone from schedule_data.timezone');
    
    if (allEvents.length === 0) {
      eventList.innerHTML = '<div class="loading">No events found</div>';
      return;
    }
    
    // Filter events by upcoming/past - each event uses its own timezone
    const today = new Date();
    console.log('🌍 Date filtering debug - each event uses its own timezone from NEON');
    
    const filteredEvents = allEvents.filter(event => {
      // Parse the event date (YYYY-MM-DD format)
      const [year, month, day] = event.date.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day); // month is 0-indexed
      
      // Get event's timezone from NEON database
      const eventTimezone = event.schedule_data?.timezone || 'America/New_York';
      
      // Create today's date in the event's timezone
      const todayInEventTimezone = new Date();
      const todayInEventTz = new Date(todayInEventTimezone.toLocaleString("en-US", { timeZone: eventTimezone }));
      todayInEventTz.setHours(0, 0, 0, 0);
      
      // Create event date in the event's timezone
      const eventDateInEventTz = new Date(eventDate.toLocaleString("en-US", { timeZone: eventTimezone }));
      eventDateInEventTz.setHours(0, 0, 0, 0);
      
      console.log(`🌍 Event "${event.name}" date comparison:`, {
        eventDate: event.date,
        eventTimezone: eventTimezone,
        eventDateInEventTz: eventDateInEventTz.toISOString(),
        todayInEventTz: todayInEventTz.toISOString(),
        isUpcoming: eventDateInEventTz >= todayInEventTz
      });
      
      if (filter === 'upcoming') {
        return eventDateInEventTz >= todayInEventTz;
      } else {
        return eventDateInEventTz < todayInEventTz;
      }
    });
    
    console.log(`📊 ${filter} events:`, filteredEvents.length);
    
    if (filteredEvents.length === 0) {
      eventList.innerHTML = `<div class="loading">No ${filter} events found</div>`;
      return;
    }
    
    // Store events globally for click handlers
    window.eventsData = filteredEvents;
    
    // Render event cards with proper event listeners
    eventList.innerHTML = filteredEvents.map((event, index) => {
      console.log(`Event ${index}:`, event);
      
      // Extract numberOfDays from schedule_data (it's stored as JSON)
      let numberOfDays = 1;
      if (event.schedule_data) {
        const scheduleData = typeof event.schedule_data === 'string' 
          ? JSON.parse(event.schedule_data) 
          : event.schedule_data;
        numberOfDays = scheduleData.numberOfDays || 1;
      }
      
      console.log(`  → Number of days: ${numberOfDays}`);
      const dayIndicator = numberOfDays > 1 ? `<div class="event-days">📅 ${numberOfDays} Days</div>` : '';
      
      // Use the event's timezone from NEON database
      const displayTimezone = event.schedule_data?.timezone || 'America/New_York';
      
      // Debug logging for timezone
      console.log(`🌍 Event "${event.name}" timezone debug:`, {
        rawScheduleData: event.schedule_data,
        timezoneFromData: event.schedule_data?.timezone,
        finalTimezone: displayTimezone,
        eventDate: event.date
      });
      
      // Get location from event data
      const eventLocation = event.schedule_data?.location || 'Great Hall';
      
      return `
        <div class="event-card" data-event-index="${index}">
          <h3>${escapeHtml(event.name)}</h3>
          <div class="event-date">📅 ${formatDate(event.date, displayTimezone)}</div>
          <div class="event-location">📍 ${eventLocation}</div>
          <div class="event-timezone">🌍 ${displayTimezone}</div>
          ${dayIndicator}
          <div class="event-id">ID: ${event.id}</div>
        </div>
      `;
    }).join('');
    
    // Add click listeners to event cards using index
    document.querySelectorAll('.event-card').forEach(card => {
      card.addEventListener('click', () => {
        const eventIndex = parseInt(card.dataset.eventIndex);
        const event = window.eventsData[eventIndex];
        console.log('🖱️ Event card clicked:', { eventIndex, event });
        if (event) {
          // Extract numberOfDays from schedule_data
          let numberOfDays = 1;
          if (event.schedule_data) {
            const scheduleData = typeof event.schedule_data === 'string' 
              ? JSON.parse(event.schedule_data) 
              : event.schedule_data;
            numberOfDays = scheduleData.numberOfDays || 1;
          }
          
          console.log(`  → Selecting event with ${numberOfDays} days`);
          selectEvent(event.id, event.name, event.date, numberOfDays);
        } else {
          console.error('❌ Event not found at index:', eventIndex);
        }
      });
    });
    
  } catch (error) {
    console.error('❌ Error loading events:', error);
    eventList.innerHTML = `<div class="loading">Error loading events: ${error.message}</div>`;
  }
}

// Determine timezone for event list filtering
function determineEventListTimezone(events) {
  console.log('🌍 Determining timezone for event list filtering...');
  console.log('🌍 Current eventTimezone state (dropdown selection):', eventTimezone);
  console.log('🌍 Events available:', events?.length || 0);
  
  // Use the dropdown selection as the override - don't auto-change it
  console.log('🌍 Using dropdown selection as timezone override:', eventTimezone);
  return eventTimezone;
}

// Load event timezone from calendar events API
async function loadEventTimezone(eventId) {
  try {
    const response = await axios.get(`${config.apiUrl}/api/calendar-events`);
    const events = response.data;
    
    // Find the event with matching ID
    const event = events.find(e => e.id === eventId);
    
    if (event && event.schedule_data?.timezone) {
      eventTimezone = event.schedule_data.timezone;
      console.log('🌍 Event timezone loaded from calendar events:', eventTimezone);
    } else {
      console.log('🌍 No timezone found in calendar events, using default:', eventTimezone);
    }
  } catch (error) {
    console.warn('⚠️ Could not load event timezone from calendar events:', error.message);
    console.log('🌍 Using default timezone:', eventTimezone);
  }
}

// Select an event
async function selectEvent(eventId, eventName, eventDate, numberOfDays = 1) {
  console.log('🎬 Event selected:', eventId, eventName, eventDate, 'days:', numberOfDays);
  
  try {
    currentEvent = { id: eventId, name: eventName, date: eventDate, numberOfDays: numberOfDays };
    
    // Load specific event timezone for this event
    await loadEventTimezone(eventId);
    
    // Update UI
    document.getElementById('currentEventName').textContent = eventName;
    document.getElementById('currentEventDate').textContent = formatDate(eventDate);
    
    // Show/hide day selector based on number of days
    const daySelector = document.querySelector('.day-selector');
    if (numberOfDays > 1) {
      daySelector.style.display = 'flex';
      // Populate day options
      const daySelect = document.getElementById('daySelect');
      daySelect.innerHTML = '';
      for (let i = 1; i <= numberOfDays; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Day ${i}`;
        daySelect.appendChild(option);
      }
      selectedDay = 1;
      daySelect.value = '1';
    } else {
      daySelector.style.display = 'none';
      selectedDay = 1;
    }
    
    // Connect to Socket.IO for real-time updates
    connectToSocketIO(eventId);
    
    // Load schedule for selected day
    await loadEventSchedule(eventId, selectedDay);
    
    // Show Run of Show page
    showPage('runOfShowPage');
    
    console.log('✅ Event loaded successfully');
  } catch (error) {
    console.error('❌ Error selecting event:', error);
    alert('Error loading event: ' + error.message);
  }
}

// Load event schedule
async function loadEventSchedule(eventId, day = 1) {
  console.log('📥 Loading schedule for event:', eventId, 'day:', day);
  const tableBody = document.getElementById('scheduleTableBody');
  tableBody.innerHTML = '<tr><td colspan="4" class="loading">Loading schedule...</td></tr>';
  
  try {
    console.log('🔗 Fetching from:', `${config.apiUrl}/api/run-of-show-data/${eventId}?day=${day}`);
    const response = await axios.get(`${config.apiUrl}/api/run-of-show-data/${eventId}?day=${day}`);
    console.log('📦 Response received:', response.status, response.data);
    
    const data = response.data;
    
    // Handle different response formats
    if (!data) {
      console.warn('⚠️ No data returned from API');
      tableBody.innerHTML = '<tr><td colspan="4" class="loading">No schedule data found for this event. Create a schedule in the web interface first.</td></tr>';
      return;
    }
    
    // Check if data is an array (direct schedule items) or object with schedule_items
    let scheduleItems;
    if (Array.isArray(data)) {
      scheduleItems = data;
    } else if (data.schedule_items) {
      scheduleItems = typeof data.schedule_items === 'string' 
        ? JSON.parse(data.schedule_items) 
        : data.schedule_items;
    } else if (data.schedule_data) {
      scheduleItems = typeof data.schedule_data === 'string'
        ? JSON.parse(data.schedule_data)
        : data.schedule_data;
    }
    
    if (!scheduleItems || scheduleItems.length === 0) {
      console.warn('⚠️ No schedule items found');
      tableBody.innerHTML = '<tr><td colspan="4" class="loading">No schedule items found for this event. Create a schedule in the web interface first.</td></tr>';
      return;
    }
    
    schedule = scheduleItems;
    console.log('✅ Schedule loaded:', schedule.length, 'items');
    
    // Render schedule table
    renderSchedule();
    
    // Load active timer status from API
    await syncTimerStatus();
    
    // Start timer updates
    startTimerUpdates();
    
  } catch (error) {
    console.error('❌ Error loading schedule:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
      
      if (error.response.status === 404) {
        tableBody.innerHTML = `<tr><td colspan="4" class="loading">
          No schedule data found for this event (Event ID: ${eventId}).<br>
          Please create a schedule in the web interface first, or select a different event.
        </td></tr>`;
      } else {
        tableBody.innerHTML = `<tr><td colspan="4" class="loading">Error loading schedule: ${error.message}</td></tr>`;
      }
    } else {
      tableBody.innerHTML = `<tr><td colspan="4" class="loading">Error loading schedule: ${error.message}</td></tr>`;
    }
  }
}

// Render schedule table
function renderSchedule() {
  const tableBody = document.getElementById('scheduleTableBody');
  
  if (schedule.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="4" class="loading">No schedule items</td></tr>';
    return;
  }
  
  // Filter schedule by selected day (like RunOfShowPage.tsx getFilteredSchedule)
  const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
  
  if (filteredSchedule.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" class="loading">No schedule items for Day ${selectedDay}</td></tr>`;
    return;
  }
  
  tableBody.innerHTML = filteredSchedule.map((item, index) => {
    const cueNumber = item.customFields?.cue || item.timerId || `ROW${index + 1}`;
    const duration = formatDuration(item.durationHours, item.durationMinutes, item.durationSeconds);
    const isActive = activeItemId === item.id;
    const isRunning = activeTimers[item.id];
    const isIndented = item.isIndented;
    
    let statusClass = 'idle';
    let statusText = '—';
    
    if (isRunning) {
      statusClass = 'running';
      statusText = 'RUNNING';
    } else if (isActive) {
      statusClass = 'loaded';
      statusText = 'LOADED';
    }
    
    let rowClass = '';
    if (isActive) rowClass += ' active';
    if (isIndented) rowClass += ' indented';
    
    return `
      <tr class="${rowClass}" data-item-id="${item.id}">
        <td><span class="cue-badge">${escapeHtml(cueNumber)}</span></td>
        <td>${escapeHtml(item.segmentName || '—')}</td>
        <td><span class="duration-badge">${duration}</span></td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      </tr>
    `;
  }).join('');
}

// Sync timer status from API (like RunOfShowPage.tsx)
async function syncTimerStatus() {
  if (!currentEvent) return;
  
  try {
    console.log('🔄 Syncing timer status from API for event:', currentEvent.id);
    const response = await axios.get(`${config.apiUrl}/api/active-timers/${currentEvent.id}`);
    const data = response.data;
    
    console.log('📊 Timer status data received:', data);
    
    // API returns an array, get the first (most recent) timer record
    const timerRecord = Array.isArray(data) ? data[0] : data;
    
    if (timerRecord && timerRecord.is_active) {
      console.log('⏱️ Active timer found:', timerRecord);
      
      const itemId = parseInt(timerRecord.item_id);
      const isRunning = timerRecord.is_running;
      const timerState = timerRecord.timer_state || 'unknown';
      
      // Find the item in the filtered schedule for the current day
      const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
      const item = filteredSchedule.find(s => s.id === itemId);
      
      if (item) {
        activeItemId = itemId;
        
        if (isRunning && timerRecord.started_at) {
          // Timer is RUNNING
          activeTimers[itemId] = true;
          
          // Calculate elapsed time
          const startedAt = new Date(timerRecord.started_at);
          const now = new Date();
          const elapsedSeconds = Math.floor((now - startedAt) / 1000);
          
          timerProgress[itemId] = {
            elapsed: elapsedSeconds,
            total: timerRecord.duration_seconds || 0,
            startedAt: timerRecord.started_at
          };
          
          console.log('▶️ Timer is RUNNING:', { elapsedSeconds, total: timerRecord.duration_seconds });
        } else if (timerState === 'loaded' || (timerRecord.is_active && !isRunning)) {
          // Timer is LOADED but not running
          activeTimers[itemId] = false;
          timerProgress[itemId] = {
            elapsed: 0,
            total: timerRecord.duration_seconds || 0,
            startedAt: null
          };
          
          console.log('⏸️ Timer is LOADED:', { 
            itemId, 
            total: timerRecord.duration_seconds, 
            timerState,
            is_active: timerRecord.is_active,
            is_running: isRunning
          });
        } else {
          // Timer is stopped or unknown state
          console.log('⏹️ Timer is STOPPED or UNKNOWN:', { timerState, is_active: timerRecord.is_active, is_running: isRunning });
          activeItemId = null;
          activeTimers = {};
          timerProgress = {};
        }
        
        // Update display
        updateCurrentCueDisplay();
        renderSchedule();
        
        console.log('✅ Timer status synced successfully');
      } else {
        console.warn('⚠️ Timer item not found in current day schedule:', itemId);
        // Still update the activeItemId but mark as not found in current day
        activeItemId = itemId;
        updateCurrentCueDisplay();
        renderSchedule();
      }
    } else {
      console.log('📭 No active timer found (is_active is false or no record)');
      activeItemId = null;
      activeTimers = {};
      timerProgress = {};
      updateCurrentCueDisplay();
      renderSchedule();
    }
    
  } catch (error) {
    console.warn('⚠️ Could not sync timer status:', error.message);
  }
}

// Load cue by ID (called from OSC)
async function loadCueById(itemId) {
  console.log('🔵 Loading cue by ID:', itemId);
  
  const item = schedule.find(s => s.id === itemId);
  if (!item) {
    console.warn('⚠️ Item not found:', itemId);
    return;
  }
  
  try {
    // Stop any running timers first
    await stopAllTimers();
    
    // Calculate duration
    const totalSeconds = item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds;
    
    // Find row number
    const rowNumber = schedule.findIndex(s => s.id === itemId) + 1;
    const cueNumber = item.customFields?.cue || item.timerId || `CUE ${itemId}`;
    
    // Call API to load cue - using correct endpoint and parameters
    await axios.post(`${config.apiUrl}/api/cues/load`, {
      event_id: currentEvent.id,
      item_id: itemId,
      user_id: 'osc-electron-app',
      duration_seconds: totalSeconds,
      row_is: rowNumber,
      cue_is: cueNumber,
      timer_id: item.timerId || `TMR${itemId}`
    });
    
    // Update local state
    activeItemId = itemId;
    timerProgress[itemId] = {
      elapsed: 0,
      total: totalSeconds,
      startedAt: null
    };
    activeTimers = {};
    
    // Update display
    updateCurrentCueDisplay();
    renderSchedule();
    
    console.log('✅ Cue loaded:', itemId);
    
  } catch (error) {
    console.error('❌ Error loading cue:', error);
  }
}

// Load cue by cue number
async function loadCueByCueNumber(cueNumber) {
  console.log('🔵 Loading cue by number:', cueNumber);
  
  // Filter schedule by selected day first (like RunOfShowPage.tsx)
  const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
  
  const item = filteredSchedule.find(s => {
    const itemCue = s.customFields?.cue || s.timerId || '';
    return itemCue.toString().toLowerCase() === cueNumber.toString().toLowerCase();
  });
  
  if (!item) {
    console.warn('⚠️ Cue not found:', cueNumber, 'for Day', selectedDay);
    addOSCLogEntry(`Cue ${cueNumber} not found for Day ${selectedDay}`, 'warning');
    return;
  }
  
  await loadCueById(item.id);
}

// Start cue (called from OSC)
async function startCue() {
  console.log('🟢 Starting cue');
  
  if (!activeItemId) {
    console.warn('⚠️ No cue loaded to start');
    return;
  }
  
  try {
    // Call API to start timer - using correct endpoint
    await axios.post(`${config.apiUrl}/api/timers/start`, {
      event_id: currentEvent.id,
      item_id: activeItemId,
      user_id: 'osc-electron-app'
    });
    
    // Update local state
    activeTimers[activeItemId] = true;
    if (timerProgress[activeItemId]) {
      timerProgress[activeItemId].startedAt = new Date().toISOString();
    }
    
    // Update display
    updateCurrentCueDisplay();
    renderSchedule();
    
    console.log('✅ Cue started:', activeItemId);
    
  } catch (error) {
    console.error('❌ Error starting cue:', error);
  }
}

// Stop cue (called from OSC)
async function stopCue() {
  console.log('🔴 Stopping cue');
  
  if (!activeItemId) {
    console.warn('⚠️ No cue loaded to stop');
    return;
  }
  
  await stopAllTimers();
}

// Stop all timers
async function stopAllTimers() {
  if (!currentEvent || !activeItemId) return;
  
  try {
    // Call API to stop timer - using correct endpoint
    await axios.post(`${config.apiUrl}/api/timers/stop`, {
      event_id: currentEvent.id,
      item_id: activeItemId
    });
    
    // Update local state
    activeTimers = {};
    
    // Update display
    updateCurrentCueDisplay();
    renderSchedule();
    
    console.log('✅ All timers stopped');
    
  } catch (error) {
    console.error('❌ Error stopping timers:', error);
  }
}

// Load next cue
async function loadNextCue() {
  if (!activeItemId || schedule.length === 0) {
    console.warn('⚠️ Cannot load next cue');
    return;
  }
  
  const currentIndex = schedule.findIndex(s => s.id === activeItemId);
  if (currentIndex === -1 || currentIndex === schedule.length - 1) {
    console.warn('⚠️ Already at last cue');
    return;
  }
  
  const nextItem = schedule[currentIndex + 1];
  await loadCueById(nextItem.id);
}

// Load previous cue
async function loadPrevCue() {
  if (!activeItemId || schedule.length === 0) {
    console.warn('⚠️ Cannot load previous cue');
    return;
  }
  
  const currentIndex = schedule.findIndex(s => s.id === activeItemId);
  if (currentIndex <= 0) {
    console.warn('⚠️ Already at first cue');
    return;
  }
  
  const prevItem = schedule[currentIndex - 1];
  await loadCueById(prevItem.id);
}

// Go to row
async function gotoRow(rowNumber) {
  const index = rowNumber - 1; // Convert to 0-based
  if (index < 0 || index >= schedule.length) {
    console.warn('⚠️ Invalid row number:', rowNumber);
    return;
  }
  
  const item = schedule[index];
  await loadCueById(item.id);
}

// Set day via OSC command
async function setDay(day) {
  console.log('📅 Setting day via OSC:', day);
  
  if (!currentEvent) {
    console.warn('⚠️ No event selected');
    return;
  }
  
  // Check if the event supports multiple days
  if (!currentEvent.numberOfDays || currentEvent.numberOfDays <= 1) {
    console.warn('⚠️ Event does not support multiple days');
    addOSCLogEntry('Event does not support multiple days', 'warning');
    return;
  }
  
  // Check if the requested day is valid
  if (day < 1 || day > currentEvent.numberOfDays) {
    console.warn('⚠️ Invalid day number:', day);
    addOSCLogEntry(`Invalid day number: ${day}. Valid range: 1-${currentEvent.numberOfDays}`, 'warning');
    return;
  }
  
  // Update the day selector
  selectedDay = day;
  document.getElementById('daySelect').value = day;
  
  // Reload schedule for the new day
  await loadEventSchedule(currentEvent.id, day);
  
  showToast(`Day set to ${day} via OSC`);
}

// Get current day via OSC command
async function getDay() {
  console.log('📅 Getting current day via OSC');
  
  console.log('📅 Current day:', selectedDay);
  
  // Log to OSC log
  addOSCLogEntry(`Current day: ${selectedDay}`, 'info');
  
  showToast(`Current day: ${selectedDay}`);
}

// List cues via OSC command
async function listCues() {
  console.log('📋 Listing cues via OSC');
  
  if (!currentEvent || !schedule || schedule.length === 0) {
    console.warn('⚠️ No event or schedule loaded');
    addOSCLogEntry('No cues available - no event loaded', 'warning');
    return;
  }
  
  // Filter schedule by selected day (like RunOfShowPage.tsx)
  const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
  
  if (filteredSchedule.length === 0) {
    addOSCLogEntry(`No cues available for Day ${selectedDay}`, 'warning');
    showToast(`No cues for Day ${selectedDay}`);
    return;
  }
  
  const cueList = filteredSchedule.map((item, index) => {
    const cueNumber = item.customFields?.cue || item.timerId || `ROW${index + 1}`;
    return `${index + 1}. ${cueNumber} - ${item.segmentName || 'Unnamed'}`;
  }).join('\n');
  
  console.log('📋 Cues for Day', selectedDay, ':', cueList);
  addOSCLogEntry(`Day ${selectedDay} Cues (${filteredSchedule.length} total):\n${cueList}`, 'info');
  
  showToast(`Listed ${filteredSchedule.length} cues for Day ${selectedDay}`);
}

// Reset timer via OSC command
async function resetTimer() {
  console.log('🔄 Resetting all timers via OSC');
  
  if (!currentEvent) {
    console.warn('⚠️ No event loaded');
    return;
  }
  
  try {
    // Call API to reset - clears active_timers, completed_cues, sub_cue_timers tables
    await axios.post(`${config.apiUrl}/api/timers/reset`, {
      event_id: currentEvent.id
    });
    
    // Clear local state
    activeItemId = null;
    activeTimers = {};
    timerProgress = {};
    
    // Update display
    updateCurrentCueDisplay();
    renderSchedule();
    
    console.log('✅ Timer reset successful - all timer tables cleared');
    addOSCLogEntry('All timers reset (active_timers, completed_cues, sub_cue_timers cleared)', 'success');
    showToast('All timers reset via OSC');
  } catch (error) {
    console.error('❌ Error resetting timer:', error);
    addOSCLogEntry('Error resetting timers', 'error');
    showToast('Error resetting timer');
  }
}

// Start sub-timer via OSC command (sub-cue timer)
async function startSubTimer(cueNumber) {
  console.log('🟠 Starting sub-cue timer for cue:', cueNumber);
  
  if (!currentEvent || !schedule || schedule.length === 0) {
    console.warn('⚠️ No event or schedule loaded');
    return;
  }
  
  // Filter schedule by selected day
  const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
  
  // Find the item by cue number
  const item = filteredSchedule.find(s => 
    (s.customFields?.cue && s.customFields.cue.toString() === cueNumber) ||
    (s.timerId && s.timerId.toString() === cueNumber)
  );
  
  if (!item) {
    console.warn('⚠️ Cue not found:', cueNumber);
    addOSCLogEntry(`Sub-cue not found: ${cueNumber}`, 'error');
    return;
  }
  
  try {
    // Calculate total seconds
    const totalSeconds = (item.durationHours || 0) * 3600 + 
                        (item.durationMinutes || 0) * 60 + 
                        (item.durationSeconds || 0);
    
    const rowNumber = schedule.findIndex(s => s.id === item.id) + 1;
    const cueDisplay = item.customFields?.cue || item.timerId || `CUE ${item.id}`;
    const timerId = item.timerId || `SUB${item.id}`;
    
    // Call API to start sub-cue timer (updates sub_cue_timers table)
    await axios.post(`${config.apiUrl}/api/sub-cue-timers`, {
      event_id: currentEvent.id,
      item_id: item.id,
      user_id: 'osc-electron-app',
      user_name: 'OSC Control',
      user_role: 'OPERATOR',
      duration_seconds: totalSeconds,
      row_number: rowNumber,
      cue_display: cueDisplay,
      timer_id: timerId,
      is_active: true,
      is_running: true,
      started_at: new Date().toISOString()
    });
    
    console.log('✅ Sub-cue timer started in database:', item.id);
    addOSCLogEntry(`Sub-cue timer started: ${cueNumber}`, 'success');
    showToast(`Sub-cue ${cueNumber} started`);
    
  } catch (error) {
    console.error('❌ Error starting sub-cue timer:', error);
    addOSCLogEntry(`Error starting sub-cue: ${cueNumber}`, 'error');
    showToast('Error starting sub-cue timer');
  }
}

// Adjust timer duration via OSC command
async function adjustTimer(minutes) {
  console.log('⏱️ Adjusting timer duration by', minutes, 'minutes');
  
  if (!currentEvent || !activeItemId) {
    console.warn('⚠️ No active timer to adjust');
    return;
  }
  
  try {
    // Find the active item in schedule
    const item = schedule.find(s => s.id === activeItemId);
    if (!item) {
      console.warn('⚠️ Active item not found in schedule');
      return;
    }
    
    // Calculate new duration
    const currentDurationMinutes = (item.durationHours || 0) * 60 + (item.durationMinutes || 0);
    const newDurationMinutes = Math.max(0, currentDurationMinutes + minutes);
    
    const newHours = Math.floor(newDurationMinutes / 60);
    const newMinutes = newDurationMinutes % 60;
    const newSeconds = item.durationSeconds || 0;
    const newTotalSeconds = newHours * 3600 + newMinutes * 60 + newSeconds;
    
    console.log(`⏱️ Adjusting from ${currentDurationMinutes}m to ${newDurationMinutes}m`);
    
    // Step 1: Update the schedule in run_of_show_data table (for row duration display)
    const updatedSchedule = schedule.map(s => 
      s.id === activeItemId 
        ? { ...s, durationHours: newHours, durationMinutes: newMinutes, durationSeconds: newSeconds }
        : s
    );
    
    try {
      // First, get the current run_of_show_data to preserve custom_columns and settings
      const currentDataResponse = await axios.get(`${config.apiUrl}/api/run-of-show-data/${currentEvent.id}`);
      const currentData = currentDataResponse.data;
      
      // Update with preserved data
      await axios.post(`${config.apiUrl}/api/run-of-show-data`, {
        event_id: currentEvent.id,
        event_name: currentData.event_name,
        event_date: currentData.event_date,
        schedule_items: updatedSchedule,
        custom_columns: currentData.custom_columns || [],
        settings: currentData.settings || {},
        last_modified_by: 'osc-electron-app',
        last_modified_by_name: 'OSC Control',
        last_modified_by_role: 'OPERATOR'
      });
      console.log('✅ Schedule row duration updated in database');
    } catch (error) {
      console.warn('⚠️ Could not update schedule:', error.message);
      console.error(error);
    }
    
    // Step 2: Update the timer duration in active_timers table (for hybrid timer)
    try {
      await axios.put(`${config.apiUrl}/api/active-timers/${currentEvent.id}/${activeItemId}/duration`, {
        duration_seconds: newTotalSeconds
      });
      console.log('✅ Hybrid timer duration updated');
    } catch (error) {
      console.warn('⚠️ Could not update hybrid timer:', error.message);
    }
    
    // Update local schedule
    schedule = updatedSchedule;
    
    // Update timer progress total
    if (timerProgress[activeItemId]) {
      timerProgress[activeItemId].total = newTotalSeconds;
    }
    
    // Update display
    updateCurrentCueDisplay();
    renderSchedule();
    
    const sign = minutes > 0 ? '+' : '';
    console.log(`✅ Timer adjusted by ${sign}${minutes} minutes`);
    showToast(`Timer ${sign}${minutes} min`);
    
  } catch (error) {
    console.error('❌ Error adjusting timer:', error);
    showToast('Error adjusting timer');
  }
}

// Stop sub-timer via OSC command (sub-cue timer)
async function stopSubTimer(cueNumber) {
  console.log('🟠 Stopping sub-cue timer for cue:', cueNumber);
  
  if (!currentEvent) {
    console.warn('⚠️ No event loaded');
    return;
  }
  
  try {
    // Find the item by cue number (optional - can stop all sub-cue timers)
    let itemId = null;
    if (cueNumber && schedule && schedule.length > 0) {
      const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
      const item = filteredSchedule.find(s => 
        (s.customFields?.cue && s.customFields.cue.toString() === cueNumber) ||
        (s.timerId && s.timerId.toString() === cueNumber)
      );
      if (item) {
        itemId = item.id;
      }
    }
    
    // Call API to stop sub-cue timer (updates sub_cue_timers table: is_active=false, is_running=false)
    await axios.put(`${config.apiUrl}/api/sub-cue-timers/stop`, {
      event_id: currentEvent.id,
      item_id: itemId
    });
    
    console.log('✅ Sub-cue timer stopped in database');
    addOSCLogEntry(`Sub-cue timer stopped${cueNumber ? `: ${cueNumber}` : ''}`, 'success');
    showToast('Sub-cue timer stopped');
    
  } catch (error) {
    console.error('❌ Error stopping sub-cue timer:', error);
    addOSCLogEntry('Error stopping sub-cue timer', 'error');
    showToast('Error stopping sub-cue timer');
  }
}

// Update current cue display
function updateCurrentCueDisplay() {
  const statusEl = document.getElementById('cueStatus');
  const cueNumberEl = document.getElementById('currentCueNumber');
  const cueNameEl = document.getElementById('currentCueName');
  const timerDisplayEl = document.getElementById('timerDisplay');
  const timerProgressBar = document.getElementById('timerProgressBar');
  
  if (!activeItemId) {
    statusEl.textContent = 'No CUE Selected';
    statusEl.className = 'status-value';
    cueNumberEl.textContent = '—';
    cueNameEl.textContent = 'No cue loaded';
    timerDisplayEl.textContent = '00:00:00';
    timerProgressBar.style.width = '0%';
    return;
  }
  
  // Find item in current day's schedule
  const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
  const item = filteredSchedule.find(s => s.id === activeItemId);
  
  if (!item) {
    // Item might be from a different day
    const allItem = schedule.find(s => s.id === activeItemId);
    if (allItem) {
      statusEl.textContent = 'CUE FROM OTHER DAY';
      statusEl.className = 'status-value warning';
      cueNumberEl.textContent = allItem.customFields?.cue || allItem.timerId || 'CUE';
      cueNameEl.textContent = `${allItem.segmentName || 'Unnamed segment'} (Day ${allItem.day || 1})`;
      timerDisplayEl.textContent = 'Switch day to see';
      timerProgressBar.style.width = '0%';
      return;
    } else {
      // Item not found at all
      statusEl.textContent = 'CUE NOT FOUND';
      statusEl.className = 'status-value error';
      cueNumberEl.textContent = '—';
      cueNameEl.textContent = 'Item not in schedule';
      timerDisplayEl.textContent = '00:00:00';
      timerProgressBar.style.width = '0%';
      return;
    }
  }
  
  const cueNumber = item.customFields?.cue || item.timerId || 'CUE';
  const isRunning = activeTimers[activeItemId];
  
  // Update status
  statusEl.textContent = isRunning ? 'RUNNING' : 'LOADED';
  statusEl.className = isRunning ? 'status-value running' : 'status-value loaded';
  
  // Update cue info
  cueNumberEl.textContent = cueNumber;
  cueNameEl.textContent = item.segmentName || 'Unnamed segment';
  
  // Update timer
  const progress = timerProgress[activeItemId];
  if (progress) {
    const elapsed = progress.elapsed || 0;
    const total = progress.total || 0;
    const remaining = Math.max(0, total - elapsed);
    
    timerDisplayEl.textContent = formatTime(remaining);
    
    const percentage = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
    timerProgressBar.style.width = `${percentage}%`;
  } else {
    timerDisplayEl.textContent = '00:00:00';
    timerProgressBar.style.width = '0%';
  }
}

// Start timer updates (every second, like RunOfShowPage.tsx)
function startTimerUpdates() {
  stopTimerUpdates();
  
  timerInterval = setInterval(() => {
    // Update elapsed time for running timers using clock-synced time
    Object.keys(activeTimers).forEach(itemId => {
      if (activeTimers[itemId] && timerProgress[itemId] && timerProgress[itemId].startedAt) {
        const startedAt = new Date(timerProgress[itemId].startedAt);
        const syncedNow = new Date(Date.now() + clockOffset);
        const elapsedSeconds = Math.floor((syncedNow - startedAt) / 1000);
        timerProgress[itemId].elapsed = elapsedSeconds;
      }
    });
    
    // Update display
    updateCurrentCueDisplay();
    
    // Sync with API every 10 seconds (more frequent than before)
    if (Math.floor(Date.now() / 1000) % 10 === 0) {
      syncTimerStatus();
    }
  }, 1000);
}

// Stop timer updates
function stopTimerUpdates() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Add log entry to OSC log
function addLogEntry(logEntry) {
  const logContainer = document.getElementById('oscLog');
  
  const time = new Date(logEntry.timestamp).toLocaleTimeString();
  const typeClass = logEntry.type.toLowerCase();
  
  let dataHtml = '';
  if (logEntry.data && (Array.isArray(logEntry.data) ? logEntry.data.length > 0 : Object.keys(logEntry.data).length > 0)) {
    dataHtml = `<div class="log-data">${JSON.stringify(logEntry.data)}</div>`;
  }
  
  const entryHtml = `
    <div class="log-entry ${typeClass}">
      <div class="log-time">${time}</div>
      <div class="log-message">${escapeHtml(logEntry.message)}</div>
      ${dataHtml}
    </div>
  `;
  
  logContainer.insertAdjacentHTML('afterbegin', entryHtml);
  
  // Keep only last 50 entries in DOM
  const entries = logContainer.querySelectorAll('.log-entry');
  if (entries.length > 50) {
    entries[entries.length - 1].remove();
  }
}

// Show page
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  document.getElementById(pageId).classList.add('active');
}

// Show toast notification
function showToast(message) {
  console.log('📢', message);
  // Could implement a toast UI here
}

// Utility functions
function formatDuration(hours, minutes, seconds) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(dateString, timezone = 'America/New_York') {
  // Parse the date string (YYYY-MM-DD format)
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed
  
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: timezone
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Connect to Socket.IO for real-time updates
function connectToSocketIO(eventId) {
  // Disconnect existing socket if any
  if (socket) {
    console.log('🔌 Disconnecting existing socket...');
    socket.disconnect();
  }
  
  console.log('📡 Connecting to Socket.IO for event:', eventId);
  
  // Connect to the API server's Socket.IO
  socket = io(config.apiUrl, {
    transports: ['websocket', 'polling']
  });
  
  socket.on('connect', () => {
    console.log('✅ Socket.IO connected!');
    
    // Join the event room
    socket.emit('join-event', eventId);
    console.log(`📡 Joined event room: event:${eventId}`);
    
    // Show disconnect timer selection modal
    showDisconnectTimerModal();
  });
  
  // Listen for server time sync
  socket.on('serverTime', (data) => {
    const serverTime = new Date(data.serverTime).getTime();
    const clientTime = new Date().getTime();
    clockOffset = serverTime - clientTime;
    console.log('🕐 OSC App: Clock sync:', {
      serverTime: data.serverTime,
      clientTime: new Date().toISOString(),
      offsetMs: clockOffset,
      offsetSeconds: Math.floor(clockOffset / 1000)
    });
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Socket.IO disconnected');
    
    // Stop disconnect timer when disconnected
    stopDisconnectTimer();
  });
  
  socket.on('error', (error) => {
    console.error('❌ Socket.IO error:', error);
  });
  
  // Listen for timer updates (MATCHES api-server.js broadcasts)
  socket.on('update', (data) => {
    console.log('📨 Socket.IO update received:', data);
    
    if (data.type === 'timerUpdated') {
      handleTimerUpdate(data.data);
    } else if (data.type === 'timerStopped') {
      handleTimerStopped(data.data);
    } else if (data.type === 'scheduleUpdated' || data.type === 'runOfShowDataUpdated') {
      handleScheduleUpdate(data.data);
    } else if (data.type === 'resetAllStates') {
      handleResetAllStates(data.data);
    } else if (data.type === 'overtimeUpdate') {
      handleOvertimeUpdate(data.data);
    } else if (data.type === 'overtimeReset') {
      handleOvertimeReset(data.data);
    }
  });
}

// Handle timer update from Socket.IO (like RunOfShowPage.tsx)
function handleTimerUpdate(timerData) {
  console.log('🔄 Handling timer update from Socket.IO:', timerData);
  
  if (!timerData) return;
  
  // Check if this is for the current event
  if (timerData.event_id !== currentEvent?.id) {
    console.log('⚠️ Timer update for different event, ignoring');
    return;
  }
  
  console.log('✅ Timer update for current event, processing...');
  
  const itemId = timerData.item_id;
  
  // Update active item
  activeItemId = itemId;
  
  // Update timer progress
  if (timerData.is_running) {
    console.log('▶️ Timer is RUNNING via Socket.IO');
    activeTimers[itemId] = true;
    
    const startedAt = new Date(timerData.started_at);
    const now = new Date();
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);
    
    timerProgress[itemId] = {
      elapsed: elapsedSeconds,
      total: timerData.duration_seconds,
      startedAt: timerData.started_at
    };
  } else {
    console.log('⏸️ Timer is LOADED via Socket.IO (not running)');
    activeTimers[itemId] = false;
    
    timerProgress[itemId] = {
      elapsed: 0,
      total: timerData.duration_seconds,
      startedAt: null
    };
  }
  
  // Update display and schedule
  updateCurrentCueDisplay();
  renderSchedule();
  
  // Add to OSC log for visibility
  const item = schedule.find(s => s.id === itemId);
  if (item) {
    const cueNumber = item.customFields?.cue || item.timerId || 'CUE';
    const action = timerData.is_running ? 'started' : 'loaded';
    addOSCLogEntry(`Cue ${cueNumber} ${action} via Socket.IO`, 'info');
  }
}

// Handle timer stopped from Socket.IO
function handleTimerStopped(timerData) {
  console.log('⏹️ Handling timer stopped:', timerData);
  
  // Clear all active timers
  activeTimers = {};
  activeItemId = null;
  timerProgress = {};
  
  // Update display
  updateCurrentCueDisplay();
  renderSchedule();
}

// Handle schedule update from Socket.IO (real-time schedule changes)
async function handleScheduleUpdate(data) {
  console.log('📋 Schedule updated via Socket.IO:', data);
  console.log('📋 Current event ID:', currentEvent?.id);
  console.log('📋 Received event ID:', data?.event_id);
  
  if (!currentEvent) {
    console.log('⚠️ No current event loaded, ignoring schedule update');
    return;
  }
  
  if (data.event_id && data.event_id !== currentEvent.id) {
    console.log('⚠️ Schedule update for different event, ignoring');
    return;
  }
  
  console.log('✅ Schedule update for current event, reloading...');
  
  // Reload the schedule for the current day
  await loadEventSchedule(currentEvent.id, selectedDay);
  
  // Show notification
  addOSCLogEntry('Schedule updated - reloaded from server', 'info');
  showToast('📋 Schedule updated');
}

// Handle reset all states from Socket.IO
function handleResetAllStates(data) {
  console.log('🔄 Reset all states via Socket.IO:', data);
  
  if (!currentEvent || data.event_id !== currentEvent.id) {
    console.log('⚠️ Reset for different event, ignoring');
    return;
  }
  
  console.log('✅ Resetting all local states...');
  
  // Clear all local state
  activeItemId = null;
  activeTimers = {};
  timerProgress = {};
  
  // Update display
  updateCurrentCueDisplay();
  renderSchedule();
  
  // Show notification
  addOSCLogEntry('All states reset via Socket.IO', 'info');
  showToast('All states reset');
}

// Handle overtime update from Socket.IO
function handleOvertimeUpdate(data) {
  console.log('⏰ Overtime update received via Socket.IO:', data);
  
  if (!currentEvent || data.event_id !== currentEvent.id) {
    console.log('⚠️ Overtime update for different event, ignoring');
    return;
  }
  
  console.log(`✅ Overtime updated for item ${data.item_id}: ${data.overtimeMinutes} minutes`);
  
  // Reload schedule to show updated overtime in the display
  loadEventSchedule(currentEvent.id, selectedDay).then(() => {
    addOSCLogEntry(`Overtime: ${data.overtimeMinutes > 0 ? '+' : ''}${data.overtimeMinutes}m for item ${data.item_id}`, 'info');
  });
}

// Handle overtime reset from Socket.IO
function handleOvertimeReset(data) {
  console.log('⏰ Overtime reset received via Socket.IO:', data);
  
  if (!currentEvent || data.event_id !== currentEvent.id) {
    console.log('⚠️ Overtime reset for different event, ignoring');
    return;
  }
  
  console.log('✅ Overtime data cleared, reloading schedule...');
  
  // Reload schedule to clear overtime display
  loadEventSchedule(currentEvent.id, selectedDay).then(() => {
    addOSCLogEntry('Overtime data reset', 'info');
    showToast('Overtime cleared');
  });
}

// Show disconnect timer selection modal
function showDisconnectTimerModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  
  // Generate hour items (0-24)
  const hourItems = Array.from({length: 25}, (_, i) => 
    `<div class="picker-item" data-value="${i}">${i}</div>`
  ).join('');
  
  // Generate minute items (0, 5, 10, 15, 20, 25, 30)
  const minuteValues = [0, 5, 10, 15, 20, 25, 30];
  const minuteItems = minuteValues.map(m => 
    `<div class="picker-item" data-value="${m}">${m}</div>`
  ).join('');
  
  modal.innerHTML = `
    <div class="modal-content">
      <h3>⏰ Auto-Disconnect Timer</h3>
      <p>How long should this connection stay active?</p>
      <div class="timer-picker-container">
        <div class="picker-column">
          <div class="picker-label">Hours</div>
          <div class="picker-wrapper">
            <div class="picker-highlight"></div>
            <div class="picker-scroll" id="hoursPicker">
              ${hourItems}
            </div>
            <div class="picker-fade-top"></div>
            <div class="picker-fade-bottom"></div>
          </div>
        </div>
        <div class="picker-separator">:</div>
        <div class="picker-column">
          <div class="picker-label">Minutes</div>
          <div class="picker-wrapper">
            <div class="picker-highlight"></div>
            <div class="picker-scroll" id="minutesPicker">
              ${minuteItems}
            </div>
            <div class="picker-fade-top"></div>
            <div class="picker-fade-bottom"></div>
          </div>
        </div>
      </div>
      <div class="timer-actions">
        <button class="timer-btn-confirm" id="confirmTimerBtn">✓ Confirm</button>
        <button class="timer-btn-never" id="neverDisconnectBtn">∞ Never Disconnect</button>
      </div>
      <p class="timer-note">⚠️ "Never" may increase database costs</p>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Initialize pickers
  const hoursPicker = document.getElementById('hoursPicker');
  const minutesPicker = document.getElementById('minutesPicker');
  
  let selectedHours = 2;
  let selectedMinutes = 0;
  
  // Setup picker scroll behavior
  function setupPicker(picker, initialValue, values) {
    const items = picker.querySelectorAll('.picker-item');
    const itemHeight = 50; // Height of each item
    let currentIndex = values.indexOf(initialValue);
    let isDragging = false;
    let startY = 0;
    let scrollTop = 0;
    
    // Center the picker on initial value
    function scrollToIndex(index, smooth = false) {
      const targetScroll = index * itemHeight;
      if (smooth) {
        picker.style.scrollBehavior = 'smooth';
      } else {
        picker.style.scrollBehavior = 'auto';
      }
      picker.scrollTop = targetScroll;
      currentIndex = index;
      updateSelection();
    }
    
    function updateSelection() {
      items.forEach((item, idx) => {
        if (idx === currentIndex) {
          item.classList.add('selected');
        } else {
          item.classList.remove('selected');
        }
      });
    }
    
    // Mouse/touch events for dragging
    picker.addEventListener('mousedown', (e) => {
      isDragging = true;
      startY = e.clientY;
      scrollTop = picker.scrollTop;
      picker.style.scrollBehavior = 'auto';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      picker.scrollTop = scrollTop + deltaY;
    });
    
    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      snapToNearest();
    });
    
    // Snap to nearest item on scroll end
    function snapToNearest() {
      const index = Math.round(picker.scrollTop / itemHeight);
      const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
      scrollToIndex(clampedIndex, true);
    }
    
    picker.addEventListener('scroll', () => {
      if (!isDragging) {
        clearTimeout(picker.snapTimeout);
        picker.snapTimeout = setTimeout(snapToNearest, 100);
      }
    });
    
    // Click to select
    items.forEach((item, idx) => {
      item.addEventListener('click', () => {
        scrollToIndex(idx, true);
      });
    });
    
    // Initialize
    scrollToIndex(currentIndex);
    
    return {
      getValue: () => values[currentIndex],
      scrollToIndex
    };
  }
  
  const hoursControl = setupPicker(hoursPicker, selectedHours, Array.from({length: 25}, (_, i) => i));
  const minutesControl = setupPicker(minutesPicker, selectedMinutes, minuteValues);
  
  // Handle confirm button
  document.getElementById('confirmTimerBtn').addEventListener('click', () => {
    const hours = hoursControl.getValue();
    const mins = minutesControl.getValue();
    const totalMinutes = (hours * 60) + mins;
    
    if (totalMinutes === 0) {
      showToast('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    
    startDisconnectTimer(totalMinutes);
    
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (mins > 0) timeText += `${mins}m`;
    
    showToast(`Auto-disconnect: ${timeText.trim()}`);
    document.body.removeChild(modal);
  });
  
  // Handle never disconnect button
  document.getElementById('neverDisconnectBtn').addEventListener('click', () => {
    startDisconnectTimer(0);
    showToast('Auto-disconnect: Never (⚠️ may increase costs)');
    document.body.removeChild(modal);
  });
}

// Auto-refresh functions
function startAutoRefresh() {
  console.log(`🔄 Starting auto-refresh with interval: ${autoRefreshSeconds} seconds`);
  
  // Clear any existing interval
  stopAutoRefresh();
  
  // Set up new interval
  autoRefreshInterval = setInterval(async () => {
    if (currentEvent) {
      console.log(`🔄 Auto-refresh: Reloading schedule for event ${currentEvent.id}, day ${selectedDay}`);
      try {
        await loadEventSchedule(currentEvent.id, selectedDay);
        console.log('✅ Auto-refresh: Schedule reloaded successfully');
      } catch (error) {
        console.error('❌ Auto-refresh: Failed to reload schedule:', error);
      }
    }
  }, autoRefreshSeconds * 1000);
  
  console.log(`✅ Auto-refresh started: Will refresh every ${autoRefreshSeconds} seconds`);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log('⏹️ Auto-refresh stopped');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  console.log('🌐 DOM loaded, initializing...');
  init().catch(error => {
    console.error('❌ Initialization error:', error);
  });
});

