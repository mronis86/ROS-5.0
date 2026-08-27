import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  type AccessEventAccessUser,
  type AccessEventCalendarRow,
  type AccessEventListTab,
  type EventVisibilityMode,
  countEventsByAccessTab,
  eventIdsForVisibility,
  filterEventsForAccessTab,
  loadEventAccessForUser,
  validateRestrictedSelection,
} from '../lib/accessEventAccess';
import {
  PLATFORM_ROLE_OPTIONS,
  type PlatformRoleId,
  platformRoleLabel,
} from '../lib/platformRoles';

export type AccessEventAccessModalMode = 'approve' | 'edit';

export interface ApproveAccessResult {
  portalUrl?: string;
  request?: { full_name?: string; is_admin?: boolean };
  role?: PlatformRoleId;
}

interface AccessEventAccessModalProps {
  open: boolean;
  mode: AccessEventAccessModalMode;
  user: AccessEventAccessUser | null;
  makeAdmin?: boolean;
  /** When false, role stays User (Access Manager approve). Default true for Admin. */
  allowRoleSelect?: boolean;
  fetchFn: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onApproved?: (result: ApproveAccessResult) => void;
  onSaved?: () => void;
}

const EVENT_TABS: Array<{ id: AccessEventListTab; label: string; activeClass: string }> = [
  { id: 'upcoming', label: 'Upcoming', activeClass: 'bg-green-600 text-white' },
  { id: 'past', label: 'Past', activeClass: 'bg-orange-600 text-white' },
  { id: 'quickMode', label: 'Quick Mode', activeClass: 'bg-amber-600 text-white' },
];

