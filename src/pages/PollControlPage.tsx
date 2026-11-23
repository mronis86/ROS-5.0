import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  drainWebPoll,
  fetchWebPoll,
  fetchWebPollRollup,
  listWebPolls,
  setWebPollStatus,
  webPollAudienceUrl,
  type WebPoll,
  type WebPollStatus,
} from '../lib/webPolls';

const STATUS_FLOW: { id: WebPollStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Close' },
  { id: 'finalizing', label: 'Finalizing' },
  { id: 'final', label: 'Final' },
];

type Rollup = {
  received?: number;
  counted?: number;
  pending_inbox?: number;
  status?: string;
  results_snapshot?: {
    options?: { id: string; label: string; color?: string; votes?: number }[];
  };
};

export default function PollControlPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';
  const pollIdParam = params.get('pollId') || '';

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const [pollList, setPollList] = useState<WebPoll[]>([]);
  const [pollId, setPollId] = useState(pollIdParam);
  const [poll, setPoll] = useState<WebPoll | null>(null);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [drainBusy, setDrainBusy] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);

  useEffect(() => {
    setPollId(pollIdParam);
  }, [pollIdParam]);

  const loadList = useCallback(async () => {
    if (!eventId) return;
    try {
      setPollList(await listWebPolls(eventId));
    } catch {
      /* list is secondary */
    }
  }, [eventId]);

  const loadPoll = useCallback(async () => {
    if (!pollId) {
      setPoll(null);
      setRollup(null);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [p, r] = await Promise.all([fetchWebPoll(pollId), fetchWebPollRollup(pollId)]);
      setPoll(p);
      setRollup(r as Rollup);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load poll');
    } finally {
      setLoading(false);
    }
  }, [pollId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setLoading(true);
    void loadPoll();
    const id = window.setInterval(() => void loadPoll(), 2500);
    return () => window.clearInterval(id);
  }, [loadPoll]);

  const selectPoll = (id: string) => {
    setPollId(id);
    navigate(`/polls-control?${qs}&pollId=${encodeURIComponent(id)}`, { replace: true });
  };

  const changeStatus = async (status: WebPollStatus) => {
    if (!pollId || statusBusy) return;
    setStatusBusy(true);
    setError(null);
    try {
      const updated = await setWebPollStatus(pollId, status);
      setPoll(updated);
      await loadPoll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setStatusBusy(false);
    }
  };

  const runDrain = async () => {
    if (!pollId || drainBusy) return;
    setDrainBusy(true);
    setDrainMsg(null);
    try {
      const result = await drainWebPoll(pollId, 200);
      setDrainMsg(
        `Processed ${result.processed ?? 0} · committed ${result.committed ?? 0}`
      );
      await loadPoll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Drain failed');
    } finally {
      setDrainBusy(false);
    }
  };

  const options = rollup?.results_snapshot?.options || poll?.options || [];
  const maxVotes = Math.max(1, ...options.map((o) => Number(o.votes || o.vote_count || 0)));
  const received = rollup?.received ?? poll?.received_count ?? 0;
  const counted = rollup?.counted ?? poll?.counted_count ?? 0;
  const pending = rollup?.pending_inbox ?? Math.max(0, received - counted);

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-slate-300">Open Web Polls Control from Setup or the event menu.</p>
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
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-sky-300/90 font-semibold">
              Web Polls · Control
            </p>
            <h1 className="text-xl font-bold leading-tight">{eventName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(`/polls-setup?${qs}`)}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Setup
            </button>
            <button
              type="button"
              onClick={() => void loadPoll()}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        {error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Active poll</label>
          <select
            value={pollId}
            onChange={(e) => selectPoll(e.target.value)}
            className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2.5 text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">Select a poll…</option>
            {pollList.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.status}] {p.question}
              </option>
            ))}
          </select>
        </div>

        {!pollId ? (
          <p className="text-slate-500 text-sm">Pick a poll to open / close and watch counts.</p>
        ) : loading && !poll ? (
          <p className="text-slate-400">Loading…</p>
        ) : poll ? (
          <>
            <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                  {poll.poll_type} · {poll.status}
                </p>
                <h2 className="text-lg font-semibold text-white mt-0.5">{poll.question}</h2>
                <a
                  href={webPollAudienceUrl(poll.public_token)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-sky-300 hover:text-sky-200 font-mono break-all"
                >
                  {webPollAudienceUrl(poll.public_token)}
                </a>
              </div>

              <div className="flex flex-wrap gap-2">
                {STATUS_FLOW.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={statusBusy || poll.status === s.id}
                    onClick={() => void changeStatus(s.id)}
                    className={`px-3 py-1.5 text-xs rounded-md border font-semibold transition-colors disabled:opacity-40 ${
                      poll.status === s.id
                        ? 'border-sky-500 bg-sky-950/50 text-sky-100'
                        : 'border-slate-600 bg-slate-950 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Received</p>
                  <p className="text-2xl font-semibold tabular-nums text-white">{received}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Counted</p>
                  <p className="text-2xl font-semibold tabular-nums text-white">{counted}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Inbox</p>
                  <p className="text-2xl font-semibold tabular-nums text-amber-200">{pending}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={drainBusy}
                  onClick={() => void runDrain()}
                  className="px-3 py-1.5 text-xs rounded bg-amber-700/80 hover:bg-amber-600 disabled:opacity-50 font-semibold"
                >
                  {drainBusy ? 'Draining…' : 'Drain inbox now'}
                </button>
                {drainMsg ? <span className="text-xs text-slate-400">{drainMsg}</span> : null}
              </div>
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">Live rollup</h3>
              {options.length === 0 ? (
                <p className="text-slate-500 text-sm">No options.</p>
              ) : (
                <ul className="space-y-2.5">
                  {options.map((o) => {
                    const votes = Number(o.votes ?? o.vote_count ?? 0);
                    const pct = Math.round((votes / maxVotes) * 100);
                    return (
                      <li key={o.id}>
                        <div className="flex justify-between text-xs mb-1 gap-2">
                          <span className="text-slate-200 truncate">{o.label}</span>
                          <span className="tabular-nums text-slate-400 shrink-0">{votes}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{
                              width: `${pct}%`,
                              background: o.color || '#38bdf8',
                            }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
