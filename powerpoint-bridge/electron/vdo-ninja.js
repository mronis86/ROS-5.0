const crypto = require('crypto');

function streamIdForEvent(eventId) {
  const compact = String(eventId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  return compact ? `ros${compact}` : `ros${crypto.randomBytes(8).toString('hex')}`;
}

function mintPassword() {
  return crypto.randomBytes(8).toString('hex');
}

function ensureRoom(rooms, eventId) {
  const key = String(eventId || '').trim();
  const next = rooms && typeof rooms === 'object' ? { ...rooms } : {};
  const existing = next[key];
  if (existing?.streamId && existing?.password) {
    return { rooms: next, room: { streamId: String(existing.streamId), password: String(existing.password) } };
  }
  const room = { streamId: streamIdForEvent(key), password: mintPassword() };
  next[key] = room;
  return { rooms: next, room };
}

function buildPushUrl(streamId, password, source) {
  const flags = source === 'camera' ? 'webcam&autostart' : 'screenshare&autostart';
  return `https://vdo.ninja/?push=${encodeURIComponent(streamId)}&password=${encodeURIComponent(password)}&${flags}&cleanoutput&label=ROS`;
}

function buildViewUrl(streamId, password) {
  return `https://vdo.ninja/?view=${encodeURIComponent(streamId)}&password=${encodeURIComponent(password)}&cleanoutput&autoplay`;
}

module.exports = { ensureRoom, buildPushUrl, buildViewUrl, streamIdForEvent };
