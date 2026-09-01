/**
 * Training booking — Mon–Fri hourly slots 9:00–16:00 (ending 5pm) in TRAINING_TIMEZONE.
 * Multiple people may book the same hour. Admins can block full days or single hours.
 */

const { getAppPublicOrigin } = require('./access-portal');

const DEFAULT_TZ = 'America/New_York';
const SLOT_START_HOUR = 9;
const SLOT_END_HOUR = 16; // last slot starts at 4pm → 4–5pm
const SLOT_DURATION_MS = 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 60;

function trainingTimezone() {
  return (process.env.TRAINING_TIMEZONE || DEFAULT_TZ).trim() || DEFAULT_TZ;
}

function isMissingTrainingTableError(err) {
  return (
    err &&
    (err.code === '42P01' ||
      /training_bookings|training_blocked_dates|training_blocked_hours/i.test(String(err.message || '')))
  );
}

async function ensureTrainingSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.training_bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cancelled_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_training_bookings_starts_at
      ON public.training_bookings (starts_at)
  `);
  await pool.query(`DROP INDEX IF EXISTS public.idx_training_bookings_starts_at_active`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.training_blocked_dates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      block_date DATE NOT NULL UNIQUE,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_training_blocked_dates_date
      ON public.training_blocked_dates (block_date)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.training_blocked_hours (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      block_date DATE NOT NULL,
      hour INTEGER NOT NULL CHECK (hour >= 9 AND hour <= 16),
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (block_date, hour)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_training_blocked_hours_date
      ON public.training_blocked_hours (block_date)
  `);
}

/** Offset of timeZone at `date` (ms to add to local wall to get UTC… inverted below). */
function getTimeZoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - date.getTime();
}

/** Wall clock in `timeZone` → UTC Date. */
function wallTimeToUtc(year, month, day, hour, minute, timeZone) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offset;
  }
  return new Date(utcMs);
}

