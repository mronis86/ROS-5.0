import React, { useState } from 'react';
import {
  type SubCall,
  buildManualSubCall,
  formatSubCallChip,
  newSubCallId,
  normalizeSubCalls,
} from '../lib/subCalls';

type Props = {
  itemId: number;
  cueLabel?: string;
  /** Parent cue field / notes — used to number manual chips as CUE N.N */
  parentItem?: {
    notes?: string;
    subCalls?: SubCall[] | unknown;
    customFields?: { cue?: string } | Record<string, string>;
  };
  /** Already resolved (notes + saved called state). */
  subCalls: SubCall[];
  canEdit: boolean;
  canConfirm: boolean;
  onChange: (next: SubCall[]) => void;
};

/**
 * Compact call strip under a main cue — chips a director taps as they call actions.
 * Labels often auto-pull from notes (Cue 22.1: …); confirm state is what we save.
 */
export function SubCallsStrip({
  itemId,
  cueLabel,
  parentItem,
  subCalls,
  canEdit,
  canConfirm,
  onChange,
}: Props) {
  const calls = normalizeSubCalls(subCalls);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const fromNotesCount = calls.filter((c) => c.fromNotes || c.id.startsWith('note:')).length;

  const toggleCalled = (id: string) => {
    if (!canConfirm) return;
    onChange(calls.map((c) => (c.id === id ? { ...c, called: !c.called } : c)));
  };

  const addCall = () => {
    const label = draft.trim();
    if (!label || !canEdit) return;
    const numbered = parentItem
      ? buildManualSubCall({ ...parentItem, subCalls: calls }, label)
      : null;
    onChange([
      ...calls,
      numbered || { id: newSubCallId(), label, called: false, fromNotes: false },
    ]);
    setDraft('');
    setAdding(false);
  };

  const removeCall = (id: string) => {
    if (!canEdit) return;
    const target = calls.find((c) => c.id === id);
    if (target?.fromNotes || id.startsWith('note:')) return;
    onChange(calls.filter((c) => c.id !== id));
  };

  if (!calls.length && !canEdit) return null;

  return (
    <div
      className="w-full flex-shrink-0 border-t border-slate-600 bg-slate-900/95 px-3 py-2.5 flex flex-wrap items-center gap-2"
      data-sub-calls-for={itemId}
    >
      <span
        className="text-xs uppercase tracking-wide text-slate-300 font-bold mr-1 flex-shrink-0"
        title={
          fromNotesCount
            ? 'Pulled from Cue N.N: lines in Notes — tap to mark called'
            : 'Director call checklist for this cue (not timed rows)'
        }
      >
        Sub calls{cueLabel ? ` · ${cueLabel}` : ''}
        {fromNotesCount ? (
          <span className="ml-1.5 font-medium normal-case tracking-normal text-slate-400">
            (from notes)
          </span>
        ) : null}
      </span>

      {calls.map((c) => {
        const fromNotes = Boolean(c.fromNotes || c.id.startsWith('note:'));
        const chip = formatSubCallChip(c);
        return (
          <div key={c.id} className="inline-flex items-center max-w-full">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => toggleCalled(c.id)}
              title={chip.full}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border-2 transition-colors max-w-[26rem] shadow-sm text-left ${
                c.called
                  ? 'bg-emerald-600 border-emerald-400 text-white'
                  : 'bg-slate-700 border-slate-400 text-white hover:border-sky-400 hover:bg-slate-600'
              } ${!canConfirm ? 'opacity-70 cursor-default' : 'cursor-pointer'}`}
            >
              {c.called ? <span className="mr-1.5">✓</span> : null}
              {chip.prefix ? (
                <>
                  <span className="font-bold tracking-wide">{chip.prefix}</span>
                  {chip.body ? (
                    <span className="font-medium text-white/90">
                      <span className="mx-2 text-white/50">·</span>
                      {chip.body}
                    </span>
                  ) : null}
                </>
              ) : (
                <span>{chip.body}</span>
              )}
            </button>
            {canEdit && !fromNotes ? (
              <button
                type="button"
                onClick={() => removeCall(c.id)}
                className="ml-1 px-1.5 text-slate-400 hover:text-rose-400 text-base leading-none"
                title="Remove sub call"
                aria-label={`Remove ${c.label}`}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}

      {canEdit ? (
        adding ? (
          <form
            className="inline-flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addCall();
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (!draft.trim()) setAdding(false);
              }}
              placeholder="e.g. Kill music"
              className="w-52 px-3 py-1.5 text-sm rounded-lg bg-slate-800 border-2 border-slate-500 text-white"
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-sky-600 text-white hover:bg-sky-500"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft('');
                setAdding(false);
              }}
              className="px-2 py-1.5 text-sm text-slate-300 hover:text-white"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold border-2 border-dashed border-slate-500 text-slate-300 hover:text-sky-200 hover:border-sky-400"
          >
            + Sub call
          </button>
        )
      ) : null}
    </div>
  );
}
