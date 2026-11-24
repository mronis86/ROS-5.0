import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import WebPollDesignEditor from '../components/WebPollDesignEditor';
import type { WebPollDisplayStyle } from '../lib/webPollDisplayStyle';
import {
  fetchWebPoll,
  fetchWebPollRollup,
  listWebPolls,
  setWebPollOnAir,
  updateWebPollDisplayStyle,
  webPollDisplayStyle,
  webPollSurfaceUrl,
  type WebPoll,
  type WebPollSurfaceKind,
} from '../lib/webPolls';

type Rollup = {
  received?: number;
  counted?: number;
  pending_inbox?: number;
  results_snapshot?: {
    options?: { id: string; label: string; color?: string; votes?: number }[];
  };
};

const SURFACES: { id: WebPollSurfaceKind; label: string; hint: string }[] = [
  { id: 'stage', label: 'Stage', hint: 'Full-frame results plate' },
  { id: 'lower', label: 'Lower third', hint: 'Bottom banner overlay' },
  { id: 'pip', label: 'PiP', hint: 'Corner picture-in-picture' },
];

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
  const [onAirBusy, setOnAirBusy] = useState(false);
  const [designDraft, setDesignDraft] = useState<WebPollDisplayStyle | null>(null);
  const [designBusy, setDesignBusy] = useState(false);
  const [designMsg, setDesignMsg] = useState<string | null>(null);
  const [showDesign, setShowDesign] = useState(false);
  const [copiedSurface, setCopiedSurface] = useState<string | null>(null);

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
    const id = window.setInterval(() => void loadPoll(), 2000);
    return () => window.clearInterval(id);
  }, [loadPoll]);

  useEffect(() => {
    setDesignDraft(null);
    setDesignMsg(null);
    setShowDesign(false);
  }, [pollId]);

  useEffect(() => {
    if (!poll || poll.id !== pollId) return;
    setDesignDraft((prev) => prev ?? webPollDisplayStyle(poll));
  }, [poll, pollId]);

  const selectPoll = (id: string) => {
    setPollId(id);
    navigate(`/polls-control?${qs}&pollId=${encodeURIComponent(id)}`, { replace: true });
  };

  const liveStyle = poll ? webPollDisplayStyle(poll) : null;
  const onAir = Boolean(liveStyle?.surfaces.onAir);

  const saveDesign = async () => {
    if (!poll || !designDraft || designBusy) return;
    setDesignBusy(true);
    setDesignMsg(null);
    try {
      // Keep live on-air state when saving look/layout from the draft.
      const next: WebPollDisplayStyle = {
        ...designDraft,
        surfaces: {
          ...designDraft.surfaces,
          onAir: Boolean(webPollDisplayStyle(poll).surfaces.onAir),
        },
      };
      const updated = await updateWebPollDisplayStyle(poll.id, next);
      setPoll(updated);
      setDesignDraft(webPollDisplayStyle(updated));
      setDesignMsg('Design saved');
      await loadList();
      window.setTimeout(() => setDesignMsg(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save design');
    } finally {
      setDesignBusy(false);
    }
  };

  const toggleOnAir = async () => {
    if (!pollId || onAirBusy) return;
    setOnAirBusy(true);
    setError(null);
    try {
      const updated = await setWebPollOnAir(pollId, !onAir);
      setPoll(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update on-air');
    } finally {
      setOnAirBusy(false);
    }
  };

  const copySurface = async (kind: WebPollSurfaceKind, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSurface(kind);
      window.setTimeout(() => setCopiedSurface(null), 1600);
    } catch {
      /* ignore */
    }
  };

  const options = rollup?.results_snapshot?.options || poll?.options || [];
  const look = (designDraft || liveStyle)?.look;
  const totalVotes = Math.max(
    1,
    options.reduce((n, o) => n + Number(o.votes || o.vote_count || 0), 0)
  );
  const maxVotes = Math.max(1, ...options.map((o) => Number(o.votes || o.vote_count || 0)));
  const received = rollup?.received ?? poll?.received_count ?? 0;
  const counted = rollup?.counted ?? poll?.counted_count ?? 0;
  const pending = rollup?.pending_inbox ?? Math.max(0, received - counted);
  const token = poll?.public_token || '';

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
      <header className="border-b border-slate-800 bg-slate-900/95 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-violet-300/90 font-semibold">
              Web Polls · Broadcast control
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

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
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
            className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2.5 text-white focus:outline-none focus:border-violet-500"
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
          <p className="text-slate-500 text-sm">
            Pick a poll to drive surfaces, design, and animate on / off.
          </p>
        ) : loading && !poll ? (
          <p className="text-slate-400">Loading…</p>
        ) : poll ? (
          <>
            <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                    {poll.poll_type} · voting {poll.status}
                  </p>
                  <h2 className="text-lg font-semibold text-white mt-0.5">{poll.question}</h2>
                </div>
                <button
                  type="button"
                  disabled={onAirBusy}
                  onClick={() => void toggleOnAir()}
                  className={`min-w-[9.5rem] px-5 py-3 rounded-xl text-sm font-bold tracking-wide border transition-colors disabled:opacity-50 ${
                    onAir
                      ? 'bg-emerald-500 text-emerald-950 border-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.35)]'
                      : 'bg-slate-950 text-slate-200 border-slate-600 hover:border-slate-400'
                  }`}
                >
                  {onAirBusy ? '…' : onAir ? 'ON AIR · Off' : 'Animate ON'}
                </button>
              </div>

              <p className="text-xs text-slate-400">
                {onAir
                  ? 'Surfaces are animating in. Hit Off to fade them out.'
                  : 'Surfaces stay clear until you take them on air.'}{' '}
                Open / close voting is on Management.
              </p>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Received</p>
                  <p className="text-2xl font-semibold tabular-nums">{received}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Counted</p>
                  <p className="text-2xl font-semibold tabular-nums">{counted}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">Inbox</p>
                  <p className="text-2xl font-semibold tabular-nums text-amber-200">{pending}</p>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Surface links</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Drop these into OBS / vMix as browser sources (transparent). They follow On Air.
                </p>
              </div>
              <ul className="space-y-2">
                {SURFACES.map((s) => {
                  const url = token ? webPollSurfaceUrl(token, s.id) : '';
                  return (
                    <li
                      key={s.id}
                      className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{s.label}</p>
                        <p className="text-[11px] text-slate-500">{s.hint}</p>
                        <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{url}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={!url}
                          onClick={() => void copySurface(s.id, url)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
                        >
                          {copiedSurface === s.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedSurface === s.id ? 'Copied' : 'Copy'}
                        </button>
                        <a
                          href={url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-200 hover:bg-slate-800 ${
                            !url ? 'pointer-events-none opacity-40' : ''
                          }`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">Live rollup</h3>
              {options.length === 0 ? (
                <p className="text-slate-500 text-sm">No options.</p>
              ) : (
                <ul className="space-y-2">
                  {options.map((o) => {
                    const votes = Number(o.votes ?? o.vote_count ?? 0);
                    const barPct = Math.round((votes / maxVotes) * 100);
                    const sharePct = Math.round((votes / totalVotes) * 100);
                    const fill =
                      look?.accentBars === false ? '#94a3b8' : o.color || '#38bdf8';
                    const metric = [
                      look?.showPct !== false ? `${sharePct}%` : null,
                      look?.showCounts !== false ? String(votes) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={o.id}>
                        <div className="flex justify-between text-xs mb-1 gap-2">
                          <span className="text-slate-200 truncate">
                            {look?.showLabels === false ? '' : o.label}
                          </span>
                          <span className="tabular-nums text-slate-400 shrink-0">{metric}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${barPct}%`, background: fill }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {designDraft ? (
              <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">Design</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Layout, thickness, colors, and motion for Stage / Lower / PiP.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDesign((v) => !v)}
                      className="px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                    >
                      {showDesign ? 'Hide editor' : 'Edit design'}
                    </button>
                    <button
                      type="button"
                      disabled={designBusy || !showDesign}
                      onClick={() => void saveDesign()}
                      className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 font-semibold"
                    >
                      {designBusy ? 'Saving…' : 'Save design'}
                    </button>
                    {designMsg ? (
                      <span className="text-xs text-emerald-300">{designMsg}</span>
                    ) : null}
                  </div>
                </div>
                {showDesign ? (
                  <WebPollDesignEditor
                    pollType={poll.poll_type}
                    value={designDraft}
                    onChange={setDesignDraft}
                    question={poll.question}
                    previewOptions={options.map((o) => ({
                      id: o.id,
                      label: o.label,
                      color: o.color,
                      votes: Number(o.votes ?? o.vote_count ?? 0),
                    }))}
                  />
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