function formatDateKeyInTz(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function weekdayInTz(date, timeZone) {
  // 0=Sun … 6=Sat
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[day] ?? -1;
}

function parseDateKey(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function isWeekdayParts(year, month, day, timeZone) {
  const noon = wallTimeToUtc(year, month, day, 12, 0, timeZone);
  const wd = weekdayInTz(noon, timeZone);
  return wd >= 1 && wd <= 5;
}

function addCalendarDays(year, month, day, delta) {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcsUtcStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

function buildTrainingIcs(booking, { origin } = {}) {
  const id = booking.id;
  const starts = booking.starts_at || booking.startsAt;
  const ends = booking.ends_at || booking.endsAt;
  const uid = `${id}@ros-training`;
  const summary = 'ROS Application Training';
  const descriptionLines = [
    `Training session booked for ${booking.name || 'guest'}`,
    booking.email ? `Email: ${booking.email}` : '',
    booking.company ? `Company: ${booking.company}` : '',
    booking.notes ? `Notes: ${booking.notes}` : '',
    origin ? `Booked via ${origin}/training` : '',
  ].filter(Boolean);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ROS//Training Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtcStamp(new Date())}`,
    `DTSTART:${toIcsUtcStamp(starts)}`,
    `DTEND:${toIcsUtcStamp(ends)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(descriptionLines.join('\n'))}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function serializeBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    startsAt: row.starts_at instanceof Date ? row.starts_at.toISOString() : row.starts_at,
    endsAt: row.ends_at instanceof Date ? row.ends_at.toISOString() : row.ends_at,
    name: row.name,
    email: row.email,
    company: row.company || '',
    phone: row.phone || '',
    notes: row.notes || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    cancelledAt:
      row.cancelled_at instanceof Date
        ? row.cancelled_at.toISOString()
        : row.cancelled_at || null,
  };
}

async function listBlockedDateKeys(pool, fromKey, toKey) {
  const r = await pool.query(
    `SELECT block_date::text AS block_date, reason
     FROM public.training_blocked_dates
     WHERE block_date >= $1::date AND block_date <= $2::date
     ORDER BY block_date ASC`,
    [fromKey, toKey]
  );
  return r.rows.map((row) => ({
    date: String(row.block_date).slice(0, 10),
    reason: row.reason || '',
  }));
}

async function listBlockedHoursInRange(pool, fromKey, toKey) {
  const r = await pool.query(
    `SELECT block_date::text AS block_date, hour, reason
     FROM public.training_blocked_hours
     WHERE block_date >= $1::date AND block_date <= $2::date
     ORDER BY block_date ASC, hour ASC`,
    [fromKey, toKey]
  );
  return r.rows.map((row) => ({
    date: String(row.block_date).slice(0, 10),
    hour: Number(row.hour),
    reason: row.reason || '',
  }));
}

async function listBookedCounts(pool, fromUtc, toUtc) {
  const r = await pool.query(
    `SELECT starts_at, COUNT(*)::int AS count
     FROM public.training_bookings
     WHERE cancelled_at IS NULL
       AND starts_at >= $1 AND starts_at < $2
     GROUP BY starts_at`,
    [fromUtc, toUtc]
  );
  const map = new Map();
  for (const row of r.rows) {
    const d = row.starts_at instanceof Date ? row.starts_at : new Date(row.starts_at);
    const key = Math.floor(d.getTime() / 60000);
    map.set(key, (map.get(key) || 0) + (Number(row.count) || 0));
  }
  return map;
}

/**
 * Public availability for the next LOOKAHEAD_DAYS (weekdays only).
 * Slots stay bookable even when others have already booked the same hour.
 */
async function listAvailableSlots(pool, { fromDateKey, days } = {}) {
  const tz = trainingTimezone();
  const now = new Date();
  const todayKey = formatDateKeyInTz(now, tz);
  const startParts = parseDateKey(fromDateKey) || parseDateKey(todayKey);
  const horizon = Math.min(Math.max(Number(days) || LOOKAHEAD_DAYS, 1), 90);

  const endParts = addCalendarDays(startParts.year, startParts.month, startParts.day, horizon);
  const fromKey = `${startParts.year}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;
  const toKey = `${endParts.year}-${String(endParts.month).padStart(2, '0')}-${String(endParts.day).padStart(2, '0')}`;

  const rangeStart = wallTimeToUtc(startParts.year, startParts.month, startParts.day, 0, 0, tz);
  const rangeEnd = wallTimeToUtc(endParts.year, endParts.month, endParts.day, 23, 59, tz);

  const [blocked, blockedHours, bookedCounts] = await Promise.all([
    listBlockedDateKeys(pool, fromKey, toKey),
    listBlockedHoursInRange(pool, fromKey, toKey),
    listBookedCounts(pool, rangeStart, rangeEnd),
  ]);
  const blockedSet = new Set(blocked.map((b) => b.date));
  const blockedHourSet = new Set(blockedHours.map((b) => `${b.date}|${b.hour}`));

  const slots = [];
  let cursor = { ...startParts };
  for (let i = 0; i <= horizon; i++) {
    const dateKey = `${cursor.year}-${String(cursor.month).padStart(2, '0')}-${String(cursor.day).padStart(2, '0')}`;
    if (isWeekdayParts(cursor.year, cursor.month, cursor.day, tz) && !blockedSet.has(dateKey)) {
      for (let hour = SLOT_START_HOUR; hour <= SLOT_END_HOUR; hour++) {
        if (blockedHourSet.has(`${dateKey}|${hour}`)) continue;
        const startsAt = wallTimeToUtc(cursor.year, cursor.month, cursor.day, hour, 0, tz);
        if (startsAt.getTime() <= now.getTime()) continue;
        const startsIso = startsAt.toISOString();
        const endsAt = new Date(startsAt.getTime() + SLOT_DURATION_MS);
        const minuteKey = Math.floor(startsAt.getTime() / 60000);
        slots.push({
          startsAt: startsIso,
          endsAt: endsAt.toISOString(),
          date: dateKey,
          hour,
          bookingCount: bookedCounts.get(minuteKey) || 0,
          label: new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }).format(startsAt),
        });
      }
    }
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, 1);
  }

  return {
    timezone: tz,
    slotHours: { start: SLOT_START_HOUR, end: SLOT_END_HOUR + 1 },
    slots,
    blockedDates: blocked,
    blockedHours,
  };
}

