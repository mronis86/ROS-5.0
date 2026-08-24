import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { acceptEventShare, previewEventShare, type EventSharePreview } from '../lib/eventShareAccess';

const JoinEventAccessPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [preview, setPreview] = useState<EventSharePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError('This invite link is missing a token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await previewEventShare(token);
      if (!data.ok || data.error) {
        setError(data.error || data.message || 'Invalid invite link.');
        setPreview(null);
      } else {
        setPreview(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invite.');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptEventShare(token);
      if (!result.ok) {
        setError(result.error || 'Could not add event.');
        return;
      }
      setAdded(result.status === 'added');
      setDoneMessage(result.message || 'Done.');
      setPreview((prev) =>
        prev
          ? {
              ...prev,
              canAdd: false,
              accessStatus: result.status === 'added' ? 'already' : prev.accessStatus,
              message: result.message || prev.message,
            }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add event.');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-[var(--app-header-height)]">
      <div className="mx-auto max-w-lg px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-slate-700 bg-slate-800/90 p-6 shadow-xl">
          <h1 className="text-xl font-bold text-white">Event access invite</h1>
          <p className="mt-2 text-sm text-slate-400">
            Someone shared an event with you. You can add it to the events you can see, or skip.
          </p>

          {loading ? (
            <p className="mt-6 text-slate-400 text-sm">Loading invite…</p>
          ) : error && !preview ? (
            <div className="mt-6 rounded-lg border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : preview ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-slate-600 bg-slate-900/60 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Event</p>
                <p className="mt-1 text-lg font-semibold text-white">{preview.event.name}</p>
                {preview.event.date ? (
                  <p className="mt-1 text-sm text-slate-400">{preview.event.date}</p>
                ) : null}
              </div>

              {error ? (
                <div className="rounded-lg border border-amber-700/50 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
                  {error}
                </div>
              ) : null}

              {doneMessage ? (
                <div
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    added
                      ? 'border-emerald-700/50 bg-emerald-900/30 text-emerald-200'
                      : 'border-slate-600 bg-slate-900/50 text-slate-300'
                  }`}
                >
                  {doneMessage}
                </div>
              ) : (
                <p className="text-sm text-slate-300">{preview.message}</p>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {preview.canAdd && !doneMessage ? (
                  <button
                    type="button"
                    onClick={() => void handleAdd()}
                    disabled={accepting}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {accepting ? 'Adding…' : 'Add this event'}
                  </button>
                ) : null}
                <Link
                  to="/"
                  className="rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
                >
                  {preview.canAdd && !doneMessage ? 'No thanks' : 'Back to Event List'}
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default JoinEventAccessPage;
