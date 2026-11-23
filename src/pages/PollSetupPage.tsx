import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createWebPoll,
  listWebPolls,
  webPollAudienceUrl,
  type WebPoll,
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

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const [polls, setPolls] = useState<WebPoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
      setPolls(await listWebPolls(eventId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load polls');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOptionLabels(defaultOptions(pollType).map((o) => o.label));
  }, [pollType]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || busy) return;
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
      await createWebPoll(eventId, { question: q, pollType, options });
      setQuestion('');
      setOptionLabels(defaultOptions(pollType).map((o) => o.label));
      await load();
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

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-sky-300/90 font-semibold">
              Web Polls · Setup
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

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-6">
        {error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <form
          onSubmit={(e) => void onCreate(e)}
          className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-200">New poll</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Creates a draft. Open it from Control when you’re ready to take votes.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Question</label>
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
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Type</label>
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
                      onClick={() => setOptionLabels(optionLabels.filter((_, j) => j !== i))}
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
                    setOptionLabels([...optionLabels, `Option ${String.fromCharCode(65 + optionLabels.length)}`])
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

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">Polls for this event</h2>
          {loading ? (
            <p className="text-slate-400 text-sm">Loading…</p>
          ) : polls.length === 0 ? (
            <p className="text-slate-500 text-sm">No polls yet.</p>
          ) : (
            <ul className="space-y-2">
              {polls.map((poll) => {
                const audience = webPollAudienceUrl(poll.public_token);
                return (
                  <li
                    key={poll.id}
                    className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${statusTone(poll.status)}`}
                        >
                          {poll.status}
                        </span>
                        <span className="text-[11px] text-slate-500 uppercase">{poll.poll_type}</span>
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          {poll.received_count}/{poll.counted_count} recv/counted
                        </span>
                      </div>
                      <p className="font-medium text-white truncate">{poll.question}</p>
                      <p className="text-[11px] text-slate-500 font-mono truncate mt-0.5">{audience}</p>
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
                          navigate(`/polls-control?${qs}&pollId=${encodeURIComponent(poll.id)}`)
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
        </section>
      </main>
    </div>
  );
}