export default function AccessEventAccessModal({
  open,
  mode,
  user,
  makeAdmin = false,
  allowRoleSelect = true,
  fetchFn,
  onClose,
  onApproved,
  onSaved,
}: AccessEventAccessModalProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AccessEventCalendarRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [visibilityMode, setVisibilityMode] = useState<EventVisibilityMode>('all');
  const [eventTab, setEventTab] = useState<AccessEventListTab>('upcoming');
  const [approveRole, setApproveRole] = useState<PlatformRoleId>(makeAdmin ? 'admin' : 'user');

  const skipRestrictions =
    (mode === 'approve' ? approveRole === 'admin' : false) ||
    makeAdmin ||
    user?.is_admin === true;

  useEffect(() => {
    if (!open || !user) return;
    setApproveRole(makeAdmin ? 'admin' : 'user');
  }, [open, user, makeAdmin]);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch('');
    setEventTab('upcoming');
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

  const tabCounts = useMemo(() => countEventsByAccessTab(events), [events]);

  const filteredEvents = useMemo(
    () => filterEventsForAccessTab(events, eventTab, search),
    [events, eventTab, search]
  );

  const toggleSelection = useCallback((eventId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const selectAllInTab = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const event of filteredEvents) next.add(event.id);
      return next;
    });
  }, [filteredEvents]);

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
      const role: PlatformRoleId = allowRoleSelect ? approveRole : 'user';

      if (mode === 'approve') {
        const res = await fetchFn(`/api/admin/access-requests/${user.id}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role,
            make_admin: role === 'admin',
            ...(event_ids !== null ? { event_ids } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          portalUrl?: string;
          request?: { full_name?: string; is_admin?: boolean };
          role?: PlatformRoleId;
        };
        if (!res.ok) {
          setError(data.error || `HTTP ${res.status}`);
          return;
        }
        onApproved?.({
          portalUrl: data.portalUrl,
          request: data.request,
          role: data.role || role,
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
    allowRoleSelect,
    approveRole,
    onApproved,
    onClose,
    onSaved,
  ]);

  if (!open || !user) return null;

  const title = mode === 'approve' ? 'Approve user' : 'Event access';
  const submitLabel =
    mode === 'approve'
      ? submitting
        ? 'Approving…'
        : `Approve as ${platformRoleLabel(allowRoleSelect ? approveRole : 'user')}`
      : submitting
        ? 'Saving…'
        : 'Save';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-black/60">
      <div
        className="w-full max-w-2xl bg-slate-800 border border-slate-600 rounded-xl shadow-2xl h-[min(92vh,720px)] flex flex-col"
        role="dialog"
        aria-labelledby="access-event-access-title"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-700 shrink-0">
          <div className="min-w-0">
            <h3 id="access-event-access-title" className="text-base font-semibold text-white truncate">
              {title}
              <span className="font-normal text-slate-400"> · {user.full_name || user.email}</span>
            </h3>
            {skipRestrictions && (
              <p className="text-slate-500 text-xs mt-0.5">Administrators always see all events</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-2.5 flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
          {error && (
            <div className="px-3 py-1.5 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-xs shrink-0">
              {error}
            </div>
          )}

          {mode === 'approve' && allowRoleSelect ? (
            <div className="shrink-0 rounded-lg border border-slate-600 bg-slate-900/50 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
                Role
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {PLATFORM_ROLE_OPTIONS.map((opt) => {
                  const active = approveRole === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setApproveRole(opt.id)}
                      className={`text-left rounded-md px-2.5 py-2 border transition-colors ${
                        active
                          ? 'border-blue-500 bg-blue-600/30 text-white'
                          : 'border-slate-600 bg-slate-800/80 text-slate-300 hover:border-slate-500 hover:bg-slate-700/80'
                      }`}
                      title={opt.description}
                    >
                      <span className="block text-xs font-semibold">{opt.label}</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5 leading-snug">
                        {opt.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!skipRestrictions && (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-400 whitespace-nowrap">Visibility</span>
                <div className="bg-slate-900/70 rounded-lg p-0.5 flex flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setVisibilityMode('all')}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      visibilityMode === 'all'
                        ? 'bg-slate-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All events
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibilityMode('restricted')}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      visibilityMode === 'restricted'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Selected only
                  </button>
                </div>
              </div>

              {visibilityMode === 'all' ? (
                <p className="text-slate-400 text-xs shrink-0">
                  User can see every event on the calendar.
                </p>
              ) : (
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="bg-slate-900/60 rounded-lg p-0.5 flex shrink-0">
                    {EVENT_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setEventTab(tab.id)}
                        className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                          eventTab === tab.id ? tab.activeClass : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {tab.label}
                        <span className="ml-1 opacity-80">({tabCounts[tab.id]})</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search…"
                      className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-900/60 border border-slate-600 rounded-md text-xs text-white placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={selectAllInTab}
                      disabled={loading || filteredEvents.length === 0}
                      title="Select every event in this list"
                      className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[11px] rounded-md whitespace-nowrap"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(new Set())}
                      disabled={loading || selected.size === 0}
                      title="Clear all selected events"
                      className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[11px] rounded-md whitespace-nowrap"
                    >
                      Clear
                    </button>
                  </div>

                  {loading ? (
                    <p className="text-slate-400 text-sm">Loading events…</p>
                  ) : filteredEvents.length === 0 ? (
                    <p className="text-slate-400 text-sm">
                      {search.trim() ? 'No events match this search.' : 'No events in this list.'}
                    </p>
                  ) : (
                    <ul className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
                      {filteredEvents.map((event) => {
                        const checked = selected.has(event.id);
                        return (
                          <li key={event.id}>
                            <label
                              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer ${
                                checked
                                  ? 'border-violet-500/60 bg-violet-950/30'
                                  : 'border-slate-700 bg-slate-900/40 hover:border-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSelection(event.id)}
                                className="mt-0.5 rounded border-slate-500"
                              />
                              <span className="min-w-0">
                                <span className="block text-xs text-white font-medium truncate">
                                  {event.name}
                                </span>
                                <span className="block text-[10px] text-slate-400">{event.date}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {skipRestrictions && mode === 'approve' ? (
            <p className="text-slate-400 text-sm flex-1">
              This role has full calendar visibility. Event restrictions are not applied.
            </p>
          ) : null}
        </div>

        <div className="px-4 py-3 border-t border-slate-700 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || loading}
            className="flex-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
