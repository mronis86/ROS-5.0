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
  formatTrainingHourLabel,
  formatTrainingWhen,
  type TrainingBooking,
} from '../../lib/trainingBooking';

type BlockMode = 'day' | 'hour';

const DEFAULT_SLOT_HOURS = { start: 9, end: 16 };

function groupBookingsBySlot(bookings: TrainingBooking[]): { startsAt: string; bookings: TrainingBooking[] }[] {
  const map = new Map<string, TrainingBooking[]>();
  for (const b of bookings) {
    const key = b.startsAt;
    const list = map.get(key) || [];
    list.push(b);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    .map(([startsAt, group]) => ({ startsAt, bookings: group }));
}

const TrainingAdminPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('America/New_York');
  const [bookings, setBookings] = useState<TrainingBooking[]>([]);
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

  const hourOptions = useMemo(() => {
    const opts: number[] = [];
    for (let h = slotHours.start; h <= slotHours.end; h++) opts.push(h);
    return opts;
  }, [slotHours]);

  const slotGroups = useMemo(() => groupBookingsBySlot(bookings), [bookings]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, d] = await Promise.all([adminListTrainingBookings(false), adminListBlockedDates()]);
      if (!b.ok) throw new Error(b.error || 'Failed to load bookings');
      if (!d.ok) throw new Error(d.error || 'Failed to load blocked dates');
      setTimezone(b.timezone || d.timezone || 'America/New_York');
      setBookings(b.bookings || []);
      setBlockedDays(d.blockedDates || []);
      setBlockedHours(d.blockedHours || []);
      if (d.slotHours?.start != null && d.slotHours?.end != null) {
        setSlotHours({ start: Number(d.slotHours.start), end: Number(d.slotHours.end) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load training admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const onCancelSlot = async (startsAt: string, count: number) => {
    const when = formatTrainingWhen(startsAt, timezone);
    if (
      !window.confirm(
        `Cancel all ${count} booking${count === 1 ? '' : 's'} in this hour?\n\n${when}`
      )
    ) {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Bookings & availability</h2>
          <p className="text-sm text-slate-400 mt-1">
            Hours: Mon–Fri 9–5 ({timezone.replace(/_/g, ' ')}). Block a full day or a single hour.
            Cancel one person or everyone in that hour.
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

        {(blockedDays.length > 0 || blockedHours.length > 0) && (
          <div className="mt-4 space-y-3">
            {blockedDays.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                  Blocked days
                </p>
                <ul className="divide-y divide-slate-700/80">
                  {blockedDays.map((row) => (
                    <li key={`day-${row.date}`} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div>
                        <span className="text-white font-medium">{row.date}</span>
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
            {blockedHours.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                  Blocked hours
                </p>
                <ul className="divide-y divide-slate-700/80">
                  {blockedHours.map((row) => (
                    <li
                      key={`hour-${row.date}-${row.hour}`}
                      className="py-2 flex items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <span className="text-white font-medium">{row.date}</span>
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
        {!loading && blockedDays.length === 0 && blockedHours.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No blocked days or hours.</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">
          Upcoming bookings {loading ? '' : `(${bookings.length})`}
        </h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : slotGroups.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming bookings.</p>
        ) : (
          <ul className="space-y-4">
            {slotGroups.map((group) => (
              <li
                key={group.startsAt}
                className="rounded-lg border border-slate-700/80 bg-slate-950/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <p className="text-white font-medium text-sm">
                    {formatTrainingWhen(group.startsAt, timezone)}
                    {group.bookings.length > 1 ? (
                      <span className="text-amber-400/90 font-normal ml-2">
                        · {group.bookings.length} booked
                      </span>
                    ) : null}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onCancelSlot(group.startsAt, group.bookings.length)}
                    className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-red-900/70 hover:bg-red-800 text-red-100"
                  >
                    Cancel all in this hour
                  </button>
                </div>
                <ul className="divide-y divide-slate-800">
                  {group.bookings.map((b) => (
                    <li key={b.id} className="py-2 flex flex-wrap items-start justify-between gap-3">
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
                        className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200"
                      >
                        Cancel one
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TrainingAdminPanel;
