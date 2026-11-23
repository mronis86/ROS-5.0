import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchPublicEventPolls,
  submitPublicWebPollVote,
  type PublicEventPoll,
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

function VoteForm({
  poll,
  onDone,
}: {
  poll: PublicEventPoll;
  onDone: () => void;
}) {
  const [singleId, setSingleId] = useState<string | null>(null);
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [rankOrder, setRankOrder] = useState(() => (poll.options || []).map((o) => o.id));
  const [ratingScore, setRatingScore] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setRankOrder((poll.options || []).map((o) => o.id));
    setSingleId(null);
    setMultiIds([]);
    setRatingScore(null);
    setSent(false);
    setSubmitError(null);
  }, [poll.id]);

  const options = poll.options || [];
  const labelFor = (id: string) => options.find((o) => o.id === id)?.label || id;

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
    if (sending || sent) return;
    setSending(true);
    setSubmitError(null);
    try {
      let payload: Record<string, unknown>;
      const type = poll.poll_type as WebPollType;
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
      await submitPublicWebPollVote(poll.public_token, payload, getOrCreateVoterKey());
      setSent(true);
      onDone();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Vote failed');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 px-4 py-6 text-center text-emerald-100">
        Thanks — your vote was received.
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
      <h2 className="text-xl font-semibold">{poll.question}</h2>
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
              onClick={() =>
                setMultiIds((prev) =>
                  prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]
                )
              }
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
  );
}

export default function PollEventAudiencePage() {
  const { token = '' } = useParams<{ token: string }>();
  const safeToken = useMemo(() => decodeURIComponent(token || '').trim(), [token]);

  const [title, setTitle] = useState('Live poll');
  const [openPolls, setOpenPolls] = useState<PublicEventPoll[]>([]);
  const [activePoll, setActivePoll] = useState<PublicEventPoll | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (!safeToken) {
        if (initial) {
          setLoadError('Invalid poll link');
          setLoading(false);
        }
        return;
      }
      try {
        const data = await fetchPublicEventPolls(safeToken);
        if (cancelled) return;
        setTitle(data.session?.title || 'Live poll');
        setOpenPolls(data.open_polls || []);
        setActivePoll(data.active_poll || null);
        setLoadError(null);
        if (!pickedId && data.active_poll?.id) setPickedId(data.active_poll.id);
        else if (!pickedId && data.open_polls?.length === 1) setPickedId(data.open_polls[0].id);
      } catch (e) {
        if (!cancelled && initial) {
          setLoadError(e instanceof Error ? e.message : 'Could not open polls');
        }
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    void load(true);
    const id = window.setInterval(() => void load(false), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [safeToken, pickedId]);

  const selected =
    openPolls.find((p) => p.id === pickedId) ||
    activePoll ||
    (openPolls.length === 1 ? openPolls[0] : null);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300/80 font-semibold mb-2">
            Live poll
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-6">{title}</h1>

          {loading ? (
            <p className="text-slate-400">Loading…</p>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-700/40 bg-rose-950/40 px-4 py-3 text-rose-100">
              {loadError}
            </div>
          ) : openPolls.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-6 text-center text-slate-300">
              No poll is open right now. Stay on this page — it will update when one opens.
            </div>
          ) : (
            <div className="space-y-4">
              {openPolls.length > 1 ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400">Choose a poll</p>
                  {openPolls.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPickedId(p.id)}
                      className={`w-full text-left rounded-xl border px-4 py-3 ${
                        selected?.id === p.id
                          ? 'border-sky-500 bg-sky-950/40'
                          : 'border-slate-600 bg-slate-900/70 hover:border-slate-500'
                      }`}
                    >
                      {p.question}
                    </button>
                  ))}
                </div>
              ) : null}
              {selected ? <VoteForm poll={selected} onDone={() => undefined} /> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
