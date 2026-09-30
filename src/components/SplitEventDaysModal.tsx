import React, { useEffect, useMemo, useState } from 'react';
import { Event } from '../types/Event';

export type DayDisposition = 'keep' | 'move' | 'delete';

type SplitEventDaysModalProps = {
  event: Event;
  isOpen: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (payload: {
    keepDays: number[];
    moveDays: number[];
    deleteDays: number[];
    newEventName: string;
  }) => void;
};

function addDaysIso(dateStr: string, deltaDays: number): string {
  const base = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return base || '—';
  const d = new Date(`${base}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function formatMovedLabel(days: number[]): string {
  if (!days.length) return '';
  if (days.length === 1) return `Day ${days[0]}`;
  if (days.length === 2) return `Days ${days[0]}–${days[1]}`;
  return `Days ${days[0]}–${days[days.length - 1]}`;
}

const SplitEventDaysModal: React.FC<SplitEventDaysModalProps> = ({
  event,
  isOpen,
  busy = false,
  error = null,
  onClose,
  onConfirm,
}) => {
  const days = Math.max(1, Number(event.numberOfDays) || 1);
  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);

  const [disposition, setDisposition] = useState<Record<number, DayDisposition | ''>>({});
  const [newEventName, setNewEventName] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const blank: Record<number, DayDisposition | ''> = {};
    for (const d of dayList) blank[d] = '';
    setDisposition(blank);
    setNewEventName('');
  }, [isOpen, dayList]);

  if (!isOpen) return null;

  const keepDays = dayList.filter((d) => disposition[d] === 'keep');
  const moveDays = dayList.filter((d) => disposition[d] === 'move');
  const deleteDays = dayList.filter((d) => disposition[d] === 'delete');
  const unsetDays = dayList.filter((d) => !disposition[d]);
  const allChosen = unsetDays.length === 0;
  const canSubmit =
    !busy &&
    allChosen &&
    keepDays.length > 0 &&
    (moveDays.length > 0 || deleteDays.length > 0);

  const setDay = (day: number, value: DayDisposition) => {
    setDisposition((prev) => {
      const next = { ...prev, [day]: value };
      if (!newEventName.trim()) {
        const projected = dayList.filter((d) =>
          d === day ? value === 'move' : next[d] === 'move'
        );
        if (projected.length) {
          setNewEventName(`${event.name} (${formatMovedLabel(projected)})`);
        }
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-600 bg-slate-900 shadow-xl">
        <div className="border-b border-slate-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Split event days</h2>
          <p className="mt-1 text-sm text-slate-400">
            {event.name} · {days} day{days === 1 ? '' : 's'} starting {event.date}
          </p>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-300">
            Choose Keep, Move, or Delete for every day. Nothing is pre-selected.
          </p>

          <div className="overflow-hidden rounded-lg border border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-center">Keep</th>
                  <th className="px-3 py-2 text-center">Move</th>
                  <th className="px-3 py-2 text-center">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {dayList.map((day) => {
                  const value = disposition[day] || '';
                  return (
                    <tr key={day} className={!value ? 'bg-slate-950/40' : undefined}>
                      <td className="px-3 py-2 font-medium text-white">Day {day}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {addDaysIso(event.date, day - 1)}
                      </td>
                      {(['keep', 'move', 'delete'] as DayDisposition[]).map((opt) => (
                        <td key={opt} className="px-3 py-2 text-center">
                          <input
                            type="radio"
                            name={`split-day-${day}`}
                            checked={value === opt}
                            disabled={busy}
                            onChange={() => setDay(day, opt)}
                            aria-label={`${opt} day ${day}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs text-slate-300 sm:grid-cols-3">
            <div>
              <span className="font-semibold text-emerald-300">Keep:</span>{' '}
              {keepDays.length ? keepDays.map((d) => `Day ${d}`).join(', ') : '—'}
              {keepDays.length > 0
                ? ` → Day 1 starts ${addDaysIso(event.date, keepDays[0] - 1)}`
                : ''}
            </div>
            <div>
              <span className="font-semibold text-sky-300">Move:</span>{' '}
              {moveDays.length ? moveDays.map((d) => `Day ${d}`).join(', ') : '—'}
              {moveDays.length > 0
                ? ` → new event ${addDaysIso(event.date, moveDays[0] - 1)}`
                : ''}
            </div>
            <div>
              <span className="font-semibold text-red-300">Delete:</span>{' '}
              {deleteDays.length ? deleteDays.map((d) => `Day ${d}`).join(', ') : '—'}
            </div>
          </div>

          {!allChosen ? (
            <p className="text-xs text-amber-300">
              Still need a choice for: {unsetDays.map((d) => `Day ${d}`).join(', ')}
            </p>
          ) : null}

          {moveDays.length > 0 ? (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                New event name
              </span>
              <input
                type="text"
                value={newEventName}
                disabled={busy}
                onChange={(e) => setNewEventName(e.target.value)}
                placeholder={`${event.name} (${formatMovedLabel(moveDays)})`}
                className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
          ) : null}

          {error ? (
            <div className="rounded-md border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                keepDays,
                moveDays,
                deleteDays,
                newEventName:
                  newEventName.trim() ||
                  (moveDays.length ? `${event.name} (${formatMovedLabel(moveDays)})` : ''),
              })
            }
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? 'Working…' : moveDays.length ? 'Apply split' : 'Apply (delete days)'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SplitEventDaysModal;
