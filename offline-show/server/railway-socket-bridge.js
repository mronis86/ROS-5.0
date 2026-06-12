'use strict';

const path = require('path');
const fs = require('fs');

const OFFLINE_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(OFFLINE_ROOT, '..');

function loadSocketIoClient() {
  try {
    return require('socket.io-client');
  } catch {
    /* fall through */
  }
  const candidates = [
    path.join(OFFLINE_ROOT, 'node_modules', 'socket.io-client'),
    path.join(REPO_ROOT, 'node_modules', 'socket.io-client'),
  ];
  for (const mod of candidates) {
    if (fs.existsSync(mod)) return require(mod);
  }
  throw new Error(
    'socket.io-client is not installed. From offline-show folder run: npm install'
  );
}

const { getCloudMode } = require('./cloud-mode');
const { RAILWAY_BASE_URL } = require('./railway-client');

/** Client → Railway events (same names as api-server.js) */
const CLIENT_TO_RAILWAY = [
  'joinEvent',
  'leaveEvent',
  'presenceJoin',
  'resetAllStates',
  'contentReviewSelectionUpdate',
  'contentReviewRequestState',
  'scriptScrollUpdate',
  'scriptCommentUpdate',
  'teleprompterSettingsUpdate',
  'teleprompterGuideLineUpdate',
  'overtimeUpdate',
  'showStartOvertimeUpdate',
  'startCueSelectionUpdate',
  'requestSync',
];

/** Railway → LAN direct events (not wrapped in `update`) */
const RAILWAY_DIRECT_TO_LAN = [
  'contentReviewSelectionSync',
  'scriptScrollSync',
  'scriptCommentSync',
  'teleprompterSettingsUpdated',
  'teleprompterGuideLineUpdated',
  'forceDisconnect',
];

/** Railway direct events re-emitted as `update` for the React socket client */
const RAILWAY_DIRECT_AS_UPDATE = {
  overtimeUpdate: (data) => ({
    type: 'overtimeUpdate',
    eventId: String(data?.event_id ?? ''),
    data,
    timestamp: new Date().toISOString(),
  }),
  showStartOvertimeUpdate: (data) => ({
    type: 'showStartOvertimeUpdate',
    eventId: String(data?.event_id ?? ''),
    data: {
      event_id: data?.event_id,
      item_id: data?.item_id,
      showStartOvertime: data?.showStartOvertime,
    },
    timestamp: new Date().toISOString(),
  }),
  startCueSelectionUpdate: (data) => ({
    type: 'startCueSelectionUpdate',
    eventId: String(data?.event_id ?? ''),
    data,
    timestamp: new Date().toISOString(),
  }),
};

function eventRoomId(message) {
  if (!message) return null;
  const id =
    message.eventId ??
    message.data?.event_id ??
    message.data?.eventId ??
    message.event_id;
  return id != null ? String(id) : null;
}

