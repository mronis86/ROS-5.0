/** Lightweight director call chips under a main cue (not schedule rows / timers). */

export type SubCall = {
  id: string;
  /** Full text for tooltips / change log (not truncated). */
  label: string;
  /** e.g. "22.1" when from notes — shown as "CUE 22.1". */
  cueKey?: string;
  /** Description after the cue number. */
  detail?: string;
  /** Director confirmed this action was called. */
  called?: boolean;
  /** Parsed from cue notes (Cue 22.1: …) — labels follow notes; only called is stored. */
  fromNotes?: boolean;
};

export const ROS_SHOW_SUB_CALLS_KEY = 'rosShowSubCalls';
/** Max characters of detail text on the chip (prefix stays full). */
export const SUB_CALL_DETAIL_MAX = 40;

/** Cue 22.1: Settle…  |  22.1: Settle…  |  Cue 22.1 - Settle… */
const SUB_CUE_LINE_RE =
  /^(?:cue\s*)?(\d+)\.(\d+)\s*(?::|[-–—]|\)|\.)\s*(.+)$/i;

export function newSubCallId(): string {
  return `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSubCalls(raw: unknown): SubCall[] {
  if (!Array.isArray(raw)) return [];
  const out: SubCall[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const label = String((row as SubCall).label || '').trim();
    if (!label) continue;
    const id = String((row as SubCall).id || '').trim() || newSubCallId();
    const cueKey = String((row as SubCall).cueKey || '').trim() || undefined;
    const detail = String((row as SubCall).detail || '').trim() || undefined;
    out.push({
      id,
      label,
      cueKey,
      detail,
      called: Boolean((row as SubCall).called),
      fromNotes: Boolean((row as SubCall).fromNotes),
    });
  }
  return out;
}

export function truncateSubCallDetail(
  text: string,
  max = SUB_CALL_DETAIL_MAX
): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Chip display: "CUE 22.1" + spaced detail with ellipsis when long. */
export function formatSubCallChip(c: SubCall): {
  prefix: string;
  body: string;
  full: string;
} {
  const keyFromId =
    c.id.startsWith('note:') && !c.cueKey ? c.id.slice(5) : '';
  const cueKey = (c.cueKey || keyFromId || '').trim();
  let detail = (c.detail || '').trim();

  if (!detail && c.label) {
    const m = c.label.match(/^(?:cue\s*)?(\d+\.\d+)\s*(?:[:—–-]\s*)?(.*)$/i);
    if (m) {
      if (!cueKey) {
        return {
          prefix: `CUE ${m[1]}`,
          body: truncateSubCallDetail(m[2] || ''),
          full: `CUE ${m[1]}${m[2] ? `  —  ${m[2]}` : ''}`,
        };
      }
      detail = m[2] || detail;
    }
  }

  if (cueKey) {
    const body = truncateSubCallDetail(detail || (!c.detail ? c.label : ''));
    const fullDetail = detail || c.label;
    return {
      prefix: `CUE ${cueKey}`,
      body,
      full: fullDetail ? `CUE ${cueKey}  —  ${fullDetail}` : `CUE ${cueKey}`,
    };
  }

  return {
    prefix: '',
    body: truncateSubCallDetail(c.label),
    full: c.label,
  };
}

function notesToPlainLines(notes: string): string[] {
  const plain = String(notes || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\u00a0/g, ' ');
  return plain
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Pull parent major number from "22", "CUE 22", "Cue 22.0", etc. */
export function parentCueMajor(cueField?: string | null): string | null {
  const raw = String(cueField || '').trim();
  if (!raw) return null;
  const m = raw.match(/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Auto-pull sub calls from notes lines like:
 *   Cue 22.1: Settle, presenters at podium…
 *   22.2: Finalists slide
 * Skips the parent "Cue 22:" line (no decimal).
 */
export function parseSubCallsFromNotes(
  notes: string,
  parentCueField?: string | null
): SubCall[] {
  const parent = parentCueMajor(parentCueField);
  const out: SubCall[] = [];
  const seen = new Set<string>();

  for (const line of notesToPlainLines(notes)) {
    const m = line.match(SUB_CUE_LINE_RE);
    if (!m) continue;
    const major = m[1];
    const minor = m[2];
    if (parent != null && major !== parent) continue;
    const text = String(m[3] || '').trim();
    if (!text) continue;
    const key = `${major}.${minor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `note:${key}`,
      cueKey: key,
      detail: text,
      label: `CUE ${key}  —  ${text}`,
      called: false,
      fromNotes: true,
    });
  }
  return out;
}

