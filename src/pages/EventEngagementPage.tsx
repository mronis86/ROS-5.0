import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchPublicEngagement,
  type PublicEngagement,
} from '../lib/webEngagement';
import {
  submitPublicWebPollVote,
  type PublicEventPoll,
  type WebPollType,
} from '../lib/webPolls';
import {
  submitPublicWebQa,
  WEB_QA_MAX_BODY_CHARS,
} from '../lib/webQa';

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

function VoteForm({ poll, onDone }: { poll: PublicEventPoll; onDone: () => void }) {
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
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-5"
    >
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
            className={`w-full text-left rounded-xl border px-4 py-3 ${
              singleId === o.id
                ? 'border-sky-500 bg-sky-950/40'
                : 'border-slate-600 bg-slate-950/60 hover:border-slate-500'
            }`}
          >
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
                  on ? prev.filter((id) => id !== o.id) : [...prev, o.id]
                )
              }
              className={`w-full text-left rounded-xl border px-4 py-3 ${
                on
                  ? 'border-sky-500 bg-sky-950/40'
                  : 'border-slate-600 bg-slate-950/60 hover:border-slate-500'
              }`}
            >
              {o.label}
            </button>
          );
        })}

      {poll.poll_type === 'rating' && (
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRatingScore(n)}
              className={`min-w-[3rem] rounded-xl border px-3 py-3 font-semibold ${
                ratingScore === n
                  ? 'border-sky-500 bg-sky-950/40'
                  : 'border-slate-600 bg-slate-950/60'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {poll.poll_type === 'ranked' && (
        <ul className="space-y-2">
          {rankOrder.map((id, index) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-950/60 px-3 py-2"
            >
              <span className="text-xs text-slate-500 w-5">{index + 1}</span>
              <span className="flex-1 text-sm">{labelFor(id)}</span>
              <button
                type="button"
                className="px-2 py-1 text-xs rounded border border-slate-600"
                onClick={() => moveRank(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="px-2 py-1 text-xs rounded border border-slate-600"
                onClick={() => moveRank(index, 1)}
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

function QaForm({
  token,
  atSoftLimit,
  isOpen,
}: {
  token: string;
  atSoftLimit: boolean;
  isOpen: boolean;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentOverflow, setSentOverflow] = useState(false);

  if (!isOpen) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-6 text-center text-slate-300">
        Q&A is not open on this cue right now.
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const text = body.trim();
    if (!text) return;
    if (atSoftLimit && !email.trim()) {
      setSubmitError('Email is required so we can follow up if we can answer later.');
      return;
    }
    setSending(true);
    setSubmitError(null);
    try {
      const result = await submitPublicWebQa(token, {
        body: text,
        author_name: name.trim() || undefined,
        author_email: atSoftLimit ? email.trim() : email.trim() || undefined,
      });
      setBody('');
      if (result.is_overflow || atSoftLimit) {
        setEmail('');
        setSentOverflow(true);
        setSent(false);
      } else {
        setSent(true);
        setSentOverflow(false);
      }
      window.setTimeout(() => {
        setSent(false);
        setSentOverflow(false);
      }, 4000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not submit');
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-5"
    >
      <h2 className="text-xl font-semibold">Ask a question</h2>
      {sent ? (
        <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100">
          Thanks — your question was received.
        </div>
      ) : null}
      {sentOverflow ? (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          Queue is full — we saved your question for follow-up.
        </div>
      ) : null}
      {submitError ? (
        <div className="rounded-lg border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
          {submitError}
        </div>
      ) : null}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (optional)"
        className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={atSoftLimit ? 'Email (required)' : 'Email (optional)'}
        type="email"
        className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, WEB_QA_MAX_BODY_CHARS))}
        rows={4}
        required
        placeholder="Your question"
        className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white resize-y"
      />
      <button
        type="submit"
        disabled={sending || !body.trim()}
        className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 py-3 font-semibold text-white"
      >
        {sending ? 'Sending…' : 'Submit question'}
      </button>
    </form>
  );
}

type TabId = 'qa' | 'poll';

export default function EventEngagementPage() {
  const { token = '' } = useParams<{ token: string }>();
  const safeToken = useMemo(() => decodeURIComponent(token || '').trim(), [token]);

  const [data, setData] = useState<PublicEngagement | null>(null);
  const [tab, setTab] = useState<TabId>('poll');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (initial: boolean) => {
      if (!safeToken) {
        if (initial) {
          setLoadError('Invalid link');
          setLoading(false);
        }
        return;
      }
      try {
        const next = await fetchPublicEngagement(safeToken);
        if (cancelled) return;
        setData(next);
        setLoadError(null);
        if (initial || !next.show_qa || !next.show_poll) {
          if (next.default_tab === 'qa' || next.default_tab === 'poll') {
            setTab(next.default_tab);
          }
        }
        const open = next.poll?.open_polls || [];
        const active = next.poll?.active_poll;
        if (!pickedId && active?.id) setPickedId(active.id);
        else if (!pickedId && open.length === 1) setPickedId(open[0].id);
      } catch (e) {
        if (!cancelled && initial) {
          setLoadError(e instanceof Error ? e.message : 'Could not open page');
        }
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    void load(true);
    const id = window.setInterval(() => void load(false), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [safeToken, pickedId]);

  const openPolls = data?.poll?.open_polls || [];
  const selected =
    openPolls.find((p) => p.id === pickedId) ||
    data?.poll?.active_poll ||
    (openPolls.length === 1 ? openPolls[0] : null);

  const showBoth = Boolean(data?.show_qa && data?.show_poll);
  const activeTab: TabId =
    showBoth ? tab : data?.show_poll ? 'poll' : data?.show_qa ? 'qa' : 'poll';

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300/80 font-semibold mb-2">
            Live engagement
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-6">
            {data?.title || 'Event'}
          </h1>

          {loading ? (
            <p className="text-slate-400">Loading…</p>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-700/40 bg-rose-950/40 px-4 py-3 text-rose-100">
              {loadError}
            </div>
          ) : !data?.show_qa && !data?.show_poll ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-6 text-center text-slate-300">
              Nothing is open right now. Stay on this page — it updates when Q&A or a poll goes
              live for the current cue.
            </div>
          ) : (
            <div className="space-y-4">
              {showBoth ? (
                <div className="flex gap-2 p-1 rounded-xl bg-slate-900 border border-slate-700">
                  <button
                    type="button"
                    onClick={() => setTab('qa')}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${
                      activeTab === 'qa'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    Q&A
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('poll')}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${
                      activeTab === 'poll'
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    Poll
                  </button>
                </div>
              ) : null}

              {activeTab === 'qa' && data.qa ? (
                <QaForm
                  token={data.qa.public_token}
                  atSoftLimit={data.qa.at_soft_limit}
                  isOpen={data.qa.is_open}
                />
              ) : null}

              {activeTab === 'poll' && data.show_poll ? (
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
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
