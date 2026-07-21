import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseService, RunOfShowData } from '../services/database';
import { socketClient } from '../services/socket-client';
import { Event } from '../types/Event';

/** Mirrored from `RunOfShowPage.tsx` — keep visuals consistent with desktop ROS. */
const PROGRAM_TYPES = [
  'PreShow/End',
  'Podium Transition',
  'Panel Transition',
  'Full-Stage/Ted-Talk',
  'Sub Cue',
  'No Transition',
  'Video',
  'Panel+Remote',
  'Remote Only',
  'Break F&B/B2B',
  'Breakout Session',
  'Delay Block',
  'TBD',
  'KILLED'
] as const;

const PROGRAM_TYPE_COLORS: Record<string, string> = {
  'PreShow/End': '#8B5CF6',
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
  'Full-Stage/Ted-Talk': '#EA580C'
};

const SHOT_TYPES = ['Podium', '1-Shot', '2-Shot', '3-Shot', '4-Shot', '5-Shot', '6-Shot', '7-Shot', 'Ted-Talk'] as const;

function programTypeBg(programType: string): string {
  return PROGRAM_TYPE_COLORS[programType] || '#374151';
}

function programTypeFg(programType: string): string {
  return programType === 'Sub Cue' ? '#000000' : '#ffffff';
}

function isKnownProgramType(programType: string): boolean {
  return (PROGRAM_TYPES as readonly string[]).includes(programType);
}

type ScheduleItem = {
  id: number;
  day: number;
  segmentName: string;
  programType: string;
  shotType: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  notes: string;
  assets: string;
  speakersText: string;
  hasPPT: boolean;
  hasQA: boolean;
  customFields?: Record<string, string>;
};

/** Same `||` / `name|url` encoding as Content Review. */
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
      const location =
        s.location === 'Seat' || s.location === 'Virtual' || s.location === 'Moderator' ? s.location : 'Podium';
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

function normalizeScheduleItemMobile(raw: any): ScheduleItem {
  const secRaw = raw.duration_seconds ?? raw.durationSeconds;
  let durationHours: number;
  let durationMinutes: number;
  let durationSeconds: number;
  if (secRaw != null && Number.isFinite(Number(secRaw))) {
    const t = Math.max(0, Math.floor(Number(secRaw)));
    durationHours = Math.floor(t / 3600);
    durationMinutes = Math.floor((t % 3600) / 60);
    durationSeconds = t % 60;
  } else {
    durationHours = Number(raw.durationHours ?? raw.duration_hours ?? 0);
    durationMinutes = Number(raw.durationMinutes ?? raw.duration_minutes ?? 0);
    durationSeconds = Number(raw.durationSeconds ?? raw.duration_seconds ?? 0);
  }
  const cf = raw.customFields ?? raw.custom_fields ?? {};
  return {
    id: Number(raw.id),
    day: Number(raw.day ?? 1),
    programType: String(raw.programType ?? raw.program_type ?? ''),
    shotType: String(raw.shotType ?? raw.shot_type ?? ''),
    segmentName: String(raw.segmentName ?? raw.segment_name ?? ''),
    durationHours,
    durationMinutes,
    durationSeconds,
    notes: String(raw.notes ?? ''),
    assets: String(raw.assets ?? ''),
    speakersText: String(raw.speakersText ?? raw.speakers_text ?? raw.speakers ?? ''),
    hasPPT: !!(raw.hasPPT ?? raw.has_ppt),
    hasQA: !!(raw.hasQA ?? raw.has_qa),
    customFields: typeof cf === 'object' && cf !== null ? cf : {}
  };
}

/** Display-only: always `CUE 1`, `CUE 2.2`, etc. (strips any existing cue prefix, case-insensitive). */
const cueLabel = (item: ScheduleItem) => {
  const raw = item.customFields?.cue?.trim();
  if (raw) {
    const body = raw.replace(/^\s*cue\s+/i, '').trim();
    return body ? `CUE ${body}` : 'CUE';
  }
  return `CUE ${item.id}`;
};

