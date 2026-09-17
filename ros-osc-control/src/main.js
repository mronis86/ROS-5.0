const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const osc = require('osc');
require('dotenv').config();

let mainWindow;
let oscUDP;
let powerSaveId;
let oscLog = [];

// Configuration
const config = {
  apiMode: process.env.API_MODE || 'RAILWAY',
  localApiUrl: process.env.LOCAL_API_URL || 'http://localhost:3001',
  railwayApiUrl: process.env.RAILWAY_API_URL || 'https://ros-50-production.up.railway.app',
  // Integration token (ros_itok_…) — Admin → Integration API tokens (read, control)
  apiToken: (process.env.API_TOKEN || process.env.RAILWAY_API_TOKEN || '').trim(),
  oscPort: parseInt(process.env.OSC_LISTEN_PORT) || 57121,
  oscHost: process.env.OSC_LISTEN_HOST || '0.0.0.0'
};

function getApiUrl() {
  return config.apiMode === 'LOCAL' ? config.localApiUrl : config.railwayApiUrl;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'ros-osc-config.json');
}

function loadPersistedConfig() {
  try {
    const file = getConfigPath();
    if (!fs.existsSync(file)) return;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.apiMode === 'LOCAL' || saved.apiMode === 'RAILWAY') {
      config.apiMode = saved.apiMode;
    }
    if (typeof saved.apiToken === 'string' && saved.apiToken.trim()) {
      if (!(process.env.API_TOKEN || process.env.RAILWAY_API_TOKEN)) {
        config.apiToken = saved.apiToken.trim();
      }
    }
    console.log('📋 Loaded persisted config from', file);
  } catch (err) {
    console.warn('⚠️ Could not load persisted config:', err.message);
  }
}

function savePersistedConfig() {
  try {
    const file = getConfigPath();
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          apiMode: config.apiMode,
          apiToken: config.apiToken || ''
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.warn('⚠️ Could not save config:', err.message);
  }
}

function publicConfig() {
  return {
    apiMode: config.apiMode,
    apiUrl: getApiUrl(),
    apiToken: config.apiToken || '',
    oscPort: config.oscPort,
    oscHost: config.oscHost
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'ROS OSC Control',
    backgroundColor: '#1e293b'
  });

  mainWindow.loadFile('src/renderer/index.html');
  
  // Wait for page to load before sending OSC status
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('🌐 Renderer loaded, ready to send messages');
  });

  // Prevent the app from sleeping or screen from dimming
  powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  console.log('🔋 Power save blocker enabled - app will never sleep');
  console.log('🔋 Power save blocker ID:', powerSaveId);
  console.log('🔋 Is preventing sleep:', powerSaveBlocker.isStarted(powerSaveId));

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
      console.log('🔋 Power save blocker stopped');
    }
  });
}

// Initialize OSC
function initializeOSC() {
  try {
    console.log('📡 Creating OSC UDP Port...');
    console.log(`   Address: ${config.oscHost}`);
    console.log(`   Port: ${config.oscPort}`);
    
    oscUDP = new osc.UDPPort({
      localAddress: config.oscHost,
      localPort: config.oscPort,
      metadata: true
    });

    oscUDP.on('ready', () => {
      console.log(`✅ OSC UDP Server listening on ${config.oscHost}:${config.oscPort}`);
      addOscLog('SYSTEM', `OSC Server started on port ${config.oscPort}`, {});
      
      // Send status to renderer - with delay to ensure window is ready
      setTimeout(() => {
        if (mainWindow && mainWindow.webContents) {
          console.log('📤 Sending OSC status to renderer...');
          mainWindow.webContents.send('osc-status', {
            status: 'listening',
            port: config.oscPort,
            host: config.oscHost
          });
          console.log('✅ OSC status sent to renderer');
        }
      }, 1000); // Wait 1 second for renderer to be fully ready
    });

    oscUDP.on('message', (oscMsg) => {
      console.log('📨 OSC Message received:', oscMsg);
      
      const address = oscMsg.address;
      const args = oscMsg.args || [];
      
      // Log the message
      addOscLog('RECEIVED', address, args);
      
      // Send to renderer for display
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('osc-message', {
          address,
          args,
          timestamp: new Date().toISOString()
        });
      }
      
      // Handle OSC commands
      handleOSCCommand(address, args);
    });

    oscUDP.on('error', (err) => {
      console.error('❌ OSC Error:', err);
      addOscLog('ERROR', err.message, {});
      
      // Try to send error to renderer
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('osc-status', {
          status: 'error',
          error: err.message
        });
      }
    });

    console.log('📡 Opening OSC port...');
    oscUDP.open();
    console.log('📡 OSC port opening...');
  } catch (error) {
    console.error('❌ Failed to initialize OSC:', error);
    throw error;
  }
}