async function createBooking(pool, payload) {
  const tz = trainingTimezone();
  const startsAt = new Date(payload.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    const err = new Error('Invalid start time.');
    err.status = 400;
    throw err;
  }
  if (startsAt.getTime() <= Date.now()) {
    const err = new Error('That slot is in the past.');
    err.status = 400;
    throw err;
  }

  const dateKey = formatDateKeyInTz(startsAt, tz);
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(startsAt);
  const hour = Number(hourStr);
  const minuteStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    minute: '2-digit',
  }).format(startsAt);
  if (Number(minuteStr) !== 0 || hour < SLOT_START_HOUR || hour > SLOT_END_HOUR) {
    const err = new Error('Pick a weekday hour between 9:00 AM and 4:00 PM.');
    err.status = 400;
    throw err;
  }
  const parts = parseDateKey(dateKey);
  if (!parts || !isWeekdayParts(parts.year, parts.month, parts.day, tz)) {
    const err = new Error('Training is only available Monday–Friday.');
    err.status = 400;
    throw err;
  }

  const blocked = await pool.query(
    `SELECT 1 FROM public.training_blocked_dates WHERE block_date = $1::date LIMIT 1`,
    [dateKey]
  );
  if (blocked.rows[0]) {
    const err = new Error('That day is blocked for training.');
    err.status = 409;
    throw err;
  }

  const blockedHour = await pool.query(
    `SELECT 1 FROM public.training_blocked_hours
     WHERE block_date = $1::date AND hour = $2 LIMIT 1`,
    [dateKey, hour]
  );
  if (blockedHour.rows[0]) {
    const err = new Error('That hour is blocked for training.');
    err.status = 409;
    throw err;
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  if (!name || name.length < 2) {
    const err = new Error('Please enter your name.');
    err.status = 400;
    throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const err = new Error('Please enter a valid email.');
    err.status = 400;
    throw err;
  }

  const endsAt = new Date(startsAt.getTime() + SLOT_DURATION_MS);
  const expectedStart = wallTimeToUtc(parts.year, parts.month, parts.day, hour, 0, tz);
  if (Math.abs(expectedStart.getTime() - startsAt.getTime()) > 1000) {
    const err = new Error('Invalid slot time.');
    err.status = 400;
    throw err;
  }

  try {
    const r = await pool.query(
      `INSERT INTO public.training_bookings
         (starts_at, ends_at, name, email, company, phone, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        expectedStart.toISOString(),
        endsAt.toISOString(),
        name,
        email,
        String(payload.company || '').trim() || null,
        String(payload.phone || '').trim() || null,
        String(payload.notes || '').trim() || null,
      ]
    );
    return serializeBooking(r.rows[0]);
  } catch (err) {
    throw err;
  }
}

async function getBookingById(pool, id) {
  const r = await pool.query(
    `SELECT * FROM public.training_bookings WHERE id = $1 AND cancelled_at IS NULL LIMIT 1`,
    [String(id)]
  );
  return serializeBooking(r.rows[0] || null);
}

async function listBookingsAdmin(pool, { includeCancelled = false, includePast = false, limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const pastFilter = includePast ? '' : 'AND starts_at >= NOW()';
  const r = await pool.query(
    includeCancelled
      ? `SELECT * FROM public.training_bookings WHERE TRUE ${pastFilter} ORDER BY starts_at DESC LIMIT $1`
      : `SELECT * FROM public.training_bookings WHERE cancelled_at IS NULL ${pastFilter} ORDER BY starts_at ASC LIMIT $1`,
    [lim]
  );
  return r.rows.map(serializeBooking);
}

async function cancelBooking(pool, id) {
  const r = await pool.query(
    `UPDATE public.training_bookings
     SET cancelled_at = NOW()
     WHERE id = $1 AND cancelled_at IS NULL
     RETURNING *`,
    [String(id)]
  );
  return serializeBooking(r.rows[0] || null);
}

/** Cancel every active booking in the same hour block (same starts_at). */
async function cancelBookingsForSlot(pool, startsAtIso) {
  const startsAt = new Date(startsAtIso);
  if (Number.isNaN(startsAt.getTime())) {
    const err = new Error('Invalid start time.');
    err.status = 400;
    throw err;
  }
  const r = await pool.query(
    `UPDATE public.training_bookings
     SET cancelled_at = NOW()
     WHERE cancelled_at IS NULL
       AND starts_at >= $1::timestamptz - INTERVAL '30 seconds'
       AND starts_at < $1::timestamptz + INTERVAL '30 seconds'
     RETURNING *`,
    [startsAt.toISOString()]
  );
  return r.rows.map(serializeBooking);
}

async function listBlockedDatesAdmin(pool) {
  const r = await pool.query(
    `SELECT id, block_date::text AS block_date, reason, created_at
     FROM public.training_blocked_dates
     WHERE block_date >= (CURRENT_DATE - 7)
     ORDER BY block_date ASC`
  );
  return r.rows.map((row) => ({
    id: row.id,
    date: String(row.block_date).slice(0, 10),
    reason: row.reason || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
}

async function listBlockedHoursAdmin(pool) {
  const r = await pool.query(
    `SELECT id, block_date::text AS block_date, hour, reason, created_at
     FROM public.training_blocked_hours
     WHERE block_date >= (CURRENT_DATE - 7)
     ORDER BY block_date ASC, hour ASC`
  );
  return r.rows.map((row) => ({
    id: row.id,
    date: String(row.block_date).slice(0, 10),
    hour: Number(row.hour),
    reason: row.reason || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));
}

async function blockDate(pool, dateKey, reason) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    const err = new Error('Invalid date (use YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const r = await pool.query(
    `INSERT INTO public.training_blocked_dates (block_date, reason)
     VALUES ($1::date, $2)
     ON CONFLICT (block_date) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING id, block_date::text AS block_date, reason, created_at`,
    [key, String(reason || '').trim() || null]
  );
  // Full-day block supersedes hour blocks that day.
  await pool.query(`DELETE FROM public.training_blocked_hours WHERE block_date = $1::date`, [key]);
  const row = r.rows[0];
  return {
    id: row.id,
    date: String(row.block_date).slice(0, 10),
    reason: row.reason || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function unblockDate(pool, dateKey) {
  const parts = parseDateKey(dateKey);
  if (!parts) {
    const err = new Error('Invalid date.');
    err.status = 400;
    throw err;
  }
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  await pool.query(`DELETE FROM public.training_blocked_dates WHERE block_date = $1::date`, [key]);
  return { ok: true, date: key };
}

async function blockHour(pool, dateKey, hour, reason) {
  const parts = parseDateKey(dateKey);
  const h = Number(hour);
  if (!parts) {
    const err = new Error('Invalid date (use YYYY-MM-DD).');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(h) || h < SLOT_START_HOUR || h > SLOT_END_HOUR) {
    const err = new Error(`Hour must be ${SLOT_START_HOUR}–${SLOT_END_HOUR} (24h).`);
    err.status = 400;
    throw err;
  }
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const dayBlocked = await pool.query(
    `SELECT 1 FROM public.training_blocked_dates WHERE block_date = $1::date LIMIT 1`,
    [key]
  );
  if (dayBlocked.rows[0]) {
    const err = new Error('That whole day is already blocked.');
    err.status = 409;
    throw err;
  }
  const r = await pool.query(
    `INSERT INTO public.training_blocked_hours (block_date, hour, reason)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (block_date, hour) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING id, block_date::text AS block_date, hour, reason, created_at`,
    [key, h, String(reason || '').trim() || null]
  );
  const row = r.rows[0];
  return {
    id: row.id,
    date: String(row.block_date).slice(0, 10),
    hour: Number(row.hour),
    reason: row.reason || '',
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function unblockHour(pool, dateKey, hour) {
  const parts = parseDateKey(dateKey);
  const h = Number(hour);
  if (!parts || !Number.isInteger(h)) {
    const err = new Error('Invalid date or hour.');
    err.status = 400;
    throw err;
  }
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  await pool.query(
    `DELETE FROM public.training_blocked_hours WHERE block_date = $1::date AND hour = $2`,
    [key, h]
  );
  return { ok: true, date: key, hour: h };
}

function buildIcsDownloadMeta(booking, req) {
  const origin = getAppPublicOrigin(req);
  const ics = buildTrainingIcs(booking, { origin });
  return {
    filename: `ros-training-${String(booking.startsAt || booking.starts_at).slice(0, 10)}.ics`,
    contentType: 'text/calendar; charset=utf-8',
    body: ics,
  };
}

module.exports = {
  trainingTimezone,
  SLOT_START_HOUR,
  SLOT_END_HOUR,
  isMissingTrainingTableError,
  ensureTrainingSchema,
  listAvailableSlots,
  createBooking,
  getBookingById,
  listBookingsAdmin,
  cancelBooking,
  cancelBookingsForSlot,
  listBlockedDatesAdmin,
  listBlockedHoursAdmin,
  blockDate,
  unblockDate,
  blockHour,
  unblockHour,
  buildTrainingIcs,
  buildIcsDownloadMeta,
  serializeBooking,
};
