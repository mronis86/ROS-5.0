import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicWebQa, submitPublicWebQa } from '../lib/webQa';

export default function QaAudiencePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [title, setTitle] = useState('Live Q&A');
  const [isOpen, setIsOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const safeToken = useMemo(() => decodeURIComponent(token || '').trim(), [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!safeToken) {
        setLoadError('Invalid Q&A link');
        setLoading(false);
        return;
      }
      try {
        const data = await fetchPublicWebQa(safeToken);
        if (cancelled) return;
        setTitle(data.title || 'Live Q&A');
        setIsOpen(data.is_open === true);
        setLoadError(null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not open Q&A');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeToken]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!safeToken || sending) return;
    const text = body.trim();
    if (!text) return;
    setSending(true);
    setSubmitError(null);
    try {
      await submitPublicWebQa(safeToken, {
        body: text,
        author_name: name.trim() || undefined,
      });
      setBody('');
      setSent(true);
      window.setTimeout(() => setSent(false), 2500);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.2em] text-fuchsia-300/80 font-semibold mb-2">
            Audience
          </p>
          <h1 className="text-3xl font-bold tracking-tight mb-1">{title}</h1>
          <p className="text-slate-400 text-sm mb-6">
            Ask a question for the room. Moderators review before it goes live.
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
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Question</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                  maxLength={2000}
                  rows={5}
                  placeholder="Type your question…"
                  className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-fuchsia-500 resize-y"
                />
                <p className="mt-1 text-[11px] text-slate-500 text-right">{body.length}/2000</p>
              </div>
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="w-full rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 disabled:hover:bg-fuchsia-600 py-3 font-semibold text-white"
              >
                {sending ? 'Sending…' : 'Submit question'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
