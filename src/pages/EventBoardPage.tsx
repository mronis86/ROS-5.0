import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Event } from '../types/Event';
import { normalizeWorkspaceMode } from '../types/Event';
import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch, authHeaders } from '../lib/sessionAuth';
import { DatabaseService } from '../services/database';

type BoardZone = 'agenda' | 'powerpoint' | 'display';

type BoardAsset = {
  id: string;
  zone: BoardZone;
  original_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  extracted_text?: string | null;
  uploaded_by_name?: string | null;
  created_at?: string;
};

type BoardData = {
  event_id: string;
  av_notes: string;
  agenda_text: string;
  assets: BoardAsset[];
};

const ZONE_META: Record<BoardZone, { title: string; hint: string; accept: string }> = {
  agenda: {
    title: 'Agenda / Schedule',
    hint: 'PDF, Word, Excel, or TXT — upload to view and extract text',
    accept: '.pdf,.doc,.docx,.txt,.xlsx,.xls',
  },
  powerpoint: {
    title: 'PowerPoint',
    hint: 'PPT, PPTX, or PDF decks',
    accept: '.ppt,.pptx,.pdf',
  },
  display: {
    title: 'Display screen content',
    hint: 'Images, video, or PDF for room displays',
    accept: 'image/*,video/*,.pdf',
  },
};