/** Highest N in parent.N among resolved / notes calls (0 if none). */
export function maxSubCallMinor(item: {
  notes?: string;
  subCalls?: SubCall[] | unknown;
  customFields?: { cue?: string } | Record<string, string>;
}): number {
  let max = 0;
  const bump = (key: string) => {
    const m = String(key).match(/\.(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  };
  for (const c of resolveSubCalls(item)) {
    if (c.cueKey) bump(c.cueKey);
    else if (c.id.startsWith('note:')) bump(c.id.slice(5));
  }
  return max;
}

/** Build a manual sub call under this cue (next .N after notes/manual). */
export function buildManualSubCall(
  item: {
    notes?: string;
    subCalls?: SubCall[] | unknown;
    customFields?: { cue?: string } | Record<string, string>;
  },
  detailText: string
): SubCall | null {
  const detail = String(detailText || '').replace(/\s+/g, ' ').trim();
  if (!detail) return null;
  const major = parentCueMajor(
    item.customFields && typeof item.customFields === 'object'
      ? String((item.customFields as { cue?: string }).cue || '')
      : ''
  );
  if (!major) return null;
  const nextMinor = maxSubCallMinor(item) + 1;
  const cueKey = `${major}.${nextMinor}`;
  return {
    id: newSubCallId(),
    cueKey,
    detail,
    label: `CUE ${cueKey}  —  ${detail}`,
    called: false,
    fromNotes: false,
  };
}

/**
 * Prefer notes-derived chips when present; keep called flags from saved subCalls.
 * Manual chips (non-note ids) are kept after the notes list.
 */
export function resolveSubCalls(item: {
  notes?: string;
  subCalls?: SubCall[] | unknown;
  customFields?: { cue?: string } | Record<string, string>;
}): SubCall[] {
  const stored = normalizeSubCalls(item.subCalls);
  const cueField =
    item.customFields && typeof item.customFields === 'object'
      ? String((item.customFields as { cue?: string }).cue || '')
      : '';
  const fromNotes = parseSubCallsFromNotes(item.notes || '', cueField);

  const calledById = new Map<string, boolean>();
  const calledByLabel = new Map<string, boolean>();
  for (const s of stored) {
    calledById.set(s.id, Boolean(s.called));
    calledByLabel.set(s.label.toLowerCase(), Boolean(s.called));
  }

  if (fromNotes.length > 0) {
    const noteIds = new Set(fromNotes.map((c) => c.id));
    const mergedNotes = fromNotes.map((c) => ({
      ...c,
      called: Boolean(calledById.get(c.id) || calledByLabel.get(c.label.toLowerCase())),
    }));
    const manualExtras = stored.filter((s) => !s.fromNotes && !noteIds.has(s.id) && !s.id.startsWith('note:'));
    return [...mergedNotes, ...manualExtras];
  }

  return stored.map((s) => ({ ...s, fromNotes: false }));
}

/** Default on so new sub-call strips are visible until the operator hides them. */
export function loadShowSubCalls(): boolean {
  try {
    const raw = localStorage.getItem(ROS_SHOW_SUB_CALLS_KEY);
    if (raw == null) return true;
    return raw !== 'false' && raw !== '0';
  } catch {
    return true;
  }
}

export function saveShowSubCalls(show: boolean): void {
  try {
    localStorage.setItem(ROS_SHOW_SUB_CALLS_KEY, show ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}
