'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { initDb } = require('./db');
const { registerRoutes } = require('./routes');
const { getCloudMode } = require('./cloud-mode');
const { configureRailwayClient } = require('./railway-client');
const { getRailwayApiToken } = require('./railway-api-token');
const { createRailwaySocketBridge } = require('./railway-socket-bridge');
const { formatLanUrls, getLanIPv4Addresses } = require('./lan-addresses');

const PORT = Number(process.env.OFFLINE_PORT || process.env.PORT || 3004);
const HOST = process.env.OFFLINE_HOST || '0.0.0.0';
const IS_DEV = process.env.OFFLINE_DEV === '1' || process.env.OFFLINE_DEV === 'true';
const OFFLINE_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(OFFLINE_ROOT, '..');

function resolveUiDist() {
  const dir = path.join(OFFLINE_ROOT, 'ui', 'dist');
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

function loadVite() {
  const localVite = path.join(OFFLINE_ROOT, 'ui', 'node_modules', 'vite');
  if (fs.existsSync(localVite)) return require(localVite);
  return require(path.join(REPO_ROOT, 'node_modules', 'vite'));
}

async function start() {
  const db = initDb();
  configureRailwayClient({
    getToken: () => getRailwayApiToken(db),
  });
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
  });

  function broadcastUpdate(eventId, updateType, data) {
    const id = String(eventId);
    const message = { type: updateType, eventId: id, data, timestamp: new Date().toISOString() };
    io.to(`event:${id}`).emit('update', message);
    console.log(`📡 ${updateType} → event:${id}`);
  }

  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '50mb' }));

  function broadcastCloudMode(payload) {
    io.emit('cloudMode', {
      ...payload,
      timestamp: new Date().toISOString(),
    });
    console.log(`☁️ Cloud mode → ${payload.mode} (all LAN clients)`);
    railwayBridge.onCloudModeChange();
  }

  const railwayBridge = createRailwaySocketBridge(io, db);

  registerRoutes(app, db, { broadcastUpdate, broadcastCloudMode });

  app.get('/api/lan-info', (_req, res) => {
    res.json({
      port: PORT,
      host: HOST,
      urls: formatLanUrls(PORT),
      addresses: getLanIPv4Addresses(),
      hint: 'Open one of the LAN URLs on iPad/phone (same Wi‑Fi). Allow port 3004 in Windows Firewall if unreachable.',
    });
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);
    socket.emit('serverTime', { serverTime: new Date().toISOString() });
    socket.emit('cloudMode', {
      ...getCloudMode(db),
      timestamp: new Date().toISOString(),
    });

    railwayBridge.attachLocalSocketHandlers(socket);

    socket.on('joinEvent', (eventId) => {
      const id = String(eventId);
      socket.join(`event:${id}`);
      console.log(`👥 ${socket.id} joined event:${id}`);
      railwayBridge.trackJoin(id);
    });

    socket.on('leaveEvent', (eventId) => {
      const id = String(eventId);
      socket.leave(`event:${id}`);
      railwayBridge.trackLeave(id);
    });

    socket.on('requestSync', (data) => {
      if (railwayBridge.isCloudConnected()) return;
      const eventId = data?.eventId != null ? String(data.eventId) : '';
      if (!eventId) return;
      const { normalizeRunOfShowRow } = require('./db');
      const row = db.prepare('SELECT * FROM run_of_show_data WHERE event_id = ?').get(eventId);
      if (row) {
        io.to(`event:${eventId}`).emit('update', {
          type: 'runOfShowDataUpdated',
          eventId,
          data: normalizeRunOfShowRow(row),
          timestamp: new Date().toISOString(),
        });
      }
    });

    socket.on('forceClockSync', (data) => {
      if (railwayBridge.isCloudConnected()) return;
      const eventId = data?.eventId != null ? String(data.eventId) : '';
      if (!eventId || !socket.rooms.has(`event:${eventId}`)) return;

      const { normalizeActiveTimer, normalizeTimerMessage } = require('./db');
      const activeTimer = normalizeActiveTimer(
        db.prepare('SELECT * FROM active_timers WHERE event_id = ? ORDER BY updated_at DESC LIMIT 1').get(eventId)
      );
      broadcastUpdate(
        eventId,
        activeTimer && activeTimer.is_active && activeTimer.timer_state !== 'stopped'
          ? 'timerUpdated'
          : 'timersStopped',
        activeTimer || { event_id: eventId }
      );

      const subCueTimers = db
        .prepare('SELECT * FROM sub_cue_timers WHERE event_id = ? AND is_running = 1 ORDER BY created_at DESC')
        .all(eventId);
      if (subCueTimers.length > 0) {
        for (const timer of subCueTimers) broadcastUpdate(eventId, 'subCueTimerStarted', timer);
      } else {
        broadcastUpdate(eventId, 'subCueTimerStopped', { event_id: eventId });
      }

      const timerMessage = normalizeTimerMessage(
        db.prepare('SELECT * FROM timer_messages WHERE event_id = ? AND enabled = 1 ORDER BY created_at DESC LIMIT 1').get(eventId)
      );
      broadcastUpdate(
        eventId,
        'timerMessageUpdated',
        timerMessage || { event_id: eventId, message: '', enabled: false }
      );
      io.to(`event:${eventId}`).emit('serverTime', { serverTime: new Date().toISOString() });
    });

    socket.on('resetAllStates', (data) => {
      if (railwayBridge.isCloudConnected()) return;
      const eventId = data?.eventId != null ? String(data.eventId) : '';
      if (!eventId) return;
      io.to(`event:${eventId}`).emit('update', {
        type: 'resetAllStates',
        eventId,
        data: { eventId },
        timestamp: new Date().toISOString(),
      });
      io.to(`event:${eventId}`).emit('update', {
        type: 'completedCuesUpdated',
        eventId,
        data: { cleared: true, eventId },
        timestamp: new Date().toISOString(),
      });
    });
  });

  if (IS_DEV) {
    const uiRoot = path.join(OFFLINE_ROOT, 'ui');
    const vite = await loadVite().createServer({
      configFile: path.join(uiRoot, 'vite.config.ts'),
      root: uiRoot,
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/socket.io')) {
        return next();
      }
      if (path.extname(req.path)) return next();
      try {
        const uiRoot = path.join(OFFLINE_ROOT, 'ui');
        const template = fs.readFileSync(path.join(uiRoot, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).setHeader('Content-Type', 'text/html').end(html);
      } catch (e) {
        next(e);
      }
    });
    console.log('🔧 Dev: API + offline UI on one port');
  } else {
    const dist = resolveUiDist();
    if (!dist) {
      console.error('❌ offline-show/ui/dist missing. Run: node offline-show/scripts/build-ui.js');
    } else {
      app.use(express.static(dist, { index: false }));
      app.get(/^\/(?!api|health|socket\.io).*/, (_req, res) => {
        res.sendFile(path.join(dist, 'index.html'));
      });
      console.log('📦 Serving built offline UI from ui/dist');
    }
  }

  server.listen(PORT, HOST, () => {
    const lanUrls = formatLanUrls(PORT);
    console.log('');
    console.log('========================================');
    console.log('  ROS Offline Show');
    console.log('========================================');
    for (const url of lanUrls) {
      console.log(`  ${url}`);
    }
    if (lanUrls.length <= 1) {
      console.log('  (no LAN IPv4 detected — Wi‑Fi/Ethernet connected?)');
    }
    console.log(`  Health: http://127.0.0.1:${PORT}/health`);
    console.log(`  Binding: ${HOST}:${PORT}`);
    console.log(`  Cloud on: API + WebSocket bridged to Railway/Neon`);
    console.log(`  LAN only: SQLite + local WebSocket`);
    console.log('  iPad/phone: use the http://192.168.x.x:3004 URL above (not 127.0.0.1)');
    console.log('  If LAN fails: run launcher\\allow-lan-firewall.bat as Administrator');
    console.log('========================================');
    console.log('');
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