function formatBytes(n?: number | null): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const EventBoardPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as { event?: Event; userRole?: string };
  const [event, setEvent] = useState<Event | null>(state.event || null);
  const [userRole] = useState(String(state.userRole || 'EDITOR').toUpperCase());
  const canEdit = userRole === 'EDITOR';

  const [board, setBoard] = useState<BoardData | null>(null);
  const [avNotes, setAvNotes] = useState('');
  const [agendaText, setAgendaText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusyZone, setUploadBusyZone] = useState<BoardZone | null>(null);
  const [switching, setSwitching] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const eventId = event?.id;

  const assetsByZone = useMemo(() => {
    const map: Record<BoardZone, BoardAsset[]> = { agenda: [], powerpoint: [], display: [] };
    for (const asset of board?.assets || []) {
      if (map[asset.zone]) map[asset.zone].push(asset);
    }
    return map;
  }, [board?.assets]);

  const loadBoard = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiAuthFetch(`${getApiBaseUrl()}/api/event-board/${encodeURIComponent(id)}`);
      if (!res) throw new Error('Not signed in');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load board (${res.status})`);
      }
      const data = (await res.json()) as BoardData;
      setBoard(data);
      setAvNotes(data.av_notes || '');
      setAgendaText(data.agenda_text || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!eventId) {
      setError('No event selected. Open Event Board from the event list.');
      setLoading(false);
      return;
    }
    void loadBoard(eventId);
  }, [eventId, loadBoard]);

  const persistNotes = useCallback(
    async (nextAv: string, nextAgenda: string) => {
      if (!eventId || !canEdit) return;
      setSaving(true);
      try {
        const res = await apiAuthFetch(`${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}`, {
          method: 'PUT',
          headers: { 'X-ROS-Role': userRole },
          body: JSON.stringify({
            av_notes: nextAv,
            agenda_text: nextAgenda,
            agenda_items: [],
          }),
        });
        if (!res) throw new Error('Not signed in');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to save');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [canEdit, eventId, userRole]
  );

  const scheduleSave = useCallback(
    (nextAv: string, nextAgenda: string) => {
      if (!canEdit) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistNotes(nextAv, nextAgenda);
      }, 700);
    },
    [canEdit, persistNotes]
  );

  const onUpload = async (zone: BoardZone, file: File) => {
    if (!eventId || !canEdit) return;
    setUploadBusyZone(zone);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('zone', zone);
      const res = await fetch(`${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/assets`, {
        method: 'POST',
        headers: { ...authHeaders(), 'X-ROS-Role': userRole },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      await loadBoard(eventId);
      if (zone === 'agenda' && data.extracted_text) {
        setAgendaText((prev) => prev || data.extracted_text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadBusyZone(null);
    }
  };

  const openAsset = async (asset: BoardAsset) => {
    if (!eventId) return;
    try {
      const res = await apiAuthFetch(
        `${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/assets/${encodeURIComponent(asset.id)}/url`
      );
      if (!res) throw new Error('Not signed in');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open file');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open file');
    }
  };

  const applyExtracted = async (asset: BoardAsset) => {
    if (!eventId || !canEdit) return;
    try {
      const res = await apiAuthFetch(
        `${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/assets/${encodeURIComponent(asset.id)}/apply-text`,
        { method: 'POST', headers: { 'X-ROS-Role': userRole } }
      );
      if (!res) throw new Error('Not signed in');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not apply text');
      setAgendaText(data.agenda_text || asset.extracted_text || '');
      await loadBoard(eventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply text');
    }
  };

  const deleteAsset = async (asset: BoardAsset) => {
    if (!eventId || !canEdit) return;
    if (!window.confirm(`Delete ${asset.original_name}?`)) return;
    try {
      const res = await apiAuthFetch(
        `${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/assets/${encodeURIComponent(asset.id)}`,
        { method: 'DELETE', headers: { 'X-ROS-Role': userRole } }
      );
      if (!res) throw new Error('Not signed in');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      await loadBoard(eventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const switchToRos = async () => {
    if (!event || !canEdit) return;
    if (!window.confirm('Switch this event to a standard timed Run of Show? You can switch back later from Edit Event.')) {
      return;
    }
    setSwitching(true);
    try {
      const calendarEvents: any[] = (await DatabaseService.getCalendarEvents()) || [];
      const match = calendarEvents.find(
        (c) => c.schedule_data?.eventId === event.id || c.id === event.id || c.id === event.calendarId
      );
      if (!match?.id) throw new Error('Could not find calendar event to update');
      const nextMode = normalizeWorkspaceMode('ros', event.eventType);
      await DatabaseService.updateCalendarEvent(match.id, {
        name: event.name,
        date: event.date,
        schedule_data: {
          ...match.schedule_data,
          workspaceMode: nextMode,
          eventId: event.id,
        },
      });
      const nextEvent = { ...event, workspaceMode: nextMode };
      setEvent(nextEvent);
      navigate('/run-of-show', { state: { event: nextEvent, userRole } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch to ROS');
    } finally {
      setSwitching(false);
    }
  };

  const renderZone = (zone: BoardZone) => {
    const meta = ZONE_META[zone];
    const list = assetsByZone[zone];
    return (
      <section className="rounded-xl border border-slate-600/80 bg-slate-900/50 p-4 flex flex-col min-h-[220px]">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-white tracking-wide">{meta.title}</h2>
          <p className="text-xs text-slate-400 mt-1">{meta.hint}</p>
        </header>

        {canEdit ? (
          <label
            className={`mb-3 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-500 bg-slate-950/40 px-3 py-6 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-900/60 transition-colors ${
              uploadBusyZone === zone ? 'opacity-60 pointer-events-none' : ''
            }`}
          >
            <span className="text-sm text-slate-200">
              {uploadBusyZone === zone ? 'Uploading…' : 'Drop file or click to upload'}
            </span>
            <input
              type="file"
              className="hidden"
              accept={meta.accept}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onUpload(zone, file);
              }}
            />
          </label>
        ) : (
          <p className="mb-3 text-xs text-slate-500">View only — EDITOR role required to upload.</p>
        )}

        <ul className="space-y-2 flex-1 overflow-auto">
          {list.length === 0 ? (
            <li className="text-xs text-slate-500">No files yet.</li>
          ) : (
            list.map((asset) => (
              <li
                key={asset.id}
                className="flex items-start justify-between gap-2 rounded-md border border-slate-700 bg-slate-950/50 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-100 truncate" title={asset.original_name}>
                    {asset.original_name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {[formatBytes(asset.size_bytes), asset.uploaded_by_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openAsset(asset)}
                    className="rounded px-2 py-1 text-[11px] font-medium text-blue-200 hover:bg-slate-800"
                  >
                    Open
                  </button>
                  {zone === 'agenda' && asset.extracted_text && canEdit ? (
                    <button
                      type="button"
                      onClick={() => void applyExtracted(asset)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-slate-800"
                      title="Copy extracted text into agenda notes"
                    >
                      Use text
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => void deleteAsset(asset)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-slate-800"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    );
  };

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <p className="text-lg font-semibold text-white">Event Board</p>
          <p className="text-sm text-slate-400">{error || 'Open an event from the list.'}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Back to events
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-white truncate">{event?.name || 'Event Board'}</h1>
              <span className="rounded-md bg-emerald-700/80 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                Board
              </span>
              <span className="text-[11px] text-slate-400">{userRole}</span>
              {saving ? <span className="text-[11px] text-slate-500">Saving…</span> : null}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {[event?.date, event?.location, event?.eventType].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                disabled={switching}
                onClick={() => void switchToRos()}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
              >
                {switching ? 'Switching…' : 'Switch to timed ROS'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600"
            >
              Event list
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-5">
        {error ? (
          <div className="rounded-lg border border-red-800/70 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-slate-400 text-sm">Loading board…</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              {renderZone('agenda')}
              {renderZone('powerpoint')}
              {renderZone('display')}
            </div>

            <section className="rounded-xl border border-slate-600/80 bg-slate-900/50 p-4">
              <h2 className="text-sm font-semibold text-white mb-1">Agenda text</h2>
              <p className="text-xs text-slate-400 mb-2">
                Parsed or pasted schedule notes for the room (not a timed cue sheet).
              </p>
              <textarea
                value={agendaText}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = e.target.value;
                  setAgendaText(next);
                  scheduleSave(avNotes, next);
                }}
                rows={10}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                placeholder="Paste agenda text or extract it from an uploaded document…"
              />
            </section>

            <section className="rounded-xl border border-slate-600/80 bg-slate-900/50 p-4">
              <h2 className="text-sm font-semibold text-white mb-1">General AV info / notes</h2>
              <p className="text-xs text-slate-400 mb-2">Mic counts, record/stream plan, room quirks, contacts…</p>
              <textarea
                value={avNotes}
                disabled={!canEdit}
                onChange={(e) => {
                  const next = e.target.value;
                  setAvNotes(next);
                  scheduleSave(next, agendaText);
                }}
                rows={8}
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                placeholder="AV notes for this meeting…"
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default EventBoardPage;
