import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Event } from '../types/Event';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

type ContentReviewFollowMode = 'solo' | 'drive' | 'follow';
type ReviewStatus = 'pending' | 'needs_update' | 'approved';
type ReviewStage = 'creative' | 'ros';

interface StageReviewEntry {
  status: ReviewStatus;
  note: string;
  updatedAt: string;
  updatedBy: string;
}

interface CueReviewEntry {
  creative: StageReviewEntry;
  ros: StageReviewEntry;
}

type CueReviewMap = Record<number, CueReviewEntry>;
type StreamFloatRect = { left: number; top: number; width: number; height: number };

const REVIEW_STAGES: { id: ReviewStage; label: string; shortLabel: string }[] = [
  { id: 'creative', label: 'Creative Content', shortLabel: 'Creative' },
  { id: 'ros', label: 'ROS Show', shortLabel: 'ROS' }
];

function emptyStageReviewEntry(): StageReviewEntry {
  return { status: 'pending', note: '', updatedAt: '', updatedBy: '' };
}

function emptyCueReviewEntry(): CueReviewEntry {
  return { creative: emptyStageReviewEntry(), ros: emptyStageReviewEntry() };
}

function getStageReview(entry: CueReviewEntry | undefined, stage: ReviewStage): StageReviewEntry {
  if (!entry) return emptyStageReviewEntry();
  return entry[stage] ?? emptyStageReviewEntry();
}

function isFullyApproved(entry: CueReviewEntry | undefined): boolean {
  if (!entry) return false;
  return entry.creative.status === 'approved' && entry.ros.status === 'approved';
}

function canApproveRosStage(entry: CueReviewEntry | undefined): boolean {
  return getStageReview(entry, 'creative').status === 'approved';
}

/** Migrate legacy single-stage localStorage entries */
function normalizeCueReviewMap(raw: unknown): CueReviewMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: CueReviewMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isFinite(id) || !val || typeof val !== 'object') continue;
    const row = val as Record<string, unknown>;
    if ('creative' in row && 'ros' in row) {
      const creative = row.creative as StageReviewEntry;
      const ros = row.ros as StageReviewEntry;
      out[id] = {
        creative: {
          status: creative?.status ?? 'pending',
          note: (creative?.note ?? '').toString(),
          updatedAt: (creative?.updatedAt ?? '').toString(),
          updatedBy: (creative?.updatedBy ?? '').toString()
        },
        ros: {
          status: ros?.status ?? 'pending',
          note: (ros?.note ?? '').toString(),
          updatedAt: (ros?.updatedAt ?? '').toString(),
          updatedBy: (ros?.updatedBy ?? '').toString()
        }
      };
      continue;
    }
    if ('status' in row) {
      const legacy: StageReviewEntry = {
        status: (row.status as ReviewStatus) ?? 'pending',
        note: (row.note ?? '').toString(),
        updatedAt: (row.updatedAt ?? '').toString(),
        updatedBy: (row.updatedBy ?? '').toString()
      };
      out[id] = { creative: { ...legacy }, ros: emptyStageReviewEntry() };
    }
  }
  return out;
}

function cueRailReviewMeta(entry: CueReviewEntry | undefined, activeStage: ReviewStage) {
  if (isFullyApproved(entry)) return reviewStatusMeta('approved');
  return reviewStatusMeta(getStageReview(entry, activeStage).status);
}

function reviewStatusMeta(status: ReviewStatus) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        railClass: 'bg-emerald-500/90 text-emerald-950 border-emerald-300 shadow-sm shadow-emerald-900/50',
        cueRailIdleClass:
          'border-emerald-400/90 bg-emerald-950/90 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)] hover:bg-emerald-900/95',
        cueRailActiveClass:
          'border-cyan-300 bg-emerald-900 ring-2 ring-emerald-300/70 shadow-[0_0_12px_rgba(52,211,153,0.35)]',
        cueLabelClass: 'text-emerald-50',
        cardClass: 'border-emerald-700/70 bg-emerald-950/25 text-emerald-100'
      };
    case 'needs_update':
      return {
        label: 'Needs update',
        railClass: 'bg-amber-500/90 text-amber-950 border-amber-200 shadow-sm shadow-amber-900/50',
        cueRailIdleClass:
          'border-amber-400/90 bg-amber-950/90 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)] hover:bg-amber-900/95',
        cueRailActiveClass:
          'border-cyan-300 bg-amber-950 ring-2 ring-amber-300/70 shadow-[0_0_12px_rgba(251,191,36,0.35)]',
        cueLabelClass: 'text-amber-50',
        cardClass: 'border-amber-700/70 bg-amber-950/25 text-amber-100'
      };
    default:
      return {
        label: 'Pending',
        railClass: 'bg-slate-700/80 text-slate-300 border-slate-500/70',
        cueRailIdleClass: 'border-transparent bg-transparent hover:bg-slate-900',
        cueRailActiveClass: 'border-cyan-500/80 bg-slate-800 ring-1 ring-cyan-500/40',
        cueLabelClass: 'text-white',
        cardClass: 'border-slate-600/70 bg-slate-800/70 text-slate-200'
      };
  }
}

/** Matches PhotoView / print cue styling */
const PROGRAM_TYPE_COLORS: Record<string, string> = {
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#F3F4F6',
  'No Transition': '#059669',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  'Delay Block': '#7C3AED',
  TBD: '#6B7280',
  KILLED: '#DC2626',
  Podium: '#8B4513',
  Panel: '#404040',
  'PreShow/End': '#8B5CF6'
};
const PROGRAM_TYPE_OPTIONS = [
  'Podium Transition',
  'Panel Transition',
  'Sub Cue',
  'No Transition',
  'Video',
  'Panel+Remote',
  'Remote Only',
  'Break F&B/B2B',
  'Breakout Session',
  'Delay Block',
  'TBD',
  'KILLED',
  'Podium',
  'Panel',
  'PreShow/End'
];

const SHOT_TYPES = ['Podium', '1-Shot', '2-Shot', '3-Shot', '4-Shot', '5-Shot', '6-Shot', '7-Shot', 'Ted-Talk'];

interface CustomColumn {
  name: string;
  id: string;
}

interface ScheduleItem {
  id: number;
  day: number;
  programType: string;
  shotType: string;
  segmentName: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  notes: string;
  assets: string;
  speakersText: string;
  hasPPT?: boolean;
  hasQA?: boolean;
  customFields: Record<string, string>;
  isStartCue?: boolean;
}

type IndentedMap = Record<number, { parentId: number; userName?: string }>;
type AssetRow = { id: string; name: string; link: string; linkEnabled: boolean };
type SpeakerSlotDraft = {
  id: string;
  slot: number;
  location: 'Podium' | 'Seat' | 'Virtual' | 'Moderator';
  fullName: string;
  title: string;
  org: string;
  photoLink: string;
};

function normalizeScheduleItem(raw: any): ScheduleItem {
  const sec = raw.duration_seconds ?? raw.durationSeconds ?? 0;
  const cf = raw.customFields ?? raw.custom_fields ?? {};
  return {
    id: Number(raw.id),
    day: Number(raw.day ?? 1),
    programType: String(raw.programType ?? raw.program_type ?? ''),
    shotType: String(raw.shotType ?? raw.shot_type ?? ''),
    segmentName: String(raw.segmentName ?? raw.segment_name ?? ''),
    durationHours: Math.floor(sec / 3600),
    durationMinutes: Math.floor((sec % 3600) / 60),
    durationSeconds: sec % 60,
    notes: String(raw.notes ?? ''),
    assets: String(raw.assets ?? ''),
    speakersText: String(raw.speakersText ?? raw.speakers_text ?? ''),
    hasPPT: !!(raw.hasPPT ?? raw.has_ppt),
    hasQA: !!(raw.hasQA ?? raw.has_qa),
    customFields: typeof cf === 'object' && cf !== null ? cf : {},
    isStartCue: !!(raw.isStartCue ?? raw.is_start_cue)
  };
}

function formatCueDisplay(cue: string | undefined): string {
  if (!cue) return 'CUE';
  if (cue.includes('CUE ')) return cue;
  return cue.replace(/^CUE(\d+)$/, 'CUE $1');
}

