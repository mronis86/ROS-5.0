import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  type AccessEventAccessUser,
  type EventVisibilityMode,
  eventIdsForVisibility,
  loadEventAccessForUser,
  validateRestrictedSelection,
} from '../lib/accessEventAccess';

export type AccessEventAccessModalMode = 'approve' | 'edit';

export interface ApproveAccessResult {
  portalUrl?: string;
  request?: { full_name?: string; is_admin?: boolean };
}

interface AccessEventAccessModalProps {
  open: boolean;
  mode: AccessEventAccessModalMode;
  user: AccessEventAccessUser | null;
  makeAdmin?: boolean;
  fetchFn: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onApproved?: (result: ApproveAccessResult) => void;
  onSaved?: () => void;
}

export default function AccessEventAccessModal({
  open,
  mode,
  user,
  makeAdmin = false,
  fetchFn,
  onClose,
  onApproved,
  onSaved,
}: AccessEventAccessModalProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; name: string; date: string }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [visibilityMode, setVisibilityMode] = useState<EventVisibilityMode>('all');

  const skipRestrictions = makeAdmin || user?.is_admin === true;

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch('');
    void (async () => {
      const data = await loadEventAccessForUser(fetchFn, user.id);
      if (cancelled) return;
      if (data.error) {
        setError(data.error);
        setEvents([]);
        setSelected(new Set());
        setVisibilityMode('all');
      } else {
        setEvents(data.events);
        const ids = new Set(data.event_ids);
        setSelected(ids);
        setVisibilityMode(ids.size > 0 ? 'restricted' : 'all');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, fetchFn]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (event) =>
        event.name.toLowerCase().includes(q) ||
        event.id.toLowerCase().includes(q) ||
        event.date.includes(q)
    );
  }, [events, search]);

  const toggleSelection = useCallback((eventId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    setError(null);

    if (!skipRestrictions) {
      const validationError = validateRestrictedSelection(visibilityMode, selected);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setSubmitting(true);
    try {
      const event_ids = skipRestrictions ? [] : eventIdsForVisibility(visibilityMode, selected);

      if (mode === 'approve') {
        const res = await fetchFn(`/api/admin/access-requests/${user.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            make_admin: makeAdmin,
            ...(event_ids !== null ? { event_ids } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          portalUrl?: string;
          request?: { full_name?: string; is_admin?: boolean };
        };
        if (!res.ok) {
          setError(data.error || `HTTP ${res.status}`);
          return;
        }
        onApproved?.({
          portalUrl: data.portalUrl,
          request: data.request,
        });
        onClose();
        return;
      }

      const res = await fetchFn(`/api/admin/access-requests/${user.id}/event-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_ids: event_ids ?? [] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }, [
    user,
    skipRestrictions,
    visibilityMode,
    selected,
    mode,
    fetchFn,
    makeAdmin,
    onApproved,
    onClose,
    onSaved,
  ]);

  if (!open || !user) return null;

  const title = mode === 'approve' ? 'Approve user' : 'Event access';
  const submitLabel =
    mode === 'approve'
      ? makeAdmin
        ? 'Approve as administrator'
        : 'Approve user'
      : submitting
        ? 'Saving…'
        : 'Save';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60">
      <div
        className="w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-h-[90vh] flex flex-col"
        role="dialog"
        aria-labelledby="access-event-access-title"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-700 shrink-0">
          <div>
            <h3 id="access-event-access-title" className="text-lg font-semibold text-white">
              {title}
            </h3>
            <p className="text-slate-400 text-sm mt-1">
              {user.full_name || user.email}
              {skipRestrictions && (
                <span className="text-slate-500"> — administrators always see all events</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
              {error}
            </div>
          )}

          {mode === 'approve' && !skipRestrictions && (
            <p className="text-slate-400 text-sm">
              Choose calendar visibility before approving. You can change this later from the user&apos;s
              Events action.
            </p>
          )}

          {!skipRestrictions && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-300">Calendar visibility</legend>
                <label className="flex items-start gap-3 rounded-lg border border-slate-700/80 px-3 py-2.5 cursor-pointer hover:bg-slate-900/40">
                  <input
                    type="radio"
                    name="event-visibility-mode"
                    checked={visibilityMode === 'all'}
                    onChange={() => setVisibilityMode('all')}
                    className="mt-1 border-slate-500 bg-slate-900 text-violet-500 focus:ring-violet-500"
                  />
                  <span>
                    <span className="block text-white text-sm font-medium">All events</span>
                    <span className="block text-slate-500 text-xs">User can see every event on the calendar.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-slate-700/80 px-3 py-2.5 cursor-pointer hover:bg-slate-900/40">
                  <input
                    type="radio"
                    name="event-visibility-mode"
                    checked={visibilityMode === 'restricted'}
                    onChange={() => setVisibilityMode('restricted')}
                    className="mt-1 border-slate-500 bg-slate-900 text-violet-500 focus:ring-violet-500"
                  />
                  <span>
                    <span className="block text-white text-sm font-medium">Only selected events</span>
                    <span className="block text-slate-500 text-xs">
                      User only sees the events you check below.
                    </span>
                  </span>
                </label>
              </fieldset>

              {visibilityMode === 'restricted' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search events…"
                      className="flex-1 min-w-[12rem] px-3 py-2 bg-slate-900/60 border border-slate-600 rounded-lg text-sm text-white placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(events.map((e) => e.id)))}
                      disabled={loading || events.length === 0}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      disabled={loading}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs rounded-lg"
                    >
                      Clear selection
                    </button>
                  </div>
                  {loading ? (
                    <p className="text-slate-400 text-sm">Loading events…</p>
                  ) : filteredEvents.length === 0 ? (
                    <p className="text-slate-400 text-sm">No events match your search.</p>
                  ) : (
                    <ul className="divide-y divide-slate-700/60 border border-slate-700/80 rounded-lg max-h-80 overflow-y-auto">
                      {filteredEvents.map((event) => (
                        <li key={event.id}>
                          <label className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-900/40 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected.has(event.id)}
                              onChange={() => toggleSelection(event.id)}
                              className="mt-1 rounded border-slate-500 bg-slate-900 text-violet-500 focus:ring-violet-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-white text-sm font-medium truncate">{event.name}</span>
                              <span className="block text-slate-500 text-xs">
                                {event.date || 'No date'} · <code className="text-slate-400">{event.id}</code>
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-slate-500">
                    {selected.size === 0
                      ? 'Select at least one event.'
                      : `${selected.size} event${selected.size === 1 ? '' : 's'} selected.`}
                  </p>
                </>
              )}
            </>
          )}

          {skipRestrictions && (
            <p className="text-slate-400 text-sm">
              {mode === 'approve'
                ? 'This user will be approved with full access to all events on the calendar.'
                : 'Administrators always have access to all events. No restrictions apply.'}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded-lg"
          >
            {mode === 'edit' && skipRestrictions ? 'Close' : 'Cancel'}
          </button>
          {!(mode === 'edit' && skipRestrictions) && (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || loading}
              className={`px-4 py-2 disabled:opacity-50 text-white text-sm font-medium rounded-lg ${
                mode === 'approve'
                  ? makeAdmin
                    ? 'bg-blue-600 hover:bg-blue-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-violet-600 hover:bg-violet-500'
              }`}
            >
              {submitting ? (mode === 'approve' ? 'Approving…' : 'Saving…') : submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
