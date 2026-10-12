import React, { useEffect, useMemo, useState } from 'react';
import {
  buildCivicsCompanionSlots,
  CivicsBeeRoster,
  CivicsButtonBuild,
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
type BridgeInfo = {
  instanceId: string;
  at: string;
  host?: string;
  port?: number;
  page?: number;
  version?: string;
  perRow?: number;
  count?: number;
  spots?: string[];
  layoutError?: string;
  bridgeVersion?: string;
};
type ButtonResult = { n: number; where: string; state: string; message: string };
type BridgeResult = {
  at: string;
  instanceId: string;
  requestedAt: string;
  action: string;
  done: boolean;
  buttons: ButtonResult[];
};

const RESULT_LABEL: Record<string, string> = {
  created: 'Created',
  imported: 'Imported',
  cleared: 'Cleared',
  failed: 'Failed',
};

const RESULT_CLASS: Record<string, string> = {
  created: 'bg-sky-900 text-sky-200',
  imported: 'bg-emerald-900 text-emerald-200',
  cleared: 'bg-amber-900 text-amber-200',
  failed: 'bg-red-900 text-red-200',
};

const CivicsCompanionButtonsPanel: React.FC<Props> = ({ roster, eventId, pushing, onPush }) => {
  const [pictureStyle, setPictureStyle] = useState<CivicsButtonPictureStyle>(
    roster.buttonBuild?.pictureStyle || 'abbrev-name'
  );
  const [flagOutline, setFlagOutline] = useState(roster.buttonBuild?.flagOutline === true);
  const [previewKey, setPreviewKey] = useState('');
  const [dismissedImport, setDismissedImport] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [bridgeLog, setBridgeLog] = useState<BridgeLogLine[]>([]);
  const [bridges, setBridges] = useState<BridgeInfo[]>([]);
  const [result, setResult] = useState<BridgeResult | null>(null);
  const [serverNow, setServerNow] = useState(0);

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
        if (stop) return;
        setBridgeLog(Array.isArray(body.lines) ? body.lines : []);
        setBridges(Array.isArray(body.bridges) ? body.bridges : []);
        setResult(body.result && typeof body.result === 'object' ? body.result : null);
        setServerNow(body.now ? new Date(body.now).getTime() : Date.now());
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
  const hasFlag = pictureStyle === 'abbrev-name-flag' || pictureStyle === 'flag-state-name';
  const showAbbrev = pictureStyle === 'abbrev-name' || pictureStyle === 'abbrev-name-flag';
  const currentKey = JSON.stringify([pictureStyle, hasFlag && flagOutline, slots]);
  const previewed = previewKey === currentKey;

  const liveBridges = bridges.filter((b) => serverNow - new Date(b.at).getTime() < 15000);
  const bridge = liveBridges[0] || null;
  const bridgeSeen = !!bridge;
  const tooManyBridges = liveBridges.length > 1;
  const spots = bridge?.spots || [];
  const spotText = spots.length ? spots.join(', ') : '';
  const where = bridge ? `Companion ${bridge.host}:${bridge.port}, page ${bridge.page}` : 'Companion';

  const build = roster.buttonBuild || null;
  const currentResult = result && build && result.requestedAt === build.requestedAt ? result : null;
  const resultByButton = new Map<number, ButtonResult>();
  currentResult?.buttons.forEach((b) => resultByButton.set(b.n, b));
  const generateDone =
    build?.action === 'generate' && currentResult?.action === 'generate' && currentResult.done ? currentResult : null;
  const generateFailed = generateDone ? generateDone.buttons.filter((b) => b.state === 'failed').length : 0;
  const askImport = !!generateDone && generateFailed === 0 && dismissedImport !== build?.requestedAt;
  const sentAge = build ? serverNow - new Date(build.requestedAt).getTime() : Number.POSITIVE_INFINITY;
  const working =
    !!build &&
    build.action !== 'legacy' &&
    (currentResult ? !currentResult.done && serverNow - new Date(currentResult.at).getTime() < 30000 : sentAge < 20000);
  const waitingForBridge = working && !currentResult;

  const blockReason = !bridgeSeen
    ? 'Start Civics Bridge V2 first. The website needs to see it.'
    : tooManyBridges
      ? 'More than one Civics Bridge V2 is running. Close the extra copies first.'
      : bridge?.layoutError
        ? bridge.layoutError
        : working
          ? 'The bridge is still working on the last request.'
          : '';

  const send = async (nextBuild: CivicsButtonBuild) => {
    setMessage(null);
    const ok = await onPush({ ...roster, buttonBuild: nextBuild });
    if (!ok) setMessage('Could not save the request. Nothing was sent to the bridge.');
    return ok;
  };

  const generate = () =>
    send({
      requestedAt: new Date().toISOString(),
      pictureStyle,
      flagOutline: hasFlag && flagOutline,
      slots,
      action: 'generate',
    });

  const importButtons = () => {
    if (!build || build.action !== 'generate') return;
    void send({ ...build, requestedAt: new Date().toISOString(), action: 'import', generateId: build.requestedAt });
  };

  const clear = () => {
    const ok = window.confirm(
      `Clear ${spots.length || 'all'} button${spots.length === 1 ? '' : 's'} on ${where}?${spotText ? `\n\nButtons: ${spotText}` : ''}`
    );
    if (!ok) return;
    void send({
      requestedAt: new Date().toISOString(),
      pictureStyle,
      flagOutline: hasFlag && flagOutline,
      slots: [],
      action: 'clear',
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Companion buttons</h2>
        <p className="mt-1 text-sm text-slate-400">
          Pick a picture style and click Preview. Generate then makes the pictures on the bridge computer only.
          Companion is only changed when you click Import or Clear.
        </p>
        <p
          className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
            bridgeSeen ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-400'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${bridgeSeen ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          {bridgeSeen
            ? `Bridge ${bridge?.bridgeVersion || ''} seen. ${where}, Companion ${bridge?.version || ''}`
            : 'Bridge not seen. Start Civics Bridge V2 on the show computer.'}
        </p>
        {bridgeSeen && spotText && (
          <p className="mt-2 text-xs text-slate-400">
            This bridge uses {spots.length} button{spots.length === 1 ? '' : 's'}, {bridge?.perRow} per row: {spotText}
          </p>
        )}
        {tooManyBridges && (
          <p className="mt-2 text-sm text-red-300">
            {liveBridges.length} copies of Civics Bridge V2 are running ({liveBridges.map((b) => b.instanceId).join(', ')}).
            Close all but one, or they will both change Companion.
          </p>
        )}
        {bridge?.layoutError && <p className="mt-2 text-sm text-red-300">{bridge.layoutError}</p>}
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
            checked={hasFlag && flagOutline}
            disabled={!hasFlag}
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
          {slots.map((slot, index) => {
            const status = resultByButton.get(index + 1);
            return (
              <div
                key={`${slot.state}-${index}`}
                className={`flex min-h-[8rem] flex-col items-center justify-center rounded-2xl border px-3 py-4 text-center ${
                  !previewed
                    ? 'border-dashed border-slate-600 bg-transparent text-slate-500'
                    : slot.eliminated
                      ? 'border-neutral-500 bg-neutral-500 text-white'
                      : 'border-dashed border-slate-500 text-white'
                }`}
                style={
                  previewed && !slot.eliminated
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
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  Button {index + 1}
                  {spots[index] ? ` · ${spots[index]}` : ''}
                </span>
                {previewed ? (
                  <>
                    {hasFlag && <span className="mt-1 text-[10px] text-slate-400">Flag</span>}
                    <span className={`mt-1 text-lg font-bold ${slot.eliminated ? 'line-through' : ''}`}>
                      {showAbbrev ? slot.code : slot.stateLabel}
                    </span>
                    {showAbbrev && <span className="mt-1 text-xs text-slate-300">{slot.name}</span>}
                    {slot.eliminated && (
                      <span className="mt-2 text-[10px] font-semibold uppercase tracking-wide">Eliminated</span>
                    )}
                  </>
                ) : (
                  <span className="mt-2 text-xs uppercase tracking-wide">Not previewed</span>
                )}
                {status && (
                  <span
                    title={status.message}
                    className={`mt-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      RESULT_CLASS[status.state] || 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {RESULT_LABEL[status.state] || status.state}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={slots.length === 0}
          onClick={() => setPreviewKey(currentKey)}
          className="rounded-lg border border-cyan-500 px-4 py-2 text-sm font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewed ? 'Previewed' : 'Preview'}
        </button>
        <button
          type="button"
          disabled={pushing || !previewed || !!blockReason || slots.length === 0}
          onClick={() => void generate()}
          title={!previewed ? 'Click Preview first.' : blockReason}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pushing ? 'Working…' : 'Generate pictures'}
        </button>
        <button
          type="button"
          disabled={pushing || !!blockReason}
          onClick={clear}
          title={blockReason}
          className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear buttons on Companion
        </button>
      </div>
      {!previewed && slots.length > 0 && (
        <p className="text-xs text-slate-500">Click Preview to check the buttons before you can generate them.</p>
      )}
      {previewed && blockReason && <p className="text-xs text-amber-300">{blockReason}</p>}
      {message && <p className="text-sm text-red-300">{message}</p>}

      {waitingForBridge && (
        <p className="text-sm text-slate-300">
          Sent {build?.action}. Waiting for the bridge to pick it up…
        </p>
      )}

      {generateDone && (
        <div className="rounded-xl border border-sky-700 bg-sky-950/50 px-4 py-3 text-sm text-sky-100">
          {generateFailed === 0 ? (
            <p className="font-semibold">
              Pictures created for {generateDone.buttons.length} button{generateDone.buttons.length === 1 ? '' : 's'}.
              Companion has not been changed.
            </p>
          ) : (
            <p className="font-semibold text-red-200">
              {generateFailed} picture{generateFailed === 1 ? '' : 's'} failed. Fix that and generate again before importing.
            </p>
          )}
          {askImport && (
            <>
              <p className="mt-2">
                Import these pictures to {where}?{spotText ? ` Buttons: ${spotText}.` : ''}
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  disabled={pushing || !!blockReason}
                  onClick={importButtons}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Import to Companion
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedImport(build?.requestedAt || '')}
                  className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100"
                >
                  Not now
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {currentResult && currentResult.buttons.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            {currentResult.action === 'generate'
              ? 'Generate'
              : currentResult.action === 'import'
                ? 'Import'
                : 'Clear'}{' '}
            {currentResult.done ? 'finished' : 'in progress'}
          </h3>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-700">
            <table className="w-full text-left text-xs text-slate-300">
              <tbody>
                {currentResult.buttons.map((b) => (
                  <tr key={b.n} className="border-b border-slate-800 last:border-0">
                    <td className="px-3 py-1.5">{b.n ? `Button ${b.n}` : ''}</td>
                    <td className="px-3 py-1.5 text-slate-400">{b.where}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 font-semibold uppercase ${
                          RESULT_CLASS[b.state] || 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {RESULT_LABEL[b.state] || b.state}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">{b.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-200">Bridge log</h3>
        <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
          {bridgeLog.length === 0 ? (
            <p className="text-slate-500">No bridge messages yet. Start Civics Bridge V2.</p>
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
