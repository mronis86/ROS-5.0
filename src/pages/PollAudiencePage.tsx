import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchPublicWebPoll,
  submitPublicWebPollVote,
  type WebPollOption,
  type WebPollType,
} from '../lib/webPolls';

const VOTER_KEY_STORAGE = 'ros_web_poll_voter_key';

function getOrCreateVoterKey() {
  try {
    const existing = localStorage.getItem(VOTER_KEY_STORAGE);
    if (existing) return existing;
    const key =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `v_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(VOTER_KEY_STORAGE, key);
    return key;
  } catch {
    return `v_${Date.now()}`;
  }
}

type PublicPoll = {
  id: string;
  question: string;
  poll_type: WebPollType;
  status: string;
  options: WebPollOption[];
};

export default function PollAudiencePage() {
  const { token = '' } = useParams<{ token: string }>();
  const safeToken = useMemo(() => decodeURIComponent(token || '').trim(), [token]);

  const [poll, setPoll] = useState<PublicPoll | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const [singleId, setSingleId] = useState<string | null>(null);
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [ratingScore, setRatingScore] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!safeToken) {
        setLoadError('Invalid poll link');
        setLoading(false);
        return;
      }
      try {
        const data = await fetchPublicWebPoll(safeToken);
        if (cancelled) return;
        const p = data.poll as PublicPoll;
        setPoll(p);
        setRankOrder((p.options || []).map((o) => o.id));
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not open poll');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [safeToken]);

  const toggleMulti = (id: string) => {
    setMultiIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const moveRank = (index: number, dir: -1 | 1) => {
    setRankOrder((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!safeToken || !poll || sending || sent) return;
    setSending(true);
    setSubmitError(null);
    try {
      let payload: Record<string, unknown>;
      const type = poll.poll_type;
      if (type === 'single' || type === 'yesno') {
        if (!singleId) throw new Error('Pick an option');
        payload = { optionId: singleId };
      } else if (type === 'multi') {
        if (!multiIds.length) throw new Error('Pick at least one option');
        payload = { optionIds: multiIds };
      } else if (type === 'rating') {
        if (!ratingScore) throw new Error('Pick a rating');
        payload = { score: ratingScore };
      } else if (type === 'ranked') {
        payload = { order: rankOrder };
      } else {
        throw new Error('Unsupported poll type');
      }
      await submitPublicWebPollVote(safeToken, payload, getOrCreateVoterKey());
      setSent(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Vote failed');
    } finally {
      setSending(false);
    }
  };

  const isOpen = poll?.status === 'open';
  const options = poll?.options || [];
  const labelFor = (id: string) => options.find((o) => o.id === id)?.label || id;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300/80 font-semibold mb-2">
            Live poll
          </p>
          {loading ? (
            <p className="text-slate-400">Loading…</p>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-700/40 bg-rose-950/40 px-4 py-3 text-rose-100">
              {loadError}
            </div>
          ) : poll ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight mb-6">{poll.question}</h1>
              {!isOpen ? (
                <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-6 text-center text-slate-300">
                  {poll.status === 'draft'
                    ? 'This poll is not open yet.'
                    : 'Voting is closed for this poll.'}
                </div>
              ) : sent ? (
                <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 px-4 py-6 text-center text-emerald-100">
                  Thanks — your vote was received.
                </div>
              ) : (
                <form
                  onSubmit={(e) => void onSubmit(e)}
                  className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-5"
                >
                  {submitError ? (
                    <div className="rounded-lg border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
                      {submitError}
                    </div>
                  ) : null}

                  {(poll.poll_type === 'single' || poll.poll_type === 'yesno') &&
                    options.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSingleId(o.id)}
                        className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                          singleId === o.id
                            ? 'border-sky-500 bg-sky-950/40 text-white'
                            : 'border-slate-600 bg-slate-950/60 text-slate-200 hover:border-slate-500'
                        }`}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-2.5"
                          style={{ background: o.color || '#38bdf8' }}
                        />
                        {o.label}
                      </button>
                    ))}

                  {poll.poll_type === 'multi' &&
                    options.map((o) => {
                      const on = multiIds.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => toggleMulti(o.id)}
                          className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                            on
                              ? 'border-sky-500 bg-sky-950/40 text-white'
                              : 'border-slate-600 bg-slate-950/60 text-slate-200 hover:border-slate-500'
                          }`}
                        >
                          <span className="mr-2 tabular-nums text-slate-500">{on ? '✓' : '○'}</span>
                          {o.label}
                        </button>
                      );
                    })}

                  {poll.poll_type === 'rating' && (
                    <div className="flex flex-wrap gap-2 justify-center">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRatingScore(n)}
                          className={`w-12 h-12 rounded-xl border text-lg font-semibold tabular-nums ${
                            ratingScore === n
                              ? 'border-sky-500 bg-sky-950/50 text-sky-100'
                              : 'border-slate-600 bg-slate-950 text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}

                  {poll.poll_type === 'ranked' && (
                    <ul className="space-y-2">
                      {rankOrder.map((id, i) => (
                        <li
                          key={id}
                          className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-950/60 px-3 py-2"
                        >
                          <span className="text-xs text-slate-500 w-5 tabular-nums">{i + 1}</span>
                          <span className="flex-1 text-slate-100">{labelFor(id)}</span>
                          <button
                            type="button"
                            onClick={() => moveRank(i, -1)}
                            disabled={i === 0}
                            className="px-2 py-1 text-xs rounded border border-slate-600 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRank(i, 1)}
                            disabled={i === rankOrder.length - 1}
                            className="px-2 py-1 text-xs rounded border border-slate-600 disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <button
                    type="submit"
                    disabled={sending}
                    className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-3 font-semibold text-white"
                  >
                    {sending ? 'Sending…' : 'Submit vote'}
                  </button>
                </form>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
