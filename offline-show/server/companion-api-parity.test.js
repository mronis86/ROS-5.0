'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const Database = require('better-sqlite3');
const express = require('express');
const { registerRoutes } = require('./routes');

const db = new Database(':memory:');
const updates = [];
let server;
let baseUrl;

before(async () => {
  db.exec(`
    CREATE TABLE active_timers (
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
    CREATE TABLE overtime_minutes (
      event_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      overtime_minutes INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (event_id, item_id)
    );
    CREATE TABLE run_of_show_data (
      event_id TEXT PRIMARY KEY,
      schedule_items TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sub_cue_timers (
      event_id TEXT PRIMARY KEY,
      item_id TEXT,
      duration_seconds INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 0,
      is_running INTEGER DEFAULT 0,
      started_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const app = express();
  app.use(express.json());
  registerRoutes(app, db, {
    broadcastUpdate(eventId, type, data) {
      updates.push({ eventId, type, data });
    },
    broadcastCloudMode() {},
  });
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
});

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

test('LAN Companion load preserves zero duration and start runs the loaded timer', async () => {
  const loaded = await request('/api/cues/load', {
    method: 'POST',
    body: JSON.stringify({
      event_id: 'event-1',
      item_id: 101,
      user_id: 'companion',
      duration_seconds: 0,
    }),
  });
  assert.equal(loaded.response.status, 200);
  assert.equal(loaded.body.timer.duration_seconds, 0);

  const started = await request('/api/timers/start', {
    method: 'POST',
    body: JSON.stringify({ event_id: 'event-1', item_id: 101 }),
  });
  assert.equal(started.response.status, 200);
  assert.equal(started.body.success, true);

  const timer = db.prepare('SELECT * FROM active_timers WHERE event_id = ?').get('event-1');
  assert.equal(timer.timer_state, 'running');
  assert.equal(timer.is_active, 1);
  assert.equal(timer.is_running, 1);
  assert.ok(updates.some((update) => update.type === 'timerUpdated'));
});

test('LAN Companion stop stores and broadcasts overtime', async () => {
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  db.prepare(`
    UPDATE active_timers
    SET started_at = ?, duration_seconds = 30, is_active = 1, is_running = 1,
        timer_state = 'running'
    WHERE event_id = ?
  `).run(startedAt, 'event-1');
  const timerBeforeStop = db
    .prepare('SELECT * FROM active_timers WHERE event_id = ?')
    .get('event-1');
  assert.equal(timerBeforeStop.is_running, 1);
  assert.equal(timerBeforeStop.duration_seconds, 30);

  const stopped = await request('/api/timers/stop', {
    method: 'POST',
    body: JSON.stringify({ event_id: 'event-1', item_id: 101 }),
  });
  assert.equal(stopped.response.status, 200);

  const overtime = db
    .prepare('SELECT overtime_minutes FROM overtime_minutes WHERE event_id = ? AND item_id = ?')
    .get('event-1', '101');
  assert.ok(overtime, 'expected overtime row for normalized Companion item ID');
  assert.equal(overtime.overtime_minutes, 1);
  assert.ok(
    updates.some(
      (update) => update.type === 'overtimeUpdate' && update.data.overtimeMinutes === 1
    )
  );
});

test('LAN Companion LED clear broadcasts the same event as Railway', async () => {
  const cleared = await request('/api/led-output/clear', {
    method: 'POST',
    body: JSON.stringify({ event_id: 'event-1' }),
  });
  assert.equal(cleared.response.status, 200);
  assert.deepEqual(cleared.body, { ok: true });
  assert.ok(
    updates.some(
      (update) =>
        update.type === 'ledOutputClear' &&
        update.eventId === 'event-1' &&
        update.data.eventId === 'event-1'
    )
  );
});
