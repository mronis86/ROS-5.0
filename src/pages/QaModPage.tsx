import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  buildWebQaQuestionsCsv,
  downloadTextFile,
  fetchWebQaOverview,
  fetchWebQaQuestions,
  rotateWebQaSession,
  webQaAudienceAbsoluteUrl,
  webQaQrImageUrl,
  type WebQaOverview,
} from '../lib/webQa';

export default function QaModPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';

  const [overview, setOverview] = useState<WebQaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const audienceUrl = overview?.session
    ? webQaAudienceAbsoluteUrl(overview.session.public_token)
    : '';
  const qrUrl = audienceUrl ? webQaQrImageUrl(audienceUrl, 260) : '';

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await fetchWebQaOverview(eventId, {
        title: eventName !== 'Event' ? eventName : undefined,
      });
      setOverview(data);
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
      window.prompt('Copy this Q&A link:', audienceUrl);
    }
  };

  const rotate = async () => {
    if (!eventId) return;
    if (
      !window.confirm(
        'Generate a new audience link? The old QR / URL will stop working. Existing questions stay.'
      )
    ) {
      return;
    }
    try {
      await rotateWebQaSession(eventId);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not rotate link');
    }
  };

  const downloadReport = async (cueItemId?: number) => {
    if (!eventId || reportBusy) return;
    setReportBusy(true);
    try {
      const questions = await fetchWebQaQuestions(eventId, 'all');
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
              onClick={() =>
                navigate(
                  `/run-of-show?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`
                )
              }
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

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <aside className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 space-y-4 h-fit">
            <div>
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Audience QR</h2>
              <p className="text-xs text-slate-400 mb-3">
                Unique per event. Scan to open the submit page.
              </p>
              {qrUrl ? (
                <div className="rounded-lg bg-white p-3 inline-block">
                  <img
                    src={qrUrl}
                    alt="Q&A audience QR code"
                    width={220}
                    height={220}
                    className="block"
                  />
                </div>
              ) : (
                <div className="h-[220px] w-[220px] rounded-lg bg-slate-800 animate-pulse" />
              )}
            </div>

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
                <button
                  type="button"
                  onClick={() => void rotate()}
                  className="px-3 py-1.5 text-sm rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                  New QR / link
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-700 space-y-2">
              <p className="text-sm font-semibold text-white">Active moderation</p>
              <p className="text-xs text-slate-400 leading-snug">
                Live queue for pending / approved / answered questions.
              </p>
              <button
                type="button"
                onClick={() => window.open(`/qa-mod/active?${qs}`, '_blank')}
                className="w-full px-3 py-2.5 rounded-lg bg-fuchsia-700 hover:bg-fuchsia-600 font-semibold text-sm"
              >
                Open Active Q&A
                {(overview?.counts?.pending ?? 0) > 0
                  ? ` (${overview?.counts?.pending} pending)`
                  : ''}
              </button>
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
                    Total:{' '}
                    <span className="tabular-nums font-semibold">
                      {overview?.question_total ?? 0}
                    </span>
                  </p>
                </div>
              </div>
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
