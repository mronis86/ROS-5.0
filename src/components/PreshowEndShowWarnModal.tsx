import React, { useEffect } from 'react';

type Props = {
  isOpen: boolean;
  onUseEndShow: () => void;
  onKeepPreshow: () => void;
};

/**
 * High-attention warning when choosing PreShow mid/late show
 * (likely should be EndShow instead of a browser confirm).
 */
const PreshowEndShowWarnModal: React.FC<Props> = ({ isOpen, onUseEndShow, onKeepPreshow }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onKeepPreshow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onKeepPreshow]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-5 sm:p-8"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="preshow-endshow-warn-title"
      aria-describedby="preshow-endshow-warn-body"
    >
      <div className="absolute inset-0 bg-slate-950/85" aria-hidden />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-500 bg-slate-900 shadow-2xl shadow-black/50">
        <div className="border-b border-violet-500/40 bg-slate-950 px-6 py-5 sm:px-8 sm:py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">
            Program type check
          </p>
          <h2
            id="preshow-endshow-warn-title"
            className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl"
          >
            This looks like EndShow, not PreShow
          </h2>
        </div>

        <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex gap-4 rounded-2xl border border-slate-600 bg-slate-950/70 px-4 py-4 sm:px-5 sm:py-5">
            <span
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xl font-black text-white"
              aria-hidden
            >
              !
            </span>
            <p
              id="preshow-endshow-warn-body"
              className="text-base leading-relaxed text-slate-200 sm:text-lg"
            >
              There is already a <span className="font-semibold text-white">PreShow</span> earlier in this
              session, with several cues after it. Choosing PreShow again usually means you want{' '}
              <span className="font-semibold text-white">EndShow</span> (close of show), not another pre-show.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <button
              type="button"
              onClick={onKeepPreshow}
              className="rounded-2xl border border-slate-500 bg-slate-800 px-5 py-5 text-left transition hover:border-slate-400 hover:bg-slate-700"
            >
              <span className="block text-base font-semibold text-white sm:text-lg">Keep PreShow</span>
              <span className="mt-1.5 block text-sm text-slate-400">
                Use PreShow on this cue anyway
              </span>
            </button>
            <button
              type="button"
              onClick={onUseEndShow}
              className="rounded-2xl border border-violet-300/70 bg-violet-600 px-5 py-5 text-left shadow-lg shadow-violet-950/40 transition hover:bg-violet-500"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 5px, rgba(0,0,0,0.12) 5px 10px)',
              }}
            >
              <span className="block text-base font-bold text-white sm:text-lg">Use EndShow</span>
              <span className="mt-1.5 block text-sm font-medium text-violet-100">
                Recommended for mid / late show
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreshowEndShowWarnModal;
