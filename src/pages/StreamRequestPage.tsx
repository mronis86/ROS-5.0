import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchStreamRequestForm,
  submitStreamRequestForm,
  type StreamRequestFormPayload,
} from '../lib/streamRequestLinks';
import {
  STREAM_YOUTUBE_CHANNEL_OPTIONS,
  STREAM_VISIBILITY_OPTIONS,
} from '../types/Event';

const StreamRequestPage: React.FC = () => {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [payload, setPayload] = useState<StreamRequestFormPayload | null>(null);

  const [youtubeChannel, setYoutubeChannel] = useState('');
  const [youtubeChannelOther, setYoutubeChannelOther] = useState('');
  const [visibility, setVisibility] = useState('');
  const [shareWith, setShareWith] = useState('');
  const [requestContactName, setRequestContactName] = useState('');
  const [requestContactEmail, setRequestContactEmail] = useState('');

  const channels = useMemo(
    () => payload?.options?.youtubeChannels || [...STREAM_YOUTUBE_CHANNEL_OPTIONS],
    [payload]
  );
  const visibilities = useMemo(
    () => payload?.options?.visibilities || [...STREAM_VISIBILITY_OPTIONS],
    [payload]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError('This Stream Request link is missing a token.');
        setLoading(false);
        return;
      }
      setLoading(true);
      const data = await fetchStreamRequestForm(token);
      if (cancelled) return;
      if (!data.ok) {
        setError(data.error || 'Could not load this form.');
        setLoading(false);
        return;
      }
      setPayload(data);
      const ex = data.existing || {};
      setYoutubeChannel(ex.youtubeChannel || '');
      setYoutubeChannelOther(ex.youtubeChannelOther || '');
      setVisibility(ex.visibility || '');
      setShareWith(ex.shareWith || '');
      setRequestContactName(ex.requestContactName || '');
      setRequestContactEmail(ex.requestContactEmail || '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await submitStreamRequestForm(token, {
      youtubeChannel,
      youtubeChannelOther,
      visibility,
      shareWith,
      requestContactName,
      requestContactEmail,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error || 'Submit failed');
      return;
    }
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wider text-emerald-400/90 font-semibold">
            Stream Request
          </p>
          <h1 className="text-2xl font-bold text-white mt-1">
            {payload?.event?.name || 'Event stream setup'}
          </h1>
          {payload?.event?.date ? (
            <p className="text-sm text-slate-400 mt-1">
              {payload.event.date}
              {payload.event.location ? ` · ${payload.event.location}` : ''}
            </p>
          ) : null}
        </header>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading form…</p>
        ) : done ? (
          <div className="rounded-xl border border-emerald-600/50 bg-emerald-950/40 p-5 space-y-2">
            <p className="text-lg font-semibold text-emerald-100">Thanks — request received</p>
            <p className="text-sm text-slate-300">
              Your answers were saved to this event&apos;s stream details. The production team can
              view them from the event edit screen.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => void onSubmit(e)}
            className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4"
          >
            {payload?.alreadySubmitted ? (
              <p className="text-xs text-amber-200/90 bg-amber-950/40 border border-amber-700/40 rounded-lg px-3 py-2">
                A request was already submitted for this event. Submitting again will update it.
              </p>
            ) : null}

            {error ? (
              <p className="text-sm text-red-300 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">
                {error}
              </p>
            ) : null}

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">
                YouTube channel for this player
              </label>
              <select
                required
                value={youtubeChannel}
                onChange={(e) => setYoutubeChannel(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
              >
                <option value="">Select channel…</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {youtubeChannel === 'Other' ? (
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Other channel name
                </label>
                <input
                  required
                  value={youtubeChannelOther}
                  onChange={(e) => setYoutubeChannelOther(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
                  placeholder="Channel name"
                />
              </div>
            ) : null}

            <div>
              <p className="block text-sm font-medium text-slate-200 mb-2">Video visibility</p>
              <div className="flex gap-3">
                {visibilities.map((v) => (
                  <label
                    key={v}
                    className={`flex-1 cursor-pointer rounded-lg border px-3 py-2.5 text-sm text-center ${
                      visibility === v
                        ? 'border-emerald-500 bg-emerald-950/50 text-white'
                        : 'border-slate-600 bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      className="sr-only"
                      checked={visibility === v}
                      onChange={() => setVisibility(v)}
                      required
                    />
                    {v}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-1">
                Who should we share the player link with?
              </label>
              <p className="text-xs text-slate-500 mb-1.5">
                For Swoogo embedding or direct link posting — name, email, or team.
              </p>
              <textarea
                required
                rows={3}
                value={shareWith}
                onChange={(e) => setShareWith(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
                placeholder="e.g. Jane Doe — jane@… (Swoogo) / post on event page"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Your name <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  value={requestContactName}
                  onChange={(e) => setRequestContactName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-1">
                  Your email <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  type="email"
                  value={requestContactEmail}
                  onChange={(e) => setRequestContactEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold py-2.5 text-sm"
            >
              {submitting ? 'Submitting…' : 'Submit stream request'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default StreamRequestPage;
