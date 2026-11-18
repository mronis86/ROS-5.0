import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Event } from '../types/Event';
import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch, authHeaders } from '../lib/sessionAuth';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { canSelectOperatorRole } from '../services/auth-service';
import RoleSelectionModal from '../components/RoleSelectionModal';
import { sessionRoleLabel } from '../lib/sessionRoleLabels';
import { parseBoardAgenda, rowsLookTimed, type BoardAgendaRow } from '../lib/boardAgenda';
import { MEETING_HUB_LABEL } from '../types/Event';
import { versionedFileName } from '../lib/cueFileVersions';

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
  version?: number;
  versionCount?: number;
  versionedName?: string;
  isCurrent?: boolean;
  converted_from_id?: string | null;
};

type BoardData = {
  event_id: string;
  av_notes: string;
  agenda_text: string;
  agenda_items?: BoardAgendaRow[];
  conference_setup?: string;
  food_beverage?: string;
  public_control_enabled?: boolean;
  public_token?: string | null;
  assets: BoardAsset[];
};

const ZONE_META: Record<
  BoardZone,
  { title: string; hint: string; emptyHint: string; accept: string; optional?: boolean }
> = {
  agenda: {
    title: 'Agenda',
    hint: 'Upload the meeting schedule (PDF, Word, Excel, or text).',
    emptyHint: 'No agenda file yet.',
    accept: '.pdf,.doc,.docx,.txt,.xlsx,.xls',
  },
  powerpoint: {
    title: 'Presentations',
    hint: 'Upload PowerPoint or PDF decks for the room to open.',
    emptyHint: 'No presentations yet.',
    accept: '.ppt,.pptx,.pdf',
  },
  display: {
    title: 'Room screens',
    hint: 'Optional images, video, or PDF for lobby / confidence monitors.',
    emptyHint: 'No room-screen files yet.',
    accept: 'image/*,video/*,.pdf',
    optional: true,
  },
};

function isPdfAsset(asset: BoardAsset): boolean {
  const name = String(asset.original_name || '').toLowerCase();
  const mime = String(asset.mime_type || '').toLowerCase();
  return name.endsWith('.pdf') || mime === 'application/pdf';
}

