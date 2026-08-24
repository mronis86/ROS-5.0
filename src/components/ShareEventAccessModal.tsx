import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, RefreshCw, X } from 'lucide-react';
import { createEventShareLink } from '../lib/eventShareAccess';
import { createGuestEventLink } from '../lib/eventGuestLinks';

type ShareTab = 'teammate' | 'guest';

interface ShareEventAccessModalProps {
  open: boolean;
  event: { id: string; name: string } | null;
  onClose: () => void;
}

const ShareEventAccessModal: React.FC<ShareEventAccessModalProps> = ({ open, event, onClose }) => {
  const [tab, setTab] = useState<ShareTab>('teammate');
  const [loading, setLoading] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [guestUrl, setGuestUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const loadTeammate = useCallback(
    async (rotate = false) => {
      if (!event?.id) return;
      if (rotate) setRotating(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await createEventShareLink(event.id, { rotate });
        if (!result.ok || !result.shareUrl) {
          setError(result.error || 'Could not create share link.');
          setShareUrl('');
          return;
        }
        setShareUrl(result.shareUrl);
        setCopied(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create share link.');
        setShareUrl('');
      } finally {
        setLoading(false);
        setRotating(false);
      }
    },
    [event?.id]
  );

  const loadGuest = useCallback(
    async (rotate = false) => {
      if (!event?.id) return;
      if (rotate) setRotating(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await createGuestEventLink(event.id, { rotate });
        if (!result.ok || !result.guestUrl) {
          setError(result.error || 'Could not create guest link.');
          setGuestUrl('');
          return;
        }
        setGuestUrl(result.guestUrl);
        setCopied(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create guest link.');
        setGuestUrl('');
      } finally {
        setLoading(false);
        setRotating(false);
      }
    },
    [event?.id]
  );

  useEffect(() => {
    if (!open || !event?.id) return;
    setError(null);
    setCopied(false);
    setTab('teammate');
    setShareUrl('');
    setGuestUrl('');
    void loadTeammate(false);
  }, [open, event?.id, loadTeammate]);

  useEffect(() => {
    if (!open || !event?.id) return;
    if (tab === 'guest' && !guestUrl && !loading) {
      void loadGuest(false);
    }
  }, [tab, open, event?.id, guestUrl, loading, loadGuest]);

  const activeUrl = tab === 'teammate' ? shareUrl : guestUrl;

  const copyLink = async () => {
    if (!activeUrl) return;
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the link and copy manually.');
    }
  };

  const refreshLink = () => {
    if (tab === 'teammate') void loadTeammate(true);
    else void loadGuest(true);
  };

  if (!open || !event) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60">
      <div
        className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-800 shadow-2xl"
        role="dialog"
        aria-labelledby="share-event-access-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div className="min-w-0">
            <h3 id="share-event-access-title" className="text-lg font-semibold text-white flex items-center gap-2">
              <Link2 className="h-5 w-5 text-violet-300 shrink-0" />
              Share event
            </h3>
            <p className="mt-1 text-sm text-slate-400 truncate">{event.name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pt-3">
          <div className="flex rounded-lg bg-slate-900/70 p-0.5 border border-slate-700">
            <button
              type="button"
              onClick={() => {
                setTab('teammate');
                setCopied(false);
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${
                tab === 'teammate' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Teammate access
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('guest');
                setCopied(false);
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold ${
                tab === 'guest' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Guest view
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-slate-300">
            {tab === 'teammate'
              ? 'For people already in the system. They can choose to add this event to their Event List.'
              : 'For clients or anyone without an account. Opens a read-only schedule — no sign-in.'}
          </p>

          {error ? (
            <div className="rounded-lg border border-amber-700/50 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
              {error}
            </div>
          ) : null}

          {loading && !activeUrl ? (
            <p className="text-sm text-slate-400">Creating link…</p>
          ) : activeUrl ? (
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={activeUrl}
                className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs text-slate-200 font-mono"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={() => void copyLink()}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white shrink-0 ${
                  tab === 'guest' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-violet-600 hover:bg-violet-500'
                }`}
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 px-5 py-3">
          <button
            type="button"
            onClick={refreshLink}
            disabled={loading || rotating || !activeUrl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
            title="Creates a new link and stops the old one from working"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rotating ? 'animate-spin' : ''}`} />
            {rotating ? 'Refreshing…' : 'New link'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-600 px-3 py-1.5 text-sm text-white hover:bg-slate-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareEventAccessModal;
