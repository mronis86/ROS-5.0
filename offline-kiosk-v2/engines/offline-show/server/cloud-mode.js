'use strict';

const { nowIso } = require('./db');

const SETTING_KEY = 'cloud_connectivity_mode';
const MODES = {
  LAN_ONLY: 'lan-only',
  CLOUD_CONNECTED: 'cloud-connected',
};

function ensureSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getCloudMode(db) {
  ensureSettingsTable(db);
  const row = db.prepare('SELECT value, updated_at FROM system_settings WHERE key = ?').get(SETTING_KEY);
  const mode =
    row?.value === MODES.CLOUD_CONNECTED ? MODES.CLOUD_CONNECTED : MODES.LAN_ONLY;
  return {
    mode,
    lanOnly: mode === MODES.LAN_ONLY,
    cloudConnected: mode === MODES.CLOUD_CONNECTED,
    updatedAt: row?.updated_at || null,
  };
}

function setCloudMode(db, mode, meta = {}) {
  if (mode !== MODES.LAN_ONLY && mode !== MODES.CLOUD_CONNECTED) {
    throw new Error('mode must be lan-only or cloud-connected');
  }
  ensureSettingsTable(db);
  const ts = nowIso();
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(SETTING_KEY, mode, ts);
  return {
    mode,
    lanOnly: mode === MODES.LAN_ONLY,
    cloudConnected: mode === MODES.CLOUD_CONNECTED,
    updatedAt: ts,
    updatedBy: meta.updatedBy || null,
  };
}

module.exports = {
  MODES,
  SETTING_KEY,
  getCloudMode,
  setCloudMode,
};
