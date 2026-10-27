import React, { useMemo, useState } from 'react';
import type { NoteLabelHint } from '../lib/notesLabelSuggest';
import { formatCalloutTime } from '../lib/audioCallouts';

function hintKey(hint: NoteLabelHint): string {
  return `${hint.type}:${hint.line}`;
}

export default function NotesLabelSuggestBanner({
  suggestions,
  fallbackCue = '',
  onConvert,
  convertingKey = null,
}: {
  suggestions: NoteLabelHint[];
  fallbackCue?: string;
  onConvert: (hint: NoteLabelHint, time?: string) => void;
  convertingKey?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [useCue, setUseCue] = useState<Record<string, boolean>>({});
  const [cues, setCues] = useState<Record<string, string>>({});
  const defaults = useMemo(() => {
    const nextUse: Record<string, boolean> = {};
    const nextCues: Record<string, string> = {};
    for (const hint of suggestions) {
      const key = hintKey(hint);
      const cue = String(hint.cuePrefix || fallbackCue).replace(/^CUE\s+/i, '').trim();
      nextCues[key] = cue;
      nextUse[key] = Boolean(cue);
    }
    return { nextUse, nextCues };
  }, [fallbackCue, suggestions]);

  if (!suggestions.length) return null;

  const voCount = suggestions.filter((hint) => hint.type === 'vo').length;
  const settleCount = suggestions.filter((hint) => hint.type === 'settle').length;
  const readyCount = suggestions.filter((hint) => hint.type === 'settle' || hint.time).length;

  const cueFor = (hint: NoteLabelHint) => {
    const key = hintKey(hint);
    const include = useCue[key] ?? defaults.nextUse[key];
    if (!include) return '';
    return (cues[key] ?? defaults.nextCues[key] ?? '').trim();
  };

  const convertHint = (hint: NoteLabelHint) => {
    const key = hintKey(hint);
    onConvert(
      { ...hint, cuePrefix: cueFor(hint) },
      hint.time || times[hint.line]
    );
  };

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex overflow-hidden rounded-full border border-slate-500 text-[11px] font-semibold leading-none"
        title="Convert typed VO / Settle lines"
      >
        {voCount ? (
          <span className="bg-amber-700 px-2 py-0.5 text-amber-50">VO {voCount}</span>
        ) : null}
        {settleCount ? (
          <span className="bg-blue-700 px-2 py-0.5 text-blue-50">Settle {settleCount}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[24rem] max-w-[85vw] rounded-lg border border-slate-600 bg-slate-900 p-2 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-300">Keep CUE on if the number should stay in front</p>
            {readyCount ? (
              <button
                type="button"
                onClick={() => {
                  for (const hint of suggestions) {
                    const time = hint.time || times[hint.line];
                    if (hint.type === 'vo' && !time) continue;
                    convertHint(hint);
                  }
                }}
                className="rounded bg-slate-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-slate-500"
              >
                Convert all
              </button>
            ) : null}
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {suggestions.map((hint) => {
              const key = hintKey(hint);
              const needsTime = hint.type === 'vo' && !hint.time;
              const includeCue = useCue[key] ?? defaults.nextUse[key];
              const cueValue = cues[key] ?? defaults.nextCues[key] ?? '';
              const isSettle = hint.type === 'settle';
              const title = isSettle
                ? `Settle${includeCue && cueValue ? ` ${cueValue.replace(/\.1$/i, '')}.1` : ''}`
                : `${hint.kind === 'bgm' ? 'BGM' : 'VO'}${includeCue && cueValue ? ` CUE ${cueValue}` : ''}${
                    hint.time ? ` ${formatCalloutTime(hint.time)}` : ''
                  }${hint.label ? ` · ${hint.label}` : ''}`;
              return (
                <div
                  key={key}
                  className={`flex flex-wrap items-center gap-2 rounded px-2 py-1 ${
                    isSettle ? 'bg-blue-950/70 ring-1 ring-blue-500/40' : 'bg-amber-950/70 ring-1 ring-amber-500/40'
                  }`}
                >
                  <div className="min-w-0 flex-1 truncate text-[11px] text-white" title={hint.line}>
                    {title}
                  </div>
                  <label className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-slate-200">
                    <input
                      type="checkbox"
                      checked={includeCue}
                      onChange={(e) => setUseCue((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    CUE
                  </label>
                  {includeCue ? (
                    <input
                      type="text"
                      maxLength={6}
                      value={cueValue}
                      onChange={(e) =>
                        setCues((prev) => ({ ...prev, [key]: e.target.value.replace(/^CUE\s*/i, '').slice(0, 6) }))
                      }
                      className="h-6 w-12 rounded border border-slate-500 bg-slate-800 px-1 text-center font-mono text-[11px] text-white"
                      title="Cue / sub number"
                    />
                  ) : null}
                  {needsTime ? (
                    <input
                      type="time"
                      value={times[hint.line] || ''}
                      onChange={(e) => setTimes((prev) => ({ ...prev, [hint.line]: e.target.value }))}
                      className="h-6 rounded border border-slate-600 bg-slate-900 px-1 text-[11px] text-white"
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={!!convertingKey || (needsTime && !times[hint.line]) || (isSettle && includeCue && !cueValue && !fallbackCue)}
                    onClick={() => convertHint(hint)}
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-50 ${
                      isSettle ? 'bg-blue-600 hover:bg-blue-500' : 'bg-amber-600 hover:bg-amber-500'
                    }`}
                  >
                    {convertingKey === key ? '…' : 'Go'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
