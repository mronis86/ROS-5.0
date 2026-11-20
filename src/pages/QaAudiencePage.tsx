import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchPublicWebQa,
  submitPublicWebQa,
  WEB_QA_MAX_BODY_CHARS,
  type PublicWebQaSession,
} from '../lib/webQa';

export default function QaAudiencePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [title, setTitle] = useState('Live Q&A');
  const [isOpen, setIsOpen] = useState(true);
  const [atSoftLimit, setAtSoftLimit] = useState(false);
  const [currentCue, setCurrentCue] = useState<PublicWebQaSession['current_cue']>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentOverflow, setSentOverflow] = useState(false);

  const safeToken = useMemo(() => decodeURIComponent(token || '').trim(), [token]);

  useEffect(() => {
    let cancelled = false;
    const apply = (data: PublicWebQaSession) => {
      setTitle(data.title || 'Live Q&A');
      setIsOpen(data.is_open === true);
      setAtSoftLimit(data.at_soft_limit === true);
      setCurrentCue(data.current_cue || null);
      setLoadError(null);
    };

    const load = async (initial: boolean) => {
      if (!safeToken) {
        if (initial) {
          setLoadError('Invalid Q&A link');
          setLoading(false);
        }
        return;
      }
      try {
        const data = await fetchPublicWebQa(safeToken);
        if (cancelled) return;
        apply(data);
      } catch (e) {
        if (!cancelled && initial) {
          setLoadError(e instanceof Error ? e.message : 'Could not open Q&A');
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
  }, [safeToken]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!safeToken || sending) return;
    const text = body.trim();
    if (!text) return;
    if (atSoftLimit && !email.trim()) {
      setSubmitError('Email is required so we can follow up if we can answer later.');
      return;
    }
    setSending(true);
    setSubmitError(null);
    try {
      const result = await submitPublicWebQa(safeToken, {
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
      // Refresh limit state after submit
      try {
        const data = await fetchPublicWebQa(safeToken);
        setAtSoftLimit(data.at_soft_limit === true);
        setIsOpen(data.is_open === true);
        setCurrentCue(data.current_cue || null);
      } catch {
        /* keep last known */
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSending(false);
    }
  };

  const segmentLabel = (currentCue?.segment_name || '').trim();
  const cueLabel = (currentCue?.cue || '').trim();

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.2em] text-fuchsia-300/80 font-semibold mb-2">
            Audience
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-1">{title}</h1>
          {segmentLabel || cueLabel ? (
            <div className="mb-4 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2.5">
              {segmentLabel ? (
                <p className="text-base font-semibold text-white leading-snug">{segmentLabel}</p>
              ) : null}
              <p className="text-xs text-slate-400 mt-0.5">
                {cueLabel ? (
                  <span className="tabular-nums">{cueLabel}</span>
                ) : (
                  <span>Current segment</span>
                )}
                <span className="mx-1.5 text-slate-600">·</span>
                Questions go to this Q&A
              </p>
            </div>
          ) : null}
          <p className="text-slate-400 text-sm mb-6">
            {atSoftLimit && isOpen
              ? 'Live moderation is full. Leave your question and email — we may follow up later if we can answer.'
              : 'Ask a question for the room. Moderators review before it goes live.'}
          </p>

          {loading ? (
            <p className="text-slate-400">Loading…</p>
          ) : loadError ? (
            <div className="rounded-xl border border-rose-700/40 bg-rose-950/40 px-4 py-3 text-rose-100">
              {loadError}
            </div>
          ) : !isOpen ? (
            <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-6 text-center text-slate-300">
              Q&A submissions are closed right now.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
              {atSoftLimit ? (
                <div className="rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
                  We’ve hit the live question cap for this session. Your question is still saved.
                  Add an email if you’d like a follow-up later.
                </div>
              ) : null}
              {submitError ? (
                <div className="rounded-lg border border-rose-700/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">
                  {submitError}
                </div>
              ) : null}
              {sent ? (
                <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100">
                  Sent — thanks. A moderator will review it.
                </div>
              ) : null}
              {sentOverflow ? (
                <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-100">
                  Saved — thanks. If we can answer later, we’ll use the email you provided.
                </div>
              ) : null}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                  Your name <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="Name or org"
                  className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-fuchsia-500"
                />
              </div>
              {atSoftLimit ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Email <span className="font-normal text-amber-300/90">(required for follow-up)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    maxLength={160}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-fuchsia-500"
                  />
                </div>
              ) : null}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Question</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, WEB_QA_MAX_BODY_CHARS))}
                  required
                  maxLength={WEB_QA_MAX_BODY_CHARS}
                  rows={4}
                  placeholder="Keep it short — one clear question…"
                  className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-fuchsia-500 resize-y"
                />
                <p
                  className={`mt-1 text-[11px] text-right tabular-nums ${
                    body.length >= WEB_QA_MAX_BODY_CHARS ? 'text-amber-300' : 'text-slate-500'
                  }`}
                >
                  {body.length}/{WEB_QA_MAX_BODY_CHARS}
                </p>
              </div>
              <button
                type="submit"
                disabled={sending || !body.trim() || (atSoftLimit && !email.trim())}
                className="w-full rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 disabled:hover:bg-fuchsia-600 py-3 font-semibold text-white"
              >
                {sending
                  ? 'Sending…'
                  : atSoftLimit
                    ? 'Submit for later follow-up'
                    : 'Submit question'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
