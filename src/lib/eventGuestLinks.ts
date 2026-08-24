import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';

export interface GuestEventSummary {
  id: string;
  name: string;
  date: string;
  location?: string;
  numberOfDays?: number;
  masterStartTime?: string;
  dayStartTimes?: Record<number | string, string>;
}

export interface GuestScheduleItem {
  id: number;
  day: number;
  segmentName: string;
  programType: string;
  shotType: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  speakers: string;
  speakersText: string;
  notes: string;
  assets?: string;
  customFields?: Record<string, unknown>;
  cue: string;
  isIndented: boolean;
  hasPPT: boolean;
  hasQA: boolean;
  needsRecording: boolean;
  isPublic?: boolean;
}

export interface GuestActiveTimer {
  itemId: number | string;
  timerState?: string;
  isActive?: boolean;
  isRunning?: boolean;
  durationSeconds?: number;
  elapsedSeconds?: number;
  cueIs?: string;
}

export interface GuestEventPayload {
  ok: boolean;
  event?: GuestEventSummary;
  scheduleItems?: GuestScheduleItem[];
  activeTimer?: GuestActiveTimer | null;
  serverTime?: string;
  error?: string;
  needsMigration?: boolean;
}

export interface GuestLinkCreateResult {
  ok: boolean;
  event?: { id: string; name: string; date: string };
  guestUrl?: string;
  reused?: boolean;
  error?: string;
  needsMigration?: boolean;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getApiBaseUrl();
  const headers = new Headers(init?.headers);
  const json = apiJsonHeaders();
  Object.entries(json).forEach(([key, value]) => headers.set(key, value));
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

/** Public — no auth headers required. */
export async function fetchGuestEvent(token: string): Promise<GuestEventPayload> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/guest-event/${encodeURIComponent(token)}`);
  const data = (await res.json().catch(() => ({}))) as GuestEventPayload & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
      needsMigration: data.needsMigration,
    };
  }
  return { ok: true, ...data };
}

export async function createGuestEventLink(
  eventId: string,
  options?: { rotate?: boolean }
): Promise<GuestLinkCreateResult> {
  const res = await authedFetch(`/api/calendar-events/${encodeURIComponent(eventId)}/guest-link`, {
    method: 'POST',
    body: JSON.stringify({ rotate: options?.rotate === true }),
  });
  const data = (await res.json().catch(() => ({}))) as GuestLinkCreateResult & { error?: string };
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${res.status}`,
      needsMigration: data.needsMigration,
    };
  }
  return {
    ok: true,
    event: data.event,
    guestUrl: data.guestUrl,
    reused: data.reused,
  };
}

export function formatGuestDuration(item: GuestScheduleItem): string {
  const h = Number(item.durationHours) || 0;
  const m = Number(item.durationMinutes) || 0;
  const s = Number(item.durationSeconds) || 0;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function stripHtmlNotes(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function formatSpeakerSlots(raw: string): string {
  if (!raw) return '';
  try {
    const speakers = JSON.parse(raw);
    if (!Array.isArray(speakers) || speakers.length === 0) return '';
    return speakers
      .slice()
      .sort((a: { slot?: number }, b: { slot?: number }) => (a.slot || 0) - (b.slot || 0))
      .filter((speaker: { fullName?: string }) => speaker.fullName && String(speaker.fullName).trim())
      .map((speaker: { location?: string; slot?: number; fullName?: string; title?: string }) => {
        const loc =
          speaker.location === 'Podium'
            ? 'P'
            : speaker.location === 'Seat'
              ? 'S'
              : speaker.location === 'Virtual'
                ? 'V'
                : 'M';
        const title = speaker.title ? ` (${speaker.title})` : '';
        return `${loc}${speaker.slot ?? ''} · ${speaker.fullName}${title}`;
      })
      .join('\n');
  } catch {
    return raw;
  }
}

/** Prefer Speakers column (speakersText); fall back to Participants (speakers). */
export function formatGuestSpeakers(item: GuestScheduleItem): string {
  return formatSpeakerSlots(item.speakersText) || formatSpeakerSlots(item.speakers) || '';
}

export const GUEST_PROGRAM_TYPE_COLORS: Record<string, string> = {
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
  'Full-Stage/Ted-Talk': '#EA580C',
};

export function guestRowTint(programType: string): string | undefined {
  const hex = GUEST_PROGRAM_TYPE_COLORS[programType];
  if (!hex) return undefined;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.22)`;
}