const clampInt = (value: string, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const stripHtml = (value: string) =>
  (value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();

type RosSessionRole = 'VIEWER' | 'EDITOR' | 'OPERATOR';

/** Same rules as `RunOfShowPage` / `ScheduleRow`: navigation state, then `userRole_${eventId}` like desktop. */
function resolveSessionRole(userRole: string | undefined, eventId: string | undefined): RosSessionRole {
  const raw = (userRole || '').toString().trim().toUpperCase();
  if (raw === 'VIEWER' || raw === 'EDITOR' || raw === 'OPERATOR') return raw;
  if (eventId) {
    try {
      const saved = localStorage.getItem(`userRole_${eventId}`);
      if (saved === 'VIEWER' || saved === 'EDITOR' || saved === 'OPERATOR') return saved;
    } catch {
      /* ignore */
    }
  }
  return 'VIEWER';
}

/** Seven speaker slots — compact labels (mirrors Content Review read mode). */
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

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Desktop-style timer text: HH:MM:SS and supports negative overtime. */
function formatLiveClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00:00';
  const isNegative = seconds < 0;
  const absSeconds = Math.abs(Math.floor(seconds));
  const h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const s = absSeconds % 60;
  const sign = isNegative ? '-' : '';
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Match desktop thresholds: >120 green, >30 yellow, else red (and overtime red). */
function timerColorClass(remainingSeconds: number): string {
  if (remainingSeconds > 120) return 'text-emerald-300';
  if (remainingSeconds > 30) return 'text-amber-300';
  return 'text-red-300';
}

/** Elapsed seconds since server `started_at`, using client+offset as synced wall clock (desktop ROS style). */
function elapsedSinceStart(startedAt: string | null | undefined, clockOffsetMs = 0): number {
  if (!startedAt) return 0;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return 0;
  if (t > new Date('2090-01-01T00:00:00Z').getTime()) return 0;
  const now = Date.now() + clockOffsetMs;
  return Math.max(0, Math.floor((now - t) / 1000));
}

type PrimaryLive =
  | {
      kind: 'running';
      itemId: number;
      total: number;
      startedAt: string;
      cueText: string;
      /** When set, remaining = total − tickBaseElapsed − (now − tickAnchorMs)/1s (matches server `elapsed_seconds`). */
      tickAnchorMs?: number;
      tickBaseElapsed?: number;
    }
  | { kind: 'loaded'; itemId: number; total: number; cueText: string };

type SubLive = {
  itemId: number;
  total: number;
  startedAt: string;
  cueText: string;
  tickAnchorMs?: number;
  tickBaseElapsed?: number;
};

/** Snap countdown to server-reported elapsed time when present (avoids client/server clock skew). */
function attachElapsedTick<T extends object>(base: T, source: any): T {
  const raw = source?.elapsed_seconds ?? source?.elapsedSeconds;
  if (raw == null || raw === '') return base;
  const n = Number(raw);
  if (!Number.isFinite(n)) return base;
  return { ...base, tickAnchorMs: Date.now(), tickBaseElapsed: Math.max(0, Math.floor(n)) };
}

function getElapsedSeconds(source: any): number | null {
  const raw = source?.elapsed_seconds ?? source?.elapsedSeconds;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function remainingRunningSec(
  total: number,
  startedAt: string,
  tickAnchorMs: number | undefined,
  tickBaseElapsed: number | undefined,
  clockOffsetMs: number
): number {
  if (tickAnchorMs != null && tickBaseElapsed != null) {
    const delta = Math.floor((Date.now() - tickAnchorMs) / 1000);
    return total - tickBaseElapsed - delta;
  }
  const elapsed = elapsedSinceStart(startedAt, clockOffsetMs);
  return total - elapsed;
}

function truthyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 't' || v === 'T';
}

function isRealStartedAt(startedAt: string): boolean {
  if (!startedAt) return false;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return false;
  return t < new Date('2090-01-01T00:00:00Z').getTime();
}

/** Match `RunOfShowPage` sync: infer loaded/running when `timer_state` is missing. */
function parsePrimaryLive(row: any, list: ScheduleItem[]): PrimaryLive | null {
  if (!row || typeof row !== 'object') return null;
  const stateRaw = String(row.timer_state || '').toLowerCase();
  if (stateRaw === 'stopped') return null;

  const rawItemId = row.item_id ?? row.last_loaded_cue_id;
  if (rawItemId == null || rawItemId === '') return null;
  const itemId = Number(rawItemId);
  if (!Number.isFinite(itemId)) return null;

  const total = Math.max(0, Number(row.duration_seconds ?? 0) || 0);
  const stub =
    list.find((i) => i.id === itemId) ||
    ({ id: itemId, customFields: {} } as ScheduleItem);
  const cueRaw = row.cue_is != null ? String(row.cue_is).trim() : '';
  const cueText = cueRaw || cueLabel(stub);

  const isRunning = truthyFlag(row.is_running);
  const isActive = truthyFlag(row.is_active);
  const startedAt = row.started_at != null ? String(row.started_at) : '';
  const elapsedRaw = row.elapsed_seconds ?? row.elapsedSeconds;
  const elapsed = Number(elapsedRaw);
  const hasElapsed = Number.isFinite(elapsed) && elapsed > 0;
  const hasRealStartedAt = startedAt ? isRealStartedAt(startedAt) : false;

  let kind: 'running' | 'loaded' | null = null;
  if (stateRaw === 'running' || isRunning) kind = 'running';
  else if (isActive && (hasElapsed || hasRealStartedAt)) kind = 'running';
  else if (stateRaw === 'loaded') kind = 'loaded';
  else if (!stateRaw || stateRaw === 'unknown') {
    if (isActive && hasRealStartedAt) kind = 'running';
    else if (isActive) kind = 'loaded';
  } else if (isActive) {
    kind = 'loaded';
  }

  if (!kind) return null;
  if (kind === 'running') {
    return { kind: 'running', itemId, total, startedAt, cueText };
  }
  return { kind: 'loaded', itemId, total, cueText };
}

function socketEventMatchesEvent(data: any, eventIdStr: string): boolean {
  const rid = data?.event_id ?? data?.eventId;
  if (rid == null || rid === '') return false;
  return String(rid) === eventIdStr;
}

function parseSubLive(data: any, list: ScheduleItem[]): SubLive | null {
  if (!data || typeof data !== 'object') return null;
  if (data.is_running === false || data.is_running === 0 || data.is_running === 'false' || data.is_running === 'f') {
    return null;
  }

  const rawItemId = data.item_id;
  if (rawItemId == null || rawItemId === '') return null;
  const itemId = Number(rawItemId);
  if (!Number.isFinite(itemId)) return null;

  const total = Math.max(0, Number(data.duration_seconds ?? 0) || 0);
  const startedAt = data.started_at != null ? String(data.started_at) : '';
  const isRunning = truthyFlag(data.is_running) || String(data.timer_state || '').toLowerCase() === 'running';
  const hasElapsed = (() => {
    const e = Number(data.elapsed_seconds ?? data.elapsedSeconds);
    return Number.isFinite(e) && e > 0;
  })();
  if (!isRunning && !hasElapsed && !isRealStartedAt(startedAt)) return null;
  const stub =
    list.find((i) => i.id === itemId) ||
    ({ id: itemId, customFields: {} } as ScheduleItem);
  const cueRaw = data.cue_display != null ? String(data.cue_display).trim() : '';
  const cueText = cueRaw || cueLabel(stub);
  return { itemId, total, startedAt, cueText };
}

function mergeRunningPrimaryFromRow(
  activeRow: any,
  list: ScheduleItem[],
  prev: PrimaryLive | null
): PrimaryLive | null {
  const next = parsePrimaryLive(activeRow, list);
  if (!next || next.kind !== 'running') return next;
  const elapsedFromRow = getElapsedSeconds(activeRow);
  if (elapsedFromRow != null) {
    // Important: some REST rows keep elapsed_seconds at 0 while running.
    // Do not reset anchor every poll unless elapsed actually advanced.
    const prevElapsed = prev?.kind === 'running' ? prev.tickBaseElapsed : undefined;
    const shouldSnap =
      prev?.kind !== 'running' ||
      prev.itemId !== next.itemId ||
      prevElapsed == null ||
      elapsedFromRow > prevElapsed;
    if (shouldSnap) {
      return attachElapsedTick({ ...next }, activeRow) as PrimaryLive;
    }
  }
  if (
    prev?.kind === 'running' &&
    prev.itemId === next.itemId &&
    prev.tickAnchorMs != null &&
    prev.tickBaseElapsed != null
  ) {
    return { ...next, tickAnchorMs: prev.tickAnchorMs, tickBaseElapsed: prev.tickBaseElapsed };
  }
  return next;
}

function mergeRunningSubFromRow(
  subData: any,
  list: ScheduleItem[],
  prev: SubLive | null
): SubLive | null {
  const next = parseSubLive(subData, list);
  if (!next) return null;
  const elapsedFromRow = getElapsedSeconds(subData);
  if (elapsedFromRow != null) {
    const shouldSnap =
      !prev ||
      prev.itemId !== next.itemId ||
      prev.tickBaseElapsed == null ||
      elapsedFromRow > prev.tickBaseElapsed;
    if (shouldSnap) return attachElapsedTick({ ...next }, subData);
  }
  if (
    prev &&
    prev.itemId === next.itemId &&
    prev.tickAnchorMs != null &&
    prev.tickBaseElapsed != null
  ) {
    return { ...next, tickAnchorMs: prev.tickAnchorMs, tickBaseElapsed: prev.tickBaseElapsed };
  }
  return next;
}

const RunOfShowMobilePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const event = (location.state as { event?: Event; userRole?: string } | undefined)?.event;
  const userRole = (location.state as { event?: Event; userRole?: string } | undefined)?.userRole;

  const sessionRole = useMemo(
    () => resolveSessionRole(userRole, event?.id),
    [userRole, event?.id]
  );
  const isViewer = sessionRole === 'VIEWER';
  const isEditor = sessionRole === 'EDITOR';
  const isOperator = sessionRole === 'OPERATOR';
  /** Cue + duration + day — matches desktop (viewer blocked; editor + operator). */
  const canEditCueOrDuration = isEditor || isOperator;
  /** Program, segment, shot, notes, assets, speakers, PPT/Q&A — editor only on desktop grid. */
  const canEditEditorOnlyFields = isEditor;

  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [rosData, setRosData] = useState<RunOfShowData | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [segmentDraft, setSegmentDraft] = useState('');
  const [programDraft, setProgramDraft] = useState('');
  const [shotDraft, setShotDraft] = useState('');
  const [dayDraft, setDayDraft] = useState('1');
  const [hoursDraft, setHoursDraft] = useState('0');
  const [minutesDraft, setMinutesDraft] = useState('0');
  const [secondsDraft, setSecondsDraft] = useState('0');
  const [notesDraft, setNotesDraft] = useState('');
  const [assetRows, setAssetRows] = useState<AssetRow[]>([
    { id: `asset-${Date.now()}`, name: '', link: '', linkEnabled: false }
  ]);
  const [speakerDraft, setSpeakerDraft] = useState<SpeakerSlotDraft[]>([]);
  const [cueDraft, setCueDraft] = useState('');
  const [hasPptDraft, setHasPptDraft] = useState(false);
  const [hasQaDraft, setHasQaDraft] = useState(false);
  const [extraCustomDraft, setExtraCustomDraft] = useState<Record<string, string>>({});

  const itemsRef = useRef<ScheduleItem[]>([]);
  const [primaryLive, setPrimaryLive] = useState<PrimaryLive | null>(null);
  const [subLive, setSubLive] = useState<SubLive | null>(null);
  const [hybridTimerData, setHybridTimerData] = useState<{ activeTimer: any | null; secondaryTimer: any | null }>({
    activeTimer: null,
    secondaryTimer: null
  });
  const [liveTick, setLiveTick] = useState(0);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [timerPollError, setTimerPollError] = useState<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const id = window.setInterval(() => setLiveTick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const activeRow = await DatabaseService.getActiveTimer(event.id);
        if (cancelled) return;
        const list = itemsRef.current;
        setPrimaryLive((prev) => mergeRunningPrimaryFromRow(activeRow, list, prev));
        setTimerPollError(null);
      } catch (err) {
        if (!cancelled) {
          console.warn('ROS mobile timer poll failed', err);
          setPrimaryLive(null);
          setSubLive(null);
          setTimerPollError('Live timers unavailable (network or API). Open the browser console for details.');
        }
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [event?.id, items.length]);

  /** Desktop ROS drives timers over Socket.IO; REST active-timer rows can lag. Subscribe like desktop. */
  useEffect(() => {
    if (!event?.id) return;
    const eventIdStr = String(event.id);

    const refreshTimersFromRest = async () => {
      try {
        const activeRow = await DatabaseService.getActiveTimer(event.id);
        const list = itemsRef.current;
        setPrimaryLive((prev) => mergeRunningPrimaryFromRow(activeRow, list, prev));
        setTimerPollError(null);
      } catch (e) {
        console.warn('ROS mobile timer REST sync failed', e);
      }
    };

    socketClient.connect(eventIdStr, {
      onServerTime: (data: any) => {
        const serverTime = data?.serverTime != null ? new Date(data.serverTime).getTime() : NaN;
        if (!Number.isFinite(serverTime)) return;
        setClockOffsetMs(serverTime - Date.now());
      },
      onTimerUpdated: (data: any) => {
        if (!socketEventMatchesEvent(data, eventIdStr)) return;
        setHybridTimerData((prev) => ({ ...prev, activeTimer: data }));
        const next = parsePrimaryLive(data, itemsRef.current);
        if (next?.kind === 'running') {
          setPrimaryLive(attachElapsedTick({ ...next }, data) as PrimaryLive);
        } else {
          setPrimaryLive(next);
        }
      },
      onActiveTimersUpdated: (data: any) => {
        let timerData = data;
        if (Array.isArray(data) && data.length > 0) timerData = data[0];
        if (!timerData || !socketEventMatchesEvent(timerData, eventIdStr)) return;
        if (
          timerData.timer_state === 'stopped' ||
          !timerData.is_active ||
          (timerData.is_running === false && timerData.is_active === false)
        ) {
          setHybridTimerData((prev) => ({ ...prev, activeTimer: null }));
          setPrimaryLive(null);
          return;
        }
        setHybridTimerData((prev) => ({ ...prev, activeTimer: timerData }));
        const next = parsePrimaryLive(timerData, itemsRef.current);
        if (next?.kind === 'running') {
          setPrimaryLive(attachElapsedTick({ ...next }, timerData) as PrimaryLive);
        } else {
          setPrimaryLive(next);
        }
      },
      onTimerStopped: (data: any) => {
        if (data && socketEventMatchesEvent(data, eventIdStr)) {
          setHybridTimerData((prev) => ({ ...prev, activeTimer: null }));
          setPrimaryLive(null);
        }
      },
      onTimersStopped: (data: any) => {
        if (data && socketEventMatchesEvent(data, eventIdStr)) {
          setHybridTimerData((prev) => ({ ...prev, activeTimer: null, secondaryTimer: null }));
          setPrimaryLive(null);
        }
      },
      onSubCueTimerStarted: (data: any) => {
        if (!socketEventMatchesEvent(data, eventIdStr)) return;
        setHybridTimerData((prev) => ({ ...prev, secondaryTimer: data }));
        const next = parseSubLive(data, itemsRef.current);
        if (!next) {
          setSubLive(null);
          return;
        }
        setSubLive(attachElapsedTick({ ...next }, data));
      },
      onSubCueTimerStopped: (data: any) => {
        if (data && socketEventMatchesEvent(data, eventIdStr)) {
          setHybridTimerData((prev) => ({ ...prev, secondaryTimer: null }));
          setSubLive(null);
        }
      },
      onResetAllStates: () => {
        setHybridTimerData({ activeTimer: null, secondaryTimer: null });
        setPrimaryLive(null);
        setSubLive(null);
      }
    });

    void refreshTimersFromRest();

    return () => {
      socketClient.disconnect(event.id);
    };
  }, [event?.id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!event?.id) {
        setError('Missing event context. Please launch from Event List.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = await DatabaseService.getRunOfShowData(event.id);
        const schedule = Array.isArray(data?.schedule_items)
          ? (data.schedule_items as any[]).map(normalizeScheduleItemMobile)
          : [];
        const sorted = [...schedule].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
        if (cancelled) return;
        setRosData(
          data || {
            event_id: event.id,
            event_name: event.name,
            event_date: event.date,
            schedule_items: sorted,
            custom_columns: [],
            settings: {}
          }
        );
        setItems(sorted);
        setSelectedId(sorted[0]?.id ?? null);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load ROS mobile data', err);
        setError('Unable to load Run Of Show data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [event?.id]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  useEffect(() => {
    if (!selectedItem) return;
    setSegmentDraft(selectedItem.segmentName || '');
    setProgramDraft(selectedItem.programType || '');
    setShotDraft(selectedItem.shotType || '');
    setDayDraft(String(selectedItem.day ?? 1));
    setHoursDraft(String(selectedItem.durationHours ?? 0));
    setMinutesDraft(String(selectedItem.durationMinutes ?? 0));
    setSecondsDraft(String(selectedItem.durationSeconds ?? 0));
    setNotesDraft(stripHtml(selectedItem.notes || ''));
    const parsedAssets = parseAssetRows(selectedItem.assets ?? '');
    setAssetRows(
      parsedAssets.length ? parsedAssets : [{ id: `asset-${Date.now()}`, name: '', link: '', linkEnabled: false }]
    );
    setSpeakerDraft(parseSpeakersDraft(selectedItem.speakersText ?? ''));
    setCueDraft(selectedItem.customFields?.cue || '');
    setHasPptDraft(!!selectedItem.hasPPT);
    setHasQaDraft(!!selectedItem.hasQA);
    setSaveMessage('');

    const cols = Array.isArray(rosData?.custom_columns) ? rosData.custom_columns : [];
    const nextExtra: Record<string, string> = {};
    const cf = selectedItem.customFields || {};
    for (const col of cols as { name?: string }[]) {
      const name = col?.name?.trim();
      if (!name || name === 'cue') continue;
      nextExtra[name] = String(cf[name] ?? '');
    }
    setExtraCustomDraft(nextExtra);
  }, [selectedItem, rosData?.custom_columns]);

  const saveSelectedItem = async () => {
    if (isViewer || !selectedItem || !event?.id || !rosData) return;
    setIsSaving(true);
    setSaveMessage('');
    const updatedItem: ScheduleItem = {
      ...selectedItem,
      segmentName: segmentDraft.trim(),
      programType: programDraft.trim(),
      shotType: shotDraft.trim(),
      day: clampInt(dayDraft, 1, 99),
      durationHours: clampInt(hoursDraft, 0, 23),
      durationMinutes: clampInt(minutesDraft, 0, 59),
      durationSeconds: clampInt(secondsDraft, 0, 59),
      notes: notesDraft,
      assets: stringifyAssetRows(assetRows),
      speakersText: stringifySpeakersDraft(speakerDraft),
      hasPPT: hasPptDraft,
      hasQA: hasQaDraft,
      customFields: {
        ...(selectedItem.customFields || {}),
        ...extraCustomDraft,
        cue: cueDraft.trim()
      }
    };
    const updatedItems = items.map((item) => (item.id === selectedItem.id ? updatedItem : item));
    setItems(updatedItems);
    try {
      const payload = {
        event_id: rosData.event_id || event.id,
        event_name: rosData.event_name || event.name,
        event_date: rosData.event_date || event.date,
        schedule_items: updatedItems,
        custom_columns: Array.isArray(rosData.custom_columns) ? rosData.custom_columns : [],
        settings: rosData.settings || {}
      };
      const result = await DatabaseService.saveRunOfShowData(payload);
      if (result) setRosData(result);
      setSaveMessage('Saved');
    } catch (err) {
      console.error('Failed to save mobile ROS item', err);
      setSaveMessage('Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const subRemainingSec = useMemo(() => {
    if (!subLive) return null;
    return remainingRunningSec(
      subLive.total,
      subLive.startedAt,
      subLive.tickAnchorMs,
      subLive.tickBaseElapsed,
      clockOffsetMs
    );
  }, [subLive, liveTick, clockOffsetMs]);

  const desktopPrimaryLive = useMemo<PrimaryLive | null>(() => {
    const t = hybridTimerData.activeTimer;
    if (!t || typeof t !== 'object') return null;
    const stateRaw = String(t.timer_state || '').toLowerCase();
    if (stateRaw === 'stopped') return null;
    const isActive = truthyFlag(t.is_active);
    if (!isActive) return null;

    const rawItemId = t.item_id ?? t.last_loaded_cue_id;
    const itemId = Number(rawItemId);
    if (!Number.isFinite(itemId)) return null;
    const total = Math.max(0, Number(t.duration_seconds ?? 0) || 0);
    const stub = itemsRef.current.find((i) => i.id === itemId) || ({ id: itemId, customFields: {} } as ScheduleItem);
    const cueRaw = t.cue_is != null ? String(t.cue_is).trim() : '';
    const cueText = cueRaw || cueLabel(stub);

    if (truthyFlag(t.is_running) || stateRaw === 'running') {
      return {
        kind: 'running',
        itemId,
        total,
        startedAt: t.started_at != null ? String(t.started_at) : '',
        cueText
      };
    }
    return { kind: 'loaded', itemId, total, cueText };
  }, [hybridTimerData.activeTimer, items.length]);

  const effectivePrimaryLive = desktopPrimaryLive ?? primaryLive;
  const effectivePrimaryRemainingSec = useMemo(() => {
    const p = effectivePrimaryLive;
    if (!p) return null;
    if (p.kind === 'loaded') return p.total;
    const startedAtMs = Date.parse(p.startedAt || '');
    if (!Number.isFinite(startedAtMs)) return p.total;
    const syncedNow = Date.now() + clockOffsetMs;
    const elapsed = Math.floor((syncedNow - startedAtMs) / 1000);
    return p.total - Math.max(0, elapsed);
  }, [effectivePrimaryLive, liveTick, clockOffsetMs]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 pb-40 pt-[var(--app-header-height)]">
      <div className="mx-auto max-w-xl space-y-3 px-3 pt-2">
        <div className="rounded-xl border border-slate-600 bg-slate-900/80 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Run Of Show Mobile</p>
              <h1 className="text-base font-bold text-white">{event?.name || 'Run Of Show'}</h1>
              <p className="text-xs text-slate-400">{event?.date || ''}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/run-of-show', { state: { event, userRole: sessionRole } })}
              className="rounded-md border border-slate-500 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
            >
              Desktop ROS
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-4 text-sm text-slate-300">Loading rundown...</div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/50 bg-red-950/30 p-4 text-sm text-red-200">{error}</div>
        ) : !selectedItem ? (
          <div className="rounded-xl border border-slate-600 bg-slate-900/70 p-4 text-sm text-slate-300">No cues found for this event.</div>
        ) : (
          <div className="rounded-xl border border-slate-600 bg-slate-900/90 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={`rounded px-2 py-1 text-xs font-bold ${
                  programDraft === 'KILLED' ? 'opacity-75 line-through' : ''
                }`}
                style={{ backgroundColor: 'rgba(34,211,238,0.35)', color: '#ecfeff' }}
              >
                {cueLabel(selectedItem)}
              </span>
              <span
                className="truncate rounded px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-white/10 max-w-[65%]"
                style={{
                  backgroundColor: programTypeBg(programDraft),
                  color: programTypeFg(programDraft)
                }}
                title={programDraft || 'No Transition'}
              >
                {programDraft || 'No Transition'}
              </span>
              <span className="ml-auto rounded bg-slate-800 px-2 py-1 text-xs font-mono ring-1 ring-slate-600">
                {String(clampInt(hoursDraft, 0, 23)).padStart(2, '0')}:
                {String(clampInt(minutesDraft, 0, 59)).padStart(2, '0')}:
                {String(clampInt(secondsDraft, 0, 59)).padStart(2, '0')}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-md border border-slate-600 bg-slate-800/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                Role: {sessionRole}
              </span>
            </div>
            {isViewer ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-950/35 px-2.5 py-2 text-[11px] leading-snug text-amber-100">
                <span className="font-semibold">Viewer</span> — this rundown is read-only. Choose Editor or Operator when launching the event to make changes.
              </div>
            ) : isOperator ? (
              <div className="rounded-md border border-sky-500/40 bg-sky-950/35 px-2.5 py-2 text-[11px] leading-snug text-sky-100">
                <span className="font-semibold">Operator</span> — you can edit cue, day, duration, and custom columns. Program, segment, shot, notes, assets, speakers, and PPT/Q&A are editor-only (same as desktop ROS).
              </div>
            ) : null}

            <div className="border-t border-slate-700 pt-2 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Identity</p>
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-400">Cue</label>
                <input
                  value={cueDraft}
                  onChange={(e) => setCueDraft(e.target.value)}
                  disabled={!canEditCueOrDuration}
                  title={isViewer ? 'Viewers cannot edit cue names (desktop ROS)' : undefined}
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-400">Segment</label>
                <input
                  value={segmentDraft}
                  onChange={(e) => setSegmentDraft(e.target.value)}
                  disabled={!canEditEditorOnlyFields}
                  title={!canEditEditorOnlyFields ? 'Only Editors can edit segment names (desktop ROS)' : undefined}
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="border-t border-slate-700 pt-2 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Timing</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-slate-400">Day</label>
                  <input
                    type="number"
                    min={1}
                    value={dayDraft}
                    onChange={(e) => setDayDraft(e.target.value)}
                    disabled={!canEditCueOrDuration}
                    title={isViewer ? 'Viewers cannot edit day' : undefined}
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-slate-400">HH</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={hoursDraft}
                    onChange={(e) => setHoursDraft(e.target.value)}
                    disabled={!canEditCueOrDuration}
                    title={isViewer ? 'Viewers cannot edit duration' : undefined}
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-slate-400">MM:SS</label>
                  <div className="mt-1 flex gap-1">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={minutesDraft}
                      onChange={(e) => setMinutesDraft(e.target.value)}
                      disabled={!canEditCueOrDuration}
                      title={isViewer ? 'Viewers cannot edit duration' : undefined}
                      className="w-1/2 rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={secondsDraft}
                      onChange={(e) => setSecondsDraft(e.target.value)}
                      disabled={!canEditCueOrDuration}
                      title={isViewer ? 'Viewers cannot edit duration' : undefined}
                      className="w-1/2 rounded border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-700 pt-2 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Production</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-slate-400">Program Type</label>
                  <select
                    value={programDraft || 'No Transition'}
                    onChange={(e) => setProgramDraft(e.target.value)}
                    disabled={!canEditEditorOnlyFields}
                    title={!canEditEditorOnlyFields ? 'Only Editors can edit program type (desktop ROS)' : undefined}
                    className="mt-1 w-full rounded-md border border-slate-500 px-2.5 py-2 text-sm font-semibold outline-none ring-2 ring-transparent transition focus:border-cyan-400 focus:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      backgroundColor: programTypeBg(programDraft || 'No Transition'),
                      color: programTypeFg(programDraft || 'No Transition')
                    }}
                  >
                    {programDraft && !isKnownProgramType(programDraft) ? (
                      <option
                        value={programDraft}
                        style={{
                          backgroundColor: programTypeBg(programDraft),
                          color: programTypeFg(programDraft)
                        }}
                      >
                        Current (legacy): {programDraft}
                      </option>
                    ) : null}
                    {PROGRAM_TYPES.map((type) => (
                      <option
                        key={type}
                        value={type}
                        style={{
                          backgroundColor: programTypeBg(type),
                          color: programTypeFg(type)
                        }}
                      >
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-slate-400">Shot Type</label>
                  <select
                    value={shotDraft}
                    onChange={(e) => setShotDraft(e.target.value)}
                    disabled={!canEditEditorOnlyFields}
                    title={!canEditEditorOnlyFields ? 'Only Editors can edit shot type (desktop ROS)' : undefined}
                    className="mt-1 w-full rounded border-2 border-slate-500 bg-slate-700 px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select Shot Type</option>
                    {SHOT_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {Array.isArray(rosData?.custom_columns) && rosData.custom_columns.length > 0 ? (
                <>
                  <div className="border-t border-slate-700 pt-2 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Custom Columns</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {(rosData.custom_columns as { id?: string; name?: string }[]).map((col) => {
                      const key = col.name?.trim();
                      if (!key || key === 'cue') return null;
                      return (
                        <div key={col.id || key}>
                          <label className="text-[11px] uppercase tracking-wide text-slate-400">{key}</label>
                          <input
                            value={extraCustomDraft[key] ?? ''}
                            onChange={(e) =>
                              setExtraCustomDraft((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            disabled={isViewer}
                            title={isViewer ? 'Viewers cannot edit custom columns' : undefined}
                            className="mt-1 w-full rounded border border-slate-600 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              <div className="border-t border-slate-700 pt-2 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Supporting</p>
              </div>

              {canEditEditorOnlyFields ? (
                <>
              <div className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800/80">
                <div className="border-b border-slate-600 bg-slate-700/90 px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-200">
                  Speakers (slots 1–7)
                </div>
                <div className="space-y-2 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-slate-300">Participants ({speakerDraft.length}/7)</span>
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
                              location: 'Podium' as const,
                              fullName: '',
                              title: '',
                              org: '',
                              photoLink: ''
                            }
                          ].sort((a, b) => a.slot - b.slot);
                        });
                      }}
                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      + Add Speaker
                    </button>
                  </div>
                  {speakerDraft.length === 0 ? (
                    <div className="rounded border border-slate-700 bg-slate-900/50 p-2 text-[11px] text-slate-400">
                      No speakers yet. Use &quot;Add Speaker&quot; to add one at a time.
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {speakerDraft
                      .slice()
                      .sort((a, b) => a.slot - b.slot)
                      .map((sp) => (
                        <div key={sp.id} className="rounded border border-slate-600 bg-slate-900/60 p-2">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase text-slate-400">Speaker {sp.slot}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setSpeakerDraft((prev) => prev.filter((row) => row.id !== sp.id))
                              }
                              className="rounded bg-rose-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-600"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Slot</label>
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
                                }}
                                className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                              >
                                {[1, 2, 3, 4, 5, 6, 7].map((slotNum) => {
                                  const taken = speakerDraft.some((r) => r.id !== sp.id && r.slot === slotNum);
                                  return (
                                    <option key={`${sp.id}-slot-${slotNum}`} value={slotNum} disabled={taken}>
                                      {slotNum}
                                      {taken ? ' (used)' : ''}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Location</label>
                              <select
                                value={sp.location}
                                onChange={(e) => {
                                  const nextLocation =
                                    (e.target.value as SpeakerSlotDraft['location']) || 'Podium';
                                  setSpeakerDraft((prev) =>
                                    prev.map((row) => (row.id === sp.id ? { ...row, location: nextLocation } : row))
                                  );
                                }}
                                className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                              >
                                <option value="Podium">Podium</option>
                                <option value="Seat">Seat</option>
                                <option value="Virtual">Virtual</option>
                                <option value="Moderator">Moderator</option>
                              </select>
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Full Name</label>
                              <input
                                type="text"
                                value={sp.fullName}
                                onChange={(e) =>
                                  setSpeakerDraft((prev) =>
                                    prev.map((row) => (row.id === sp.id ? { ...row, fullName: e.target.value } : row))
                                  )
                                }
                                placeholder="Enter full name"
                                className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Title</label>
                              <input
                                type="text"
                                value={sp.title}
                                onChange={(e) =>
                                  setSpeakerDraft((prev) =>
                                    prev.map((row) => (row.id === sp.id ? { ...row, title: e.target.value } : row))
                                  )
                                }
                                placeholder="Title / position"
                                className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Organization</label>
                              <input
                                type="text"
                                value={sp.org}
                                onChange={(e) =>
                                  setSpeakerDraft((prev) =>
                                    prev.map((row) => (row.id === sp.id ? { ...row, org: e.target.value } : row))
                                  )
                                }
                                placeholder="Organization"
                                className="w-full rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Photo URL</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="url"
                                  value={sp.photoLink}
                                  onChange={(e) =>
                                    setSpeakerDraft((prev) =>
                                      prev.map((row) =>
                                        row.id === sp.id ? { ...row, photoLink: e.target.value } : row
                                      )
                                    )
                                  }
                                  placeholder="https://..."
                                  className="min-w-0 flex-1 rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                                />
                                {sp.photoLink ? (
                                  <img
                                    src={sp.photoLink}
                                    alt={sp.fullName || `Speaker ${sp.slot}`}
                                    className="h-8 w-8 shrink-0 rounded border border-slate-500 object-cover"
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
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800/80">
                <div className="border-b border-slate-600 bg-slate-700/90 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-200">
                  Assets
                </div>
                <div className="space-y-2 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Assets list</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAssetRows((prev) => [
                          ...prev,
                          { id: `asset-${Date.now()}-${prev.length}`, name: '', link: '', linkEnabled: false }
                        ])
                      }
                      className="rounded bg-emerald-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                    >
                      + Add Asset
                    </button>
                  </div>
                  <div className="space-y-2">
                    {assetRows.map((row) => (
                      <div key={row.id} className="rounded border border-slate-600 bg-slate-900/70 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAssetRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: v } : r)));
                            }}
                            placeholder="Asset name..."
                            className="min-w-0 flex-1 rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-400"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setAssetRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? { ...r, linkEnabled: !r.linkEnabled, link: !r.linkEnabled ? r.link : '' }
                                    : r
                                )
                              )
                            }
                            className={`rounded px-2 py-1 text-[11px] font-semibold ${
                              row.linkEnabled
                                ? 'bg-slate-600 text-white hover:bg-slate-500'
                                : 'bg-blue-700 text-white hover:bg-blue-600'
                            }`}
                          >
                            {row.linkEnabled ? '− Link' : '+ Link'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setAssetRows((prev) => {
                                const next = prev.filter((r) => r.id !== row.id);
                                return next.length
                                  ? next
                                  : [{ id: `asset-${Date.now()}`, name: '', link: '', linkEnabled: false }];
                              })
                            }
                            className="rounded bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-600"
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
                            }}
                            placeholder="Enter asset URL..."
                            className="mt-2 w-full rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-sm text-cyan-100 outline-none focus:border-cyan-400"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
                </>
              ) : (
                <>
                  <div className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800/80">
                    <div className="border-b border-slate-600 bg-slate-700/90 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-200">
                      Speakers (read-only)
                    </div>
                    <div className="p-2">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {parseSpeakersSlots(selectedItem.speakersText ?? '').map((cell, i) => (
                          <div
                            key={i}
                            className="flex min-h-[4.5rem] flex-col rounded border border-slate-600 bg-slate-900/50 p-2 text-center"
                          >
                            <div className="text-[10px] font-bold uppercase text-slate-500">Slot {i + 1}</div>
                            <div className="mt-1 whitespace-pre-line text-xs font-semibold leading-snug text-white">
                              {cell || '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800/80">
                    <div className="border-b border-slate-600 bg-slate-700/90 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-200">
                      Assets (read-only)
                    </div>
                    <div className="break-words p-3 text-sm text-cyan-100/90">
                      {(() => {
                        const rows = parseAssetRows(selectedItem.assets ?? '');
                        if (!rows.length) {
                          return <span className="text-slate-500">None</span>;
                        }
                        return (
                          <ul className="list-inside list-disc space-y-1.5">
                            {rows.map((a, i) => (
                              <li key={`${a.name}-${i}`}>
                                <span className="font-medium text-white">{a.name}</span>
                                {a.link ? (
                                  <>
                                    {' '}
                                    <a
                                      href={a.link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-cyan-300 underline"
                                    >
                                      open link
                                    </a>
                                  </>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="text-[11px] uppercase tracking-wide text-slate-400">Notes</label>
                <textarea
                  rows={6}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  readOnly={!canEditEditorOnlyFields}
                  title={!canEditEditorOnlyFields ? 'Only Editors can edit notes (desktop ROS)' : undefined}
                  className={`mt-1 w-full rounded border border-slate-600 px-2.5 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none ${
                    canEditEditorOnlyFields ? 'bg-slate-950' : 'cursor-default bg-slate-900/80 text-slate-300'
                  }`}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={hasPptDraft}
                    onChange={(e) => setHasPptDraft(e.target.checked)}
                    disabled={!canEditEditorOnlyFields}
                    title={!canEditEditorOnlyFields ? 'Only Editors can edit PPT (desktop ROS)' : undefined}
                  />
                  PPT
                </label>
                <label className="inline-flex items-center gap-2 text-slate-200">
                  <input
                    type="checkbox"
                    checked={hasQaDraft}
                    onChange={(e) => setHasQaDraft(e.target.checked)}
                    disabled={!canEditEditorOnlyFields}
                    title={!canEditEditorOnlyFields ? 'Only Editors can edit Q&A (desktop ROS)' : undefined}
                  />
                  Q&A
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveSelectedItem}
                  disabled={isSaving || isViewer}
                  title={isViewer ? 'Viewers cannot save changes' : undefined}
                  className="rounded bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
                <span className="text-xs text-slate-400">{saveMessage}</span>
              </div>
            </div>

            <div className="text-xs text-slate-400">{items.length} total cues</div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-700 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-2 py-2">
          {timerPollError && !effectivePrimaryLive && !subLive ? (
            <div className="mb-2 rounded-lg border border-amber-600/40 bg-amber-950/35 px-2 py-2 text-[11px] leading-snug text-amber-100">
              {timerPollError}
            </div>
          ) : null}
          {!loading && !error && event?.id && !effectivePrimaryLive && !subLive && !timerPollError ? (
            <div className="mb-2 rounded-md border border-slate-700/80 bg-slate-950/60 px-2 py-1.5 text-[10px] leading-snug text-slate-500">
              No active cue on the server yet. When an operator loads or starts a timer from desktop Run Of Show, it will show here.
            </div>
          ) : null}
          {effectivePrimaryLive || subLive ? (
            <div className="mb-2 space-y-2 rounded-lg border border-slate-600 bg-slate-950/90 px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Live timers</div>
              {effectivePrimaryLive ? (
                <div className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {effectivePrimaryLive.kind === 'running' ? 'Running Cue' : 'Loaded Cue'}
                  </div>
                  <div className="truncate text-sm font-semibold text-white">{effectivePrimaryLive.cueText}</div>
                  <div
                    className={`mt-1 font-mono text-3xl font-bold tabular-nums ${
                      effectivePrimaryLive.kind === 'running' && effectivePrimaryRemainingSec != null
                        ? timerColorClass(effectivePrimaryRemainingSec)
                        : 'text-amber-300'
                    }`}
                  >
                    {effectivePrimaryLive.kind === 'running' && effectivePrimaryRemainingSec != null
                      ? formatLiveClock(effectivePrimaryRemainingSec)
                      : formatLiveClock(effectivePrimaryLive.total)}
                  </div>
                </div>
              ) : null}
              {subLive && subRemainingSec != null ? (
                <div className="rounded-md border border-violet-700/70 bg-violet-950/30 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-violet-200">Sub Cue</div>
                  <div className="truncate text-sm font-semibold text-white">{subLive.cueText}</div>
                  <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${timerColorClass(subRemainingSec)}`}>
                    {formatLiveClock(subRemainingSec)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mb-1 text-[11px] text-slate-400">Cues</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {items.map((item) => {
              const active = item.id === selectedId;
              const stripe = programTypeBg(item.programType || 'No Transition');
              const mainRunId = effectivePrimaryLive?.kind === 'running' ? effectivePrimaryLive.itemId : null;
              const mainLoadedId = effectivePrimaryLive?.kind === 'loaded' ? effectivePrimaryLive.itemId : null;
              const subRunId = subLive?.itemId ?? null;
              const isMainRun = item.id === mainRunId;
              const isMainLoad = item.id === mainLoadedId;
              const isSubRun = item.id === subRunId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  style={{ borderLeft: `4px solid ${stripe}` }}
                  className={`shrink-0 rounded-md border px-2.5 py-1.5 text-left text-xs font-semibold transition-shadow ${
                    active ? 'bg-cyan-700 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  } ${
                    isMainRun
                      ? 'border-emerald-500 ring-2 ring-emerald-400/80 ring-offset-1 ring-offset-slate-900'
                      : isMainLoad
                        ? 'border-amber-500 ring-2 ring-amber-400/70 ring-offset-1 ring-offset-slate-900'
                        : isSubRun
                          ? 'border-violet-500 ring-2 ring-violet-400/80 ring-offset-1 ring-offset-slate-900'
                          : 'border-slate-700'
                  }`}
                >
                  <div>{cueLabel(item)}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunOfShowMobilePage;
