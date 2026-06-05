'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'offline-show.db');

function nowIso() {
  return new Date().toISOString();
}

function randomUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const { randomUUID: nodeUuid } = require('crypto');
  return nodeUuid();
}

function parseJson(val, fallback) {
  if (val == null || val === '') return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function stringifyJson(val) {
  if (val == null) return null;
  return typeof val === 'string' ? val : JSON.stringify(val);
}

function boolToInt(v) {
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}

function intToBool(v) {
  return v === 1 || v === true;
}

function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      schedule_data TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_of_show_data (
      event_id TEXT PRIMARY KEY,
      event_name TEXT,
      event_date TEXT,
      schedule_items TEXT DEFAULT '[]',
      custom_columns TEXT DEFAULT '[]',
      settings TEXT DEFAULT '{}',
      last_modified_by TEXT,
      last_modified_by_name TEXT,
      last_modified_by_role TEXT,
      last_change_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS active_timers (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      item_id TEXT,
      user_id TEXT,
      user_name TEXT,
      user_role TEXT,
      timer_state TEXT DEFAULT 'stopped',
      is_active INTEGER DEFAULT 0,
      is_running INTEGER DEFAULT 0,
      started_at TEXT,
      last_loaded_cue_id TEXT,
      cue_is TEXT,
      duration_seconds INTEGER DEFAULT 300,
      elapsed_seconds INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS completed_cues (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      cue_id TEXT,
      user_id TEXT NOT NULL,
      user_name TEXT,
      user_role TEXT,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS overtime_minutes (
      event_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      overtime_minutes INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (event_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS show_start_overtime (
      event_id TEXT PRIMARY KEY,
      item_id TEXT,
      show_start_overtime INTEGER DEFAULT 0,
      scheduled_time TEXT,
      actual_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timer_messages (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      message TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      sent_by TEXT,
      sent_by_name TEXT,
      sent_by_role TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indented_cues (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      parent_item_id TEXT,
      user_id TEXT,
      user_name TEXT,
      user_role TEXT,
      indented_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(event_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date DESC);
    CREATE INDEX IF NOT EXISTS idx_completed_cues_event ON completed_cues(event_id);
    CREATE INDEX IF NOT EXISTS idx_timer_messages_event ON timer_messages(event_id);

    CREATE TABLE IF NOT EXISTS sub_cue_timers (
      event_id TEXT PRIMARY KEY,
      item_id TEXT,
      user_id TEXT,
      user_name TEXT,
      user_role TEXT,
      duration_seconds INTEGER DEFAULT 0,
      row_number INTEGER,
      cue_display TEXT,
      timer_id TEXT,
      is_active INTEGER DEFAULT 0,
      is_running INTEGER DEFAULT 0,
      started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  console.log(`📂 Offline DB: ${DB_PATH}`);
  return db;
}

function normalizeCalendarEvent(row) {
  if (!row) return null;
  return {
    ...row,
    schedule_data: parseJson(row.schedule_data, {}),
  };
}

function normalizeRunOfShowRow(row) {
  if (!row) return null;
  return {
    ...row,
    schedule_items: parseJson(row.schedule_items, []),
    custom_columns: parseJson(row.custom_columns, []),
    settings: parseJson(row.settings, {}),
  };
}

function normalizeActiveTimer(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: intToBool(row.is_active),
    is_running: intToBool(row.is_running),
  };
}

function normalizeTimerMessage(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: intToBool(row.enabled),
  };
}

module.exports = {
  DB_PATH,
  nowIso,
  randomUUID,
  parseJson,
  stringifyJson,
  boolToInt,
  intToBool,
  initDb,
  normalizeCalendarEvent,
  normalizeRunOfShowRow,
  normalizeActiveTimer,
  normalizeTimerMessage,
};