function formatDurationClock(it: ScheduleItem): string {
  const { durationHours: h, durationMinutes: m, durationSeconds: s } = it;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatDurationShort(it: ScheduleItem): string {
  const { durationHours: h, durationMinutes: m, durationSeconds: s } = it;
  if (h === 0 && m === 0 && s === 0) return '—';
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Walk up parent links until this id is a top-level (non-indented) row. */
function rootIdFor(itemId: number, indented: IndentedMap): number {
  let cur = itemId;
  const seen = new Set<number>();
  while (indented[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = indented[cur].parentId;
    if (seen.size > 40) break;
  }
  return cur;
}

/** Only http(s) embed targets — blocks javascript:, data:, etc. */
function sanitizeStreamEmbedUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function embedUrlFromSearchParam(raw: string | null): string | null {
  if (!raw) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  return sanitizeStreamEmbedUrl(decoded);
}

function youtubeEmbedUrl(base: string): string | null {
  try {
    const u = new URL(base);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
      const short = u.pathname.match(/\/shorts\/([^/]+)/);
      if (short) return `https://www.youtube.com/embed/${short[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

function vimeoEmbedUrl(base: string): string | null {
  try {
    const u = new URL(base);
    if (!u.hostname.includes('vimeo.com')) return null;
    const id = u.pathname.match(/\/(\d+)/);
    return id ? `https://player.vimeo.com/video/${id[1]}` : null;
  } catch {
    return null;
  }
}

/** PDF, Drive, Office web, video hosts — for creative PDF + per-cue asset preview */
function normalizeCreativeEmbedUrl(raw: string): string | null {
  const base = sanitizeStreamEmbedUrl(raw);
  if (!base) return null;
  const yt = youtubeEmbedUrl(base);
  if (yt) return yt;
  const vimeo = vimeoEmbedUrl(base);
  if (vimeo) return vimeo;
  try {
    const u = new URL(base);
    const driveFile = u.hostname.includes('drive.google.com') && u.pathname.match(/\/file\/d\/([^/]+)/);
    if (driveFile) {
      return `https://drive.google.com/file/d/${driveFile[1]}/preview`;
    }
    if (u.hostname.includes('docs.google.com') && u.pathname.includes('/document/')) {
      return base.includes('embedded=true') ? base : `${base}${base.includes('?') ? '&' : '?'}embedded=true`;
    }
    const path = u.pathname.toLowerCase();
    if (path.endsWith('.pdf') || path.endsWith('.ppt') || path.endsWith('.pptx')) {
      return base;
    }
  } catch {
    return base;
  }
  return base;
}

function cueNeedsCreativeExtras(item: ScheduleItem): boolean {
  return !!item.hasPPT || item.programType === 'Video';
}

function creativeExtraAssetRows(item: ScheduleItem): AssetRow[] {
  return parseAssetRows(item.assets ?? '').filter((a) => a.linkEnabled && a.link.trim());
}

function depthFor(itemId: number, indented: IndentedMap): number {
  let d = 0;
  let cur = itemId;
  const seen = new Set<number>();
  while (indented[cur] && !seen.has(cur)) {
    seen.add(cur);
    d++;
    cur = indented[cur].parentId;
    if (d > 40) break;
  }
  return d;
}

function notesForEditor(raw: string): string {
  if (!raw) return '';
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  if (looksHtml) return raw;
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

function parseAssetRows(raw: string): AssetRow[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('||')
    .map((s, idx) => {
      const piece = s.trim();
      if (!piece) return null;
      const [namePart, ...rest] = piece.split('|');
      const name = (namePart || '').trim();
      const link = rest.join('|').trim();
      if (!name) return null;
      return {
        id: `asset-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        link,
        linkEnabled: link.length > 0
      } as AssetRow;
    })
    .filter((r): r is AssetRow => !!r);
}

function stringifyAssetRows(rows: AssetRow[]): string {
  return rows
    .map((r) => {
      const name = r.name.trim();
      const link = r.link.trim();
      if (!name) return '';
      return r.linkEnabled && link ? `${name}|${link}` : name;
    })
    .filter(Boolean)
    .join('||');
}

function parseSpeakersDraft(speakersTextJson: string): SpeakerSlotDraft[] {
  if (!speakersTextJson) return [];
  try {
    const arr = JSON.parse(speakersTextJson);
    if (!Array.isArray(arr)) return [];
    const out: SpeakerSlotDraft[] = [];
    for (const s of arr) {
      const slot = Number(s.slot);
      if (!Number.isFinite(slot) || slot < 1 || slot > 7) continue;
      const location = s.location === 'Seat' || s.location === 'Virtual' || s.location === 'Moderator' ? s.location : 'Podium';
      out.push({
        id: (s.id || `speaker-slot-${slot}`).toString(),
        slot,
        location,
        fullName: (s.fullName || '').toString(),
        title: (s.title || '').toString(),
        org: (s.org || '').toString(),
        photoLink: (s.photoLink || '').toString()
      });
    }
    out.sort((a, b) => a.slot - b.slot);
    return out;
  } catch {
    return [];
  }
}

function stringifySpeakersDraft(rows: SpeakerSlotDraft[]): string {
  const payload = rows
    .filter((r) => r.fullName.trim().length > 0)
    .map((r) => ({
      id: r.id || `speaker-slot-${r.slot}`,
      slot: r.slot,
      location: r.location,
      fullName: r.fullName.trim(),
      title: r.title.trim(),
      org: r.org.trim(),
      photoLink: r.photoLink.trim()
    }));
  return JSON.stringify(payload);
}

function buildIndentedMap(data: any[] | null): IndentedMap {
  const map: IndentedMap = {};
  if (!data || !Array.isArray(data)) return map;
  for (const row of data) {
    const itemId = row.item_id ?? row.itemId;
    const parentId = row.parent_item_id ?? row.parentItemId;
    if (itemId != null && parentId != null) {
      map[Number(itemId)] = {
        parentId: Number(parentId),
        userName: row.user_name ?? row.userName
      };
    }
  }
  return map;
}

/** Seven slots with full speaker fields for read-only detail view */
function parseSpeakersSlotsDetailed(speakersTextJson: string): (SpeakerSlotDraft | null)[] {
  const out: (SpeakerSlotDraft | null)[] = Array(7).fill(null);
  for (const row of parseSpeakersDraft(speakersTextJson)) {
    if (row.slot >= 1 && row.slot <= 7) out[row.slot - 1] = row;
  }
  return out;
}

/** Seven speaker slots like PhotoView print row */
function parseSpeakersSlots(speakersTextJson: string): string[] {
  const out = Array(7).fill('');
  if (!speakersTextJson) return out;
  try {
    const arr = JSON.parse(speakersTextJson);
    if (!Array.isArray(arr)) return out;
    for (const s of arr) {
      const slot = Number(s.slot);
      if (!Number.isFinite(slot) || slot < 1 || slot > 7) continue;
      const loc =
        s.location === 'Podium'
          ? 'P'
          : s.location === 'Seat'
            ? 'S'
            : s.location === 'Virtual'
              ? 'V'
              : 'M';
      const name = (s.fullName || '').trim() || '—';
      out[slot - 1] = `${loc}${slot}\n${name}`;
    }
  } catch {
    /* ignore */
  }
  return out;
}

function truncateSpeakerField(text: string, maxLength = 20): string {
  const t = text.trim();
  if (t.length <= maxLength) return t;
  return `${t.slice(0, maxLength - 1)}…`;
}

/** Slots 1–7 left-to-right (PhotoView-style), compact or with photo/title/org */
function SpeakerSlotsReadOnlyRow({
  speakersText,
  expanded,
  compactClassName = 'p-2'
}: {
  speakersText: string;
  expanded: boolean;
  compactClassName?: string;
}) {
  const slots = parseSpeakersSlotsDetailed(speakersText);
  const compactCells = parseSpeakersSlots(speakersText);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[40rem] grid-cols-7 divide-x divide-slate-600">
        {slots.map((sp, i) => {
          const slotNum = i + 1;
          const hasSpeaker =
            sp && (sp.fullName.trim() || sp.title.trim() || sp.org.trim() || sp.photoLink.trim());

          return (
            <div
              key={`speaker-slot-${slotNum}`}
              className={`flex min-w-0 flex-col ${compactClassName} ${
                expanded ? 'items-center text-center' : 'justify-start text-center'
              }`}
            >
              <div className="text-[10px] font-bold uppercase text-slate-500">Slot {slotNum}</div>
              {expanded ? (
                hasSpeaker && sp ? (
                  <div className="mt-1 flex w-full flex-col items-center">
                    <div className="mb-1.5 flex justify-center">
                      <img
                        src={sp.photoLink.trim() || '/speaker-placeholder.svg'}
                        alt={sp.fullName || `Speaker ${slotNum}`}
                        className="h-20 w-16 rounded border border-slate-500 object-cover object-top shadow-sm"
                        onError={(e) => {
                          const img = e.currentTarget as HTMLImageElement;
                          img.onerror = null;
                          img.src = '/speaker-placeholder.svg';
                        }}
                      />
                    </div>
                    <div className="w-full text-xs font-semibold leading-tight text-white">
                      {sp.fullName.trim() || '—'}
                    </div>
                    {sp.title.trim() ? (
                      <div
                        className="mt-1 w-full px-0.5 text-[10px] leading-tight text-slate-400"
                        title={sp.title.trim()}
                      >
                        {truncateSpeakerField(sp.title, 20)}
                      </div>
                    ) : null}
                    {sp.org.trim() ? (
                      <div
                        className="mt-0.5 w-full px-0.5 text-[10px] leading-tight text-slate-400"
                        title={sp.org.trim()}
                      >
                        {truncateSpeakerField(sp.org, 20)}
                      </div>
                    ) : null}
                    <div className="mt-1 rounded bg-slate-700/90 px-1.5 py-0.5 text-[9px] font-medium text-slate-300">
                      {sp.location || '—'}
                    </div>
                    {sp.photoLink.trim() ? (
                      <a
                        href={sp.photoLink.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 truncate text-[9px] text-cyan-400 hover:text-cyan-300"
                        title={sp.photoLink.trim()}
                      >
                        Photo
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-1 items-center justify-center text-[10px] text-slate-500">—</div>
                )
              ) : (
                <div className="mt-1 whitespace-pre-line text-xs font-semibold leading-snug text-white">
                  {compactCells[i] || '—'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ContentReviewPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlParams = new URLSearchParams(location.search);
  const eventIdParam = urlParams.get('eventId');
  const eventNameParam = urlParams.get('eventName');

  const [event, setEvent] = useState<Event>(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id) return fromState;
    return {
      id: eventIdParam || '',
      name: eventNameParam || 'Event',
      date: '',
      location: '',
      numberOfDays: 1
    };
  });

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [indented, setIndented] = useState<IndentedMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const cueButtonRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const eventId = event?.id || eventIdParam || '';

  const goBackFromContentReview = useCallback(() => {
    if (eventId) {
      navigate('/run-of-show', {
        state: {
          event: {
            ...event,
            id: eventId,
            name: event.name || eventNameParam || 'Event',
          },
        },
      });
      return;
    }
    navigate('/');
  }, [event, eventId, eventNameParam, navigate]);

  const streamFromQuery = useMemo(
    () => embedUrlFromSearchParam(searchParams.get('streamUrl')),
    [searchParams]
  );
  const creativePdfFromQuery = useMemo(
    () => embedUrlFromSearchParam(searchParams.get('creativePdf')),
    [searchParams]
  );
  const streamStorageKey = eventId ? `ros.contentReview.streamUrl.${eventId}` : null;
  const creativePdfStorageKey = eventId ? `ros.contentReview.creativePdfUrl.${eventId}` : null;
  const sideRailStorageKey = eventId ? `ros.contentReview.sideRailWidth.${eventId}` : null;
  const [savedStreamUrl, setSavedStreamUrl] = useState<string | null>(null);
  const [streamPanelOpen, setStreamPanelOpen] = useState(false);
  const [streamFloatOpen, setStreamFloatOpen] = useState(false);
  const [streamFloatRect, setStreamFloatRect] = useState<StreamFloatRect>({
    left: 0,
    top: 0,
    width: 920,
    height: 560
  });
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSaveMessage, setNotesSaveMessage] = useState<string | null>(null);
  const [segmentDraft, setSegmentDraft] = useState('');
  const [segmentDirty, setSegmentDirty] = useState(false);
  const [isSavingSegment, setIsSavingSegment] = useState(false);
  const [segmentSaveMessage, setSegmentSaveMessage] = useState<string | null>(null);
  const [shotDraft, setShotDraft] = useState('');
  const [shotDirty, setShotDirty] = useState(false);
  const [isSavingShot, setIsSavingShot] = useState(false);
  const [shotSaveMessage, setShotSaveMessage] = useState<string | null>(null);
  const [assetsDraft, setAssetsDraft] = useState('');
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);
  const [assetsDirty, setAssetsDirty] = useState(false);
  const [isSavingAssets, setIsSavingAssets] = useState(false);
  const [assetsSaveMessage, setAssetsSaveMessage] = useState<string | null>(null);
  const [durationHoursDraft, setDurationHoursDraft] = useState('0');
  const [durationMinutesDraft, setDurationMinutesDraft] = useState('0');
  const [durationSecondsDraft, setDurationSecondsDraft] = useState('0');
  const [durationDirty, setDurationDirty] = useState(false);
  const [isSavingDuration, setIsSavingDuration] = useState(false);
  const [durationSaveMessage, setDurationSaveMessage] = useState<string | null>(null);
  const [customFieldsDraft, setCustomFieldsDraft] = useState<Record<string, string>>({});
  const [customFieldsDirty, setCustomFieldsDirty] = useState(false);
  const [isSavingCustomFields, setIsSavingCustomFields] = useState(false);
  const [customFieldsSaveMessage, setCustomFieldsSaveMessage] = useState<string | null>(null);
  const [hasPptDraft, setHasPptDraft] = useState(false);
  const [hasQaDraft, setHasQaDraft] = useState(false);
  const [pptQaDirty, setPptQaDirty] = useState(false);
  const [isSavingPptQa, setIsSavingPptQa] = useState(false);
  const [pptQaSaveMessage, setPptQaSaveMessage] = useState<string | null>(null);
  const [cueDraft, setCueDraft] = useState('');
  const [programTypeDraft, setProgramTypeDraft] = useState('');
  const [cueProgramDirty, setCueProgramDirty] = useState(false);
  const [isSavingCueProgram, setIsSavingCueProgram] = useState(false);
  const [cueProgramSaveMessage, setCueProgramSaveMessage] = useState<string | null>(null);
  const [cueProgramError, setCueProgramError] = useState<string | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState<SpeakerSlotDraft[]>([]);
  const [speakersDirty, setSpeakersDirty] = useState(false);
  const [isSavingSpeakers, setIsSavingSpeakers] = useState(false);
  const [speakersSaveMessage, setSpeakersSaveMessage] = useState<string | null>(null);
  const notesEditorRef = useRef<HTMLDivElement>(null);
  /** Width of review+stream column on large screens (px). */
  const [sideRailWidthPx, setSideRailWidthPx] = useState(416);
  const [isLgLayout, setIsLgLayout] = useState(false);
  const [sideRailResizing, setSideRailResizing] = useState(false);
  const [streamUrlDraft, setStreamUrlDraft] = useState('');
  const [streamSetupOpen, setStreamSetupOpen] = useState(false);
  const [savedCreativePdfUrl, setSavedCreativePdfUrl] = useState<string | null>(null);
  const [creativePdfUrlDraft, setCreativePdfUrlDraft] = useState('');
  const [creativePdfSetupOpen, setCreativePdfSetupOpen] = useState(true);
  /** When set, main creative iframe shows this cue asset instead of the event PDF */
  const [creativeEmbedOverride, setCreativeEmbedOverride] = useState<string | null>(null);
  const [creativeEmbedOverrideLabel, setCreativeEmbedOverrideLabel] = useState<string | null>(null);
  const [cueReviews, setCueReviews] = useState<CueReviewMap>({});
  const [contentReviewHydrated, setContentReviewHydrated] = useState(false);
  const contentReviewHydratedRef = useRef(false);
  const [activeReviewStage, setActiveReviewStage] = useState<ReviewStage>('creative');
  const speakerDetailsStorageKey = eventId ? `ros.contentReview.speakerDetails.${eventId}` : null;
  const activeReviewStageStorageKey = eventId ? `ros.contentReview.activeStage.${eventId}` : null;
  const [speakerDetailsExpanded, setSpeakerDetailsExpanded] = useState(false);

  const [followMode, setFollowMode] = useState<ContentReviewFollowMode>('solo');
  const [followSourceName, setFollowSourceName] = useState('');
  const followModeRef = useRef<ContentReviewFollowMode>('solo');
  const scheduleRef = useRef<ScheduleItem[]>([]);
  const applyRemoteSelectionRef = useRef(false);
  const scheduleLenRef = useRef(0);

  const driverId = user?.id ?? 'guest';
  const driverName = (user?.full_name || user?.email || 'Guest').trim() || 'Guest';
  const reviewStorageKey = eventId ? `ros.contentReview.cueReview.${eventId}` : null;
  const streamDragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0
  });
  const streamResizeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0
  });
  /** `active` while dragging the main | review split; `lastW` for persistence. */
  const sideRailDragRef = useRef<{ active: boolean; lastW: number }>({ active: false, lastW: 416 });
  const sideRailResizeRowRef = useRef<HTMLDivElement>(null);

  const clampSideRailWidth = useCallback((w: number) => {
    if (typeof window === 'undefined') return w;
    const minW = 260;
    const maxW = Math.min(680, Math.floor(window.innerWidth * 0.58));
    return Math.min(Math.max(w, minW), Math.max(minW, maxW));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsLgLayout(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (contentReviewHydrated) return;
    if (!sideRailStorageKey || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(sideRailStorageKey);
      if (!raw) return;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n)) return;
      setSideRailWidthPx(clampSideRailWidth(n));
    } catch {
      /* ignore */
    }
  }, [sideRailStorageKey, clampSideRailWidth, contentReviewHydrated]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setSideRailWidthPx((w) => clampSideRailWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampSideRailWidth]);

  const clampStreamRect = useCallback((next: StreamFloatRect): StreamFloatRect => {
    if (typeof window === 'undefined') return next;
    const margin = 8;
    const minW = 360;
    const minH = 220;
    const maxW = Math.max(minW, window.innerWidth - margin * 2);
    const maxH = Math.max(minH, window.innerHeight - margin * 2);
    const width = Math.min(Math.max(next.width, minW), maxW);
    const height = Math.min(Math.max(next.height, minH), maxH);
    const left = Math.min(Math.max(next.left, margin), window.innerWidth - width - margin);
    const top = Math.min(Math.max(next.top, margin), window.innerHeight - height - margin);
    return { left, top, width, height };
  }, []);

  const readLocalCueReviews = useCallback((): CueReviewMap => {
    if (!reviewStorageKey || typeof localStorage === 'undefined') return {};
    try {
      const raw = localStorage.getItem(reviewStorageKey);
      if (!raw) return {};
      return normalizeCueReviewMap(JSON.parse(raw));
    } catch {
      return {};
    }
  }, [reviewStorageKey]);

  useEffect(() => {
    if (!activeReviewStageStorageKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(activeReviewStageStorageKey, activeReviewStage);
    } catch {
      /* ignore quota */
    }
  }, [activeReviewStageStorageKey, activeReviewStage]);

  useEffect(() => {
    if (!reviewStorageKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(reviewStorageKey, JSON.stringify(cueReviews));
    } catch {
      /* ignore quota */
    }
  }, [reviewStorageKey, cueReviews]);

  useEffect(() => {
    if (!eventId || !contentReviewHydrated) return;
    const t = window.setTimeout(() => {
      void DatabaseService.saveContentReviewData(eventId, {
        reviews: cueReviews as Record<string, unknown>,
        stream_url: savedStreamUrl,
        creative_pdf_url: savedCreativePdfUrl,
        active_stage: activeReviewStage,
        side_rail_width_px: sideRailWidthPx,
        last_modified_by: driverId,
        last_modified_by_name: driverName,
      });
    }, 900);
    return () => window.clearTimeout(t);
  }, [
    eventId,
    contentReviewHydrated,
    cueReviews,
    savedStreamUrl,
    savedCreativePdfUrl,
    activeReviewStage,
    sideRailWidthPx,
    driverId,
    driverName,
  ]);

  useEffect(() => {
    if (!speakerDetailsStorageKey || typeof localStorage === 'undefined') {
      setSpeakerDetailsExpanded(false);
      return;
    }
    try {
      setSpeakerDetailsExpanded(localStorage.getItem(speakerDetailsStorageKey) === '1');
    } catch {
      setSpeakerDetailsExpanded(false);
    }
  }, [speakerDetailsStorageKey]);

  useEffect(() => {
    if (!speakerDetailsStorageKey || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(speakerDetailsStorageKey, speakerDetailsExpanded ? '1' : '0');
    } catch {
      /* ignore quota */
    }
  }, [speakerDetailsStorageKey, speakerDetailsExpanded]);

  useEffect(() => {
    followModeRef.current = followMode;
  }, [followMode]);

  useEffect(() => {
    scheduleRef.current = schedule;
  }, [schedule]);

  useEffect(() => {
    if (followMode !== 'follow') setFollowSourceName('');
  }, [followMode]);

  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(eventId, {});
    const socket = socketClient.getSocket();
    const onConnect = () => {
      if (followModeRef.current === 'follow') socketClient.emitContentReviewRequestState();
    };
    const onSync = (payload: {
      eventId?: string;
      itemId?: number;
      fromUserName?: string;
    }) => {
      if (!payload || String(payload.eventId) !== String(eventId)) return;
      if (followModeRef.current !== 'follow') return;
      const id = Number(payload.itemId);
      if (!Number.isFinite(id)) return;
      const rows = scheduleRef.current;
      if (!rows.some((r) => r.id === id)) return;
      const name = (payload.fromUserName || '').trim();
      if (name) setFollowSourceName(name);
      applyRemoteSelectionRef.current = true;
      setSelectedId(id);
      queueMicrotask(() => {
        applyRemoteSelectionRef.current = false;
      });
    };
    socket?.on('connect', onConnect);
    socket?.on('contentReviewSelectionSync', onSync);
    if (socket?.connected && followModeRef.current === 'follow') {
      socketClient.emitContentReviewRequestState();
    }
    return () => {
      socket?.off('connect', onConnect);
      socket?.off('contentReviewSelectionSync', onSync);
    };
  }, [eventId]);

  useEffect(() => {
    if (followMode !== 'follow' || !eventId) return;
    if (socketClient.isConnected()) socketClient.emitContentReviewRequestState();
  }, [followMode, eventId]);

  useEffect(() => {
    scheduleLenRef.current = 0;
  }, [eventId]);

  /** If Follow was on before rows loaded, catch up once the schedule exists. */
  useEffect(() => {
    const prev = scheduleLenRef.current;
    const len = schedule.length;
    if (followMode === 'follow' && eventId && prev === 0 && len > 0 && socketClient.isConnected()) {
      socketClient.emitContentReviewRequestState();
    }
    scheduleLenRef.current = len;
  }, [schedule.length, followMode, eventId]);

  useEffect(() => {
    if (!eventId || followMode !== 'drive' || selectedId == null) return;
    if (applyRemoteSelectionRef.current) return;
    socketClient.emitContentReviewSelectionUpdate(selectedId, driverId, driverName);
  }, [eventId, followMode, selectedId, driverId, driverName]);

  useEffect(() => {
    if (streamFromQuery) {
      setSavedStreamUrl(streamFromQuery);
      return;
    }
    if (contentReviewHydrated) return;
    if (!streamStorageKey || typeof localStorage === 'undefined') {
      setSavedStreamUrl(null);
      return;
    }
    try {
      const stored = localStorage.getItem(streamStorageKey);
      setSavedStreamUrl(stored ? sanitizeStreamEmbedUrl(stored) : null);
    } catch {
      setSavedStreamUrl(null);
    }
  }, [streamFromQuery, streamStorageKey, contentReviewHydrated]);

  useEffect(() => {
    if (streamFromQuery) setStreamPanelOpen(true);
  }, [streamFromQuery]);

  useEffect(() => {
    if (creativePdfFromQuery) {
      setSavedCreativePdfUrl(creativePdfFromQuery);
      setCreativePdfSetupOpen(false);
      return;
    }
    if (contentReviewHydrated) return;
    if (!creativePdfStorageKey || typeof localStorage === 'undefined') {
      setSavedCreativePdfUrl(null);
      return;
    }
    try {
      const stored = localStorage.getItem(creativePdfStorageKey);
      const parsed = stored ? normalizeCreativeEmbedUrl(stored) : null;
      setSavedCreativePdfUrl(parsed);
      setCreativePdfSetupOpen(!parsed);
    } catch {
      setSavedCreativePdfUrl(null);
      setCreativePdfSetupOpen(true);
    }
  }, [creativePdfFromQuery, creativePdfStorageKey, contentReviewHydrated]);

  useEffect(() => {
    if (activeReviewStage === 'creative' && editModeEnabled) setEditModeEnabled(false);
  }, [activeReviewStage, editModeEnabled]);

  useEffect(() => {
    setCreativeEmbedOverride(null);
    setCreativeEmbedOverrideLabel(null);
  }, [selectedId]);

  const applyCreativePdfUrl = useCallback(() => {
    const next = normalizeCreativeEmbedUrl(creativePdfUrlDraft);
    if (!next) return;
    setSavedCreativePdfUrl(next);
    if (creativePdfStorageKey) {
      try {
        localStorage.setItem(creativePdfStorageKey, next);
      } catch {
        /* ignore quota */
      }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('creativePdf', next);
        return p;
      },
      { replace: true }
    );
    setCreativePdfUrlDraft(next);
    setCreativePdfSetupOpen(false);
  }, [creativePdfUrlDraft, creativePdfStorageKey, setSearchParams]);

  const clearCreativePdfUrl = useCallback(() => {
    setSavedCreativePdfUrl(null);
    setCreativePdfUrlDraft('');
    if (creativePdfStorageKey) {
      try {
        localStorage.removeItem(creativePdfStorageKey);
      } catch {
        /* ignore */
      }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('creativePdf');
        return p;
      },
      { replace: true }
    );
    setCreativePdfSetupOpen(true);
  }, [creativePdfStorageKey, setSearchParams]);

  const applyStreamUrl = useCallback(() => {
    const next = sanitizeStreamEmbedUrl(streamUrlDraft);
    if (!next) return;
    setSavedStreamUrl(next);
    if (streamStorageKey) {
      try {
        localStorage.setItem(streamStorageKey, next);
      } catch {
        /* ignore quota */
      }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('streamUrl', next);
        return p;
      },
      { replace: true }
    );
    setStreamUrlDraft(next);
    setStreamSetupOpen(false);
  }, [streamUrlDraft, streamStorageKey, setSearchParams]);

  const clearStreamUrl = useCallback(() => {
    setSavedStreamUrl(null);
    setStreamUrlDraft('');
    if (streamStorageKey) {
      try {
        localStorage.removeItem(streamStorageKey);
      } catch {
        /* ignore */
      }
    }
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('streamUrl');
        return p;
      },
      { replace: true }
    );
    setStreamSetupOpen(true);
  }, [streamStorageKey, setSearchParams]);

  useEffect(() => {
    if (!savedStreamUrl) setStreamFloatOpen(false);
  }, [savedStreamUrl]);

  useEffect(() => {
    if (!streamFloatOpen || typeof window === 'undefined') return;
    setStreamFloatRect((prev) => {
      const next = prev.left === 0 && prev.top === 0 ? { left: window.innerWidth - 960, top: window.innerHeight - 600, width: 920, height: 560 } : prev;
      return clampStreamRect(next);
    });
  }, [streamFloatOpen, clampStreamRect]);

  useEffect(() => {
    if (!streamFloatOpen || typeof window === 'undefined') return;
    const onResize = () => setStreamFloatRect((prev) => clampStreamRect(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [streamFloatOpen, clampStreamRect]);

  useEffect(() => {
    if (!streamFloatOpen || typeof window === 'undefined') return;
    const onMove = (e: PointerEvent) => {
      if (streamDragRef.current.active) {
        const nextLeft = e.clientX - streamDragRef.current.offsetX;
        const nextTop = e.clientY - streamDragRef.current.offsetY;
        setStreamFloatRect((prev) => clampStreamRect({ ...prev, left: nextLeft, top: nextTop }));
        return;
      }
      if (streamResizeRef.current.active) {
        const dx = e.clientX - streamResizeRef.current.startX;
        const dy = e.clientY - streamResizeRef.current.startY;
        setStreamFloatRect((prev) =>
          clampStreamRect({
            ...prev,
            width: streamResizeRef.current.startWidth + dx,
            height: streamResizeRef.current.startHeight + dy
          })
        );
      }
    };
    const onUp = () => {
      streamDragRef.current.active = false;
      streamResizeRef.current.active = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [streamFloatOpen, clampStreamRect]);

  useEffect(() => {
    if (!sideRailResizing) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [sideRailResizing]);

  const startDragStreamFloat = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    streamDragRef.current = {
      active: true,
      offsetX: e.clientX - streamFloatRect.left,
      offsetY: e.clientY - streamFloatRect.top
    };
  }, [streamFloatRect.left, streamFloatRect.top]);

  const startResizeStreamFloat = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    streamResizeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: streamFloatRect.width,
      startHeight: streamFloatRect.height
    };
  }, [streamFloatRect.height, streamFloatRect.width]);

  /** Match `w-3` grip; width = review/stream column only (not the grip). */
  const SIDE_RAIL_GRIP_PX = 12;
  const SIDE_RAIL_MIN_MAIN_PX = 260;

  const updateSideRailWidthFromPointer = useCallback(
    (e: { clientX: number }) => {
      const row = sideRailResizeRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const rawW = rect.right - e.clientX - SIDE_RAIL_GRIP_PX;
      const rowMax = Math.max(260, rect.width - SIDE_RAIL_MIN_MAIN_PX - SIDE_RAIL_GRIP_PX);
      const next = clampSideRailWidth(Math.min(rawW, rowMax));
      sideRailDragRef.current.lastW = next;
      setSideRailWidthPx(next);
    },
    [clampSideRailWidth]
  );

  const endSideRailDrag = useCallback(() => {
    const was = sideRailDragRef.current.active;
    sideRailDragRef.current.active = false;
    setSideRailResizing(false);
    if (was && sideRailStorageKey && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(sideRailStorageKey, String(sideRailDragRef.current.lastW));
      } catch {
        /* ignore quota */
      }
    }
  }, [sideRailStorageKey]);

  const startSideRailResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sideRailDragRef.current = { active: true, lastW: sideRailWidthPx };
      setSideRailResizing(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      updateSideRailWidthFromPointer(e.nativeEvent);
    },
    [sideRailWidthPx, updateSideRailWidthFromPointer]
  );

  useEffect(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id) setEvent(fromState);
  }, [location.state]);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing event. Open Content Review from the Run of Show menu, or add ?eventId= to the URL.');
      setLoading(false);
      setContentReviewHydrated(false);
      contentReviewHydratedRef.current = false;
      return;
    }
    setLoading(true);
    setError(null);
    setContentReviewHydrated(false);
    contentReviewHydratedRef.current = false;
    try {
      const [data, indentedRows, reviewData] = await Promise.all([
        DatabaseService.getRunOfShowData(eventId),
        DatabaseService.getIndentedCues(eventId),
        DatabaseService.getContentReviewData(eventId),
      ]);
      if (!data?.schedule_items?.length) {
        setSchedule([]);
        setCustomColumns((data?.custom_columns as CustomColumn[]) || []);
        setIndented(buildIndentedMap(indentedRows));
        setError('No schedule rows found for this event.');
        setLoading(false);
        return;
      }
      const items = (data.schedule_items as any[]).map(normalizeScheduleItem);
      setSchedule(items);
      setCustomColumns(Array.isArray(data.custom_columns) ? (data.custom_columns as CustomColumn[]) : []);
      setIndented(buildIndentedMap(indentedRows));

      const localReviews = readLocalCueReviews();
      const apiReviews = reviewData?.reviews ? normalizeCueReviewMap(reviewData.reviews) : {};
      const hasApiReviews = Object.keys(apiReviews).length > 0;
      const hasLocalReviews = Object.keys(localReviews).length > 0;
      setCueReviews(hasApiReviews ? apiReviews : hasLocalReviews ? localReviews : {});

      if (reviewData?.active_stage === 'ros' || reviewData?.active_stage === 'creative') {
        setActiveReviewStage(reviewData.active_stage);
      } else if (activeReviewStageStorageKey && typeof localStorage !== 'undefined') {
        try {
          const saved = localStorage.getItem(activeReviewStageStorageKey);
          setActiveReviewStage(saved === 'ros' ? 'ros' : 'creative');
        } catch {
          setActiveReviewStage('creative');
        }
      }

      if (!streamFromQuery && reviewData?.stream_url) {
        setSavedStreamUrl(sanitizeStreamEmbedUrl(reviewData.stream_url));
      }
      if (!creativePdfFromQuery && reviewData?.creative_pdf_url) {
        const pdf = normalizeCreativeEmbedUrl(reviewData.creative_pdf_url);
        setSavedCreativePdfUrl(pdf);
        setCreativePdfSetupOpen(!pdf);
      }
      if (reviewData?.side_rail_width_px != null && Number.isFinite(reviewData.side_rail_width_px)) {
        setSideRailWidthPx(clampSideRailWidth(reviewData.side_rail_width_px));
      }

      setError(null);
    } catch (e) {
      console.error(e);
      setError('Could not load run of show data.');
    } finally {
      setLoading(false);
      setContentReviewHydrated(true);
      contentReviewHydratedRef.current = true;
    }
  }, [
    eventId,
    readLocalCueReviews,
    activeReviewStageStorageKey,
    streamFromQuery,
    creativePdfFromQuery,
    clampSideRailWidth,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const cueLabel = useCallback((it: ScheduleItem) => {
    const raw = (it.customFields?.cue ?? '').toString().trim();
    return raw || `Row ${it.id}`;
  }, []);

  /** Roots in schedule order, each with its subtree (same order as ROS). */
  const cueGroups = useMemo(() => {
    const byRoot = new Map<number, ScheduleItem[]>();
    for (const it of schedule) {
      const r = rootIdFor(it.id, indented);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r)!.push(it);
    }
    const rootsInOrder: number[] = [];
    const seen = new Set<number>();
    for (const it of schedule) {
      const r = rootIdFor(it.id, indented);
      if (!seen.has(r)) {
        seen.add(r);
        rootsInOrder.push(r);
      }
    }
    return rootsInOrder.map((rootId) => ({ rootId, items: byRoot.get(rootId) ?? [] }));
  }, [schedule, indented]);

  useEffect(() => {
    if (!schedule.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !schedule.some((r) => r.id === selectedId)) {
      setSelectedId(schedule[0].id);
    }
  }, [schedule, selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    const el = cueButtonRefs.current.get(selectedId);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const selectedRow = useMemo(
    () => (selectedId == null ? null : schedule.find((r) => r.id === selectedId) ?? null),
    [schedule, selectedId]
  );
  const selectedReview = selectedRow ? cueReviews[selectedRow.id] : undefined;
  const selectedStageReview = getStageReview(selectedReview, activeReviewStage);
  const selectedStatus: ReviewStatus = selectedStageReview.status;
  const selectedNote = selectedStageReview.note;
  const selectedFullyApproved = isFullyApproved(selectedReview);
  const rosApproveBlocked =
    activeReviewStage === 'ros' && !canApproveRosStage(selectedReview);

  const setCueReviewStatus = useCallback(
    (itemId: number, stage: ReviewStage, status: ReviewStatus) => {
      setCueReviews((prev) => {
        const before = prev[itemId] ?? emptyCueReviewEntry();
        if (stage === 'ros' && status === 'approved' && !canApproveRosStage(before)) {
          return prev;
        }
        const stageBefore = getStageReview(before, stage);
        return {
          ...prev,
          [itemId]: {
            ...before,
            [stage]: {
              status,
              note: stageBefore.note,
              updatedAt: new Date().toISOString(),
              updatedBy: driverName
            }
          }
        };
      });
    },
    [driverName]
  );

  const setCueReviewNote = useCallback(
    (itemId: number, stage: ReviewStage, note: string) => {
      setCueReviews((prev) => {
        const before = prev[itemId] ?? emptyCueReviewEntry();
        const stageBefore = getStageReview(before, stage);
        return {
          ...prev,
          [itemId]: {
            ...before,
            [stage]: {
              status: stageBefore.status,
              note,
              updatedAt: new Date().toISOString(),
              updatedBy: driverName
            }
          }
        };
      });
    },
    [driverName]
  );

  const ReviewStageSwitcher = ({ className = '' }: { className?: string }) => (
    <div
      className={`flex rounded-lg border border-slate-600 bg-slate-800/50 p-0.5 ${className}`}
      role="group"
      aria-label="Review stage"
    >
      {REVIEW_STAGES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setActiveReviewStage(id)}
          className={`rounded-md px-2 py-1.5 text-[10px] font-semibold leading-tight md:text-xs ${
            activeReviewStage === id
              ? id === 'creative'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'bg-orange-600 text-white shadow-sm'
              : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  /** Main panel always shows the parent (root) row so subs share the parent’s full content. */
  const displayItem = useMemo(() => {
    if (selectedId == null) return null;
    const root = rootIdFor(selectedId, indented);
    return schedule.find((r) => r.id === root) ?? null;
  }, [schedule, selectedId, indented]);

  const creativeCueItem = selectedRow ?? displayItem ?? null;
  const creativeCueExtras =
    creativeCueItem && cueNeedsCreativeExtras(creativeCueItem) ? creativeCueItem : null;
  const creativeCueAssets = creativeCueItem ? creativeExtraAssetRows(creativeCueItem) : [];
  const creativeIframeSrc = creativeEmbedOverride ?? savedCreativePdfUrl;

  /** Sub-cues under the current parent (same group as sidebar), in run order — shown below parent in main column. */
  const subCuesUnderParent = useMemo(() => {
    if (!displayItem) return [];
    const group = cueGroups.find((g) => g.rootId === displayItem.id);
    if (!group) return [];
    return group.items.filter((it) => it.id !== displayItem.id);
  }, [cueGroups, displayItem]);

  const programColor = (pt: string) => PROGRAM_TYPE_COLORS[pt] || '#6B7280';
  const programTextClass = (pt: string) =>
    pt === 'Sub Cue' || pt === 'KILLED' ? 'text-black' : 'text-white';

  const pptQaString = (it: ScheduleItem) => {
    const parts: string[] = [];
    if (it.hasPPT) parts.push('PPT');
    if (it.hasQA) parts.push('Q&A');
    return parts.length ? parts.join(' / ') : 'None';
  };

  useEffect(() => {
    setNotesDraft(displayItem?.notes ?? '');
    setNotesDirty(false);
    setNotesSaveMessage(null);
    setSegmentDraft(displayItem?.segmentName ?? '');
    setSegmentDirty(false);
    setSegmentSaveMessage(null);
    setShotDraft(displayItem?.shotType ?? '');
    setShotDirty(false);
    setShotSaveMessage(null);
    setAssetsDraft(displayItem?.assets ?? '');
    const parsedAssets = parseAssetRows(displayItem?.assets ?? '');
    setAssetRows(parsedAssets.length ? parsedAssets : [{ id: `asset-${Date.now()}`, name: '', link: '', linkEnabled: false }]);
    setAssetsDirty(false);
    setAssetsSaveMessage(null);
    setDurationHoursDraft(String(displayItem?.durationHours ?? 0));
    setDurationMinutesDraft(String(displayItem?.durationMinutes ?? 0));
    setDurationSecondsDraft(String(displayItem?.durationSeconds ?? 0));
    setDurationDirty(false);
    setDurationSaveMessage(null);
    setCustomFieldsDraft(
      Object.fromEntries((customColumns || []).map((col) => [col.id, (displayItem?.customFields?.[col.id] ?? '').toString()]))
    );
    setCustomFieldsDirty(false);
    setCustomFieldsSaveMessage(null);
    setHasPptDraft(!!displayItem?.hasPPT);
    setHasQaDraft(!!displayItem?.hasQA);
    setPptQaDirty(false);
    setPptQaSaveMessage(null);
    setCueDraft((displayItem?.customFields?.cue ?? '').toString());
    setProgramTypeDraft(displayItem?.programType ?? '');
    setCueProgramDirty(false);
    setCueProgramSaveMessage(null);
    setCueProgramError(null);
    setSpeakerDraft(parseSpeakersDraft(displayItem?.speakersText ?? ''));
    setSpeakersDirty(false);
    setSpeakersSaveMessage(null);
  }, [displayItem?.id, editModeEnabled]);

  useEffect(() => {
    if (!editModeEnabled) return;
    const editor = notesEditorRef.current;
    if (!editor) return;
    editor.innerHTML = notesForEditor(notesDraft);
  }, [editModeEnabled, displayItem?.id]);

  const saveDisplayItemNotes = useCallback(async () => {
    if (!displayItem || !eventId || isSavingNotes) return;
    const nextNotes = notesDraft;
    const updatedSchedule = schedule.map((it) => (it.id === displayItem.id ? { ...it, notes: nextNotes } : it));

    setIsSavingNotes(true);
    setSchedule(updatedSchedule);
    setNotesSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setNotesDirty(false);
      setNotesSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save notes from Content Review:', e);
      setNotesSaveMessage('Save failed');
    } finally {
      setIsSavingNotes(false);
    }
  }, [displayItem, eventId, isSavingNotes, notesDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemSegment = useCallback(async () => {
    if (!displayItem || !eventId || isSavingSegment) return;
    const nextSegment = segmentDraft;
    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id ? { ...it, segmentName: nextSegment } : it
    );

    setIsSavingSegment(true);
    setSchedule(updatedSchedule);
    setSegmentSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setSegmentDirty(false);
      setSegmentSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save segment from Content Review:', e);
      setSegmentSaveMessage('Save failed');
    } finally {
      setIsSavingSegment(false);
    }
  }, [displayItem, eventId, isSavingSegment, segmentDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemShot = useCallback(async () => {
    if (!displayItem || !eventId || isSavingShot) return;
    const nextShot = shotDraft;
    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id ? { ...it, shotType: nextShot } : it
    );

    setIsSavingShot(true);
    setSchedule(updatedSchedule);
    setShotSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setShotDirty(false);
      setShotSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save shot type from Content Review:', e);
      setShotSaveMessage('Save failed');
    } finally {
      setIsSavingShot(false);
    }
  }, [displayItem, eventId, isSavingShot, shotDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemAssets = useCallback(async () => {
    if (!displayItem || !eventId || isSavingAssets) return;
    const nextAssets = stringifyAssetRows(assetRows);
    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id ? { ...it, assets: nextAssets } : it
    );

    setIsSavingAssets(true);
    setSchedule(updatedSchedule);
    setAssetsSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setAssetsDirty(false);
      setAssetsSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save assets from Content Review:', e);
      setAssetsSaveMessage('Save failed');
    } finally {
      setIsSavingAssets(false);
    }
  }, [displayItem, eventId, isSavingAssets, assetRows, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemDuration = useCallback(async () => {
    if (!displayItem || !eventId || isSavingDuration) return;
    const h = Math.max(0, Number.parseInt(durationHoursDraft || '0', 10) || 0);
    const m = Math.min(59, Math.max(0, Number.parseInt(durationMinutesDraft || '0', 10) || 0));
    const s = Math.min(59, Math.max(0, Number.parseInt(durationSecondsDraft || '0', 10) || 0));

    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id
        ? {
            ...it,
            durationHours: h,
            durationMinutes: m,
            durationSeconds: s
          }
        : it
    );

    setIsSavingDuration(true);
    setSchedule(updatedSchedule);
    setDurationSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setDurationDirty(false);
      setDurationSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save duration from Content Review:', e);
      setDurationSaveMessage('Save failed');
    } finally {
      setIsSavingDuration(false);
    }
  }, [
    displayItem,
    eventId,
    isSavingDuration,
    durationHoursDraft,
    durationMinutesDraft,
    durationSecondsDraft,
    schedule,
    event.name,
    event.date,
    customColumns,
    driverId,
    driverName
  ]);

  const saveDisplayItemCustomFields = useCallback(async () => {
    if (!displayItem || !eventId || isSavingCustomFields) return;
    const nextCustomFields = {
      ...(displayItem.customFields || {}),
      ...customFieldsDraft
    };
    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id ? { ...it, customFields: nextCustomFields } : it
    );

    setIsSavingCustomFields(true);
    setSchedule(updatedSchedule);
    setCustomFieldsSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setCustomFieldsDirty(false);
      setCustomFieldsSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save custom fields from Content Review:', e);
      setCustomFieldsSaveMessage('Save failed');
    } finally {
      setIsSavingCustomFields(false);
    }
  }, [displayItem, eventId, isSavingCustomFields, customFieldsDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemPptQa = useCallback(async () => {
    if (!displayItem || !eventId || isSavingPptQa) return;
    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id ? { ...it, hasPPT: hasPptDraft, hasQA: hasQaDraft } : it
    );

    setIsSavingPptQa(true);
    setSchedule(updatedSchedule);
    setPptQaSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setPptQaDirty(false);
      setPptQaSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save PPT/Q&A from Content Review:', e);
      setPptQaSaveMessage('Save failed');
    } finally {
      setIsSavingPptQa(false);
    }
  }, [displayItem, eventId, isSavingPptQa, hasPptDraft, hasQaDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemCueProgram = useCallback(async () => {
    if (!displayItem || !eventId || isSavingCueProgram) return;
    const nextCue = cueDraft.trim();
    const nextProgramType = programTypeDraft.trim();
    if (!nextCue) {
      setCueProgramError('Cue is required.');
      return;
    }
    const cueKey = nextCue.replace(/\s+/g, '').toUpperCase();
    const duplicateCue = schedule.some((it) => {
      if (it.id === displayItem.id) return false;
      const existingCue = (it.customFields?.cue ?? '').toString().trim();
      const existingKey = existingCue.replace(/\s+/g, '').toUpperCase();
      return !!existingKey && existingKey === cueKey;
    });
    if (duplicateCue) {
      setCueProgramError('Cue already exists in this run of show.');
      return;
    }

    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id
        ? {
            ...it,
            programType: nextProgramType,
            customFields: {
              ...(it.customFields || {}),
              cue: nextCue
            }
          }
        : it
    );

    setIsSavingCueProgram(true);
    setSchedule(updatedSchedule);
    setCueProgramSaveMessage(null);
    setCueProgramError(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setCueProgramDirty(false);
      setCueProgramSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save cue/program type from Content Review:', e);
      setCueProgramSaveMessage('Save failed');
    } finally {
      setIsSavingCueProgram(false);
    }
  }, [displayItem, eventId, isSavingCueProgram, cueDraft, programTypeDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const saveDisplayItemSpeakers = useCallback(async () => {
    if (!displayItem || !eventId || isSavingSpeakers) return;
    const nextSpeakersText = stringifySpeakersDraft(speakerDraft);
    const updatedSchedule = schedule.map((it) =>
      it.id === displayItem.id ? { ...it, speakersText: nextSpeakersText } : it
    );

    setIsSavingSpeakers(true);
    setSchedule(updatedSchedule);
    setSpeakersSaveMessage(null);
    try {
      const existing = await DatabaseService.getRunOfShowData(eventId);
      const result = await DatabaseService.saveRunOfShowData(
        {
          event_id: eventId,
          event_name: event.name || existing?.event_name || 'Event',
          event_date: event.date || existing?.event_date || new Date().toISOString().slice(0, 10),
          schedule_items: updatedSchedule,
          custom_columns: customColumns,
          settings: existing?.settings || {}
        },
        {
          userId: driverId,
          userName: driverName,
          userRole: 'OPERATOR'
        }
      );
      if (!result) throw new Error('save failed');
      setSpeakersDirty(false);
      setSpeakersSaveMessage('Saved');
    } catch (e) {
      console.error('Failed to save speakers from Content Review:', e);
      setSpeakersSaveMessage('Save failed');
    } finally {
      setIsSavingSpeakers(false);
    }
  }, [displayItem, eventId, isSavingSpeakers, speakerDraft, schedule, event.name, event.date, customColumns, driverId, driverName]);

  const applyNotesFormatting = useCallback((action: string, value?: string) => {
    const editor = notesEditorRef.current;
    if (!editor) return;
    editor.focus();
    switch (action) {
      case 'bold':
      case 'italic':
      case 'underline':
      case 'justifyLeft':
      case 'justifyCenter':
      case 'justifyRight':
      case 'undo':
      case 'redo':
        document.execCommand(action, false);
        break;
      case 'foreColor':
      case 'backColor':
      case 'fontSize':
        if (value) document.execCommand(action, false, value);
        break;
      case 'clearHighlight':
        document.execCommand('backColor', false, 'transparent');
        break;
      default:
        break;
    }
    const html = editor.innerHTML;
    setNotesDraft(html);
    setNotesDirty(html !== (displayItem?.notes ?? ''));
    setNotesSaveMessage(null);
  }, [displayItem?.notes]);

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--app-header-height)] z-0 flex flex-col bg-slate-900 text-white">
      {/* Slim top bar — page chrome; body does not scroll */}
      <header className="shrink-0 border-b border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-3 py-2.5 md:px-5">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={goBackFromContentReview}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="Back to Run of Show"
            title="Back to Run of Show"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="hidden h-7 w-px shrink-0 bg-slate-600/80 sm:block" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="relative top-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Content review
            </span>
            <h1 className="min-w-0 truncate text-base font-bold leading-tight text-white sm:text-lg md:text-xl">
              {event.name || eventNameParam || 'Event'}
            </h1>
            {followMode === 'drive' ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
                Driving — others can use Follow
              </span>
            ) : null}
          </div>
          <div
            className="flex shrink-0 rounded-lg border border-slate-600 bg-slate-800/50 p-0.5"
            role="group"
            aria-label="Cue sync mode"
          >
            {(
              [
                { mode: 'solo' as const, label: 'Solo' },
                { mode: 'drive' as const, label: 'Drive' },
                { mode: 'follow' as const, label: 'Follow' }
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFollowMode(mode)}
                className={`rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide md:px-2.5 md:text-xs ${
                  followMode === mode
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <ReviewStageSwitcher className="hidden md:flex" />
          <button
            type="button"
            aria-pressed={editModeEnabled}
            aria-label={editModeEnabled ? 'Disable edit mode' : 'Enable edit mode'}
            disabled={activeReviewStage === 'creative'}
            title={
              activeReviewStage === 'creative'
                ? 'Switch to ROS Show to edit run-of-show fields'
                : undefined
            }
            onClick={() => setEditModeEnabled((on) => !on)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-xs font-semibold shadow-sm md:px-3 md:text-sm ${
              activeReviewStage === 'creative'
                ? 'cursor-not-allowed border-slate-600 bg-slate-800/50 text-slate-500 opacity-60'
                : editModeEnabled
                  ? 'border-violet-300 bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-lg'
                  : 'border-violet-500/60 bg-violet-950/40 text-violet-200 hover:border-violet-400/70 hover:bg-violet-900/35 hover:text-violet-100'
            }`}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 7h16M4 12h16M4 17h10"
              />
            </svg>
            <span className="hidden sm:inline">{editModeEnabled ? 'Edit On' : 'Edit'}</span>
          </button>
          <button
            type="button"
            aria-pressed={reviewPanelOpen}
            aria-label={reviewPanelOpen ? 'Hide review panel' : 'Show review panel'}
            onClick={() => setReviewPanelOpen((o) => !o)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-xs font-semibold shadow-sm md:px-3 md:text-sm ${
              reviewPanelOpen
                ? 'border-orange-300 bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-lg'
                : 'border-orange-500/60 bg-orange-950/40 text-orange-200 hover:border-orange-400/70 hover:bg-orange-900/35 hover:text-orange-100'
            }`}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span className="hidden sm:inline">Review</span>
          </button>
          <button
            type="button"
            aria-pressed={streamPanelOpen}
            aria-label={streamPanelOpen ? 'Hide stream panel' : 'Show stream panel'}
            onClick={() => {
              setStreamPanelOpen((open) => {
                if (open) return false;
                if (!savedStreamUrl) setStreamSetupOpen(true);
                return true;
              });
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-xs font-semibold shadow-sm md:px-3 md:text-sm ${
              streamPanelOpen
                ? 'border-emerald-300 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-lg'
                : 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200 hover:border-emerald-400/70 hover:bg-emerald-900/35 hover:text-emerald-100'
            }`}
          >
            <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <span className="hidden sm:inline">Stream</span>
          </button>
          <button
            type="button"
            aria-label="Refresh schedule"
            onClick={() => load()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-sky-300 bg-gradient-to-r from-blue-500 to-blue-600 px-2.5 py-2 text-xs font-semibold text-white shadow-md hover:from-blue-400 hover:to-blue-500 md:px-3 md:text-sm"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </header>

      <div className="flex shrink-0 justify-center border-b border-slate-800 bg-slate-950/80 px-3 py-1.5 md:hidden">
        <ReviewStageSwitcher />
      </div>

      {followMode === 'follow' ? (
        <div className="shrink-0 border-b border-emerald-900/40 bg-emerald-950/35 px-3 py-1.5 text-center text-xs text-emerald-100">
          Following live cue selection
          {followSourceName ? (
            <>
              {' '}
              from <span className="font-semibold text-white">{followSourceName}</span>
            </>
          ) : null}
          . Switch to <span className="font-medium">Solo</span> to use the cue list locally.
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8 text-slate-400">
          Loading schedule…
        </div>
      ) : error && !schedule.length ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8 text-amber-200">{error}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Column 1: cue rail — scrolls independently */}
          <aside className="flex min-h-0 w-[11.5rem] shrink-0 flex-col border-r border-slate-700 bg-slate-950 md:w-[13.5rem]">
            <div className="shrink-0 border-b border-slate-800 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Cues
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain py-1 pl-1 pr-0.5">
              {cueGroups.map(({ rootId, items }) => (
                <div
                  key={rootId}
                  className="mb-2 border-l-2 border-slate-600/90 pl-1.5"
                  title="Parent block above; sub-cue details scroll below in the main column."
                >
                  {items.map((it) => {
                    const killed = it.programType === 'KILLED';
                    const bar = programColor(it.programType);
                    const active = it.id === selectedId;
                    const isSub = it.id !== rootId;
                    const cueEntry = cueReviews[it.id];
                    const reviewMeta = cueRailReviewMeta(cueEntry, activeReviewStage);
                    const creativeMeta = reviewStatusMeta(getStageReview(cueEntry, 'creative').status);
                    const rosMeta = reviewStatusMeta(getStageReview(cueEntry, 'ros').status);
                    const fullyApproved = isFullyApproved(cueEntry);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        disabled={followMode === 'follow'}
                        ref={(el) => {
                          if (el) cueButtonRefs.current.set(it.id, el);
                          else cueButtonRefs.current.delete(it.id);
                        }}
                        onClick={() => setSelectedId(it.id)}
                        title={followMode === 'follow' ? 'Turn off Follow to select cues' : undefined}
                        className={`mb-0.5 flex w-full rounded-md border text-left transition-all disabled:cursor-not-allowed ${
                          followMode === 'follow'
                            ? 'border-transparent'
                            : active
                              ? reviewMeta.cueRailActiveClass
                              : reviewMeta.cueRailIdleClass
                        }`}
                        style={{
                          textDecoration: killed ? 'line-through' : undefined,
                          opacity: followMode === 'follow' ? 0.55 : killed ? 0.75 : 1
                        }}
                      >
                        <div
                          className="w-1 shrink-0 self-stretch rounded-l-md"
                          style={{ backgroundColor: bar }}
                          aria-hidden
                        />
                        <div
                          className="min-w-0 flex-1 py-1.5 pl-1 pr-0.5"
                          style={{
                            paddingLeft: isSub ? `${4 + Math.min(depthFor(it.id, indented), 4) * 8}px` : '4px'
                          }}
                        >
                          <div
                            className={`truncate text-[11px] font-bold leading-tight md:text-xs ${reviewMeta.cueLabelClass}`}
                          >
                            {isSub ? <span className="text-cyan-400/90">↳ </span> : null}
                            {formatCueDisplay(cueLabel(it))}
                          </div>
                          <div className="truncate text-[10px] text-slate-400 md:text-[11px]">
                            {it.segmentName || '—'}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-0.5">
                            {fullyApproved ? (
                              <span
                                className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${reviewMeta.railClass}`}
                              >
                                Both OK
                              </span>
                            ) : (
                              <>
                                <span
                                  className={`inline-flex rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
                                    activeReviewStage === 'creative'
                                      ? creativeMeta.railClass
                                      : 'border-slate-600/80 bg-slate-800/80 text-slate-400'
                                  }`}
                                  title="Creative Content"
                                >
                                  CC: {creativeMeta.label === 'Approved' ? 'OK' : creativeMeta.label === 'Needs update' ? '!' : '…'}
                                </span>
                                <span
                                  className={`inline-flex rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${
                                    activeReviewStage === 'ros'
                                      ? rosMeta.railClass
                                      : 'border-slate-600/80 bg-slate-800/80 text-slate-400'
                                  }`}
                                  title="ROS Show"
                                >
                                  ROS: {rosMeta.label === 'Approved' ? 'OK' : rosMeta.label === 'Needs update' ? '!' : '…'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </aside>

          <div
            ref={sideRailResizeRowRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row"
            dir="ltr"
          >
            {/* Column 2: Creative = PDF embed; ROS = full schedule detail */}
            <main
              className={`min-h-0 min-w-0 flex-1 bg-slate-900 p-3 md:p-6 ${
                activeReviewStage === 'creative'
                  ? 'flex flex-col overflow-hidden'
                  : 'overflow-y-auto overscroll-y-contain'
              }`}
            >
            {!displayItem ? (
              <p className="text-slate-500">Select a cue from the list.</p>
            ) : activeReviewStage === 'creative' ? (
              <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3">
                <div className="shrink-0 rounded-lg border border-violet-700/50 bg-violet-950/25 px-3 py-2 md:px-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/90">
                        Creative content review
                      </div>
                      <div className="text-base font-bold text-white md:text-lg">
                        {formatCueDisplay(cueLabel(displayItem))}
                        {displayItem.segmentName ? (
                          <span className="ml-2 text-sm font-medium text-slate-300">
                            · {displayItem.segmentName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="max-w-md text-[11px] text-slate-400">
                      Event PDF below for all cues. PPT / Video cues can open linked assets here.
                    </p>
                  </div>
                </div>

                {creativeCueExtras ? (
                  <div className="shrink-0 rounded-lg border border-amber-600/45 bg-amber-950/30 px-3 py-2.5">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-amber-200/90">
                        This cue
                      </span>
                      {creativeCueExtras.hasPPT ? (
                        <span className="rounded border border-amber-500/60 bg-amber-900/50 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                          PPT
                        </span>
                      ) : null}
                      {creativeCueExtras.programType === 'Video' ? (
                        <span className="rounded border border-orange-500/60 bg-orange-900/50 px-2 py-0.5 text-[10px] font-semibold text-orange-100">
                          Video
                        </span>
                      ) : null}
                      {creativeEmbedOverride ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCreativeEmbedOverride(null);
                            setCreativeEmbedOverrideLabel(null);
                          }}
                          className="ml-auto rounded border border-violet-500/70 bg-violet-900/40 px-2 py-0.5 text-[10px] font-semibold text-violet-100 hover:bg-violet-800/50"
                        >
                          ← Event PDF
                        </button>
                      ) : null}
                    </div>
                    {creativeCueAssets.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {creativeCueAssets.map((asset) => {
                          const embed = normalizeCreativeEmbedUrl(asset.link);
                          return (
                            <div
                              key={asset.id}
                              className="flex max-w-full items-center gap-1 rounded border border-slate-600 bg-slate-900/80 pl-2 pr-1 py-1"
                            >
                              <span className="truncate text-xs font-medium text-slate-200" title={asset.name}>
                                {asset.name}
                              </span>
                              <button
                                type="button"
                                onClick={() => window.open(asset.link, '_blank', 'noopener,noreferrer')}
                                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 hover:bg-slate-700"
                              >
                                Open
                              </button>
                              {embed ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCreativeEmbedOverride(embed);
                                    setCreativeEmbedOverrideLabel(asset.name);
                                  }}
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    creativeEmbedOverride === embed
                                      ? 'bg-amber-600 text-white'
                                      : 'text-amber-200 hover:bg-amber-900/60'
                                  }`}
                                >
                                  View
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-amber-100/80">
                        No asset links yet. Switch to <span className="font-semibold">ROS Show</span>, enable Edit,
                        and add links under Assets for this cue.
                      </p>
                    )}
                  </div>
                ) : null}

                <div className="shrink-0 rounded-lg border border-slate-600 bg-slate-800/80 p-2 md:p-3">
                  {savedCreativePdfUrl && !creativePdfSetupOpen ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300" title={savedCreativePdfUrl}>
                        {savedCreativePdfUrl}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCreativePdfUrlDraft(savedCreativePdfUrl);
                          setCreativePdfSetupOpen(true);
                        }}
                        className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        Change PDF
                      </button>
                      <button
                        type="button"
                        onClick={() => window.open(savedCreativePdfUrl, '_blank', 'noopener,noreferrer')}
                        className="rounded border border-slate-500 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        Open tab
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Creative PDF URL
                      </label>
                      <input
                        type="url"
                        value={creativePdfUrlDraft}
                        onChange={(e) => setCreativePdfUrlDraft(e.target.value)}
                        placeholder="https://…/deck.pdf or Google Drive share link"
                        className="w-full rounded border border-slate-500 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-violet-400"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={applyCreativePdfUrl}
                          className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
                        >
                          Embed PDF
                        </button>
                        {savedCreativePdfUrl ? (
                          <button
                            type="button"
                            onClick={() => setCreativePdfSetupOpen(false)}
                            className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                          >
                            Cancel
                          </button>
                        ) : null}
                        {savedCreativePdfUrl ? (
                          <button
                            type="button"
                            onClick={clearCreativePdfUrl}
                            className="rounded border border-rose-700/80 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-950/50"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[10px] leading-snug text-slate-500">
                        Direct .pdf links work best. Google Drive file links are converted to preview embeds. Some hosts
                        block iframes—use Open tab if the viewer is blank.
                      </p>
                    </div>
                  )}
                </div>

                <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-inner">
                  {creativeEmbedOverrideLabel ? (
                    <div className="absolute left-0 right-0 top-0 z-10 border-b border-amber-700/50 bg-amber-950/90 px-3 py-1 text-center text-[10px] font-semibold text-amber-100">
                      Viewing: {creativeEmbedOverrideLabel}
                      <span className="text-amber-200/70"> · </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCreativeEmbedOverride(null);
                          setCreativeEmbedOverrideLabel(null);
                        }}
                        className="text-violet-300 underline hover:text-violet-200"
                      >
                        Back to event PDF
                      </button>
                    </div>
                  ) : null}
                  {creativeIframeSrc && (!creativePdfSetupOpen || creativeEmbedOverride) ? (
                    <iframe
                      key={creativeIframeSrc}
                      src={creativeIframeSrc}
                      title={creativeEmbedOverrideLabel ? `Asset: ${creativeEmbedOverrideLabel}` : 'Creative content PDF'}
                      className={`absolute inset-0 h-full w-full border-0 bg-white ${creativeEmbedOverrideLabel ? 'pt-7' : ''}`}
                    />
                  ) : (
                    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-500">
                      <p>Add a PDF URL above to review creative content for this event.</p>
                      <p className="text-xs text-slate-600">
                        {creativeCueExtras
                          ? 'Use asset links above, or set the event PDF.'
                          : 'Cue list and approvals still work on the left.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-5xl space-y-4">
                {selectedRow && selectedRow.id !== displayItem.id ? (
                  <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/30 px-4 py-2.5 text-sm text-cyan-100">
                    <span className="text-slate-400">Selected sub-cue</span>{' '}
                    <span className="font-semibold text-white">{formatCueDisplay(cueLabel(selectedRow))}</span>
                    <span className="text-slate-400"> — main content is the parent cue </span>
                    <span className="font-semibold text-cyan-200">{formatCueDisplay(cueLabel(displayItem))}</span>
                  </div>
                ) : null}

                {/* Header strip — like Photo row top */}
                <div
                  className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-lg"
                  style={{
                    textDecoration: displayItem.programType === 'KILLED' ? 'line-through' : undefined,
                    opacity: displayItem.programType === 'KILLED' ? 0.85 : 1
                  }}
                >
                  <div className="grid grid-cols-1 gap-0 border-b border-slate-600 md:grid-cols-12">
                    <div className="border-b border-slate-600 bg-slate-800/90 px-3 py-2 md:col-span-2 md:border-b-0 md:border-r">
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cue</span>
                        {editModeEnabled ? (
                          <div className="mt-1 space-y-2">
                            <input
                              type="text"
                              value={cueDraft}
                              onChange={(e) => {
                                const v = e.target.value;
                                setCueDraft(v);
                                setCueProgramDirty(v.trim() !== (displayItem.customFields?.cue ?? '').toString().trim() || programTypeDraft !== (displayItem.programType ?? ''));
                                setCueProgramSaveMessage(null);
                                setCueProgramError(null);
                              }}
                              placeholder="Cue"
                              className="w-full rounded border border-slate-500 bg-slate-900 px-2 py-1 text-xs font-semibold text-white outline-none focus:border-violet-400"
                            />
                            <select
                              value={programTypeDraft}
                              onChange={(e) => {
                                const v = e.target.value;
                                setProgramTypeDraft(v);
                                setCueProgramDirty(cueDraft.trim() !== (displayItem.customFields?.cue ?? '').toString().trim() || v !== (displayItem.programType ?? ''));
                                setCueProgramSaveMessage(null);
                                setCueProgramError(null);
                              }}
                              className="w-full rounded border border-slate-500 px-2 py-1 text-xs font-semibold outline-none focus:border-violet-400"
                              style={{
                                backgroundColor: programTypeDraft ? programColor(programTypeDraft) : '#0f172a',
                                color: programTypeDraft ? (programTextClass(programTypeDraft) === 'text-black' ? '#000000' : '#ffffff') : '#ffffff'
                              }}
                            >
                              <option value="">Select Program Type</option>
                              {PROGRAM_TYPE_OPTIONS.map((type) => (
                                <option
                                  key={type}
                                  value={type}
                                  style={{
                                    backgroundColor: programColor(type),
                                    color: programTextClass(type) === 'text-black' ? '#000000' : '#ffffff'
                                  }}
                                >
                                  {type}
                                </option>
                              ))}
                            </select>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={saveDisplayItemCueProgram}
                                disabled={!cueProgramDirty || isSavingCueProgram}
                                className={`rounded px-2 py-1 text-[10px] font-semibold ${
                                  !cueProgramDirty || isSavingCueProgram
                                    ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                                    : 'bg-violet-600 text-white hover:bg-violet-500'
                                }`}
                              >
                                {isSavingCueProgram ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCueDraft((displayItem.customFields?.cue ?? '').toString());
                                  setProgramTypeDraft(displayItem.programType ?? '');
                                  setCueProgramDirty(false);
                                  setCueProgramSaveMessage(null);
                                  setCueProgramError(null);
                                }}
                                disabled={isSavingCueProgram}
                                className="rounded border border-slate-500 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              {cueProgramSaveMessage ? (
                                <span
                                  className={`text-[10px] font-semibold ${
                                    cueProgramSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                                  }`}
                                >
                                  {cueProgramSaveMessage}
                                </span>
                              ) : null}
                            </div>
                            {cueProgramError ? <div className="text-[10px] font-semibold text-rose-300">{cueProgramError}</div> : null}
                          </div>
                        ) : (
                          <>
                            <div
                              className={`mt-0.5 min-w-0 truncate text-sm font-bold md:text-base ${
                                displayItem.programType === 'KILLED' ? 'text-slate-400' : 'text-white'
                              }`}
                            >
                              {formatCueDisplay(cueLabel(displayItem))}
                            </div>
                            <span
                              className="mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: programColor(displayItem.programType),
                                color: programTextClass(displayItem.programType),
                                borderColor: displayItem.programType === 'Sub Cue' ? '#000' : 'transparent'
                              }}
                            >
                              {displayItem.programType || 'Unknown'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="border-b border-slate-600 px-3 py-2 md:col-span-2 md:border-b-0 md:border-r">
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
                        <div className="mt-0.5 truncate text-sm font-bold text-white">Day {displayItem.day}</div>
                        {displayItem.isStartCue ? (
                          <div className="mt-1 text-[10px] font-bold text-amber-400">START</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="border-b border-slate-600 px-3 py-2 md:col-span-2 md:border-b-0 md:border-r">
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Duration</span>
                        {editModeEnabled ? (
                          <div className="mt-1 space-y-2">
                            <div className="grid grid-cols-3 gap-1.5">
                              <input
                                type="number"
                                min={0}
                                value={durationHoursDraft}
                                onChange={(e) => {
                                  setDurationHoursDraft(e.target.value);
                                  const dirty =
                                    Number.parseInt(e.target.value || '0', 10) !== (displayItem.durationHours ?? 0) ||
                                    Number.parseInt(durationMinutesDraft || '0', 10) !== (displayItem.durationMinutes ?? 0) ||
                                    Number.parseInt(durationSecondsDraft || '0', 10) !== (displayItem.durationSeconds ?? 0);
                                  setDurationDirty(dirty);
                                  setDurationSaveMessage(null);
                                }}
                                className="w-full rounded border border-slate-500 bg-slate-900 px-1.5 py-1 text-center font-mono text-xs text-white outline-none focus:border-violet-400"
                                aria-label="Duration hours"
                              />
                              <input
                                type="number"
                                min={0}
                                max={59}
                                value={durationMinutesDraft}
                                onChange={(e) => {
                                  setDurationMinutesDraft(e.target.value);
                                  const dirty =
                                    Number.parseInt(durationHoursDraft || '0', 10) !== (displayItem.durationHours ?? 0) ||
                                    Number.parseInt(e.target.value || '0', 10) !== (displayItem.durationMinutes ?? 0) ||
                                    Number.parseInt(durationSecondsDraft || '0', 10) !== (displayItem.durationSeconds ?? 0);
                                  setDurationDirty(dirty);
                                  setDurationSaveMessage(null);
                                }}
                                className="w-full rounded border border-slate-500 bg-slate-900 px-1.5 py-1 text-center font-mono text-xs text-white outline-none focus:border-violet-400"
                                aria-label="Duration minutes"
                              />
                              <input
                                type="number"
                                min={0}
                                max={59}
                                value={durationSecondsDraft}
                                onChange={(e) => {
                                  setDurationSecondsDraft(e.target.value);
                                  const dirty =
                                    Number.parseInt(durationHoursDraft || '0', 10) !== (displayItem.durationHours ?? 0) ||
                                    Number.parseInt(durationMinutesDraft || '0', 10) !== (displayItem.durationMinutes ?? 0) ||
                                    Number.parseInt(e.target.value || '0', 10) !== (displayItem.durationSeconds ?? 0);
                                  setDurationDirty(dirty);
                                  setDurationSaveMessage(null);
                                }}
                                className="w-full rounded border border-slate-500 bg-slate-900 px-1.5 py-1 text-center font-mono text-xs text-white outline-none focus:border-violet-400"
                                aria-label="Duration seconds"
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={saveDisplayItemDuration}
                                disabled={!durationDirty || isSavingDuration}
                                className={`rounded px-2 py-1 text-[10px] font-semibold ${
                                  !durationDirty || isSavingDuration
                                    ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                                    : 'bg-violet-600 text-white hover:bg-violet-500'
                                }`}
                              >
                                {isSavingDuration ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDurationHoursDraft(String(displayItem.durationHours ?? 0));
                                  setDurationMinutesDraft(String(displayItem.durationMinutes ?? 0));
                                  setDurationSecondsDraft(String(displayItem.durationSeconds ?? 0));
                                  setDurationDirty(false);
                                  setDurationSaveMessage(null);
                                }}
                                disabled={isSavingDuration}
                                className="rounded border border-slate-500 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              {durationSaveMessage ? (
                                <span
                                  className={`text-[10px] font-semibold ${
                                    durationSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                                  }`}
                                >
                                  {durationSaveMessage}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="mt-0.5 min-w-0 truncate font-mono text-sm font-bold tabular-nums text-white md:text-base">
                              {formatDurationClock(displayItem)}
                            </div>
                            <div className="mt-1 text-[10px] text-slate-400">{formatDurationShort(displayItem)}</div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-800/70 px-3 py-2 md:col-span-6">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Segment</div>
                      {editModeEnabled ? (
                        <div className="mt-1 space-y-1.5">
                          <input
                            type="text"
                            value={segmentDraft}
                            onChange={(e) => {
                              setSegmentDraft(e.target.value);
                              setSegmentDirty(e.target.value !== (displayItem.segmentName ?? ''));
                              setSegmentSaveMessage(null);
                            }}
                            placeholder="Untitled segment"
                            className="w-full rounded border border-slate-500 bg-slate-900 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/40"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={saveDisplayItemSegment}
                              disabled={!segmentDirty || isSavingSegment}
                              className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                !segmentDirty || isSavingSegment
                                  ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                                  : 'bg-violet-600 text-white hover:bg-violet-500'
                              }`}
                            >
                              {isSavingSegment ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSegmentDraft(displayItem.segmentName ?? '');
                                setSegmentDirty(false);
                                setSegmentSaveMessage(null);
                              }}
                              disabled={isSavingSegment}
                              className="rounded border border-slate-500 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            {segmentSaveMessage ? (
                              <span
                                className={`text-[11px] font-semibold ${
                                  segmentSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                {segmentSaveMessage}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-white md:text-base">
                          {displayItem.segmentName || 'Untitled segment'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Second row: shot + PPT/Q&A */}
                  <div className="grid grid-cols-1 gap-0 border-b border-slate-600 sm:grid-cols-2">
                    <div className="border-b border-slate-600 p-4 sm:border-b-0 sm:border-r">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Shot</div>
                      {editModeEnabled ? (
                        <div className="mt-1 space-y-2">
                          <select
                            value={shotDraft}
                            onChange={(e) => {
                              setShotDraft(e.target.value);
                              setShotDirty(e.target.value !== (displayItem.shotType ?? ''));
                              setShotSaveMessage(null);
                            }}
                            className="w-full rounded border border-slate-500 bg-slate-900 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/40"
                          >
                            <option value="">Select Shot Type</option>
                            {SHOT_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={saveDisplayItemShot}
                              disabled={!shotDirty || isSavingShot}
                              className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                !shotDirty || isSavingShot
                                  ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                                  : 'bg-violet-600 text-white hover:bg-violet-500'
                              }`}
                            >
                              {isSavingShot ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShotDraft(displayItem.shotType ?? '');
                                setShotDirty(false);
                                setShotSaveMessage(null);
                              }}
                              disabled={isSavingShot}
                              className="rounded border border-slate-500 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            {shotSaveMessage ? (
                              <span
                                className={`text-[11px] font-semibold ${
                                  shotSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                {shotSaveMessage}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 text-base font-bold text-white">{displayItem.shotType || '—'}</div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">PPT / Q&A</div>
                      {editModeEnabled ? (
                        <div className="mt-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="inline-flex items-center gap-2 text-sm text-slate-100">
                              <input
                                type="checkbox"
                                checked={hasPptDraft}
                                onChange={(e) => {
                                  setHasPptDraft(e.target.checked);
                                  setPptQaDirty(e.target.checked !== !!displayItem.hasPPT || hasQaDraft !== !!displayItem.hasQA);
                                  setPptQaSaveMessage(null);
                                }}
                                className="h-4 w-4 rounded border-slate-500 bg-slate-800 text-violet-500 focus:ring-violet-500"
                              />
                              PPT
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm text-slate-100">
                              <input
                                type="checkbox"
                                checked={hasQaDraft}
                                onChange={(e) => {
                                  setHasQaDraft(e.target.checked);
                                  setPptQaDirty(hasPptDraft !== !!displayItem.hasPPT || e.target.checked !== !!displayItem.hasQA);
                                  setPptQaSaveMessage(null);
                                }}
                                className="h-4 w-4 rounded border-slate-500 bg-slate-800 text-violet-500 focus:ring-violet-500"
                              />
                              Q&A
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={saveDisplayItemPptQa}
                              disabled={!pptQaDirty || isSavingPptQa}
                              className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                !pptQaDirty || isSavingPptQa
                                  ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                                  : 'bg-violet-600 text-white hover:bg-violet-500'
                              }`}
                            >
                              {isSavingPptQa ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setHasPptDraft(!!displayItem.hasPPT);
                                setHasQaDraft(!!displayItem.hasQA);
                                setPptQaDirty(false);
                                setPptQaSaveMessage(null);
                              }}
                              disabled={isSavingPptQa}
                              className="rounded border border-slate-500 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Cancel
                            </button>
                            {pptQaSaveMessage ? (
                              <span
                                className={`text-[11px] font-semibold ${
                                  pptQaSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                                }`}
                              >
                                {pptQaSaveMessage}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 text-base font-bold text-white">{pptQaString(displayItem)}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Speaker slots — Photo print row */}
                <div className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-600 bg-slate-700 px-3 py-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-200">
                      Speakers (slots 1–7)
                    </span>
                    {!editModeEnabled ? (
                      <button
                        type="button"
                        onClick={() => setSpeakerDetailsExpanded((prev) => !prev)}
                        className="shrink-0 rounded border border-slate-500 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-200 hover:bg-slate-600"
                        aria-expanded={speakerDetailsExpanded}
                      >
                        {speakerDetailsExpanded ? 'Hide details' : 'Show title, org & photo'}
                      </button>
                    ) : null}
                  </div>
                  {editModeEnabled ? (
                    <div className="space-y-2 p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-300">Edit Participants ({speakerDraft.length}/7)</span>
                        <button
                          type="button"
                          disabled={speakerDraft.length >= 7}
                          onClick={() => {
                            setSpeakerDraft((prev) => {
                              const used = new Set(prev.map((s) => s.slot));
                              const nextSlot = [1, 2, 3, 4, 5, 6, 7].find((n) => !used.has(n)) ?? 1;
                              return [
                                ...prev,
                                {
                                  id: `speaker-${Date.now()}-${nextSlot}`,
                                  slot: nextSlot,
                                  location: 'Podium',
                                  fullName: '',
                                  title: '',
                                  org: '',
                                  photoLink: ''
                                }
                              ].sort((a, b) => a.slot - b.slot);
                            });
                            setSpeakersDirty(true);
                            setSpeakersSaveMessage(null);
                          }}
                          className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          + Add Speaker
                        </button>
                      </div>
                      {speakerDraft.length === 0 ? (
                        <div className="rounded border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-400">
                          No speakers yet. Use “Add Speaker” to add one at a time.
                        </div>
                      ) : null}
                      <div className="space-y-2">
                        {speakerDraft
                          .slice()
                          .sort((a, b) => a.slot - b.slot)
                          .map((sp) => (
                            <div key={sp.id} className="rounded border border-slate-600 bg-slate-900/60 p-2.5">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase text-slate-400">Speaker {sp.slot}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSpeakerDraft((prev) => prev.filter((row) => row.id !== sp.id));
                                    setSpeakersDirty(true);
                                    setSpeakersSaveMessage(null);
                                  }}
                                  className="rounded bg-rose-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-600"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Slot</label>
                                  <select
                                    value={sp.slot}
                                    onChange={(e) => {
                                      const newSlot = Number.parseInt(e.target.value, 10) || sp.slot;
                                      setSpeakerDraft((prev) => {
                                        const exists = prev.find((r) => r.id !== sp.id && r.slot === newSlot);
                                        if (exists) return prev;
                                        return prev
                                          .map((row) => (row.id === sp.id ? { ...row, slot: newSlot } : row))
                                          .sort((a, b) => a.slot - b.slot);
                                      });
                                      setSpeakersDirty(true);
                                      setSpeakersSaveMessage(null);
                                    }}
                                    className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-violet-400"
                                  >
                                    {[1, 2, 3, 4, 5, 6, 7].map((slotNum) => {
                                      const taken = speakerDraft.some((r) => r.id !== sp.id && r.slot === slotNum);
                                      return (
                                        <option key={`${sp.id}-slot-${slotNum}`} value={slotNum} disabled={taken}>
                                          {slotNum} {taken ? '(Used)' : ''}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Location</label>
                                  <select
                                    value={sp.location}
                                    onChange={(e) => {
                                      const nextLocation = (e.target.value as SpeakerSlotDraft['location']) || 'Podium';
                                      setSpeakerDraft((prev) =>
                                        prev.map((row) => (row.id === sp.id ? { ...row, location: nextLocation } : row))
                                      );
                                      setSpeakersDirty(true);
                                      setSpeakersSaveMessage(null);
                                    }}
                                    className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-violet-400"
                                  >
                                    <option value="Podium">Podium</option>
                                    <option value="Seat">Seat</option>
                                    <option value="Virtual">Virtual</option>
                                    <option value="Moderator">Moderator</option>
                                  </select>
                                </div>
                                <div className="md:col-span-2 lg:col-span-1">
                                  <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Full Name</label>
                                  <input
                                    type="text"
                                    value={sp.fullName}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      setSpeakerDraft((prev) =>
                                        prev.map((row) => (row.id === sp.id ? { ...row, fullName: nextVal } : row))
                                      );
                                      setSpeakersDirty(true);
                                      setSpeakersSaveMessage(null);
                                    }}
                                    placeholder="Enter full name"
                                    className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-violet-400"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Title</label>
                                  <input
                                    type="text"
                                    value={sp.title}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      setSpeakerDraft((prev) =>
                                        prev.map((row) => (row.id === sp.id ? { ...row, title: nextVal } : row))
                                      );
                                      setSpeakersDirty(true);
                                      setSpeakersSaveMessage(null);
                                    }}
                                    placeholder="Title / Position"
                                    className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-violet-400"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Organization</label>
                                  <input
                                    type="text"
                                    value={sp.org}
                                    onChange={(e) => {
                                      const nextVal = e.target.value;
                                      setSpeakerDraft((prev) =>
                                        prev.map((row) => (row.id === sp.id ? { ...row, org: nextVal } : row))
                                      );
                                      setSpeakersDirty(true);
                                      setSpeakersSaveMessage(null);
                                    }}
                                    placeholder="Organization"
                                    className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-violet-400"
                                  />
                                </div>
                                <div className="md:col-span-2 lg:col-span-1">
                                  <label className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Photo URL</label>
                                  <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                                    <input
                                      type="url"
                                      value={sp.photoLink}
                                      onChange={(e) => {
                                        const nextVal = e.target.value;
                                        setSpeakerDraft((prev) =>
                                          prev.map((row) => (row.id === sp.id ? { ...row, photoLink: nextVal } : row))
                                        );
                                        setSpeakersDirty(true);
                                        setSpeakersSaveMessage(null);
                                      }}
                                      placeholder="https://..."
                                      className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1 text-xs text-white outline-none focus:border-violet-400"
                                    />
                                    {sp.photoLink ? (
                                      <img
                                        src={sp.photoLink}
                                        alt={sp.fullName || `Speaker ${sp.slot}`}
                                        className="h-8 w-8 rounded object-cover border border-slate-500"
                                        onError={(e) => {
                                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={saveDisplayItemSpeakers}
                          disabled={!speakersDirty || isSavingSpeakers}
                          className={`rounded px-3 py-1.5 text-xs font-semibold ${
                            !speakersDirty || isSavingSpeakers
                              ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                              : 'bg-violet-600 text-white hover:bg-violet-500'
                          }`}
                        >
                          {isSavingSpeakers ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSpeakerDraft(parseSpeakersDraft(displayItem.speakersText || ''));
                            setSpeakersDirty(false);
                            setSpeakersSaveMessage(null);
                          }}
                          disabled={isSavingSpeakers}
                          className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        {speakersSaveMessage ? (
                          <span
                            className={`text-xs font-semibold ${
                              speakersSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                            }`}
                          >
                            {speakersSaveMessage}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <SpeakerSlotsReadOnlyRow
                      speakersText={displayItem.speakersText}
                      expanded={speakerDetailsExpanded}
                    />
                  )}
                </div>

                {/* Notes — full width block */}
                <div className="rounded-lg border border-slate-600 bg-slate-800">
                  <div className="flex items-center justify-between gap-2 border-b border-slate-600 bg-slate-700 px-4 py-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-200">Notes</span>
                    {editModeEnabled ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300">Edit mode</span>
                    ) : null}
                  </div>
                  {editModeEnabled ? (
                    <div className="space-y-2 p-4">
                      <div className="rounded border border-slate-600 bg-slate-900/80 p-2">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 border-b border-slate-700 pb-2">
                          <button type="button" onClick={() => applyNotesFormatting('bold')} className="rounded border border-slate-500 px-2 py-1 text-xs font-bold text-slate-200 hover:bg-slate-700">B</button>
                          <button type="button" onClick={() => applyNotesFormatting('italic')} className="rounded border border-slate-500 px-2 py-1 text-xs italic text-slate-200 hover:bg-slate-700">I</button>
                          <button type="button" onClick={() => applyNotesFormatting('underline')} className="rounded border border-slate-500 px-2 py-1 text-xs underline text-slate-200 hover:bg-slate-700">U</button>
                          <span className="mx-1 h-5 w-px bg-slate-700" aria-hidden />
                          <button type="button" onClick={() => applyNotesFormatting('justifyLeft')} className="rounded border border-slate-500 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">L</button>
                          <button type="button" onClick={() => applyNotesFormatting('justifyCenter')} className="rounded border border-slate-500 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">C</button>
                          <button type="button" onClick={() => applyNotesFormatting('justifyRight')} className="rounded border border-slate-500 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">R</button>
                          <span className="mx-1 h-5 w-px bg-slate-700" aria-hidden />
                          <button type="button" onClick={() => applyNotesFormatting('foreColor', '#ffffff')} className="h-6 w-6 rounded border border-slate-400 bg-white" title="White text" />
                          <button type="button" onClick={() => applyNotesFormatting('foreColor', '#fbbf24')} className="h-6 w-6 rounded border border-slate-400 bg-amber-400" title="Amber text" />
                          <button type="button" onClick={() => applyNotesFormatting('foreColor', '#60a5fa')} className="h-6 w-6 rounded border border-slate-400 bg-blue-400" title="Blue text" />
                          <button type="button" onClick={() => applyNotesFormatting('foreColor', '#4ade80')} className="h-6 w-6 rounded border border-slate-400 bg-green-400" title="Green text" />
                          <span className="mx-1 h-5 w-px bg-slate-700" aria-hidden />
                          <button type="button" onClick={() => applyNotesFormatting('clearHighlight')} className="rounded border border-slate-500 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700">No HL</button>
                          <button type="button" onClick={() => applyNotesFormatting('backColor', '#fbbf24')} className="h-6 w-6 rounded border border-slate-400 bg-amber-400" title="Amber highlight" />
                          <button type="button" onClick={() => applyNotesFormatting('backColor', '#60a5fa')} className="h-6 w-6 rounded border border-slate-400 bg-blue-400" title="Blue highlight" />
                          <button type="button" onClick={() => applyNotesFormatting('backColor', '#4ade80')} className="h-6 w-6 rounded border border-slate-400 bg-green-400" title="Green highlight" />
                          <button type="button" onClick={() => applyNotesFormatting('backColor', '#f472b6')} className="h-6 w-6 rounded border border-slate-400 bg-pink-400" title="Pink highlight" />
                          <span className="mx-1 h-5 w-px bg-slate-700" aria-hidden />
                          <button type="button" onClick={() => applyNotesFormatting('undo')} className="rounded border border-slate-500 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700">Undo</button>
                          <button type="button" onClick={() => applyNotesFormatting('redo')} className="rounded border border-slate-500 px-2 py-1 text-[10px] text-slate-200 hover:bg-slate-700">Redo</button>
                        </div>
                        <div
                          ref={notesEditorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={(e) => {
                            const html = (e.currentTarget as HTMLDivElement).innerHTML;
                            setNotesDraft(html);
                            setNotesDirty(html !== (displayItem.notes ?? ''));
                            setNotesSaveMessage(null);
                          }}
                          className="min-h-[10rem] w-full rounded border border-slate-500 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/40"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={saveDisplayItemNotes}
                          disabled={!notesDirty || isSavingNotes}
                          className={`rounded px-3 py-1.5 text-xs font-semibold ${
                            !notesDirty || isSavingNotes
                              ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                              : 'bg-violet-600 text-white hover:bg-violet-500'
                          }`}
                        >
                          {isSavingNotes ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNotesDraft(displayItem.notes ?? '');
                            setNotesDirty(false);
                            setNotesSaveMessage(null);
                          }}
                          disabled={isSavingNotes}
                          className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        {notesSaveMessage ? (
                          <span
                            className={`text-xs font-semibold ${
                              notesSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                            }`}
                          >
                            {notesSaveMessage}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-[4rem] whitespace-pre-wrap break-words p-4 text-sm leading-relaxed text-slate-100">
                      {displayItem.notes?.trim() ? (
                        <div dangerouslySetInnerHTML={{ __html: displayItem.notes }} />
                      ) : (
                        <span className="text-slate-500">No notes</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Assets */}
                <div className="rounded-lg border border-slate-600 bg-slate-800">
                  <div className="border-b border-slate-600 bg-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-200">
                    Assets
                  </div>
                  {editModeEnabled ? (
                    <div className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Assets list</span>
                        <button
                          type="button"
                          onClick={() => {
                            setAssetRows((prev) => [
                              ...prev,
                              { id: `asset-${Date.now()}-${prev.length}`, name: '', link: '', linkEnabled: false }
                            ]);
                            setAssetsDirty(true);
                            setAssetsSaveMessage(null);
                          }}
                          className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-600"
                        >
                          + Add Asset
                        </button>
                      </div>
                      <div className="space-y-2">
                        {assetRows.map((row) => (
                          <div key={row.id} className="rounded border border-slate-600 bg-slate-900/70 p-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setAssetRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: v } : r)));
                                  setAssetsDirty(true);
                                  setAssetsSaveMessage(null);
                                }}
                                placeholder="Asset name..."
                                className="min-w-[12rem] flex-1 rounded border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-sm text-white outline-none focus:border-violet-400"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setAssetRows((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? { ...r, linkEnabled: !r.linkEnabled, link: !r.linkEnabled ? r.link : '' }
                                        : r
                                    )
                                  );
                                  setAssetsDirty(true);
                                  setAssetsSaveMessage(null);
                                }}
                                className={`rounded px-2.5 py-1 text-xs font-semibold ${
                                  row.linkEnabled
                                    ? 'bg-slate-600 text-white hover:bg-slate-500'
                                    : 'bg-blue-700 text-white hover:bg-blue-600'
                                }`}
                              >
                                {row.linkEnabled ? '− Link' : '+ Link'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAssetRows((prev) => {
                                    const next = prev.filter((r) => r.id !== row.id);
                                    return next.length ? next : [{ id: `asset-${Date.now()}`, name: '', link: '', linkEnabled: false }];
                                  });
                                  setAssetsDirty(true);
                                  setAssetsSaveMessage(null);
                                }}
                                className="rounded bg-rose-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-600"
                              >
                                Remove
                              </button>
                            </div>
                            {row.linkEnabled ? (
                              <input
                                type="url"
                                value={row.link}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setAssetRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, link: v } : r)));
                                  setAssetsDirty(true);
                                  setAssetsSaveMessage(null);
                                }}
                                placeholder="Enter asset URL..."
                                className="mt-2 w-full rounded border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-sm text-cyan-100 outline-none focus:border-violet-400"
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={saveDisplayItemAssets}
                          disabled={!assetsDirty || isSavingAssets}
                          className={`rounded px-3 py-1.5 text-xs font-semibold ${
                            !assetsDirty || isSavingAssets
                              ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                              : 'bg-violet-600 text-white hover:bg-violet-500'
                          }`}
                        >
                          {isSavingAssets ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const reset = parseAssetRows(displayItem.assets ?? '');
                            setAssetRows(reset.length ? reset : [{ id: `asset-${Date.now()}`, name: '', link: '', linkEnabled: false }]);
                            setAssetsDraft(displayItem.assets ?? '');
                            setAssetsDirty(false);
                            setAssetsSaveMessage(null);
                          }}
                          disabled={isSavingAssets}
                          className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        {assetsSaveMessage ? (
                          <span
                            className={`text-xs font-semibold ${
                              assetsSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                            }`}
                          >
                            {assetsSaveMessage}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="break-all p-4 text-sm text-cyan-200">
                      {displayItem.assets?.trim() ? displayItem.assets : <span className="text-slate-500">None</span>}
                    </div>
                  )}
                </div>

                {/* Custom columns grid */}
                {(() => {
                  const allDefinedCols = customColumns;
                  if (!allDefinedCols.length) return null;
                  const readOnlyCols = allDefinedCols.filter(
                    (col) => (displayItem.customFields?.[col.id] ?? '').toString().trim().length > 0
                  );
                  const cols = editModeEnabled ? allDefinedCols : readOnlyCols;
                  if (!cols.length) return null;
                  return (
                    <div className="rounded-lg border border-slate-600 bg-slate-800">
                      <div className="border-b border-slate-600 bg-slate-700 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-200">
                        Custom columns
                      </div>
                      <div className="grid gap-0 sm:grid-cols-2">
                        {cols.map((col) => (
                          <div
                            key={col.id}
                            className="border-b border-slate-700 p-3 sm:border-r sm:[&:nth-child(2n)]:border-r-0"
                          >
                            <div className="text-[10px] font-semibold uppercase text-slate-500">{col.name}</div>
                            {editModeEnabled ? (
                              <textarea
                                value={(customFieldsDraft[col.id] ?? '').toString()}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setCustomFieldsDraft((prev) => ({ ...prev, [col.id]: val }));
                                  setCustomFieldsDirty(true);
                                  setCustomFieldsSaveMessage(null);
                                }}
                                rows={3}
                                className="mt-1 w-full resize-y rounded border border-slate-500 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/40"
                              />
                            ) : (
                              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-100">
                                {(displayItem.customFields?.[col.id] ?? '').toString()}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {editModeEnabled ? (
                        <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 px-3 py-2">
                          <button
                            type="button"
                            onClick={saveDisplayItemCustomFields}
                            disabled={!customFieldsDirty || isSavingCustomFields}
                            className={`rounded px-3 py-1.5 text-xs font-semibold ${
                              !customFieldsDirty || isSavingCustomFields
                                ? 'bg-slate-600 text-slate-300 cursor-not-allowed'
                                : 'bg-violet-600 text-white hover:bg-violet-500'
                            }`}
                          >
                            {isSavingCustomFields ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomFieldsDraft(
                                Object.fromEntries(
                                  (customColumns || []).map((c) => [c.id, (displayItem.customFields?.[c.id] ?? '').toString()])
                                )
                              );
                              setCustomFieldsDirty(false);
                              setCustomFieldsSaveMessage(null);
                            }}
                            disabled={isSavingCustomFields}
                            className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Cancel
                          </button>
                          {customFieldsSaveMessage ? (
                            <span
                              className={`text-xs font-semibold ${
                                customFieldsSaveMessage === 'Saved' ? 'text-emerald-300' : 'text-rose-300'
                              }`}
                            >
                              {customFieldsSaveMessage}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {subCuesUnderParent.length > 0 ? (
                  <section className="border-t border-slate-700 pt-6">
                    <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">
                      Sub-cues ({subCuesUnderParent.length})
                    </h2>
                    <div className="space-y-4">
                      {subCuesUnderParent.map((sub) => {
                        const isSubSelected = selectedRow?.id === sub.id;
                        const subKilled = sub.programType === 'KILLED';
                        const subBar = programColor(sub.programType);
                        const subCols = customColumns.filter(
                          (col) => (sub.customFields?.[col.id] ?? '').toString().trim().length > 0
                        );
                        return (
                          <div
                            key={sub.id}
                            className={`flex overflow-hidden rounded-lg border bg-slate-800/95 shadow-md ${
                              isSubSelected
                                ? 'border-cyan-500 ring-2 ring-cyan-500/40'
                                : 'border-slate-600'
                            }`}
                            style={{
                              textDecoration: subKilled ? 'line-through' : undefined,
                              opacity: subKilled ? 0.8 : 1
                            }}
                          >
                            <div
                              className="w-1 shrink-0 self-stretch"
                              style={{ backgroundColor: subBar }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 space-y-3 p-3 md:p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700/80 pb-3">
                                <div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                    Sub-cue
                                  </div>
                                  <div
                                    className={`mt-0.5 text-lg font-bold md:text-xl ${
                                      subKilled ? 'text-slate-400' : 'text-white'
                                    }`}
                                  >
                                    <span className="text-cyan-500/90">↳ </span>
                                    {formatCueDisplay(cueLabel(sub))}
                                  </div>
                                  <div
                                    className="mt-1.5 inline-block rounded border px-2 py-0.5 text-[10px] font-semibold"
                                    style={{
                                      backgroundColor: subBar,
                                      color: programTextClass(sub.programType),
                                      borderColor: sub.programType === 'Sub Cue' ? '#000' : 'transparent'
                                    }}
                                  >
                                    {sub.programType || 'Unknown'}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[10px] font-semibold uppercase text-slate-500">Day</div>
                                  <div className="text-sm font-bold text-white">Day {sub.day}</div>
                                  <div className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-200">
                                    {formatDurationClock(sub)}
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] font-semibold uppercase text-slate-500">Segment</div>
                                <div className="text-base font-semibold leading-snug text-white">
                                  {sub.segmentName || '—'}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                                <div>
                                  <div className="text-[10px] uppercase text-slate-500">Shot</div>
                                  <div className="font-medium text-slate-100">{sub.shotType || '—'}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase text-slate-500">PPT / Q&A</div>
                                  <div className="font-medium text-slate-100">{pptQaString(sub)}</div>
                                </div>
                              </div>
                              <div className="rounded border border-slate-600 bg-slate-900/40">
                                <div className="border-b border-slate-600 bg-slate-700/80 px-2 py-1 text-center text-[10px] font-bold uppercase text-slate-300">
                                  Speakers (1–7)
                                  {speakerDetailsExpanded ? (
                                    <span className="ml-1 font-normal normal-case text-slate-400">— details on</span>
                                  ) : null}
                                </div>
                                <SpeakerSlotsReadOnlyRow
                                  speakersText={sub.speakersText}
                                  expanded={speakerDetailsExpanded}
                                  compactClassName="p-1.5"
                                />
                              </div>
                              {sub.notes?.trim() ? (
                                <div>
                                  <div className="text-[10px] font-semibold uppercase text-slate-500">Notes</div>
                                  <div className="mt-1 whitespace-pre-wrap rounded border border-slate-700 bg-slate-900/50 p-2 text-xs text-slate-200">
                                    {sub.notes}
                                  </div>
                                </div>
                              ) : null}
                              {sub.assets?.trim() ? (
                                <div>
                                  <div className="text-[10px] font-semibold uppercase text-slate-500">Assets</div>
                                  <div className="mt-1 break-all text-xs text-cyan-200/90">{sub.assets}</div>
                                </div>
                              ) : null}
                              {subCols.length > 0 ? (
                                <div className="rounded border border-slate-600">
                                  <div className="border-b border-slate-600 bg-slate-700/80 px-2 py-1 text-[10px] font-bold uppercase text-slate-300">
                                    Custom columns
                                  </div>
                                  <div className="grid gap-0 p-2 sm:grid-cols-2">
                                    {subCols.map((col) => (
                                      <div key={col.id} className="border-b border-slate-800 py-1.5 sm:border-r sm:px-2">
                                        <div className="text-[9px] font-semibold uppercase text-slate-500">{col.name}</div>
                                        <div className="whitespace-pre-wrap text-xs text-slate-200">
                                          {(sub.customFields?.[col.id] ?? '').toString()}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}
              </div>
            )}
            </main>

            {(reviewPanelOpen || streamPanelOpen) && isLgLayout ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize main content and review or stream column"
                aria-valuemin={260}
                aria-valuemax={680}
                aria-valuenow={Math.round(sideRailWidthPx)}
                onPointerDown={startSideRailResize}
                onPointerMove={(e) => {
                  if (!sideRailDragRef.current.active) return;
                  e.preventDefault();
                  updateSideRailWidthFromPointer(e.nativeEvent);
                }}
                onPointerUp={(e) => {
                  if (!sideRailDragRef.current.active) return;
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* ignore */
                  }
                  endSideRailDrag();
                }}
                onPointerCancel={() => {
                  endSideRailDrag();
                }}
                onLostPointerCapture={() => {
                  endSideRailDrag();
                }}
                className="group relative z-[1] hidden w-3 shrink-0 cursor-col-resize select-none touch-none lg:block"
              >
                <div
                  className="absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-slate-600 group-hover:bg-slate-400 group-active:bg-slate-300"
                  aria-hidden
                />
              </div>
            ) : null}

            {reviewPanelOpen || streamPanelOpen ? (
              <div
                className="flex min-h-0 w-full shrink-0 flex-col border-t border-slate-700 bg-slate-950 lg:min-h-0 lg:max-w-none lg:flex-shrink-0 lg:grow-0 lg:border-l lg:border-t-0 lg:overflow-hidden"
                style={isLgLayout ? { flex: `0 0 ${sideRailWidthPx}px`, width: sideRailWidthPx } : undefined}
              >
                {reviewPanelOpen ? (
                  <section
                    className={`flex min-h-0 flex-1 flex-col border-l-4 border-orange-500 bg-transparent lg:min-h-0 ${streamPanelOpen ? 'border-b border-orange-800/70' : ''}`}
                    aria-label="Cue review"
                  >
                    <div className="flex shrink-0 flex-col gap-2 border-b border-orange-600/45 bg-transparent px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-orange-100">
                          Cue review
                        </span>
                        <button
                          type="button"
                          onClick={() => setReviewPanelOpen(false)}
                          className="rounded border border-orange-400/60 bg-transparent px-2 py-1 text-[10px] font-medium text-orange-50 hover:bg-transparent"
                        >
                          Hide
                        </button>
                      </div>
                      <ReviewStageSwitcher />
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-y-contain p-2">
                      {selectedRow ? (
                        <>
                          <div className="rounded border border-slate-600/80 bg-slate-900/50 px-2 py-1.5 text-[10px] text-slate-300">
                            <div className="font-semibold text-slate-200">
                              {REVIEW_STAGES.find((s) => s.id === activeReviewStage)?.label}
                            </div>
                            {selectedFullyApproved ? (
                              <div className="mt-0.5 text-emerald-300">Fully approved (Creative + ROS)</div>
                            ) : (
                              <div className="mt-1 flex flex-wrap gap-1">
                                <span
                                  className={`rounded border px-1.5 py-0.5 ${reviewStatusMeta(getStageReview(selectedReview, 'creative').status).railClass}`}
                                >
                                  Creative: {reviewStatusMeta(getStageReview(selectedReview, 'creative').status).label}
                                </span>
                                <span
                                  className={`rounded border px-1.5 py-0.5 ${reviewStatusMeta(getStageReview(selectedReview, 'ros').status).railClass}`}
                                >
                                  ROS: {reviewStatusMeta(getStageReview(selectedReview, 'ros').status).label}
                                </span>
                              </div>
                            )}
                          </div>
                          {rosApproveBlocked ? (
                            <p className="text-[10px] leading-snug text-amber-200/90">
                              Approve <span className="font-semibold">Creative Content</span> before marking ROS Show
                              approved.
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                {
                                  id: 'pending' as const,
                                  label: 'Review',
                                  activeClass: 'border-sky-100 bg-sky-500 text-white shadow-lg',
                                  idleClass:
                                    'border-sky-600 bg-sky-800 text-sky-50 hover:bg-sky-700 hover:border-sky-500'
                                },
                                {
                                  id: 'needs_update' as const,
                                  label: 'Needs Review',
                                  activeClass: 'border-amber-50 bg-amber-500 text-white shadow-lg',
                                  idleClass:
                                    'border-amber-600 bg-amber-800 text-amber-50 hover:bg-amber-700 hover:border-amber-500'
                                },
                                {
                                  id: 'approved' as const,
                                  label: 'Approved',
                                  activeClass: 'border-emerald-50 bg-emerald-500 text-white shadow-lg',
                                  idleClass:
                                    'border-emerald-600 bg-emerald-800 text-emerald-50 hover:bg-emerald-700 hover:border-emerald-500',
                                  disabled: rosApproveBlocked
                                }
                              ] as const
                            ).map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                disabled={'disabled' in s && s.disabled}
                                onClick={() => setCueReviewStatus(selectedRow.id, activeReviewStage, s.id)}
                                className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                                  selectedStatus === s.id ? `${s.activeClass} shadow-sm` : s.idleClass
                                } ${'disabled' in s && s.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                          <textarea
                            value={selectedNote}
                            onChange={(e) => setCueReviewNote(selectedRow.id, activeReviewStage, e.target.value)}
                            rows={6}
                            placeholder={`${REVIEW_STAGES.find((st) => st.id === activeReviewStage)?.label} notes…`}
                            className="min-h-[10rem] w-full flex-1 resize-y rounded border-2 border-slate-300 bg-white px-2 py-2 text-xs text-slate-900 shadow-inner outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/40"
                          />
                        </>
                      ) : (
                        <p className="text-xs text-orange-200/80">Select a cue from the list to add review notes.</p>
                      )}
                    </div>
                  </section>
                ) : null}
                {streamPanelOpen ? (
              <section
                className="flex min-h-[200px] w-full flex-1 flex-col border-t border-slate-800 bg-slate-950 lg:min-h-0 lg:border-t-0"
                aria-label="Embedded stream"
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 px-2 py-2">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Live embed
                  </span>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {savedStreamUrl && !streamSetupOpen ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setStreamUrlDraft(savedStreamUrl);
                            setStreamSetupOpen(true);
                          }}
                          className="rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
                        >
                          Change URL
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(savedStreamUrl, '_blank', 'noopener,noreferrer')}
                          className="rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
                        >
                          Open tab
                        </button>
                        <button
                          type="button"
                          onClick={() => savedStreamUrl && setStreamFloatOpen(true)}
                          className="flex items-center gap-1 rounded border border-emerald-600/60 bg-emerald-950/45 px-2 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-900/55"
                          title="Open stream in a floating window on this page"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                          Pop out
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setStreamPanelOpen(false)}
                      className="rounded border border-slate-600 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-800"
                    >
                      Hide
                    </button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                  {savedStreamUrl && !streamSetupOpen ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="min-h-0 flex-1 overflow-hidden rounded border border-slate-700 bg-black shadow-inner">
                        <iframe
                          key={savedStreamUrl}
                          src={savedStreamUrl}
                          title="Embedded stream"
                          className="h-full min-h-[200px] w-full border-0 lg:min-h-[280px]"
                          allow="camera; microphone; fullscreen; display-capture; autoplay"
                          referrerPolicy="no-referrer-when-downgrade"
                        />
                      </div>
                      <p className="shrink-0 text-[10px] leading-snug text-slate-500">
                        If this stays blank, the site may block embedding—use Open tab.
                      </p>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Viewer URL (https)
                      </label>
                      <textarea
                        value={streamUrlDraft}
                        onChange={(e) => setStreamUrlDraft(e.target.value)}
                        rows={3}
                        placeholder="https://…"
                        className="w-full resize-y rounded border border-slate-600 bg-slate-900 px-2 py-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-600"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={applyStreamUrl}
                          className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-900/40"
                        >
                          Save & load
                        </button>
                        {savedStreamUrl ? (
                          <button
                            type="button"
                            onClick={() => setStreamSetupOpen(false)}
                            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        ) : null}
                        {savedStreamUrl ? (
                          <button
                            type="button"
                            onClick={clearStreamUrl}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800"
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[10px] leading-snug text-slate-500">
                        Add <span className="font-mono text-slate-400">streamUrl</span> to the page query (URL-encoded),
                        or paste a viewer link here. Only <span className="font-mono text-slate-400">http:</span> /{' '}
                        <span className="font-mono text-slate-400">https:</span> URLs are accepted.
                      </p>
                    </div>
                  )}
                </div>
              </section>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {streamFloatOpen && savedStreamUrl ? (
        <div
          className="pointer-events-auto fixed z-[70] flex flex-col overflow-hidden rounded-xl border-2 border-emerald-500 bg-slate-950 shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
          role="dialog"
          aria-modal="true"
          aria-label="Floating stream player"
          style={{
            left: `${streamFloatRect.left}px`,
            top: `${streamFloatRect.top}px`,
            width: `${streamFloatRect.width}px`,
            height: `${streamFloatRect.height}px`
          }}
        >
          <div
            className="flex shrink-0 cursor-move select-none items-center justify-between gap-2 border-b border-emerald-800/70 bg-emerald-950/60 px-3 py-2"
            onPointerDown={startDragStreamFloat}
          >
            <span className="text-xs font-semibold text-emerald-200">Stream (floating)</span>
            <button
              type="button"
              onClick={() => setStreamFloatOpen(false)}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800"
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-black p-1">
            <iframe
              key={`float-${savedStreamUrl}`}
              src={savedStreamUrl}
              title="Floating embedded stream"
              className="h-full w-full border-0"
              allow="camera; microphone; fullscreen; display-capture; autoplay"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div
            className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize rounded-tl border-l border-t border-emerald-700/60 bg-emerald-900/40"
            onPointerDown={startResizeStreamFloat}
            title="Resize"
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  );
};

export default ContentReviewPage;
