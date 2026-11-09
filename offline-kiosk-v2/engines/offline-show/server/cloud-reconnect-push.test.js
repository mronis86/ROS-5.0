'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  alignStartedAtFromRemaining,
  elapsedSecondsFromStartedAt,
  resolveActiveTimerForPush,
} = require('./cloud-reconnect-push');

test('alignStartedAtFromRemaining preserves mid-cue remaining', () => {
  const now = Date.parse('2026-07-21T20:00:00.000Z');
  const aligned = alignStartedAtFromRemaining(
    {
      is_running: true,
      timer_state: 'running',
      duration_seconds: 3600,
      remaining_seconds: 1800,
    },
    now
  );

  assert.equal(aligned.useServerTime, false);
  assert.equal(aligned.remaining_seconds, 1800);
  assert.equal(aligned.duration_seconds, 3600);
  assert.equal(aligned.started_at, '2026-07-21T19:30:00.000Z');
  assert.equal(elapsedSecondsFromStartedAt(aligned.started_at, now), 1800);
});

test('alignStartedAtFromRemaining allows overtime (negative remaining)', () => {
  const now = Date.parse('2026-07-21T20:00:00.000Z');
  const aligned = alignStartedAtFromRemaining(
    {
      is_running: true,
      timer_state: 'running',
      duration_seconds: 600,
      remaining_seconds: -45,
    },
    now
  );

  assert.equal(aligned.remaining_seconds, -45);
  assert.equal(aligned.started_at, '2026-07-21T19:49:15.000Z');
  const elapsed = elapsedSecondsFromStartedAt(aligned.started_at, now);
  assert.equal(elapsed, 645);
  assert.equal(600 - elapsed, -45);
});

test('alignStartedAtFromRemaining derives remaining from started_at', () => {
  const now = Date.parse('2026-07-21T20:00:00.000Z');
  const started = '2026-07-21T19:50:00.000Z'; // 600s ago
  const aligned = alignStartedAtFromRemaining(
    {
      is_running: true,
      timer_state: 'running',
      duration_seconds: 1200,
      started_at: started,
    },
    now
  );

  assert.equal(aligned.remaining_seconds, 600);
  assert.equal(aligned.started_at, '2026-07-21T19:50:00.000Z');
});

test('alignStartedAtFromRemaining ignores far-future loaded placeholder', () => {
  const now = Date.parse('2026-07-21T20:00:00.000Z');
  const aligned = alignStartedAtFromRemaining(
    {
      is_running: true,
      timer_state: 'running',
      duration_seconds: 600,
      started_at: '2099-12-31T23:59:59.999Z',
    },
    now
  );

  assert.equal(aligned.useServerTime, true);
  assert.equal(aligned.started_at, null);
  assert.equal(aligned.remaining_seconds, null);
});

test('alignStartedAtFromRemaining prefers remaining over far-future started_at', () => {
  const now = Date.parse('2026-07-21T20:00:00.000Z');
  const aligned = alignStartedAtFromRemaining(
    {
      is_running: true,
      timer_state: 'running',
      duration_seconds: 600,
      started_at: '2099-12-31T23:59:59.999Z',
      remaining_seconds: 120,
    },
    now
  );

  assert.equal(aligned.useServerTime, false);
  assert.equal(aligned.remaining_seconds, 120);
  assert.equal(aligned.started_at, '2026-07-21T19:52:00.000Z');
});

test('resolveActiveTimerForPush prefers UI remaining over SQLite started_at', () => {
  const now = Date.parse('2026-07-21T20:00:00.000Z');
  const db = {
    prepare() {
      return {
        get() {
          return {
            event_id: 'evt-1',
            item_id: '10',
            user_id: 'u1',
            user_name: 'Op',
            user_role: 'OPERATOR',
            timer_state: 'running',
            is_active: 1,
            is_running: 1,
            // Stale / drifted start would imply ~1000s remaining
            started_at: '2026-07-21T19:40:00.000Z',
            duration_seconds: 3600,
            last_loaded_cue_id: '10',
            cue_is: 'CUE 10',
          };
        },
      };
    },
  };

  const resolved = resolveActiveTimerForPush(
    db,
    'evt-1',
    {
      item_id: 10,
      timer_state: 'running',
      is_active: true,
      is_running: true,
      duration_seconds: 3600,
      remaining_seconds: 1234.6,
      cue_is: 'CUE 10',
      user_id: 'u1',
      user_name: 'Op',
    },
    now
  );

  assert.ok(resolved);
  assert.equal(resolved.item_id, 10);
  assert.equal(resolved.is_running, true);
  assert.equal(resolved.remaining_seconds, 1234.6);
  assert.equal(resolved.started_at, new Date(now - (3600 - 1234.6) * 1000).toISOString());
});
