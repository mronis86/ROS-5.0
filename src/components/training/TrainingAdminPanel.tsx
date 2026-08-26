import React, { useCallback, useEffect, useState } from 'react';
import {
  adminBlockTrainingDate,
  adminCancelTrainingBooking,
  adminListBlockedDates,
  adminListTrainingBookings,
  adminUnblockTrainingDate,
  formatTrainingWhen,
  type TrainingBooking,
} from '../../lib/trainingBooking';

const TrainingAdminPanel: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('America/New_York');
  const [bookings, setBookings] = useState<TrainingBooking[]>([]);
  const [blocked, setBlocked] = useState<{ id?: string; date: string; reason?: string }[]>([]);
  const [blockDate, setBlockDate] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, d] = await Promise.all([adminListTrainingBookings(false), adminListBlockedDates()]);
      if (!b.ok) throw new Error(b.error || 'Failed to load bookings');
      if (!d.ok) throw new Error(d.error || 'Failed to load blocked dates');
      setTimezone(b.timezone || 'America/New_York');
      setBookings(b.bookings || []);
      setBlocked(d.blockedDates || []);
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
      const res = await adminBlockTrainingDate(blockDate, blockReason);
      if (!res.ok) throw new Error(res.error || 'Failed to block date');
      setBlockDate('');
      setBlockReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Block failed');
    } finally {
      setBusy(false);
    }
  };

  const onUnblock = async (date: string) => {
    if (!window.confirm(`Unblock ${date}?`)) return;
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

  const onCancel = async (id: string, name: string) => {
    if (!window.confirm(`Cancel booking for ${name}? That hour becomes available again.`)) return;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Bookings & blocked days</h2>
          <p className="text-sm text-slate-400 mt-1">
            Hours: Mon–Fri 9–5 ({timezone.replace(/_/g, ' ')}). Multiple people may book the same hour.
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
        <h3 className="text-sm font-semibold text-white mb-3">Block a date</h3>
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
          <label className="text-xs text-slate-400 flex-1 min-w-[10rem]">
            Reason (optional)
            <input
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="Holiday, travel…"
              className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-white"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium"
          >
            Block day
          </button>
        </form>
        {blocked.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-700/80">
            {blocked.map((row) => (
              <li key={row.date} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div>
                  <span className="text-white font-medium">{row.date}</span>
                  {row.reason ? <span className="text-slate-400 ml-2">{row.reason}</span> : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onUnblock(row.date)}
                  className="text-xs text-slate-300 hover:text-white underline"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-slate-500">No blocked dates.</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">
          Upcoming bookings {loading ? '' : `(${bookings.length})`}
        </h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming bookings.</p>
        ) : (
          <ul className="divide-y divide-slate-700/80">
            {bookings.map((b) => (
              <li key={b.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm">
                    {formatTrainingWhen(b.startsAt, timezone)}
                  </p>
                  <p className="text-sm text-slate-300">
                    {b.name} · {b.email}
                  </p>
                  {(b.company || b.phone) && (
                    <p className="text-xs text-slate-500">
                      {[b.company, b.phone].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {b.notes ? <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{b.notes}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onCancel(b.id, b.name)}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TrainingAdminPanel;
