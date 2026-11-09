'use strict';

const { nowIso } = require('./db');

const SETTING_KEY = 'railway_api_token';
const ENV_TOKEN = (process.env.OFFLINE_RAILWAY_API_TOKEN || '').trim() || null;

function ensureSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function tokenPrefix(token) {
  if (!token || token.length < 8) return null;
  return token.length <= 12 ? token : `${token.slice(0, 12)}…`;
}

function getStoredToken(db) {
  ensureSettingsTable(db);
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(SETTING_KEY);
  const value = typeof row?.value === 'string' ? row.value.trim() : '';
  return value || null;
}

/** Active token: env var wins over SQLite (for headless show laptops). */
function getRailwayApiToken(db) {
  if (ENV_TOKEN) return ENV_TOKEN;
  if (!db) return null;
  return getStoredToken(db);
}

function getRailwayApiTokenStatus(db) {
  if (ENV_TOKEN) {
    return {
      configured: true,
      prefix: tokenPrefix(ENV_TOKEN),
      source: 'env',
      locked: true,
    };
  }
  const stored = db ? getStoredToken(db) : null;
  return {
    configured: !!stored,
    prefix: tokenPrefix(stored),
    source: stored ? 'db' : null,
    locked: false,
  };
}

function setRailwayApiToken(db, token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!trimmed) {
    throw new Error('token is required');
  }
  ensureSettingsTable(db);
  const ts = nowIso();
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(SETTING_KEY, trimmed, ts);
  return getRailwayApiTokenStatus(db);
}

function clearRailwayApiToken(db) {
  if (ENV_TOKEN) {
    throw new Error('Token is set via OFFLINE_RAILWAY_API_TOKEN on the server — clear that env var instead');
  }
  ensureSettingsTable(db);
  db.prepare('DELETE FROM system_settings WHERE key = ?').run(SETTING_KEY);
  return getRailwayApiTokenStatus(db);
}

module.exports = {
  SETTING_KEY,
  getRailwayApiToken,
  getRailwayApiTokenStatus,
  setRailwayApiToken,
  clearRailwayApiToken,
};