function assetDisplayName(asset: BoardAsset): string {
  return (
    asset.versionedName ||
    versionedFileName(asset.original_name, asset.version, asset.versionCount) ||
    asset.original_name
  );
}

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
  const [conferenceSetup, setConferenceSetup] = useState('');
  const [foodBeverage, setFoodBeverage] = useState('');
  const [agendaText, setAgendaText] = useState('');
  const [agendaItems, setAgendaItems] = useState<BoardAgendaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusyZone, setUploadBusyZone] = useState<BoardZone | null>(null);
  const [dragOverZone, setDragOverZone] = useState<BoardZone | null>(null);
  const [notesTab, setNotesTab] = useState<'agenda' | 'setup' | 'food' | 'av'>('agenda');
  const [notesQuery, setNotesQuery] = useState('');
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [publicBusy, setPublicBusy] = useState(false);
  const [hubTab, setHubTab] = useState<'setup' | 'files' | 'details'>('files');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRefs = useRef<Partial<Record<BoardZone, HTMLInputElement | null>>>({});

  const eventId = event?.id;

  const notesQueryNorm = notesQuery.trim().toLowerCase();
  const noteMatches = (text: string) =>
    !notesQueryNorm || text.toLowerCase().includes(notesQueryNorm);
  const filteredAgendaItems = agendaItems.filter((row) =>
    noteMatches([row.time, row.subject, row.info].join(' '))
  );
  const noteTabHasMatch = {
    agenda: rowsLookTimed(agendaItems)
      ? agendaItems.some((row) => noteMatches([row.time, row.subject, row.info].join(' ')))
      : noteMatches(agendaText),
    setup: noteMatches(conferenceSetup),
    food: noteMatches(foodBeverage),
    av: noteMatches(avNotes),
  };

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
      setConferenceSetup(data.conference_setup || '');
      setFoodBeverage(data.food_beverage || '');
      setAgendaText(data.agenda_text || '');
      const stored = Array.isArray(data.agenda_items) ? data.agenda_items : [];
      const parsed = stored.length ? stored : parseBoardAgenda(data.agenda_text || '');
      setAgendaItems(rowsLookTimed(parsed) ? parsed : stored);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!eventId) {
      setError(`No event selected. Open ${MEETING_HUB_LABEL} from the event list.`);
      setLoading(false);
      return;
    }
    void loadBoard(eventId);
  }, [eventId, loadBoard]);

  const persistNotes = useCallback(
    async (
      nextAv: string,
      nextAgenda: string,
      nextItems: BoardAgendaRow[] = agendaItems,
      nextConference: string = conferenceSetup,
      nextFood: string = foodBeverage
    ) => {
      if (!eventId || !canEdit) return;
      setSaving(true);
      try {
        const res = await apiAuthFetch(`${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}`, {
          method: 'PUT',
          headers: { 'X-ROS-Role': userRole },
          body: JSON.stringify({
            av_notes: nextAv,
            agenda_text: nextAgenda,
            agenda_items: nextItems,
            conference_setup: nextConference,
            food_beverage: nextFood,
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
    [agendaItems, canEdit, conferenceSetup, eventId, foodBeverage, userRole]
  );

  const scheduleSave = useCallback(
    (
      nextAv: string,
      nextAgenda: string,
      nextItems: BoardAgendaRow[] = agendaItems,
      nextConference: string = conferenceSetup,
      nextFood: string = foodBeverage
    ) => {
      if (!canEdit) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistNotes(nextAv, nextAgenda, nextItems, nextConference, nextFood);
      }, 700);
    },
    [agendaItems, canEdit, conferenceSetup, foodBeverage, persistNotes]
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
        const parsed = parseBoardAgenda(String(data.extracted_text));
        if (rowsLookTimed(parsed)) {
          setAgendaItems(parsed);
          setAgendaText(parsed.map((row) => [row.time, row.subject, row.info].filter(Boolean).join(' — ')).join('\n'));
        } else {
          setAgendaText((prev) => prev || String(data.extracted_text));
        }
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
      const source = data.agenda_text || data.extracted_text || asset.extracted_text || '';
      const parsed = Array.isArray(data.agenda_items) && data.agenda_items.length
        ? data.agenda_items
        : parseBoardAgenda(source);
      setAgendaText(source);
      setAgendaItems(rowsLookTimed(parsed) ? parsed : []);
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

  const convertPdfToPpt = async (asset: BoardAsset) => {
    if (!eventId || !canEdit) return;
    setConvertingId(asset.id);
    setError(null);
    try {
      const res = await apiAuthFetch(
        `${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/assets/${encodeURIComponent(asset.id)}/pdf-to-pptx`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-ROS-Role': userRole },
          body: JSON.stringify({}),
        }
      );
      if (!res) throw new Error('Not signed in');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create PowerPoint');
      await loadBoard(eventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create PowerPoint');
    } finally {
      setConvertingId(null);
    }
  };

  const useAssetVersion = async (asset: BoardAsset) => {
    if (!eventId || !canEdit) return;
    setUsingId(asset.id);
    setError(null);
    try {
      const res = await apiAuthFetch(
        `${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/assets/${encodeURIComponent(asset.id)}/prefer`,
        { method: 'POST', headers: { 'X-ROS-Role': userRole } }
      );
      if (!res) throw new Error('Not signed in');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not switch version');
      await loadBoard(eventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch version');
    } finally {
      setUsingId(null);
    }
  };

  const publicControlUrl =
    board?.public_control_enabled && board.public_token
      ? `${window.location.origin}/meeting-hub/${encodeURIComponent(board.public_token)}`
      : null;

  const setPublicControl = async (enabled: boolean, rotate = false) => {
    if (!eventId || !canEdit) return;
    setPublicBusy(true);
    setError(null);
    try {
      const res = await apiAuthFetch(
        `${getApiBaseUrl()}/api/event-board/${encodeURIComponent(eventId)}/public-control`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-ROS-Role': userRole },
          body: JSON.stringify({ enabled, rotate }),
        }
      );
      if (!res) throw new Error('Not signed in');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            'Public control API is missing on Railway — redeploy the API service, then try Share again.'
          );
        }
        throw new Error(
          (typeof data.error === 'string' && data.error) ||
            `Could not update public control (${res.status})`
        );
      }
      await loadBoard(eventId);
      if (enabled && data.public_token) {
        const url = `${window.location.origin}/meeting-hub/${encodeURIComponent(data.public_token)}`;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          /* ignore */
        }
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update public control');
    } finally {
      setPublicBusy(false);
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

  const hasAgendaContent =
    assetsByZone.agenda.length > 0 ||
    rowsLookTimed(agendaItems) ||
    !!agendaText.trim();
  const hasPresentations = assetsByZone.powerpoint.length > 0;
  const hasDisplays = assetsByZone.display.length > 0;
  const isShared = !!publicControlUrl;
  const setupSteps = [
    {
      id: 'agenda' as const,
      label: 'Agenda',
      done: hasAgendaContent,
      detail: hasAgendaContent ? 'Ready' : 'Upload or paste the schedule',
    },
    {
      id: 'powerpoint' as const,
      label: 'Presentations',
      done: hasPresentations,
      detail: hasPresentations
        ? `${assetsByZone.powerpoint.length} file${assetsByZone.powerpoint.length === 1 ? '' : 's'}`
        : 'Add slide decks',
    },
    {
      id: 'display' as const,
      label: 'Room screens',
      done: hasDisplays,
      optional: true,
      detail: hasDisplays
        ? `${assetsByZone.display.length} file${assetsByZone.display.length === 1 ? '' : 's'}`
        : 'Optional',
    },
    {
      id: 'share' as const,
      label: 'Share with room',
      done: isShared,
      detail: isShared ? 'Link is live' : 'Create a simple room link',
    },
  ];
  const nextSetupStep = setupSteps.find((s) => !s.done && !s.optional) || setupSteps.find((s) => !s.done);

  const renderZone = (zone: BoardZone) => {
    const meta = ZONE_META[zone];
    const list = assetsByZone[zone];
    return (
      <section className="rounded-2xl border border-slate-600/70 bg-slate-900/55 p-5 flex flex-col min-h-[280px] h-full">
        <header className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white tracking-tight">{meta.title}</h2>
            {meta.optional ? (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Optional
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-400 mt-1 leading-snug">{meta.hint}</p>
        </header>

        {canEdit ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Upload ${meta.title}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (uploadBusyZone === zone) return;
                fileInputRefs.current[zone]?.click();
              }
            }}
            onClick={() => {
              if (uploadBusyZone === zone) return;
              fileInputRefs.current[zone]?.click();
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (uploadBusyZone === zone) return;
              setDragOverZone(zone);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (uploadBusyZone === zone) return;
              e.dataTransfer.dropEffect = 'copy';
              setDragOverZone(zone);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverZone((prev) => (prev === zone ? null : prev));
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverZone(null);
              if (uploadBusyZone === zone) return;
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              void onUpload(zone, file);
            }}
            className={`mb-4 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
              uploadBusyZone === zone
                ? 'opacity-60 pointer-events-none border-slate-500 bg-slate-950/40'
                : dragOverZone === zone
                  ? 'cursor-copy border-emerald-400 bg-emerald-950/30'
                  : 'cursor-pointer border-slate-500 bg-slate-950/40 hover:border-emerald-500/70 hover:bg-slate-900/60'
            }`}
          >
            <span className="text-sm font-semibold text-slate-100">
              {uploadBusyZone === zone ? 'Uploading…' : 'Drop a file here, or click to choose'}
            </span>
            <span className="text-xs text-slate-500">One file at a time is fine — you can add more later.</span>
            <input
              ref={(el) => {
                fileInputRefs.current[zone] = el;
              }}
              type="file"
              className="hidden"
              accept={meta.accept}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onUpload(zone, file);
              }}
            />
          </div>
        ) : (
          <p className="mb-3 text-sm text-slate-500">View only — switch to Editor to upload files.</p>
        )}

        <ul className="space-y-2 flex-1 overflow-auto">
          {list.length === 0 ? (
            <li className="rounded-lg border border-dashed border-slate-700/80 bg-slate-950/30 px-3 py-3 text-sm text-slate-500">
              {meta.emptyHint}
            </li>
          ) : (
            list.map((asset) => {
              const versioned = (asset.versionCount || 1) > 1;
              const displayName = assetDisplayName(asset);
              return (
              <li
                key={asset.id}
                className={`flex items-start justify-between gap-2 rounded-md border px-2.5 py-2 ${
                  asset.isCurrent === false && versioned
                    ? 'border-slate-700 bg-slate-950/30 opacity-90'
                    : 'border-slate-700 bg-slate-950/50'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm text-slate-100 truncate" title={displayName}>
                      {displayName}
                    </p>
                    {versioned ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          asset.isCurrent
                            ? 'bg-emerald-700 text-emerald-50'
                            : 'bg-slate-600 text-slate-100'
                        }`}
                      >
                        {asset.isCurrent ? `Current · v${asset.version}` : `Older · v${asset.version}`}
                      </span>
                    ) : null}
                    {asset.converted_from_id ? (
                      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-900/70 text-amber-100">
                        From PDF
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {[formatBytes(asset.size_bytes), asset.uploaded_by_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => void openAsset(asset)}
                    className="rounded px-2 py-1 text-[11px] font-medium text-blue-200 hover:bg-slate-800"
                  >
                    Open
                  </button>
                  {zone === 'powerpoint' && canEdit && isPdfAsset(asset) ? (
                    <button
                      type="button"
                      disabled={!!convertingId}
                      onClick={() => void convertPdfToPpt(asset)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {convertingId === asset.id ? 'Creating slides…' : 'Turn into PowerPoint'}
                    </button>
                  ) : null}
                  {canEdit && versioned && asset.isCurrent === false ? (
                    <button
                      type="button"
                      disabled={!!usingId}
                      onClick={() => void useAssetVersion(asset)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-violet-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {usingId === asset.id ? 'Switching…' : 'Use this version'}
                    </button>
                  ) : null}
                  {zone === 'agenda' && asset.extracted_text && canEdit ? (
                    <button
                      type="button"
                      onClick={() => void applyExtracted(asset)}
                      className="rounded px-2 py-1 text-[11px] font-medium text-emerald-200 hover:bg-slate-800"
                      title="Add this text into the agenda notes"
                    >
                      Add to agenda
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
            );
            })
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
            <p className="text-lg font-semibold text-white">{MEETING_HUB_LABEL}</p>
            <p className="text-sm text-slate-400">{error || 'Open an event from the list.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 pt-[var(--app-header-height)]">
      <header className="sticky top-[var(--app-header-height)] z-40">
        <div className="border-b border-slate-600 bg-slate-800 shadow-md">
          <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
            <button
              type="button"
              onClick={() => void handleBackToEvents()}
              className="shrink-0 rounded-md bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"
              title="Back to Events"
            >
              ← Events
            </button>
            <div className="ml-4 min-w-0 flex items-center gap-2">
              <h1 className="truncate text-sm sm:text-base font-semibold text-white">
                {event?.name || MEETING_HUB_LABEL}
              </h1>
              <span className="shrink-0 rounded-md bg-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Meeting Hub
              </span>
              <span className="hidden md:inline truncate text-xs text-slate-400">
                {[event?.date, event?.location].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {saving ? <span className="text-[11px] text-slate-400">Saving…</span> : null}
              <span className="text-xs text-slate-300">
                <span className="hidden sm:inline">Role: </span>
                <span className="font-semibold text-white">{sessionRoleLabel(userRole)}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowRoleChangeModal(true)}
                className="rounded-md bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-600"
              >
                Change Role
              </button>
            </div>
          </div>
        </div>
        <div className="border-b border-slate-700 bg-slate-950/90">
          <div
            role="tablist"
            aria-label="Meeting Hub sections"
            className="flex gap-2 px-3 py-3 sm:px-4 overflow-x-auto"
          >
            {(
              [
                { id: 'setup' as const, label: 'Setup / Help', tip: 'Share + how-to' },
                { id: 'files' as const, label: 'Files', tip: 'Agenda & decks' },
                { id: 'details' as const, label: 'Details', tip: 'Day-of notes' },
              ] as const
            ).map((tab) => {
              const active = hubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setHubTab(tab.id)}
                  className={`shrink-0 rounded-xl border px-4 py-2.5 text-left transition ${
                    active
                      ? 'border-emerald-500 bg-emerald-700 text-white shadow-sm'
                      : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <span className="block text-sm font-semibold leading-none">{tab.label}</span>
                  <span
                    className={`mt-1.5 block text-[11px] leading-none ${
                      active ? 'text-emerald-100/90' : 'text-slate-500'
                    }`}
                  >
                    {tab.tip}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>
      <RoleSelectionModal
        isOpen={showRoleChangeModal}
        onClose={() => setShowRoleChangeModal(false)}
        onRoleSelected={applyRole}
        eventId={event?.id || ''}
      />

      <main className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        {error ? (
          <div className="rounded-xl border border-red-800/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-slate-400 text-sm">Loading {MEETING_HUB_LABEL}…</p>
        ) : hubTab === 'setup' ? (
          <div className="space-y-6" role="tabpanel">
            <section className="rounded-xl border border-emerald-600/35 bg-emerald-950/25 px-3.5 py-2.5 sm:px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <h2 className="text-sm font-semibold text-white">Room page</h2>
                    <p className="text-xs text-emerald-100/70">
                      Room PC link — no login
                    </p>
                  </div>
                  {publicControlUrl ? (
                    <p className="mt-1 truncate text-[11px] font-mono text-emerald-100/55" title={publicControlUrl}>
                      {publicControlUrl}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {publicControlUrl ? (
                    <>
                      <a
                        href={publicControlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(publicControlUrl)}
                        className="rounded-md border border-emerald-500/50 bg-emerald-950/50 px-2.5 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/60"
                      >
                        Copy
                      </button>
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            disabled={publicBusy}
                            onClick={() => void setPublicControl(true, true)}
                            className="rounded-md px-2 py-1.5 text-xs font-medium text-emerald-200/80 hover:bg-emerald-900/50 disabled:opacity-50"
                          >
                            New link
                          </button>
                          <button
                            type="button"
                            disabled={publicBusy}
                            onClick={() => void setPublicControl(false)}
                            className="rounded-md px-2 py-1.5 text-xs font-medium text-red-300/90 hover:bg-emerald-900/50 disabled:opacity-50"
                          >
                            Turn off
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : canEdit ? (
                    <button
                      type="button"
                      disabled={publicBusy}
                      onClick={() => void setPublicControl(true)}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Create link
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-200/70">Off</span>
                  )}
                </div>
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
              <section className="rounded-2xl border border-slate-600/70 bg-slate-900/50 p-5 sm:p-6">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold text-white">Getting started</h2>
                  <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                    Work through these in order — skip optional items if you do not need them.
                  </p>
                </div>
                <ol className="grid gap-3 sm:grid-cols-2">
                  {setupSteps.map((step, index) => {
                    const goFiles = step.id === 'agenda' || step.id === 'powerpoint' || step.id === 'display';
                    return (
                      <li
                        key={step.id}
                        className={`rounded-xl border px-4 py-4 ${
                          step.done
                            ? 'border-emerald-700/50 bg-emerald-950/25'
                            : nextSetupStep?.id === step.id
                              ? 'border-emerald-500/60 bg-slate-950/70'
                              : 'border-slate-700 bg-slate-950/45'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-100">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white">
                              {step.label}
                              {step.optional ? (
                                <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Optional
                                </span>
                              ) : null}
                            </p>
                            <p className="mt-1 text-sm text-slate-400 leading-snug">{step.detail}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {step.done ? (
                                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                                  Done
                                </span>
                              ) : null}
                              {goFiles ? (
                                <button
                                  type="button"
                                  onClick={() => setHubTab('files')}
                                  className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                                >
                                  Open Files
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>

              <aside className="space-y-4">
                <section className="rounded-2xl border border-emerald-600/40 bg-emerald-950/30 p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                    Suggested next
                  </p>
                  {nextSetupStep ? (
                    <>
                      <h3 className="mt-2 text-base font-semibold text-white">{nextSetupStep.label}</h3>
                      <p className="mt-1 text-sm text-emerald-100/85 leading-relaxed">{nextSetupStep.detail}</p>
                      {nextSetupStep.id !== 'share' ? (
                        <button
                          type="button"
                          onClick={() => setHubTab('files')}
                          className="mt-4 w-full rounded-lg bg-emerald-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                        >
                          Go to Files
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-emerald-100 leading-relaxed">
                      Looks ready — open the room page when the meeting starts.
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-600/70 bg-slate-900/50 p-5">
                  <h3 className="text-sm font-semibold text-white">Quick tips</h3>
                  <ul className="mt-3 space-y-3 text-sm text-slate-400 leading-snug">
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" aria-hidden />
                      <span>
                        <button
                          type="button"
                          className="font-semibold text-emerald-300 hover:underline"
                          onClick={() => setHubTab('files')}
                        >
                          Files
                        </button>{' '}
                        is where you upload agenda, presentations, and room-screen media.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" aria-hidden />
                      <span>
                        <button
                          type="button"
                          className="font-semibold text-emerald-300 hover:underline"
                          onClick={() => setHubTab('details')}
                        >
                          Details
                        </button>{' '}
                        holds day-of notes like setup, food, and tech.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" aria-hidden />
                      <span>Create the room link here, then open it on the room PC.</span>
                    </li>
                  </ul>
                </section>
              </aside>
            </div>
          </div>
        ) : hubTab === 'files' ? (
          <div className="grid gap-5 lg:grid-cols-3" role="tabpanel">
            {renderZone('agenda')}
            {renderZone('powerpoint')}
            {renderZone('display')}
          </div>
        ) : (
          <section className="rounded-2xl border border-slate-600/70 bg-slate-900/50 p-5 sm:p-6" role="tabpanel">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">Meeting details</h2>
              <p className="mt-1 text-sm text-slate-400">
                Day-of notes — agenda text, room setup, catering, and tech.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['agenda', 'Agenda'],
                    ['setup', 'Room setup'],
                    ['food', 'Food & beverage'],
                    ['av', 'Tech notes'],
                  ] as const
                ).map(([id, label]) => {
                  const active = notesTab === id;
                  const hit = !!notesQueryNorm && noteTabHasMatch[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setNotesTab(id)}
                      className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                        active
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {label}
                      {hit ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 align-middle" /> : null}
                    </button>
                  );
                })}
              </div>
              <input
                type="search"
                value={notesQuery}
                onChange={(e) => setNotesQuery(e.target.value)}
                placeholder="Search notes…"
                className="w-full sm:w-64 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {notesTab === 'agenda' ? (
              <>
                <p className="text-sm text-slate-400 mb-3">
                  Times, topics, and notes pulled from your uploaded agenda.
                </p>
                {rowsLookTimed(agendaItems) ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-700">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-800 text-[11px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-semibold w-[9.5rem]">Times</th>
                          <th className="px-3 py-2 font-semibold">Subject</th>
                          <th className="px-3 py-2 font-semibold">Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAgendaItems.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-3 py-4 text-slate-500">No matching agenda rows.</td>
                          </tr>
                        ) : (
                          filteredAgendaItems.map((row, index) => (
                            <tr key={`${row.time}-${row.subject}-${index}`} className="border-t border-slate-700/80 align-top">
                              <td className="px-3 py-2 text-cyan-200 whitespace-nowrap tabular-nums">{row.time || '—'}</td>
                              <td className="px-3 py-2 text-white">{row.subject || '—'}</td>
                              <td className="px-3 py-2 text-slate-300">{row.info || '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <textarea
                    value={agendaText}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const next = e.target.value;
                      setAgendaText(next);
                      const parsed = parseBoardAgenda(next);
                      const nextItems = rowsLookTimed(parsed) ? parsed : [];
                      setAgendaItems(nextItems);
                      scheduleSave(avNotes, next, nextItems, conferenceSetup, foodBeverage);
                    }}
                    rows={12}
                    className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                    placeholder="Paste agenda text or extract it from an uploaded document…"
                  />
                )}
              </>
            ) : null}

            {notesTab === 'setup' ? (
              <>
                <p className="text-sm text-slate-400 mb-2">Room layout, registration, signage, staffing, load-in…</p>
                <textarea
                  value={conferenceSetup}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = e.target.value;
                    setConferenceSetup(next);
                    scheduleSave(avNotes, agendaText, agendaItems, next, foodBeverage);
                  }}
                  rows={14}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                  placeholder="Conference setup notes…"
                />
              </>
            ) : null}

            {notesTab === 'food' ? (
              <>
                <p className="text-sm text-slate-400 mb-2">Meals, breaks, dietary notes, service times, headcount…</p>
                <textarea
                  value={foodBeverage}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFoodBeverage(next);
                    scheduleSave(avNotes, agendaText, agendaItems, conferenceSetup, next);
                  }}
                  rows={14}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                  placeholder="Food and beverage notes…"
                />
              </>
            ) : null}

            {notesTab === 'av' ? (
              <>
                <p className="text-sm text-slate-400 mb-2">Mics, record/stream plan, room quirks, and who to call…</p>
                <textarea
                  value={avNotes}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAvNotes(next);
                    scheduleSave(next, agendaText, agendaItems, conferenceSetup, foodBeverage);
                  }}
                  rows={14}
                  className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-60"
                  placeholder="Tech notes for this meeting…"
                />
              </>
            ) : null}

            {notesQueryNorm && !noteTabHasMatch[notesTab] ? (
              <p className="mt-2 text-xs text-slate-500">
                No matches in this tab.
                {(['agenda', 'setup', 'food', 'av'] as const).some((id) => id !== notesTab && noteTabHasMatch[id])
                  ? ' A cyan dot marks tabs that contain this search.'
                  : ' Nothing in the notes matches.'}
              </p>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
};

export default EventBoardPage;
