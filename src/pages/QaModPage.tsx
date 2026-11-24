import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import {
  buildWebQaQuestionsCsv,
  downloadTextFile,
  downloadWebQaQrPng,
  fetchWebQaOverview,
  fetchWebQaQuestions,
  webQaActiveCsvUrl,
  webQaQueueCsvUrl,
  webQaQrImageUrl,
  type WebQaOverview,
  type WebQaQrDownloadOptions,
} from '../lib/webQa';
import {
  fetchEngagementSession,
  rotateEngagementSession,
  webEngagementAudienceUrl,
  type EngagementSession,
} from '../lib/webEngagement';

type QrBgMode = 'white' | 'transparent' | 'custom';

export default function QaModPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';

  const [overview, setOverview] = useState<WebQaOverview | null>(null);
  const [engageSession, setEngageSession] = useState<EngagementSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const [copiedActiveCsv, setCopiedActiveCsv] = useState(false);
  const [copiedTool, setCopiedTool] = useState<'active' | 'select' | 'read' | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);
  const [showQrDownload, setShowQrDownload] = useState(false);
  const [qrFg, setQrFg] = useState('#111827');
  const [qrBgMode, setQrBgMode] = useState<QrBgMode>('white');
  const [qrBgCustom, setQrBgCustom] = useState('#ffffff');
  const [qrBorderPx, setQrBorderPx] = useState(16);
  const [qrBorderColor, setQrBorderColor] = useState('#111827');
  const [qrMargin, setQrMargin] = useState(4);
  const [qrSize, setQrSize] = useState(1024);

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const audienceUrl = engageSession?.public_token
    ? webEngagementAudienceUrl(engageSession.public_token)
    : '';
  const queueCsvUrl = eventId ? webQaQueueCsvUrl(eventId) : '';
  const activeCsvUrl = eventId ? webQaActiveCsvUrl(eventId) : '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const activeToolUrl = eventId ? `${origin}/qa-mod/active?${qs}` : '';
  const selectToolUrl = eventId ? `${origin}/qa-mod/select?${qs}` : '';
  const readToolUrl = eventId ? `${origin}/qa-mod/read?${qs}` : '';
  const qrUrl = audienceUrl ? webQaQrImageUrl(audienceUrl, 140) : '';

  const qrDownloadOpts = useMemo((): WebQaQrDownloadOptions => {
    const bg =
      qrBgMode === 'transparent'
        ? 'transparent'
        : qrBgMode === 'custom'
          ? qrBgCustom
          : '#ffffff';
    return {
      size: qrSize,
      fg: qrFg,
      bg,
      margin: qrMargin,
      borderPx: qrBorderPx,
      borderColor: qrBorderColor,
    };
  }, [qrBgMode, qrBgCustom, qrBorderColor, qrBorderPx, qrFg, qrMargin, qrSize]);

  const qrPreviewUrl = audienceUrl
    ? webQaQrImageUrl(audienceUrl, {
        size: 160,
        fg: qrFg,
        bg: qrBgMode === 'transparent' ? 'ffffff' : qrDownloadOpts.bg,
        margin: qrMargin,
      })
    : '';

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [data, engage] = await Promise.all([
        fetchWebQaOverview(eventId, {
          title: eventName !== 'Event' ? eventName : undefined,
        }),
        fetchEngagementSession(eventId, {
          title: eventName !== 'Event' ? eventName : undefined,
        }),
      ]);
      setOverview(data);
      setEngageSession(engage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Q&A management');
    } finally {
      setLoading(false);
    }
  }, [eventId, eventName]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  const copyLink = async () => {
    if (!audienceUrl) return;
    try {
      await navigator.clipboard.writeText(audienceUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this engagement link:', audienceUrl);
    }
  };

  const copyQueueCsv = async () => {
    if (!queueCsvUrl) return;
    try {
      await navigator.clipboard.writeText(queueCsvUrl);
      setCopiedCsv(true);
      window.setTimeout(() => setCopiedCsv(false), 1600);
    } catch {
      window.prompt('Copy this vMix CSV URL:', queueCsvUrl);
    }
  };

  const copyActiveCsv = async () => {
    if (!activeCsvUrl) return;
    try {
      await navigator.clipboard.writeText(activeCsvUrl);
      setCopiedActiveCsv(true);
      window.setTimeout(() => setCopiedActiveCsv(false), 1600);
    } catch {
      window.prompt('Copy this vMix active CSV URL:', activeCsvUrl);
    }
  };

  const copyToolLink = async (kind: 'active' | 'select' | 'read', url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTool(kind);
      window.setTimeout(() => setCopiedTool(null), 1600);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const rotate = async () => {
    if (!eventId) return;
    if (
      !window.confirm(
        'Generate a new audience link? The old QR / URL will stop working for both Q&A and polls. Existing questions stay.'
      )
    ) {
      return;
    }
    try {
      const next = await rotateEngagementSession(eventId);
      setEngageSession(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not rotate link');
    }
  };

  const downloadQr = async () => {
    if (!audienceUrl || qrBusy) return;
    setQrBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const safeName = (eventName || 'event')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      await downloadWebQaQrPng(
        audienceUrl,
        `engagement-qr-${safeName || 'event'}-${stamp}.png`,
        qrDownloadOpts
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not download QR');
    } finally {
      setQrBusy(false);
    }
  };

  const downloadReport = async (cueItemId?: number) => {
    if (!eventId || reportBusy) return;
    setReportBusy(true);
    try {
      // Report includes overflow (email follow-ups) that live mod UI hides.
      const questions = await fetchWebQaQuestions(eventId, 'all', { includeOverflow: true });
      const filtered =
        cueItemId != null
          ? questions.filter((q) => Number(q.cue_item_id) === cueItemId)
          : questions;
      const cueLookup = new Map(
        (overview?.qa_cues || []).map((c) => [
          c.id,
          { cue: c.cue, segment_name: c.segment_name },
        ])
      );
      const csv = buildWebQaQuestionsCsv(filtered, cueLookup);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const cueTag =
        cueItemId != null
          ? `cue-${cueLookup.get(cueItemId)?.cue || cueItemId}`
          : 'all-cues';
      downloadTextFile(`web-qa-${cueTag}-${stamp}.csv`, csv);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not download report');
    } finally {
      setReportBusy(false);
    }
  };

  const current = overview?.current_cue;
  const isOpen = overview?.session?.is_open === true;
  const inQaCue = overview?.in_qa_cue === true;

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-slate-300">Open Web Q&A from an event’s main menu.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600"
          >
            Back to events
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-fuchsia-300/90 font-semibold">
              Web Q&A Management
            </p>
            <h1 className="text-xl font-bold leading-tight">{eventName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => {
                let role: string | undefined;
                try {
                  role = localStorage.getItem(`userRole_${eventId}`) || undefined;
                } catch {
                  /* ignore */
                }
                navigate(
                  `/run-of-show?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
                  {
                    state: {
                      event: {
                        id: eventId,
                        name: eventName || 'Event',
                        date: new Date().toISOString(),
                        location: '',
                        numberOfDays: 1,
                      },
                      userRole: role,
                    },
                  }
                );
              }}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Back to ROS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {loading && !overview ? (
          <p className="text-slate-400">Loading Q&A management…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
          <aside className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 space-y-4 h-fit">
            <div>
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Audience QR</h2>
              <p className="text-xs text-slate-400 mb-2">
                One link per event. Shows Q&A and/or an open poll for the live cue.
              </p>
              <div className="flex items-start gap-3">
                {qrUrl ? (
                  <div className="rounded-md bg-white p-1.5 shrink-0">
                    <img
                      src={qrUrl}
                      alt="Event engagement QR code"
                      width={112}
                      height={112}
                      className="block w-28 h-28"
                    />
                  </div>
                ) : (
                  <div className="h-28 w-28 rounded-md bg-slate-800 animate-pulse shrink-0" />
                )}
                <div className="min-w-0 space-y-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowQrDownload((v) => !v)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold rounded bg-slate-700 hover:bg-slate-600"
                  >
                    {showQrDownload ? 'Hide download options' : 'Download QR…'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void rotate()}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                  >
                    New QR / link
                  </button>
                </div>
              </div>
            </div>

            {showQrDownload ? (
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                  Download options
                </p>
                <div
                  className="rounded-md p-2 inline-block"
                  style={{
                    background:
                      qrBgMode === 'transparent'
                        ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 12px 12px'
                        : qrBgMode === 'custom'
                          ? qrBgCustom
                          : '#ffffff',
                    boxShadow:
                      qrBorderPx > 0
                        ? `0 0 0 ${Math.min(8, Math.max(2, Math.round(qrBorderPx / 8)))}px ${qrBorderColor}`
                        : undefined,
                  }}
                >
                  {qrPreviewUrl ? (
                    <img
                      src={qrPreviewUrl}
                      alt="QR download preview"
                      width={96}
                      height={96}
                      className="block w-24 h-24"
                      style={{
                        // Approximate transparent punch for preview only
                        mixBlendMode: qrBgMode === 'transparent' ? 'multiply' : undefined,
                      }}
                    />
                  ) : null}
                </div>

                <label className="block text-xs text-slate-400">
                  Code color
                  <input
                    type="color"
                    value={qrFg}
                    onChange={(e) => setQrFg(e.target.value)}
                    className="mt-1 w-full h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                  />
                </label>

                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400">Background</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['white', 'White'],
                        ['transparent', 'Transparent'],
                        ['custom', 'Custom'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setQrBgMode(id)}
                        className={`px-2 py-1 text-[11px] rounded border ${
                          qrBgMode === id
                            ? 'border-fuchsia-500 bg-fuchsia-900/40 text-white'
                            : 'border-slate-600 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {qrBgMode === 'custom' ? (
                    <input
                      type="color"
                      value={qrBgCustom}
                      onChange={(e) => setQrBgCustom(e.target.value)}
                      className="w-full h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                    />
                  ) : null}
                </div>

                <label className="block text-xs text-slate-400">
                  Border ({qrBorderPx}px)
                  <input
                    type="range"
                    min={0}
                    max={64}
                    step={2}
                    value={qrBorderPx}
                    onChange={(e) => setQrBorderPx(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>
                {qrBorderPx > 0 ? (
                  <label className="block text-xs text-slate-400">
                    Border color
                    <input
                      type="color"
                      value={qrBorderColor}
                      onChange={(e) => setQrBorderColor(e.target.value)}
                      className="mt-1 w-full h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                    />
                  </label>
                ) : null}

                <label className="block text-xs text-slate-400">
                  Quiet zone ({qrMargin})
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={qrMargin}
                    onChange={(e) => setQrMargin(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>

                <label className="block text-xs text-slate-400">
                  Export size
                  <select
                    value={qrSize}
                    onChange={(e) => setQrSize(Number(e.target.value))}
                    className="mt-1 w-full rounded bg-slate-900 border border-slate-600 px-2 py-1.5 text-sm text-white"
                  >
                    <option value={512}>512 px</option>
                    <option value={1024}>1024 px</option>
                    <option value={2048}>2048 px</option>
                  </select>
                </label>

                <button
                  type="button"
                  disabled={!audienceUrl || qrBusy}
                  onClick={() => void downloadQr()}
                  className="w-full px-3 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-40 font-semibold text-sm"
                >
                  {qrBusy ? 'Preparing PNG…' : 'Download PNG'}
                </button>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Public link
              </label>
              <div className="text-xs break-all text-sky-200 bg-slate-950/70 border border-slate-700 rounded-lg px-2.5 py-2">
                {audienceUrl || '…'}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="px-3 py-1.5 text-sm rounded bg-sky-700 hover:bg-sky-600"
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <a
                  href={audienceUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className={`px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 ${
                    !audienceUrl ? 'pointer-events-none opacity-40' : ''
                  }`}
                >
                  Open
                </a>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                vMix CSV
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void copyActiveCsv()}
                  disabled={!activeCsvUrl}
                  title="Copy active CSV link"
                  className="px-2 py-1.5 text-xs font-semibold rounded bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                >
                  {copiedActiveCsv ? (
                    <Check className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                  )}
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => void copyQueueCsv()}
                  disabled={!queueCsvUrl}
                  title="Copy queue CSV link"
                  className="px-2 py-1.5 text-xs font-semibold rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                >
                  {copiedCsv ? (
                    <Check className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 shrink-0" />
                  )}
                  Queue
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-700 space-y-2">
              <p className="text-sm font-semibold text-white">Moderator tools</p>
              <p className="text-xs text-slate-400 leading-snug">
                Public tablet links — no login. Open or copy for iPads.
              </p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => window.open(activeToolUrl || `/qa-mod/active?${qs}`, '_blank')}
                    className="flex-1 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 font-semibold text-sm"
                  >
                    Active Q&A
                    {(overview?.counts?.pending ?? 0) > 0
                      ? ` (${overview?.counts?.pending})`
                      : ''}
                  </button>
                  <button
                    type="button"
                    disabled={!activeToolUrl}
                    title="Copy link"
                    aria-label="Copy Active Q&A link"
                    onClick={() => void copyToolLink('active', activeToolUrl)}
                    className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                  >
                    {copiedTool === 'active' ? (
                      <Check className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-200" />
                    )}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => window.open(selectToolUrl || `/qa-mod/select?${qs}`, '_blank')}
                    className="flex-1 px-3 py-2 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 font-semibold text-sm"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    disabled={!selectToolUrl}
                    title="Copy link"
                    aria-label="Copy Select link"
                    onClick={() => void copyToolLink('select', selectToolUrl)}
                    className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                  >
                    {copiedTool === 'select' ? (
                      <Check className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-200" />
                    )}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => window.open(readToolUrl || `/qa-mod/read?${qs}`, '_blank')}
                    className="flex-1 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 font-semibold text-sm"
                  >
                    Reader
                  </button>
                  <button
                    type="button"
                    disabled={!readToolUrl}
                    title="Copy link"
                    aria-label="Copy Reader link"
                    onClick={() => void copyToolLink('read', readToolUrl)}
                    className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                  >
                    {copiedTool === 'read' ? (
                      <Check className="w-4 h-4 text-emerald-300" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-200" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <section className="space-y-4 min-w-0">
            <div
              className={`rounded-xl border px-4 py-4 ${
                isOpen
                  ? 'border-emerald-600/50 bg-emerald-950/30'
                  : 'border-slate-700 bg-slate-900/70'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                    Submissions
                  </p>
                  <p className="text-2xl font-bold mt-0.5">
                    {isOpen ? 'OPEN' : 'CLOSED'}
                    <span className="ml-2 text-sm font-semibold text-slate-300">
                      {inQaCue ? '· in Q&A cue' : '· out of Q&A cue'}
                    </span>
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    Auto-follows the loaded cue. Opens when that cue has Q&A checked; closes when you
                    leave it.
                  </p>
                </div>
                <div className="text-right text-sm text-slate-300">
                  <p>
                    Pending:{' '}
                    <span className="tabular-nums font-semibold text-amber-200">
                      {overview?.counts?.pending ?? 0}
                    </span>
                  </p>
                  <p>
                    Live pool:{' '}
                    <span className="tabular-nums font-semibold">
                      {overview?.visible_count ?? overview?.counts?.all ?? 0}
                      <span className="text-slate-500 font-normal">
                        /{overview?.soft_limit ?? 300}
                      </span>
                    </span>
                  </p>
                  <p>
                    Overflow:{' '}
                    <span
                      className={`tabular-nums font-semibold ${
                        (overview?.overflow_count ?? 0) > 0 ? 'text-amber-200' : ''
                      }`}
                    >
                      {overview?.overflow_count ?? 0}
                    </span>
                    <span className="text-slate-500"> · report only</span>
                  </p>
                </div>
              </div>
              {overview?.at_soft_limit ? (
                <p className="mt-3 text-xs text-amber-200/90 border-t border-amber-800/40 pt-2">
                  Live cap reached. New audience submits ask for email and land in overflow
                  (export CSV to see them).
                </p>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-4">
              <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                Current cue
              </p>
              {current ? (
                <div>
                  <p className="text-lg font-semibold">
                    {current.cue || `Item #${current.id}`}
                    {current.has_qa ? (
                      <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-fuchsia-200 bg-fuchsia-900/40 border border-fuchsia-600/40 px-2 py-0.5 rounded">
                        Q&A
                      </span>
                    ) : null}
                  </p>
                  <p className="text-slate-300 mt-0.5">
                    {current.segment_name || 'Untitled segment'}
                  </p>
                  {overview?.timer ? (
                    <p className="text-xs text-slate-500 mt-1">
                      {overview.timer.is_running
                        ? 'Timer running'
                        : overview.timer.is_active
                          ? 'Loaded'
                          : 'Last loaded'}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-slate-400">No cue loaded yet.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Cues with Q&A</h2>
                  <p className="text-xs text-slate-400">
                    Parent cues only — rows with the Q&A checkbox (not indented 13Q timers).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={reportBusy || (overview?.question_total ?? 0) === 0}
                  onClick={() => void downloadReport()}
                  className="px-3 py-1.5 text-sm rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-40"
                >
                  {reportBusy ? 'Preparing…' : 'Download all questions CSV'}
                </button>
              </div>

              {(overview?.qa_cues || []).length === 0 ? (
                <p className="text-slate-400 text-sm py-4 text-center border border-dashed border-slate-700 rounded-lg">
                  No cues have Q&A checked yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
                  {(overview?.qa_cues || []).map((cue) => {
                    const isCurrent = current?.id === cue.id;
                    return (
                      <li
                        key={cue.id}
                        className={`px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
                          isCurrent ? 'bg-fuchsia-950/30' : 'bg-slate-950/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            {cue.cue || `Item #${cue.id}`}
                            {isCurrent ? (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-200">
                                current
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {cue.segment_name || 'Untitled'}
                            <span className="mx-1.5 text-slate-600">·</span>
                            {cue.question_count || 0} question
                            {(cue.question_count || 0) === 1 ? '' : 's'}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={reportBusy || !(cue.question_count > 0)}
                          onClick={() => void downloadReport(cue.id)}
                          className="px-2.5 py-1 text-xs rounded border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                        >
                          Download CSV
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

          </section>
        </div>
      </main>
    </div>
  );
}
