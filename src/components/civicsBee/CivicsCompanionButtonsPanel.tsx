import React, { useEffect, useMemo, useState } from 'react';
import {
  buildCivicsCompanionSlots,
  CivicsBeeRoster,
  CivicsButtonPictureStyle,
} from '../../lib/civicsBee';
import { getApiBaseUrl } from '../../services/api-client';

const STYLES: Array<{ value: CivicsButtonPictureStyle; label: string }> = [
  { value: 'abbrev-name', label: 'State abbreviation and student name' },
  { value: 'abbrev-name-flag', label: 'Flag, abbreviation, and student name' },
  { value: 'state-name', label: 'State name only' },
  { value: 'flag-state-name', label: 'Flag and state name' },
];

type Props = {
  roster: CivicsBeeRoster;
  eventId: string;
  pushing: boolean;
  onPush: (next: CivicsBeeRoster) => Promise<boolean>;
};

type BridgeLogLine = { at: string; message: string };
type BridgeStatus = { at: string; host?: string; port?: number; page?: number; version?: string };

const CivicsCompanionButtonsPanel: React.FC<Props> = ({ roster, eventId, pushing, onPush }) => {
  const [pictureStyle, setPictureStyle] = useState<CivicsButtonPictureStyle>(
    roster.buttonBuild?.pictureStyle || 'abbrev-name'
  );
  const [flagOutline, setFlagOutline] = useState(roster.buttonBuild?.flagOutline === true);
  const [message, setMessage] = useState<string | null>(null);
  const [bridgeLog, setBridgeLog] = useState<BridgeLogLine[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eventId) return undefined;
    let stop = false;
    const loadLog = async () => {
      try {
        const res = await fetch(
          `${getApiBaseUrl()}/api/civics-bee/bridge-log?eventId=${encodeURIComponent(eventId)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const body = await res.json();
        if (!stop && Array.isArray(body.lines)) setBridgeLog(body.lines);
        if (!stop) setBridgeStatus(body.status && body.status.at ? body.status : null);
        if (!stop) setNow(Date.now());
      } catch {
        /* keep the last log on screen */
      }
    };
    void loadLog();
    const timer = window.setInterval(() => void loadLog(), 2000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [eventId]);

  const slots = useMemo(() => buildCivicsCompanionSlots(roster.entries), [roster.entries]);
  const generated = roster.buttonBuild?.action === 'build';
  const showFlag = generated && (pictureStyle === 'abbrev-name-flag' || pictureStyle === 'flag-state-name');
  const showAbbrev = pictureStyle === 'abbrev-name' || pictureStyle === 'abbrev-name-flag';
  const seenAt = bridgeStatus?.at || bridgeLog[0]?.at || '';
  const seenAge = seenAt ? now - new Date(seenAt).getTime() : Number.POSITIVE_INFINITY;
  const bridgeSeen = Number.isFinite(seenAge) && seenAge < 15000;

  const push = async (action: 'build' | 'clear') => {
    setMessage(null);
    const next: CivicsBeeRoster = {
      ...roster,
      buttonBuild: {
        requestedAt: new Date().toISOString(),
        pictureStyle,
        flagOutline: showFlag && flagOutline,
        slots,
        action,
      },
    };
    const ok = await onPush(next);
    setMessage(
      ok
        ? action === 'clear'
          ? 'Clear sent. Civics Bridge V2 will remove the pictures from Companion.'
          : `Generated ${slots.length} button${slots.length === 1 ? '' : 's'}. Still-in pictures are transparent. Eliminated pictures are grey.`
        : action === 'clear'
          ? 'Clear failed.'
          : 'Push failed.'
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Companion buttons</h2>
        <p className="mt-1 text-sm text-slate-400">
          Pictures stay off this page until you click Generate buttons. Clear puts them back to not generated and removes the pictures from Companion.
        </p>
        <p className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${bridgeSeen ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
          <span className={`h-2 w-2 rounded-full ${bridgeSeen ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          {bridgeSeen
            ? `Bridge seen${bridgeStatus ? ` at ${bridgeStatus.host}:${bridgeStatus.port}, page ${bridgeStatus.page}` : ''}`
            : seenAt
              ? 'Bridge not seen. The last message is in the log below.'
              : 'Bridge not seen. Start Civics Bridge V2 on the show computer.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">
          Picture
          <select
            value={pictureStyle}
            onChange={(e) => setPictureStyle(e.target.value as CivicsButtonPictureStyle)}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100"
          >
            {STYLES.map((style) => (
              <option key={style.value} value={style.value}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-6 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={showFlag && flagOutline}
            disabled={!showFlag}
            onChange={(e) => setFlagOutline(e.target.checked)}
          />
          White stroke around the flag
        </label>
      </div>

      {slots.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-8 text-center text-slate-400">
          No Top 10 students yet. Mark them on the Civics Bee Students tab first.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {slots.map((slot, index) => (
            <div
              key={`${slot.state}-${index}`}
              className={`flex min-h-[7.5rem] flex-col items-center justify-center rounded-2xl border px-3 py-4 text-center ${
                !generated
                  ? 'border-dashed border-slate-600 bg-transparent text-slate-500'
                  : slot.eliminated
                    ? 'border-neutral-500 bg-neutral-500 text-white'
                    : 'border-dashed border-slate-500 text-white'
              }`}
              style={
                generated && !slot.eliminated
                  ? {
                      backgroundColor: 'transparent',
                      backgroundImage:
                        'linear-gradient(45deg, rgba(148,163,184,0.28) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.28) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.28) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.28) 75%)',
                      backgroundSize: '14px 14px',
                      backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0',
                    }
                  : undefined
              }
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Button {index + 1}</span>
              {generated ? (
                <>
                  {showFlag && <span className="mt-1 text-[10px] text-slate-400">Flag</span>}
                  <span className={`mt-1 text-lg font-bold ${slot.eliminated ? 'line-through' : ''}`}>
                    {showAbbrev ? slot.code : slot.stateLabel}
                  </span>
                  {showAbbrev && <span className="mt-1 text-xs text-slate-300">{slot.name}</span>}
                  {slot.eliminated && (
                    <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide">Eliminated</span>
                  )}
                </>
              ) : (
                <span className="mt-2 text-xs uppercase tracking-wide">Not generated</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pushing || slots.length === 0}
          onClick={() => void push('build')}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pushing ? 'Working…' : 'Generate buttons'}
        </button>
        <button
          type="button"
          disabled={pushing}
          onClick={() => void push('clear')}
          className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear buttons on Companion
        </button>
        {roster.buttonBuild?.requestedAt && (
          <span className="text-xs text-slate-500">
            {generated ? 'Generated' : 'Not generated'} {roster.buttonBuild.requestedAt}
          </span>
        )}
      </div>
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Bridge log</h3>
        <p className="mt-1 text-xs text-slate-500">
          Civics Bridge V2 writes here after you start it. A clear replaces each Companion picture with a blank image.
        </p>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
          {bridgeLog.length === 0 ? (
            <p className="text-slate-500">No bridge messages yet. Start Civics Bridge V2, then push or clear.</p>
          ) : (
            bridgeLog.map((line, index) => (
              <p key={`${line.at}-${index}`} className="whitespace-pre-wrap py-1">
                <span className="text-slate-500">{line.at.replace('T', ' ').replace('Z', ' UTC')} </span>
                {line.message}
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default CivicsCompanionButtonsPanel;
