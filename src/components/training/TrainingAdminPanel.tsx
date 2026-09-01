import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminBlockTrainingDate,
  adminBlockTrainingHour,
  adminCancelTrainingBooking,
  adminCancelTrainingSlot,
  adminListBlockedDates,
  adminListTrainingBookings,
  adminUnblockTrainingDate,
  adminUnblockTrainingHour,
  fetchTrainingSlots,
  formatTrainingHourLabel,
  formatTrainingWhen,
  type TrainingBooking,
  type TrainingSlot,
} from '../../lib/trainingBooking';

type BlockMode = 'day' | 'hour';

const DEFAULT_SLOT_HOURS = { start: 9, end: 16 };

function todayKeyInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDayLabel(dateKey: string, timezone: string): string {
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const utcNoon = new Date(Date.UTC(y, m - 1, d, 16, 0, 0));
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(utcNoon);
  } catch {
    return dateKey;
  }
}

function formatSlotTime(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startsAt));
}

const TrainingAdminPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('America/New_York');
  const [slots, setSlots] = useState<TrainingSlot[]>([]);
  const [bookings, setBookings] = useState<TrainingBooking[]>([]);
  const [pastBookings, setPastBookings] = useState<TrainingBooking[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [loadingPast, setLoadingPast] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [blockedDays, setBlockedDays] = useState<{ id?: string; date: string; reason?: string }[]>([]);
  const [blockedHours, setBlockedHours] = useState<
    { id?: string; date: string; hour: number; reason?: string }[]
  >([]);
  const [slotHours, setSlotHours] = useState(DEFAULT_SLOT_HOURS);
  const [blockMode, setBlockMode] = useState<BlockMode>('day');
  const [blockDate, setBlockDate] = useState('');
  const [blockHour, setBlockHour] = useState(9);
  const [blockReason, setBlockReason] = useState('');
  const [busy, setBusy] = useState(false);

  const todayKey = useMemo(() => todayKeyInTimezone(timezone), [timezone]);

  const hourOptions = useMemo(() => {
    const opts: number[] = [];
    for (let h = slotHours.start; h <= slotHours.end; h++) opts.push(h);
    return opts;
  }, [slotHours]);

  const dates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of slots) {
      if (!seen.has(s.date)) {
        seen.add(s.date);
        out.push(s.date);
      }
    }
    return out;
  }, [slots]);

  const bookingsByStart = useMemo(() => {
    const map = new Map<string, TrainingBooking[]>();
    for (const b of bookings) {
      const list = map.get(b.startsAt) || [];
      list.push(b);
      map.set(b.startsAt, list);
    }
    return map;
  }, [bookings]);

  const daySlots = useMemo(
    () => slots.filter((s) => s.date === selectedDate),
    [slots, selectedDate]
  );

  const blockedDaySet = useMemo(() => new Set(blockedDays.map((b) => b.date)), [blockedDays]);
  const blockedHourSet = useMemo(
    () => new Set(blockedHours.map((b) => `${b.date}|${b.hour}`)),
    [blockedHours]
  );

  const upcomingBlockedDays = useMemo(
    () => blockedDays.filter((b) => b.date >= todayKey),
    [blockedDays, todayKey]
  );
  const upcomingBlockedHours = useMemo(
    () => blockedHours.filter((b) => b.date >= todayKey),
    [blockedHours, todayKey]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [slotData, b, d] = await Promise.all([
        fetchTrainingSlots(45),
        adminListTrainingBookings(false, false),
        adminListBlockedDates(),
      ]);
      if (!slotData.ok) throw new Error(slotData.error || 'Failed to load calendar');
      if (!b.ok) throw new Error(b.error || 'Failed to load bookings');
      if (!d.ok) throw new Error(d.error || 'Failed to load blocked dates');
      const tz = slotData.timezone || b.timezone || d.timezone || 'America/New_York';
      setTimezone(tz);
      setSlots(slotData.slots || []);
      setBookings(b.bookings || []);
      setBlockedDays(d.blockedDates || []);
      setBlockedHours(d.blockedHours || []);
      if (d.slotHours?.start != null && d.slotHours?.end != null) {
        setSlotHours({ start: Number(d.slotHours.start), end: Number(d.slotHours.end) });
      }
      const nextDates = Array.from(new Set((slotData.slots || []).map((s) => s.date)));
      setSelectedDate((prev) => {
        if (prev && nextDates.includes(prev)) return prev;
        return nextDates[0] || null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load training admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPastBookings = useCallback(async () => {
    setLoadingPast(true);
    try {
      const b = await adminListTrainingBookings(false, true);
      if (!b.ok) throw new Error(b.error || 'Failed to load past bookings');
      const now = Date.now();
      const past = (b.bookings || []).filter((row) => new Date(row.startsAt).getTime() < now);
      past.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
      setPastBookings(past.slice(0, 30));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load past bookings');
    } finally {
      setLoadingPast(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (showPast && pastBookings.length === 0) {
      void loadPastBookings();
    }
  }, [showPast, pastBookings.length, loadPastBookings]);

  const onBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockDate) return;
    setBusy(true);
    setError(null);
    try {
      const res =
        blockMode === 'hour'
          ? await adminBlockTrainingHour(blockDate, blockHour, blockReason)
          : await adminBlockTrainingDate(blockDate, blockReason);
      if (!res.ok) throw new Error(res.error || 'Failed to block');
      setBlockDate('');
      setBlockReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Block failed');
    } finally {
      setBusy(false);
    }
  };

  const onQuickBlockHour = async (date: string, hour: number) => {
    if (!window.confirm(`Block ${formatDayLabel(date, timezone)} ${formatTrainingHourLabel(hour)}?`)) return;
    setBusy(true);
    try {
      const res = await adminBlockTrainingHour(date, hour);
      if (!res.ok) throw new Error(res.error || 'Failed to block hour');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Block failed');
    } finally {
      setBusy(false);
    }
  };

  const onUnblockDay = async (date: string) => {
    if (!window.confirm(`Unblock the full day ${date}?`)) return;
    setBusy(true);
    try {
      const res = await adminUnblockTrainingDate(date);
      if (!res.ok) throw new Error(res.error || 'Failed to unblock');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unblock failed');
    } finally {
      setBusy(false);
    }
  };

  const onUnblockHour = async (date: string, hour: number) => {
    if (!window.confirm(`Unblock ${date} ${formatTrainingHourLabel(hour)}?`)) return;
    setBusy(true);
    try {
      const res = await adminUnblockTrainingHour(date, hour);
      if (!res.ok) throw new Error(res.error || 'Failed to unblock hour');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unblock failed');
    } finally {
      setBusy(false);
    }
  };

  const onCancelOne = async (id: string, name: string) => {
    if (!window.confirm(`Cancel booking for ${name} only?`)) return;
    setBusy(true);
    try {
      const res = await adminCancelTrainingBooking(id);
      if (!res.ok) throw new Error(res.error || 'Failed to cancel');
      await refresh();
      if (showPast) await loadPastBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const onCancelSlot = async (startsAt: string, count: number) => {
    const when = formatTrainingWhen(startsAt, timezone);
    if (!window.confirm(`Cancel all ${count} booking${count === 1 ? '' : 's'} in this hour?\n\n${when}`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await adminCancelTrainingSlot(startsAt);
      if (!res.ok) throw new Error(res.error || 'Failed to cancel slot');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel slot failed');
    } finally {
      setBusy(false);
    }
  };

  const upcomingBookingCount = bookings.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Bookings & availability</h2>
          <p className="text-sm text-slate-400 mt-1">
            Upcoming calendar view ({timezone.replace(/_/g, ' ')}). Past sessions are hidden unless you expand them
            below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy}
          className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm rounded-lg"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Block time</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={() => setBlockMode('day')}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              blockMode === 'day'
                ? 'bg-amber-700 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Full day
          </button>
          <button
            type="button"
            onClick={() => setBlockMode('hour')}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              blockMode === 'hour'
                ? 'bg-amber-700 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Single hour
          </button>
        </div>
        <form onSubmit={onBlock} className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-400">
            Date
            <input
              type="date"
              required
              min={todayKey}
              value={blockDate}
              onChange={(e) => setBlockDate(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-white"
            />
          </label>
          {blockMode === 'hour' ? (
            <label className="text-xs text-slate-400">
              Hour
              <select
                value={blockHour}
                onChange={(e) => setBlockHour(Number(e.target.value))}
                className="mt-1 block rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                {hourOptions.map((h) => (
                  <option key={h} value={h}>
                    {formatTrainingHourLabel(h)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-xs text-slate-400 flex-1 min-w-[10rem]">
            Reason (optional)
            <input
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Holiday, meeting…"
              className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-white"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium"
          >
            {blockMode === 'hour' ? 'Block hour' : 'Block day'}
          </button>
        </form>

        {(upcomingBlockedDays.length > 0 || upcomingBlockedHours.length > 0) && (
          <div className="mt-4 space-y-3">
            {upcomingBlockedDays.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                  Upcoming blocked days
                </p>
                <ul className="divide-y divide-slate-700/80">
                  {upcomingBlockedDays.map((row) => (
                    <li key={`day-${row.date}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div>
                        <span className="text-white font-medium">{formatDayLabel(row.date, timezone)}</span>
                        <span className="text-slate-500 ml-2">all day</span>
                        {row.reason ? <span className="text-slate-400 ml-2">{row.reason}</span> : null}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onUnblockDay(row.date)}
                        className="text-xs text-slate-300 hover:text-white underline"
                      >
                        Unblock
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {upcomingBlockedHours.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                  Upcoming blocked hours
                </p>
                <ul className="divide-y divide-slate-700/80">
                  {upcomingBlockedHours.map((row) => (
                    <li
                      key={`hour-${row.date}-${row.hour}`}
                      className="py-2 flex items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <span className="text-white font-medium">{formatDayLabel(row.date, timezone)}</span>
                        <span className="text-slate-300 ml-2">{formatTrainingHourLabel(row.hour)}</span>
                        {row.reason ? <span className="text-slate-400 ml-2">{row.reason}</span> : null}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onUnblockHour(row.date, row.hour)}
                        className="text-xs text-slate-300 hover:text-white underline"
                      >
                        Unblock
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
        {!loading && upcomingBlockedDays.length === 0 && upcomingBlockedHours.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No upcoming blocked days or hours.</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold text-white">
            Upcoming schedule {loading ? '' : `(${upcomingBookingCount} booking${upcomingBookingCount === 1 ? '' : 's'})`}
          </h3>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Loading calendar…</p>
        ) : dates.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming training days in the next few weeks.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {dates.map((d) => {
                const isToday = d === todayKey;
                const dayBookingCount = slots
                  .filter((s) => s.date === d)
                  .reduce((sum, s) => sum + (bookingsByStart.get(s.startsAt)?.length || 0), 0);
                const isBlocked = blockedDaySet.has(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedDate(d)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold min-w-[5.5rem] ${
                      selectedDate === d
                        ? 'bg-blue-600 text-white ring-2 ring-blue-400/50'
                        : isBlocked
                          ? 'bg-slate-900 text-slate-500 border border-slate-700'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span className="block">{formatDayLabel(d, timezone)}</span>
                    {isToday ? <span className="block text-[10px] font-normal opacity-90">Today</span> : null}
                    {dayBookingCount > 0 ? (
                      <span className="block text-[10px] font-normal text-amber-300 mt-0.5">
                        {dayBookingCount} booked
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selectedDate && blockedDaySet.has(selectedDate) ? (
              <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100 flex flex-wrap items-center justify-between gap-2">
                <span>This whole day is blocked from public booking.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onUnblockDay(selectedDate)}
                  className="text-xs underline hover:text-white"
                >
                  Unblock day
                </button>
              </div>
            ) : null}

            {selectedDate ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {daySlots.map((slot) => {
                  const slotBookings = bookingsByStart.get(slot.startsAt) || [];
                  const hourBlocked = blockedHourSet.has(`${slot.date}|${slot.hour}`);
                  const hasBookings = slotBookings.length > 0;
                  return (
                    <div
                      key={slot.startsAt}
                      className={`rounded-lg border p-3 ${
                        hourBlocked
                          ? 'border-slate-600 bg-slate-950/60 opacity-70'
                          : hasBookings
                            ? 'border-amber-500/50 bg-amber-950/20'
                            : 'border-slate-700 bg-slate-950/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {formatSlotTime(slot.startsAt, timezone)}
                          </p>
                          <p className="text-[11px] text-slate-500">{formatTrainingHourLabel(slot.hour)}</p>
                        </div>
                        <div className="flex flex-wrap gap-1 justify-end">
                          {hourBlocked ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onUnblockHour(slot.date, slot.hour)}
                              className="text-[11px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
                            >
                              Unblock
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onQuickBlockHour(slot.date, slot.hour)}
                              className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                            >
                              Block hour
                            </button>
                          )}
                          {hasBookings ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void onCancelSlot(slot.startsAt, slotBookings.length)}
                              className="text-[11px] px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-red-100"
                            >
                              Cancel all
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {hourBlocked ? (
                        <p className="text-xs text-slate-500">Blocked — not bookable</p>
                      ) : hasBookings ? (
                        <ul className="divide-y divide-slate-800">
                          {slotBookings.map((b) => (
                            <li key={b.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm text-slate-200">
                                  {b.name} · {b.email}
                                </p>
                                {(b.company || b.phone) && (
                                  <p className="text-xs text-slate-500">
                                    {[b.company, b.phone].filter(Boolean).join(' · ')}
                                  </p>
                                )}
                                {b.notes ? (
                                  <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{b.notes}</p>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void onCancelOne(b.id, b.name)}
                                className="shrink-0 text-[11px] px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200"
                              >
                                Cancel
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">Open — no bookings yet</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-900/20 p-4">
        <button
          type="button"
          onClick={() => setShowPast((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-300">Past sessions</h3>
            <p className="text-xs text-slate-500 mt-0.5">Hidden by default — expand to review recent history</p>
          </div>
          <span className="text-xs text-slate-400">{showPast ? 'Hide' : 'Show'}</span>
        </button>

        {showPast ? (
          <div className="mt-4 border-t border-slate-700/60 pt-4">
            {loadingPast ? (
              <p className="text-sm text-slate-500">Loading past sessions…</p>
            ) : pastBookings.length === 0 ? (
              <p className="text-sm text-slate-500">No recent past bookings.</p>
            ) : (
              <ul className="space-y-2">
                {pastBookings.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-500"
                  >
                    <p className="text-slate-400">{formatTrainingWhen(b.startsAt, timezone)}</p>
                    <p className="mt-0.5">
                      {b.name} · {b.email}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TrainingAdminPanel;