// Handle OSC commands - MATCHING OSCModalSimplified.tsx commands
function handleOSCCommand(address, args) {
  console.log('🎯 Handling OSC command:', address, args);
  
  // Parse arguments into a usable format
  const values = args.map(arg => {
    if (typeof arg === 'object' && arg.type && arg.value !== undefined) {
      return arg.value;
    }
    return arg;
  });
  
  // Command routing - EXACT match to OSCModalSimplified.tsx
  
  // Main Cue Commands: /cue/{cueNumber}/load
  const cueLoadMatch = address.match(/^\/cue\/(.+)\/load$/);
  if (cueLoadMatch) {
    const cueNumber = cueLoadMatch[1];
    console.log('🔵 OSC CUE LOAD command - cue:', cueNumber);
    sendToRenderer('load-cue-by-number', { cueNumber: String(cueNumber) });
    return;
  }
  
  // Timer Commands
  if (address === '/timer/start') {
    console.log('🟢 OSC TIMER START command');
    sendToRenderer('start-cue', {});
    return;
  }
  
  if (address === '/timer/stop') {
    console.log('🔴 OSC TIMER STOP command');
    sendToRenderer('stop-cue', {});
    return;
  }
  
  if (address === '/timer/reset') {
    console.log('🔄 OSC TIMER RESET command');
    sendToRenderer('reset-timer', {});
    return;
  }
  
  // Timer Adjustment Commands
  if (address === '/timer/adjust/-1') {
    console.log('⏱️ OSC TIMER ADJUST -1 minute');
    sendToRenderer('adjust-timer', { minutes: -1 });
    return;
  }
  
  if (address === '/timer/adjust/+1') {
    console.log('⏱️ OSC TIMER ADJUST +1 minute');
    sendToRenderer('adjust-timer', { minutes: 1 });
    return;
  }
  
  if (address === '/timer/adjust/-5') {
    console.log('⏱️ OSC TIMER ADJUST -5 minutes');
    sendToRenderer('adjust-timer', { minutes: -5 });
    return;
  }
  
  if (address === '/timer/adjust/+5') {
    console.log('⏱️ OSC TIMER ADJUST +5 minutes');
    sendToRenderer('adjust-timer', { minutes: 5 });
    return;
  }
  
  // Sub-Timer Commands: /subtimer/cue/{cueNumber}/start or /stop
  const subtimerStartMatch = address.match(/^\/subtimer\/cue\/(.+)\/start$/);
  if (subtimerStartMatch) {
    const cueNumber = subtimerStartMatch[1];
    console.log('🟠 OSC SUBTIMER START command - cue:', cueNumber);
    sendToRenderer('start-subtimer', { cueNumber: String(cueNumber) });
    return;
  }
  
  const subtimerStopMatch = address.match(/^\/subtimer\/cue\/(.+)\/stop$/);
  if (subtimerStopMatch) {
    const cueNumber = subtimerStopMatch[1];
    console.log('🟠 OSC SUBTIMER STOP command - cue:', cueNumber);
    sendToRenderer('stop-subtimer', { cueNumber: String(cueNumber) });
    return;
  }
  
  // Multi-Day Commands
  if (address === '/set-day') {
    const dayNumber = values[0];
    if (dayNumber) {
      console.log('📅 OSC SET DAY command - day:', dayNumber);
      sendToRenderer('set-day', { day: parseInt(dayNumber) });
    }
    return;
  }
  
  if (address === '/get-day') {
    console.log('📅 OSC GET DAY command');
    sendToRenderer('get-day', {});
    return;
  }
  
  if (address === '/list-cues') {
    console.log('📋 OSC LIST CUES command');
    sendToRenderer('list-cues', {});
    return;
  }
  
  // Unknown command
  console.log('⚠️ Unknown OSC address:', address);
  addOscLog('UNKNOWN', `Unknown command: ${address}`, values);
}

// Send command to renderer
function sendToRenderer(command, data) {
  if (mainWindow) {
    mainWindow.webContents.send('osc-command', { command, data });
  }
}

// Add to OSC log
function addOscLog(type, message, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type,
    message,
    data
  };
  
  oscLog.unshift(logEntry); // Add to beginning
  
  // Keep only last 100 entries
  if (oscLog.length > 100) {
    oscLog = oscLog.slice(0, 100);
  }
  
  // Send to renderer
  if (mainWindow) {
    mainWindow.webContents.send('osc-log-update', logEntry);
  }
}

// IPC Handlers
ipcMain.handle('get-config', () => publicConfig());

ipcMain.handle('set-api-mode', (event, mode) => {
  config.apiMode = mode;
  savePersistedConfig();
  console.log('🔧 API mode changed to:', mode);
  return publicConfig();
});

ipcMain.handle('set-api-token', (event, token) => {
  config.apiToken = String(token || '').trim();
  savePersistedConfig();
  const preview = config.apiToken
    ? `${config.apiToken.slice(0, 12)}… (${config.apiToken.length} chars)`
    : '(empty)';
  console.log('🔑 API token updated:', preview);
  return publicConfig();
});

ipcMain.handle('get-osc-log', () => {
  return oscLog;
});

// App lifecycle
app.whenReady().then(() => {
  loadPersistedConfig();
  console.log('🚀 App ready, creating window...');
  console.log('🔑 API token:', config.apiToken ? 'set' : 'not set');
  createWindow();
  
  console.log('🎵 Initializing OSC...');
  try {
    initializeOSC();
  } catch (error) {
    console.error('❌ Failed to initialize OSC:', error);
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (oscUDP) {
    oscUDP.close();
  }
  if (powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

console.log('🚀 ROS OSC Control Starting...');
console.log('📡 API Mode:', config.apiMode);
console.log('🌐 API URL:', getApiUrl());
console.log('🎵 OSC Port:', config.oscPort);
console.log('🔑 API token via env:', !!(process.env.API_TOKEN || process.env.RAILWAY_API_TOKEN));

