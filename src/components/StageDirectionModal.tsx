import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { STAGE_DIRECTION_PRESETS } from '../lib/audioCallouts';

type StageDirectionModalProps = {
  open: boolean;
  segmentName?: string;
  onClose: () => void;
  onAdd: (directionText: string) => void;
};

/**
 * Preset Stage Directions add immediately on click.
 * Custom text still uses Add to Notes.
 * Portaled to document.body so table overflow/stacking doesn't clip it.
 */
export default function StageDirectionModal({
  open,
  segmentName,
  onClose,
  onAdd,
}: StageDirectionModalProps) {
  const [customText, setCustomText] = useState('');

  useEffect(() => {
    if (!open) return;
    setCustomText('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmedCustom = customText.trim();

  const addAndClose = (text: string) => {
    const value = String(text || '').trim();
    if (!value) return;
    onAdd(value);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-violet-500/40 bg-slate-800 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white">Stage Direction</h2>
        <p className="mt-1 text-sm text-slate-300">
          Adds a note chip
          {segmentName ? (
            <>
              {' '}
              for <span className="font-semibold text-white">{segmentName}</span>
            </>
          ) : null}
          . Tap a preset to add it, or write your own below.
        </p>

        <div className="mt-4 space-y-2">
          {STAGE_DIRECTION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => addAndClose(preset)}
              className="flex w-full items-center rounded-lg border border-slate-600 bg-slate-900/50 px-3 py-2.5 text-left text-sm font-semibold text-slate-200 transition-colors hover:border-violet-400 hover:bg-violet-950/50 hover:text-violet-100"
            >
              {preset}
            </button>
          ))}
        </div>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Or write something
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmedCustom) {
                e.preventDefault();
                addAndClose(trimmedCustom);
              }
            }}
            placeholder="e.g. Host walks from CS"
            className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm font-medium text-white placeholder:text-slate-500 focus:border-violet-400 focus:outline-none"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmedCustom}
            onClick={() => addAndClose(trimmedCustom)}
            className="rounded-lg border border-violet-400/70 bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add to Notes
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