function createRailwaySocketBridge(localIo, db) {
  const { io: ioClient } = loadSocketIoClient();
  let railwaySocket = null;
  /** Every event room a LAN client has joined (cloud on or off) */
  const localJoinedEvents = new Set();

  function cloudConnected() {
    return getCloudMode(db).cloudConnected;
  }

  function disconnectRailway() {
    if (!railwaySocket) return;
    console.log('☁️ Railway Socket.IO bridge stopping');
    railwaySocket.removeAllListeners();
    railwaySocket.disconnect();
    railwaySocket = null;
  }

  function rejoinRailwayRooms() {
    if (!railwaySocket?.connected) return;
    for (const eventId of localJoinedEvents) {
      railwaySocket.emit('joinEvent', eventId);
      console.log(`☁️ Bridge joined Railway room event:${eventId}`);
    }
  }

  function ensureRailwayConnection() {
    if (!cloudConnected()) {
      disconnectRailway();
      return null;
    }
    if (railwaySocket) return railwaySocket;

    console.log(`☁️ Railway Socket.IO bridge connecting → ${RAILWAY_BASE_URL}`);
    railwaySocket = ioClient(RAILWAY_BASE_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
      timeout: 15000,
    });

    railwaySocket.on('connect', () => {
      console.log('☁️ Railway Socket.IO bridge connected');
      rejoinRailwayRooms();
    });

    railwaySocket.on('disconnect', (reason) => {
      console.log(`☁️ Railway Socket.IO bridge disconnected (${reason})`);
    });

    railwaySocket.on('connect_error', (err) => {
      console.warn('☁️ Railway Socket.IO bridge connect error:', err.message);
    });

    railwaySocket.on('update', (message) => {
      const eventId = eventRoomId(message);
      if (eventId) {
        localIo.to(`event:${eventId}`).emit('update', message);
      } else {
        localIo.emit('update', message);
      }
      console.log(`☁️→📡 Railway update: ${message?.type ?? 'unknown'}`);
    });

    railwaySocket.on('serverTime', (data) => {
      localIo.emit('serverTime', data);
    });

    for (const [eventName, toUpdate] of Object.entries(RAILWAY_DIRECT_AS_UPDATE)) {
      railwaySocket.on(eventName, (data) => {
        const message = toUpdate(data);
        const eventId = eventRoomId(message);
        if (eventId) localIo.to(`event:${eventId}`).emit('update', message);
      });
    }

    for (const eventName of RAILWAY_DIRECT_TO_LAN) {
      railwaySocket.on(eventName, (data) => {
        const eventId = data?.eventId != null ? String(data.eventId) : null;
        if (eventId) localIo.to(`event:${eventId}`).emit(eventName, data);
        else localIo.emit(eventName, data);
      });
    }

    return railwaySocket;
  }

  function forwardToRailway(eventName, payload) {
    if (!cloudConnected()) return false;
    const rs = ensureRailwayConnection();
    if (!rs?.connected) return false;
    rs.emit(eventName, payload);
    if (eventName !== 'requestSync') {
      console.log(`📡→☁️ Forwarded ${eventName} to Railway`);
    }
    return true;
  }

  function trackJoin(eventId) {
    const id = String(eventId);
    localJoinedEvents.add(id);
    if (cloudConnected()) {
      const rs = ensureRailwayConnection();
      if (rs?.connected) {
        rs.emit('joinEvent', id);
        console.log(`☁️ Bridge trackJoin → Railway event:${id}`);
      }
    }
  }

  function trackLeave(eventId) {
    const id = String(eventId);
    localJoinedEvents.delete(id);
    if (railwaySocket?.connected) railwaySocket.emit('leaveEvent', id);
  }

  function syncRoomsFromAdapter() {
    const rooms = localIo.sockets.adapter.rooms;
    for (const roomName of rooms.keys()) {
      if (roomName.startsWith('event:')) {
        localJoinedEvents.add(roomName.slice('event:'.length));
      }
    }
  }

  function onCloudModeChange() {
    if (cloudConnected()) {
      syncRoomsFromAdapter();
      const rs = ensureRailwayConnection();
      if (rs?.connected) {
        rejoinRailwayRooms();
      } else {
        rs?.once('connect', () => rejoinRailwayRooms());
      }
    } else {
      disconnectRailway();
    }
  }

  function attachLocalSocketHandlers(socket) {
    for (const eventName of CLIENT_TO_RAILWAY) {
      if (eventName === 'joinEvent' || eventName === 'leaveEvent') continue;
      socket.on(eventName, (payload) => {
        if (cloudConnected()) forwardToRailway(eventName, payload);
      });
    }
  }

  function isCloudConnected() {
    return cloudConnected();
  }

  if (cloudConnected()) {
    ensureRailwayConnection();
  }

  return {
    attachLocalSocketHandlers,
    trackJoin,
    trackLeave,
    onCloudModeChange,
    isCloudConnected,
    forwardToRailway,
  };
}

module.exports = { createRailwaySocketBridge };
