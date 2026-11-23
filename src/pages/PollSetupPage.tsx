import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  buildWebPollsCsv,
  createWebPoll,
  downloadTextFile,
  fetchWebPollOverview,
  rotateWebPollSession,
  webPollAudienceUrl,
  webPollEventAudienceUrl,
  webPollQrImageUrl,
  type WebPoll,
  type WebPollCueSummary,
  type WebPollOverview,
  type WebPollType,
} from '../lib/webPolls';

const POLL_TYPES: { id: WebPollType; label: string }[] = [
  { id: 'single', label: 'Single choice' },
  { id: 'multi', label: 'Multi select' },
  { id: 'yesno', label: 'Yes / No' },
  { id: 'rating', label: 'Rating 1–5' },
  { id: 'ranked', label: 'Ranked' },
];

function defaultOptions(type: WebPollType): { label: string }[] {
  if (type === 'yesno') return [{ label: 'Yes' }, { label: 'No' }];
  if (type === 'rating') {
    return [1, 2, 3, 4, 5].map((n) => ({ label: String(n) }));
  }
  if (type === 'ranked') {
    return [{ label: 'Option A' }, { label: 'Option B' }, { label: 'Option C' }];
  }
  return [{ label: 'Option A' }, { label: 'Option B' }];
}

function statusTone(status: string) {
  if (status === 'open') return 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40';
  if (status === 'closed' || status === 'finalizing') {
    return 'bg-amber-500/20 text-amber-200 border-amber-600/40';
  }
  if (status === 'final') return 'bg-sky-500/20 text-sky-200 border-sky-600/40';
  return 'bg-slate-700/60 text-slate-300 border-slate-600/50';
}

