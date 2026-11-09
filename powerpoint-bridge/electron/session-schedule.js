/** Session length planning for PPT Bridge auto-stop. */

const MODES = Object.freeze({
  testing: 'testing',
  live: 'live',
  everyday: 'everyday',
});

function clampLiveHours(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 4;
  return Math.min(24, Math.max(1, n));
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function nextLocalMidnight(date = new Date()) {
  const d = startOfLocalDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

function todayAtHour(hour, date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
}

/**
 * @param {{ mode: string, hours?: number, now?: Date }} opts
 * @returns {{ ok: true, mode: string, hours: number|null, endsAt: Date, label: string } | { ok: false, error: string }}
 */
function planSession(opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const mode = String(opts.mode || '').trim().toLowerCase();

  if (mode === MODES.testing) {
    const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    return {
      ok: true,
      mode: MODES.testing,
      hours: 2,
      endsAt,
      label: 'Testing · 2 hours',
    };
  }

  if (mode === MODES.live) {
    const hours = clampLiveHours(opts.hours);
    const timed = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const midnight = nextLocalMidnight(now);
    const endsAt = timed.getTime() <= midnight.getTime() ? timed : midnight;
    const hitMidnight = endsAt.getTime() === midnight.getTime() && timed.getTime() > midnight.getTime();
    return {
      ok: true,
      mode: MODES.live,
      hours,
      endsAt,
      label: hitMidnight
        ? `Live event · ${hours}h (stops at midnight)`
        : `Live event · ${hours} hour${hours === 1 ? '' : 's'}`,
    };
  }

  if (mode === MODES.everyday) {
    const start = todayAtHour(7, now);
    const end = todayAtHour(21, now);
    if (now.getTime() >= end.getTime()) {
      return {
        ok: false,
        error: 'Everyday mode runs 7:00 AM–9:00 PM. It is past 9:00 PM — pick Testing or Live Event, or wait until 7:00 AM.',
      };
    }
    if (now.getTime() < start.getTime()) {
      return {
        ok: false,
        error: 'Everyday mode runs 7:00 AM–9:00 PM. It is before 7:00 AM — pick Testing or Live Event, or wait until 7:00 AM.',
      };
    }
    return {
      ok: true,
      mode: MODES.everyday,
      hours: null,
      endsAt: end,
      label: 'Everyday · until 9:00 PM',
    };
  }

  return { ok: false, error: 'Pick Testing, Live Event, or Everyday.' };
}

function sessionIsActive(endsAt, now = new Date()) {
  if (!endsAt) return false;
  const t = endsAt instanceof Date ? endsAt.getTime() : Date.parse(String(endsAt));
  return Number.isFinite(t) && t > now.getTime();
}

function formatRemaining(endsAt, now = new Date()) {
  const t = endsAt instanceof Date ? endsAt.getTime() : Date.parse(String(endsAt));
  if (!Number.isFinite(t)) return '';
  const ms = Math.max(0, t - now.getTime());
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin <= 0) return 'ending…';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m left`;
  return `${h}h ${m}m left`;
}

module.exports = {
  MODES,
  clampLiveHours,
  planSession,
  sessionIsActive,
  formatRemaining,
  nextLocalMidnight,
  todayAtHour,
};
