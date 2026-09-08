import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Event } from '../types/Event';
import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch, authHeaders } from '../lib/sessionAuth';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { canSelectOperatorRole } from '../services/auth-service';
import RoleSelectionModal from '../components/RoleSelectionModal';

type SessionRole = 'VIEWER' | 'EDITOR' | 'OPERATOR';

function resolveSessionRole(
  role: string | null | undefined,
  user: { is_admin?: boolean; is_event_manager?: boolean } | null | undefined
): SessionRole {
  if (!role || !['VIEWER', 'EDITOR', 'OPERATOR'].includes(role)) return 'VIEWER';
  if (role === 'OPERATOR' && !canSelectOperatorRole(user)) return 'VIEWER';
  return role as SessionRole;
}

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
  const { user } = useAuth();
  const state = (location.state || {}) as { event?: Event; userRole?: string };
  const [event] = useState<Event | null>(state.event || null);
  const [userRole, setUserRole] = useState<SessionRole>(() => {
    const fromNav = state.userRole;
    if (fromNav) return resolveSessionRole(fromNav, user);
    const saved = event?.id ? localStorage.getItem(`userRole_${event.id}`) : null;
    return resolveSessionRole(saved || 'EDITOR', user);
  });
  const [showRoleChangeModal, setShowRoleChangeModal] = useState(false);
  const canEdit = userRole === 'EDITOR';

  const [board, setBoard] = useState<BoardData | null>(null);
  const [avNotes, setAvNotes] = useState('');
  const [agendaText, setAgendaText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusyZone, setUploadBusyZone] = useState<BoardZone | null>(null);
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

  const applyRole = (role: string) => {
    const resolved = resolveSessionRole(role, user);
    setUserRole(resolved);
    if (event?.id) {
      localStorage.setItem(`userRole_${event.id}`, resolved);
      if (user?.id) {
        const username = user.full_name || user.email || 'Unknown';
        void DatabaseService.saveUserSession(event.id, user.id, username, resolved);
      }
    }
    setShowRoleChangeModal(false);
  };

  const handleBackToEvents = async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (canEdit && eventId) {
      await persistNotes(avNotes, agendaText);
    }
    navigate('/');
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
      <div className="min-h-screen bg-slate-900 text-slate-200 pt-[var(--app-header-height)]">
        <div className="sticky top-[var(--app-header-height)] z-40 border-b border-slate-700 bg-slate-900">
          <div className="flex items-center px-3 py-1.5">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-600"
            >
              ← Events
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center px-6 pt-16">
          <div className="max-w-md text-center space-y-3">
            <p className="text-lg font-semibold text-white">Event Board</p>
            <p className="text-sm text-slate-400">{error || 'Open an event from the list.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pt-[var(--app-header-height)]">
      <header className="sticky top-[var(--app-header-height)] z-40 border-b border-slate-700 bg-slate-900">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button
            type="button"
            onClick={() => void handleBackToEvents()}
            className="shrink-0 rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-600"
            title="Back to Events"
          >
            ← Events
          </button>
          <div className="ml-6 min-w-0 flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-white">{event?.name || 'Event Board'}</h1>
            <span className="shrink-0 rounded bg-emerald-800/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-100">
              Board
            </span>
            <span className="hidden md:inline truncate text-xs text-slate-500">
              {[event?.date, event?.location].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {saving ? <span className="text-[11px] text-slate-500">Saving…</span> : null}
            <span className="text-xs text-slate-400">
              <span className="hidden sm:inline">Role: </span>
              <span className="font-semibold text-white">{userRole}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowRoleChangeModal(true)}
              className="rounded-md bg-slate-700 px-2 py-1 text-xs font-medium text-white hover:bg-slate-600"
            >
              Change Role
            </button>
          </div>
        </div>
      </header>
      <RoleSelectionModal
        isOpen={showRoleChangeModal}
        onClose={() => setShowRoleChangeModal(false)}
        onRoleSelected={applyRole}
        eventId={event?.id || ''}
      />

      <main className="mx-auto max-w-6xl px-4 sm:px-8 py-6 space-y-5">
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