export default function PollSetupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';
  const cueFromUrl = Number(params.get('cueItemId') || params.get('cueId') || '');

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const [overview, setOverview] = useState<WebPollOverview | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<number | null>(
    Number.isFinite(cueFromUrl) && cueFromUrl > 0 ? cueFromUrl : null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAudience, setCopiedAudience] = useState(false);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [question, setQuestion] = useState('');
  const [pollType, setPollType] = useState<WebPollType>('single');
  const [optionLabels, setOptionLabels] = useState(() =>
    defaultOptions('single').map((o) => o.label)
  );

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await fetchWebPollOverview(eventId);
      setOverview(data);
      setSelectedCueId((prev) => {
        if (prev && data.poll_cues.some((c) => c.id === prev)) return prev;
        if (Number.isFinite(cueFromUrl) && data.poll_cues.some((c) => c.id === cueFromUrl)) {
          return cueFromUrl;
        }
        return data.poll_cues[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load poll management');
    } finally {
      setLoading(false);
    }
  }, [eventId, cueFromUrl]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    setOptionLabels(defaultOptions(pollType).map((o) => o.label));
  }, [pollType]);

  const selectedCue: WebPollCueSummary | null = useMemo(() => {
    if (!overview || selectedCueId == null) return null;
    return overview.poll_cues.find((c) => c.id === selectedCueId) || null;
  }, [overview, selectedCueId]);

  const cuePolls: WebPoll[] = selectedCue?.polls || [];

  const eventAudienceUrl = overview?.session?.public_token
    ? webPollEventAudienceUrl(overview.session.public_token)
    : '';
  const qrUrl = eventAudienceUrl ? webPollQrImageUrl(eventAudienceUrl, 140) : '';

  const selectCue = (id: number) => {
    setSelectedCueId(id);
    setShowCreate(false);
    navigate(`/polls-setup?${qs}&cueItemId=${id}`, { replace: true });
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || busy || selectedCueId == null) return;
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const options =
        pollType === 'rating'
          ? defaultOptions('rating')
          : optionLabels
              .map((label) => label.trim())
              .filter(Boolean)
              .map((label) => ({ label }));
      const poll = await createWebPoll(eventId, {
        question: q,
        pollType,
        options,
        cueItemId: selectedCueId,
      });
      setQuestion('');
      setOptionLabels(defaultOptions(pollType).map((o) => o.label));
      setShowCreate(false);
      await load();
      navigate(`/polls-control?${qs}&pollId=${encodeURIComponent(poll.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (poll: WebPoll) => {
    const url = webPollAudienceUrl(poll.public_token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(poll.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* ignore */
    }
  };

  const downloadReport = () => {
    if (!overview?.polls?.length) return;
    setReportBusy(true);
    try {
      const lookup = new Map(
        (overview.poll_cues || []).map((c) => [
          c.id,
          { cue: c.cue, segment_name: c.segment_name },
        ])
      );
      const csv = buildWebPollsCsv(overview.polls, lookup);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadTextFile(`web-polls-${stamp}.csv`, csv);
    } finally {
      setReportBusy(false);
    }
  };

  const copyEventLink = async () => {
    if (!eventAudienceUrl) return;
    try {
      await navigator.clipboard.writeText(eventAudienceUrl);
      setCopiedAudience(true);
      window.setTimeout(() => setCopiedAudience(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const rotateQr = async () => {
    if (!eventId || rotateBusy) return;
    if (!window.confirm('Generate a new audience QR / link? The old QR will stop working.')) return;
    setRotateBusy(true);
    setError(null);
    try {
      await rotateWebPollSession(eventId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate poll link');
    } finally {
      setRotateBusy(false);
    }
  };

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-slate-300">Open Web Polls from an event’s main menu.</p>
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

  const current = overview?.current_cue;
  const inPollCue = overview?.in_poll_cue === true;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-sky-300/90 font-semibold">
              Web Polls Management
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
              onClick={() => navigate(`/polls-control?${qs}`)}
              className="px-3 py-1.5 text-sm rounded bg-sky-800 hover:bg-sky-700"
            >
              Control
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
          <p className="text-slate-400">Loading poll management…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <aside className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 space-y-4 h-fit">
            <div>
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Audience QR</h2>
              <p className="text-xs text-slate-400 mb-2">
                One link per event. Opens whatever poll is currently open.
              </p>
              <div className="flex items-start gap-3">
                {qrUrl ? (
                  <div className="rounded-md bg-white p-1.5 shrink-0">
                    <img
                      src={qrUrl}
                      alt="Poll audience QR code"
                      width={112}
                      height={112}
                      className="block w-28 h-28"
                    />
                  </div>
                ) : (
                  <div className="h-28 w-28 rounded-md bg-slate-800 animate-pulse shrink-0" />
                )}
                <div className="min-w-0 space-y-2 pt-0.5 flex-1">
                  <button
                    type="button"
                    onClick={() => void copyEventLink()}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold rounded bg-slate-700 hover:bg-slate-600 inline-flex items-center justify-center gap-1.5"
                  >
                    {copiedAudience ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedAudience ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    type="button"
                    disabled={rotateBusy}
                    onClick={() => void rotateQr()}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {rotateBusy ? 'Rotating…' : 'New QR / link'}
                  </button>
                </div>
              </div>
              {eventAudienceUrl ? (
                <p className="mt-2 text-[10px] text-slate-500 font-mono break-all">{eventAudienceUrl}</p>
              ) : null}
            </div>

            <div className="pt-3 border-t border-slate-700/80">
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Live cue</h2>
              <p className="text-xs text-slate-400 mb-2">
                {inPollCue ? 'Current loaded cue has Poll checked.' : 'Not currently in a Poll cue.'}
              </p>
              {current ? (
                <div
                  className={`rounded-lg border px-3 py-2 ${
                    inPollCue
                      ? 'border-emerald-600/50 bg-emerald-950/30'
                      : 'border-slate-700 bg-slate-950/50'
                  }`}
                >
                  <p className="text-sm font-medium">
                    {current.cue || `Item #${current.id}`}
                    {inPollCue ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-200">
                        poll cue
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{current.segment_name || '—'}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No cue loaded yet.</p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-700/80">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                Counts
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-slate-700 px-2 py-1.5">
                  <span className="text-slate-500">All</span>
                  <p className="text-lg font-semibold tabular-nums">{overview?.counts.all ?? 0}</p>
                </div>
                <div className="rounded border border-slate-700 px-2 py-1.5">
                  <span className="text-slate-500">Open</span>
                  <p className="text-lg font-semibold tabular-nums text-emerald-300">
                    {overview?.counts.open ?? 0}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={reportBusy || !(overview?.polls?.length)}
              onClick={downloadReport}
              className="w-full px-3 py-2 text-sm rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-40 font-semibold"
            >
              {reportBusy ? 'Preparing…' : 'Download polls CSV'}
            </button>
          </aside>

          <div className="space-y-5">
            <section className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Cues with Poll</h2>
                <p className="text-xs text-slate-400">
                  Parent cues with the Poll checkbox in ROS. Select one to create or manage its polls.
                </p>
              </div>

              {(overview?.poll_cues || []).length === 0 ? (
                <p className="text-slate-400 text-sm py-6 text-center border border-dashed border-slate-700 rounded-lg">
                  No cues have Poll checked yet. Check <span className="text-white">Poll</span> on a
                  rundown row, then refresh.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
                  {(overview?.poll_cues || []).map((cue) => {
                    const isSelected = selectedCueId === cue.id;
                    const isCurrent = current?.id === cue.id;
                    return (
                      <li key={cue.id}>
                        <button
                          type="button"
                          onClick={() => selectCue(cue.id)}
                          className={`w-full px-3 py-2.5 text-left flex flex-wrap items-center justify-between gap-2 transition-colors ${
                            isSelected
                              ? 'bg-sky-950/40 ring-1 ring-inset ring-sky-600/40'
                              : isCurrent
                                ? 'bg-emerald-950/20 hover:bg-slate-900'
                                : 'bg-slate-950/40 hover:bg-slate-900'
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
                              {cue.segment_name || '—'}
                            </p>
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums shrink-0">
                            {cue.poll_count || 0} poll{(cue.poll_count || 0) === 1 ? '' : 's'}
                            {(cue.open_count || 0) > 0 ? (
                              <span className="ml-2 text-emerald-300">{cue.open_count} open</span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {selectedCue ? (
              <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Selected cue
                    </p>
                    <h3 className="text-lg font-semibold">
                      {selectedCue.cue || `Item #${selectedCue.id}`}
                    </h3>
                    <p className="text-sm text-slate-400">{selectedCue.segment_name || '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreate((v) => !v)}
                    className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 font-semibold"
                  >
                    {showCreate ? 'Cancel' : 'New poll for this cue'}
                  </button>
                </div>

                {showCreate ? (
                  <form
                    onSubmit={(e) => void onCreate(e)}
                    className="rounded-lg border border-slate-700 bg-slate-950/60 p-4 space-y-3"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                        Question
                      </label>
                      <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        maxLength={280}
                        required
                        placeholder="What should we decide?"
                        className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                        Type
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {POLL_TYPES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setPollType(t.id)}
                            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                              pollType === t.id
                                ? 'border-sky-500 bg-sky-950/40 text-sky-100'
                                : 'border-slate-600 bg-slate-950 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {pollType !== 'rating' ? (
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-400">Options</label>
                        {optionLabels.map((label, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              value={label}
                              onChange={(e) => {
                                const next = [...optionLabels];
                                next[i] = e.target.value;
                                setOptionLabels(next);
                              }}
                              maxLength={80}
                              className="flex-1 rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                            />
                            {optionLabels.length > 2 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setOptionLabels(optionLabels.filter((_, j) => j !== i))
                                }
                                className="px-2.5 rounded-lg border border-slate-600 text-slate-400 hover:bg-slate-800"
                              >
                                −
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {optionLabels.length < 8 && pollType !== 'yesno' ? (
                          <button
                            type="button"
                            onClick={() =>
                              setOptionLabels([
                                ...optionLabels,
                                `Option ${String.fromCharCode(65 + optionLabels.length)}`,
                              ])
                            }
                            className="text-xs text-sky-300 hover:text-sky-200"
                          >
                            + Add option
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Rating uses fixed options 1–5.</p>
                    )}
                    <button
                      type="submit"
                      disabled={busy || !question.trim()}
                      className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-sm font-semibold"
                    >
                      {busy ? 'Creating…' : 'Create draft'}
                    </button>
                  </form>
                ) : null}

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Polls on this cue
                  </h4>
                  {cuePolls.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No polls yet — create one for this cue.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {cuePolls.map((poll) => {
                        const audience = webPollAudienceUrl(poll.public_token);
                        return (
                          <li
                            key={poll.id}
                            className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <span
                                  className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${statusTone(poll.status)}`}
                                >
                                  {poll.status}
                                </span>
                                <span className="text-[11px] text-slate-500 uppercase">
                                  {poll.poll_type}
                                </span>
                                <span className="text-[11px] text-slate-500 tabular-nums">
                                  {poll.received_count}/{poll.counted_count} recv/counted
                                </span>
                              </div>
                              <p className="font-medium text-white truncate">{poll.question}</p>
                              <p className="text-[11px] text-slate-500 font-mono truncate">
                                {audience}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => void copyLink(poll)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600"
                              >
                                {copiedId === poll.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                                {copiedId === poll.id ? 'Copied' : 'Copy link'}
                              </button>
                              <a
                                href={audience}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                              >
                                Audience
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    `/polls-control?${qs}&pollId=${encodeURIComponent(poll.id)}`
                                  )
                                }
                                className="px-2.5 py-1.5 text-xs rounded bg-sky-700 hover:bg-sky-600 font-semibold"
                              >
                                Control
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
