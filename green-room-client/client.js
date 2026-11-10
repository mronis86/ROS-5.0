#!/usr/bin/env node
/**
 * Green Room display client (Node) — Mac/Linux or machines that already have Node.
 * On Windows prefer the portable double-click: "Start Green Room Client.bat"
 * (PowerShell, no install). Same config.json / cloud API either way.
 *
 * Standby → shows up on kiosk Status → Start/Standby commands.
 *
 * Config (env or ./config.json):
 *   ROS_API_URL / ROS_APP_URL / ROS_API_TOKEN / CLIENT_ID / CLIENT_NAME / HEARTBEAT_MS
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function loadConfig() {
  const cfgPath = path.join(__dirname, 'config.json');
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    /* optional */
  }
  const hostname = os.hostname();
  return {
    apiUrl: String(process.env.ROS_API_URL || file.apiUrl || 'https://ros-50-production.up.railway.app')
      .trim()
      .replace(/\/$/, ''),
    // SPA host (Cloudflare Pages). Railway API host has no /green-room UI (404).
    appUrl: String(
      process.env.ROS_APP_URL || file.appUrl || 'https://ros1615.pages.dev'
    )
      .trim()
      .replace(/\/$/, '')
      .replace(/https?:\/\/[^/]*up\.railway\.app$/i, 'https://ros1615.pages.dev'),
    token: String(process.env.ROS_API_TOKEN || file.token || '').trim(),
    clientId: String(
      process.env.CLIENT_ID || file.clientId || `gr-${hostname.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}`
    ).trim(),
    name: String(process.env.CLIENT_NAME || file.name || `Green Room · ${hostname}`).trim(),
    heartbeatMs: Math.max(5000, Number(process.env.HEARTBEAT_MS || file.heartbeatMs || 20000) || 20000),
    openBrowser: process.env.OPEN_BROWSER !== '0' && file.openBrowser !== false,
  };
}

const state = {
  status: 'standby',
  eventId: '',
  lastCommandId: null,
  lastError: '',
  openedUrl: '',
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function api(cfg, method, urlPath, body) {
  const res = await fetch(`${cfg.apiUrl}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function greenRoomUrl(cfg, eventId) {
  const u = new URL('/green-room', `${cfg.appUrl}/`);
  u.searchParams.set('eventId', eventId);
  return u.toString();
}

function openUrl(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : 'Failed to open browser';
    return false;
  }
}

async function applyCommand(cfg, command) {
  if (!command || !command.id) return;
  const action = String(command.action || '').toLowerCase();
  const eventId = String(command.eventId || '').trim();
  log('command', action, eventId || '(no event)', command.id);

  if (action === 'assign') {
    state.eventId = eventId;
    state.status = 'standby';
    state.lastError = '';
  } else if (action === 'start') {
    state.eventId = eventId;
    const url = command.url || greenRoomUrl(cfg, eventId);
    state.openedUrl = url;
    if (cfg.openBrowser) {
      const ok = openUrl(url);
      if (!ok) log('warn: could not open browser — client still marked active');
    }
    state.status = 'active';
    state.lastError = '';
    log('active →', url);
  } else if (action === 'stop') {
    state.status = 'standby';
    state.lastError = '';
    log('back to standby (close the Green Room tab manually for now)');
  } else {
    state.lastError = `Unknown action: ${action}`;
  }
  state.lastCommandId = command.id;
}

async function heartbeat(cfg) {
  const data = await api(cfg, 'POST', '/api/display-clients/heartbeat', {
    clientId: cfg.clientId,
    name: cfg.name,
    hostname: os.hostname(),
    kind: 'green-room',
    status: state.status,
    eventId: state.eventId,
    lastCommandId: state.lastCommandId,
    lastError: state.lastError,
  });
  const queued = data?.client?.queuedCommand;
  if (queued && queued.id && queued.id !== state.lastCommandId) {
    await applyCommand(cfg, queued);
    // Immediate ack heartbeat so command clears quickly
    await api(cfg, 'POST', '/api/display-clients/heartbeat', {
      clientId: cfg.clientId,
      name: cfg.name,
      hostname: os.hostname(),
      kind: 'green-room',
      status: state.status,
      eventId: state.eventId,
      lastCommandId: state.lastCommandId,
      lastError: state.lastError,
    });
  }
  return data?.client;
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error('Missing ROS_API_TOKEN (ros_itok_…). Put it in env or green-room-client/config.json');
    process.exit(1);
  }
  log('Green Room client starting');
  log('  api     ', cfg.apiUrl);
  log('  clientId', cfg.clientId);
  log('  name    ', cfg.name);
  log('  every   ', `${cfg.heartbeatMs}ms`);
  log('Standby — waiting for kiosk start/assign commands…');

  const tick = async () => {
    try {
      const client = await heartbeat(cfg);
      log(
        `ok · ${client?.status || state.status}` +
          (client?.eventId ? ` · event ${client.eventId}` : '') +
          (client?.queuedCommand ? ' · cmd pending' : '')
      );
    } catch (e) {
      log('heartbeat failed:', e.message || e);
    }
  };

  await tick();
  setInterval(tick, cfg.heartbeatMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
