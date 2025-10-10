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
let socket = null;

// Initialize
async function init() {
  console.log('🚀 Initializing ROS OSC Control...');
  
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
    
    // Load events
    console.log('📥 Loading events...');
    await loadEvents();
    
    console.log('✅ Initialization complete');
  } catch (error) {
    console.error('❌ Initialization failed:', error);
    throw error;
  }
}

// Setup event listeners
function setupEventListeners() {
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
      await loadEventSchedule(currentEvent.id);
    } else {
      await loadEvents();
    }
    showToast('Refreshed');
  });
  
  // Back to events button
  document.getElementById('backToEventsBtn').addEventListener('click', () => {
    showPage('eventListPage');
    currentEvent = null;
    schedule = [];
    activeItemId = null;
    stopTimerUpdates();
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
    default:
      console.warn('⚠️ Unknown OSC command:', command);
  }
}

// Load events from API
async function loadEvents() {
  console.log('📥 Loading events from API...');
  const eventList = document.getElementById('eventList');
  eventList.innerHTML = '<div class="loading">Loading events...</div>';
  
  try {
    const response = await axios.get(`${config.apiUrl}/api/calendar-events`);
    const events = response.data;
    console.log('✅ Events loaded:', events.length);
    console.log('📋 Events data:', events);
    
    if (events.length === 0) {
      eventList.innerHTML = '<div class="loading">No events found</div>';
      return;
    }
    
    // Store events globally for click handlers
    window.eventsData = events;
    
    // Render event cards with proper event listeners
    eventList.innerHTML = events.map((event, index) => {
      console.log(`Event ${index}:`, event);
      const numberOfDays = event.numberOfDays || 1;
      const dayIndicator = numberOfDays > 1 ? `<div class="event-days">📅 ${numberOfDays} Days</div>` : '';
      
      return `
        <div class="event-card" data-event-index="${index}">
          <h3>${escapeHtml(event.name)}</h3>
          <div class="event-date">📅 ${formatDate(event.date)}</div>
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
          selectEvent(event.id, event.name, event.date, event.numberOfDays || 1);
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

// Select an event
async function selectEvent(eventId, eventName, eventDate, numberOfDays = 1) {
  console.log('🎬 Event selected:', eventId, eventName, eventDate, 'days:', numberOfDays);
  
  try {
    currentEvent = { id: eventId, name: eventName, date: eventDate, numberOfDays: numberOfDays };
    
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
    
    if (data && data.activeTimer) {
      const timer = data.activeTimer;
      console.log('⏱️ Active timer found:', timer);
      
      // Find the item in the filtered schedule for the current day
      const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
      const item = filteredSchedule.find(s => s.id === timer.item_id);
      
      if (item) {
        activeItemId = timer.item_id;
        
        if (timer.is_running) {
          activeTimers[timer.item_id] = true;
          
          // Calculate elapsed time
          const startedAt = new Date(timer.started_at);
          const now = new Date();
          const elapsedSeconds = Math.floor((now - startedAt) / 1000);
          
          timerProgress[timer.item_id] = {
            elapsed: elapsedSeconds,
            total: timer.duration_seconds,
            startedAt: timer.started_at
          };
          
          console.log('▶️ Timer is RUNNING:', { elapsedSeconds, total: timer.duration_seconds });
        } else {
          activeTimers[timer.item_id] = false;
          timerProgress[timer.item_id] = {
            elapsed: 0,
            total: timer.duration_seconds,
            startedAt: null
          };
          
          console.log('⏸️ Timer is LOADED:', { total: timer.duration_seconds });
        }
        
        // Update display
        updateCurrentCueDisplay();
        renderSchedule();
        
        console.log('✅ Timer status synced successfully');
      } else {
        console.warn('⚠️ Timer item not found in current day schedule:', timer.item_id);
        // Still update the activeItemId but mark as not found in current day
        activeItemId = timer.item_id;
        updateCurrentCueDisplay();
        renderSchedule();
      }
    } else {
      console.log('📭 No active timer found');
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
  console.log('🔄 Resetting timer via OSC');
  
  try {
    const response = await axios.post(`${config.apiUrl}/api/timers/reset`);
    console.log('✅ Timer reset successful');
    showToast('Timer reset via OSC');
  } catch (error) {
    console.error('❌ Error resetting timer:', error);
    showToast('Error resetting timer');
  }
}

// Start sub-timer via OSC command
async function startSubTimer(cueNumber) {
  console.log('🟠 Starting sub-timer via OSC for cue:', cueNumber);
  
  try {
    const response = await axios.post(`${config.apiUrl}/api/subtimers/start`, {
      cueNumber: cueNumber
    });
    console.log('✅ Sub-timer started successfully');
    showToast(`Sub-timer started for cue ${cueNumber}`);
  } catch (error) {
    console.error('❌ Error starting sub-timer:', error);
    showToast('Error starting sub-timer');
  }
}

// Stop sub-timer via OSC command
async function stopSubTimer(cueNumber) {
  console.log('🟠 Stopping sub-timer via OSC for cue:', cueNumber);
  
  try {
    const response = await axios.post(`${config.apiUrl}/api/subtimers/stop`, {
      cueNumber: cueNumber
    });
    console.log('✅ Sub-timer stopped successfully');
    showToast(`Sub-timer stopped for cue ${cueNumber}`);
  } catch (error) {
    console.error('❌ Error stopping sub-timer:', error);
    showToast('Error stopping sub-timer');
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
    // Update elapsed time for running timers
    Object.keys(activeTimers).forEach(itemId => {
      if (activeTimers[itemId] && timerProgress[itemId] && timerProgress[itemId].startedAt) {
        const startedAt = new Date(timerProgress[itemId].startedAt);
        const now = new Date();
        const elapsedSeconds = Math.floor((now - startedAt) / 1000);
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

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
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
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Socket.IO disconnected');
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

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  console.log('🌐 DOM loaded, initializing...');
  init().catch(error => {
    console.error('❌ Initialization error:', error);
  });
});

