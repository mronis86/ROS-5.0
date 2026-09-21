import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  runTeleprompterSttDiagnostics,
  type SttDiagLine,
  type SttDiagResult,
} from '../lib/teleprompter-stt-diagnostics';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Preferred mic device id from Teleprompter settings */
  deviceId?: string;
};

function levelClass(level: SttDiagLine['level']): string {
  switch (level) {
    case 'ok':
      return 'text-emerald-300';
    case 'warn':
      return 'text-amber-300';
    case 'error':
      return 'text-rose-300';
    default:
      return 'text-slate-300';
  }
}

/**
 * In-app STT tester with copyable log for IT / Umbrella tickets.
 */
export default function TeleprompterSttDiagnosticsModal({ open, onClose, deviceId }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SttDiagResult | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setRunning(false);
      return;
    }
    setResult(null);
    setCopyState('idle');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, running]);

  const run = async () => {
    if (running) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setCopyState('idle');
    setResult(null);
    try {
      const next = await runTeleprompterSttDiagnostics({
        deviceId,
        signal: ac.signal,
      });
      if (!ac.signal.aborted) setResult(next);
    } catch (err: any) {
      setResult({
        lines: [
          {
            t: new Date().toISOString(),
            level: 'error',
            message: `Diagnostics crashed: ${err?.message || String(err)}`,
          },
        ],
        summary: 'Diagnostics failed to complete.',
        likelyUmbrellaBlock: false,
        micOk: false,
        sttHeardSpeech: false,
        sttNetworkErrors: 0,
        copyText: `Diagnostics crashed: ${err?.message || String(err)}`,
      });
    } finally {
      setRunning(false);
    }
  };

  const copyLog = async () => {
    if (!result?.copyText) return;
    try {
      await navigator.clipboard.writeText(result.copyText);
      setCopyState('ok');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = result.copyText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyState('ok');
      } catch {
        setCopyState('fail');
      }
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-cyan-500/40 bg-slate-900 shadow-2xl">
        <div className="border-b border-slate-700 px-5 py-4">
          <h2 className="text-lg font-bold text-white">Speech-to-text diagnostics</h2>
          <p className="mt-1 text-sm text-slate-300">
            For IT / Cisco Umbrella: tests local mic vs Google cloud speech (Chrome/Edge Web Speech API).
            ROS does not host or proxy speech-to-text.
          </p>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm">
          <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-slate-300">
            <p className="font-semibold text-slate-200">What IT should allow</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-400">
              <li>HTTPS (443) from venue PCs to Google speech endpoints used by Chromium Web Speech</li>
              <li>
                Common path includes <span className="font-mono text-cyan-300">www.google.com</span> speech-api
                (exact URLs can change — avoid IP allowlists)
              </li>
              <li>
                Pattern: <span className="text-amber-200">Mic meter works</span> but{' '}
                <span className="text-rose-300">Auto-scroll / STT gets network errors</span> → filter/VPN block
              </li>
            </ul>
          </div>

          {result ? (
            <div
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                result.likelyUmbrellaBlock
                  ? 'border-rose-500/50 bg-rose-950/40 text-rose-100'
                  : result.sttHeardSpeech
                    ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-100'
                    : 'border-amber-500/50 bg-amber-950/40 text-amber-100'
              }`}
            >
              {result.summary}
            </div>
          ) : (
            <p className="text-slate-400">
              Click <span className="font-semibold text-white">Run test</span>, allow the mic if asked, then speak
              clearly for ~12 seconds.
            </p>
          )}

          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-700 bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
            {running && !result ? (
              <p className="animate-pulse text-cyan-300">Running… speak now if the mic meter / STT steps ask you to.</p>
            ) : null}
            {(result?.lines || []).map((line, i) => (
              <div key={`${line.t}-${i}`} className={levelClass(line.level)}>
                <span className="text-slate-500">{line.t.slice(11, 19)}</span> {line.message}
              </div>
            ))}
            {!running && !result ? (
              <p className="text-slate-500">Log will appear here.</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-700 px-5 py-3">
          {copyState === 'ok' ? (
            <span className="mr-auto text-xs text-emerald-300">Copied — paste into the IT ticket</span>
          ) : null}
          {copyState === 'fail' ? (
            <span className="mr-auto text-xs text-rose-300">Copy failed — select the log manually</span>
          ) : null}
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={!result || running}
            onClick={() => void copyLog()}
            className="rounded-lg border border-slate-500 bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Copy log for IT
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="rounded-lg border border-cyan-400/60 bg-cyan-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {running ? 'Running…' : result ? 'Run again' : 'Run test'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
