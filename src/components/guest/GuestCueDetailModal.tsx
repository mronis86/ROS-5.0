import React, { useCallback, useState } from 'react';
import type { GuestScheduleItem } from '../../lib/eventGuestLinks';
import { displaySpeakersText } from '../../lib/guestRosHelpers';

interface GuestCueDetailModalProps {
  open: boolean;
  item: GuestScheduleItem | null;
  startTime?: string;
  onClose: () => void;
  onOpenSpeakers?: () => void;
}

async function copyText(value: string): Promise<boolean> {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const GuestCueDetailModal: React.FC<GuestCueDetailModalProps> = ({
  open,
  item,
  startTime,
  onClose,
  onOpenSpeakers,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = useCallback(async (key: string, value: string) => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
  }, []);

  if (!open || !item) return null;

  const speakers = displaySpeakersText(item.speakersText || item.speakers || '');
  const cueLabel = String(item.cue || '').trim() || '—';
  const segment = String(item.segmentName || '').trim() || '—';
  const combined = [
    `CUE ${cueLabel}`,
    startTime ? `Start: ${startTime}` : '',
    item.programType ? `Program: ${item.programType}` : '',
    `Segment: ${segment}`,
    speakers ? `Speakers:\n${speakers}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-slate-600 bg-slate-900 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-cue-detail-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div className="min-w-0">
            <h2 id="guest-cue-detail-title" className="font-semibold text-white">
              Cue details
            </h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">CUE {cueLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-lg leading-none shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-4 text-sm">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Segment name</p>
              <button
                type="button"
                onClick={() => void handleCopy('segment', segment)}
                className="text-[11px] font-semibold text-violet-300 hover:text-violet-200"
              >
                {copiedKey === 'segment' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-white whitespace-pre-wrap break-words leading-relaxed">{segment}</p>
          </div>

          {(startTime || item.programType) && (
            <div className="grid grid-cols-2 gap-3 text-slate-300">
              {startTime ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Start</p>
                  <p>{startTime}</p>
                </div>
              ) : null}
              {item.programType ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Program</p>
                  <p>{item.programType}</p>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Speakers</p>
              <div className="flex items-center gap-2">
                {speakers ? (
                  <button
                    type="button"
                    onClick={() => void handleCopy('speakers', speakers)}
                    className="text-[11px] font-semibold text-violet-300 hover:text-violet-200"
                  >
                    {copiedKey === 'speakers' ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
                {onOpenSpeakers ? (
                  <button
                    type="button"
                    onClick={onOpenSpeakers}
                    className="text-[11px] font-semibold text-sky-300 hover:text-sky-200"
                  >
                    Open speaker cards
                  </button>
                ) : null}
              </div>
            </div>
            {speakers ? (
              <p className="text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{speakers}</p>
            ) : (
              <p className="text-slate-500">No speakers listed for this cue.</p>
            )}
          </div>
        </div>

        <div className="border-t border-slate-700 px-4 py-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleCopy('all', combined)}
            className="rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {copiedKey === 'all' ? 'Copied all' : 'Copy segment + speakers'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default GuestCueDetailModal;
