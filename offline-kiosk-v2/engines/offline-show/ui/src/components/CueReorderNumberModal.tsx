import React, { useMemo, useState } from 'react';
import {
  applyCueLabels,
  cueBody,
  groupCueBlocks,
  previewCueNumbers,
  type CueRenumberItem,
} from '../lib/cueRenumber';

type DraftRow = {
  id: number;
  next: string;
  skip: boolean;
};

type Props<T extends CueRenumberItem> = {
  schedule: T[];
  day: number;
  isChild: (item: T) => boolean;
  onClose: () => void;
  onApply: (nextSchedule: T[], summary: { changeCount: number }) => void;
};

export default function CueReorderNumberModal<T extends CueRenumberItem>({
  schedule,
  day,
  isChild,
  onClose,
  onApply,
}: Props<T>) {
  const dayItems = useMemo(
    () => schedule.filter((item) => (item.day || 1) === day),
    [day, schedule]
  );
  const grouped = useMemo(() => groupCueBlocks(dayItems, isChild), [dayItems, isChild]);
  const flatItems = useMemo(() => grouped.blocks.flat(), [grouped.blocks]);
  const [startAt, setStartAt] = useState(1);
  const [numberSubs, setNumberSubs] = useState(true);
  const [keepCustomLabels, setKeepCustomLabels] = useState(true);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [manualNext, setManualNext] = useState<Record<number, string>>({});

  const drafts = useMemo<DraftRow[]>(() => {
    const preview = previewCueNumbers(grouped.blocks, {
      startAt,
      numberCues: true,
      numberSubs,
      keepCustomLabels,
      skippedIds: [...skipped],
    });
    return preview.rows.map((row) => ({
      id: row.id,
      next: skipped.has(row.id) ? row.current : manualNext[row.id] ?? row.next,
      skip: skipped.has(row.id),
    }));
  }, [grouped.blocks, keepCustomLabels, manualNext, numberSubs, skipped, startAt]);

  const byId = useMemo(() => new Map(dayItems.map((item) => [item.id, item])), [dayItems]);
  const changeCount = drafts.filter((row) => {
    const item = byId.get(row.id);
    if (!item || row.skip) return false;
    return cueBody(item.customFields?.cue) !== String(row.next || '').trim();
  }).length;

  const blockFor = (id: number) => grouped.blocks.find((block) => block.some((item) => item.id === id)) || [];

  const setRowSkip = (id: number, skip: boolean) => {
    const block = blockFor(id);
    const isParent = block[0]?.id === id;
    const ids = isParent ? block.map((item) => item.id) : [id];
    setSkipped((prev) => {
      const next = new Set(prev);
      for (const itemId of ids) {
        if (skip) next.add(itemId);
        else next.delete(itemId);
      }
      return next;
    });
    if (skip) {
      setManualNext((prev) => {
        const next = { ...prev };
        for (const itemId of ids) delete next[itemId];
        return next;
      });
    }
  };

  const startFromRow = (id: number) => {
    const next = new Set<number>();
    for (const item of flatItems) {
      if (item.id === id) break;
      next.add(item.id);
    }
    setSkipped(next);
    setManualNext({});
  };

  const apply = () => {
    const updates = drafts
      .filter((row) => !row.skip)
      .map((row) => ({ id: row.id, next: row.next }));
    const result = applyCueLabels(schedule, updates);
    if (!result.changeCount) {
      onClose();
      return;
    }
    onApply(result.schedule, { changeCount: result.changeCount });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="mx-4 flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-slate-600 bg-slate-800 shadow-2xl">
        <div className="border-b border-slate-600 p-4">
          <h3 className="text-lg font-bold text-white">ReCue#</h3>
          <p className="mt-1 text-sm text-slate-400">
            Changes CUE labels only. Skip leaves a number alone and does not count that row.
            Start here skips everything above and numbers from that row.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {grouped.blocks.length === 0 ? (
            <p className="text-slate-400">No cues on this day.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <span className="text-slate-400">First new number</span>
                  <input
                    type="number"
                    min={0}
                    value={startAt}
                    onChange={(e) => setStartAt(Math.max(0, Number(e.target.value) || 0))}
                    className="w-16 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-white"
                  />
                </label>
              </div>
              <div className="mb-4 space-y-2 text-xs">
                <label className="flex items-start gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={keepCustomLabels}
                    onChange={(e) => setKeepCustomLabels(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Keep OPEN / BREAK names</span>
                    <span className="block text-slate-400">
                      Leaves word-only cues alone. Letter cues still renumber and keep the letter (1A → 3A).
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={numberSubs}
                    onChange={(e) => setNumberSubs(e.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">Keep .1 / .2 with the parent</span>
                    <span className="block text-slate-400">
                      2.1 stays under cue 2. If 2 becomes 5, then 2.1 becomes 5.1 — it will not become 4.
                    </span>
                  </span>
                </label>
              </div>
              <div className="space-y-2">
                {grouped.blocks.map((block) =>
                  block.map((item, childIndex) => {
                    const draft = drafts.find((row) => row.id === item.id);
                    const current = cueBody(item.customFields?.cue);
                    const isChildRow = childIndex > 0;
                    const parentSkipped = skipped.has(block[0].id);
                    const rowSkipped = !!draft?.skip || parentSkipped;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                          rowSkipped
                            ? `${isChildRow ? 'ml-6' : ''} bg-slate-800/80 opacity-50 grayscale`
                            : isChildRow
                              ? 'ml-6 bg-slate-700/50'
                              : 'bg-slate-700/80'
                        }`}
                      >
                        {isChildRow && parentSkipped ? (
                          <span className="w-[3.25rem] shrink-0" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRowSkip(item.id, !draft?.skip)}
                            className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${
                              draft?.skip
                                ? 'bg-slate-500 text-slate-200 hover:bg-slate-400'
                                : 'bg-slate-600 text-white hover:bg-slate-500'
                            }`}
                            title={
                              isChildRow
                                ? 'Skip only this sub-cue'
                                : 'Skip this cue and its .1 rows'
                            }
                          >
                            Skip
                          </button>
                        )}
                        {!isChildRow ? (
                          <button
                            type="button"
                            onClick={() => startFromRow(item.id)}
                            className="shrink-0 rounded px-2 py-1 text-xs font-semibold bg-slate-600 text-slate-100 hover:bg-slate-500"
                            title="Skip every row above this one, then number from here"
                          >
                            Start here
                          </button>
                        ) : (
                          <span className="w-[4.75rem] shrink-0" />
                        )}
                        <span className="w-12 shrink-0 font-mono text-sm text-slate-400">{current || '—'}</span>
                        <span className="text-slate-500">→</span>
                        <input
                          type="text"
                          maxLength={6}
                          disabled={rowSkipped}
                          value={draft?.next ?? current}
                          onChange={(e) => {
                            const value = e.target.value.replace(/^CUE\s*/i, '').slice(0, 6);
                            setRowSkip(item.id, false);
                            setManualNext((prev) => ({ ...prev, [item.id]: value }));
                          }}
                          className="w-16 rounded border border-slate-500 bg-slate-800 px-2 py-1 text-center font-mono text-sm text-white disabled:opacity-50"
                        />
                        <span className="min-w-0 truncate text-sm text-white">{item.segmentName || '—'}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-600 p-4">
          <p className="text-xs text-slate-400">
            {changeCount} label{changeCount === 1 ? '' : 's'} will change
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-600 px-4 py-2 text-white hover:bg-slate-500"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={changeCount === 0}
              onClick={apply}
              className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply labels
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
