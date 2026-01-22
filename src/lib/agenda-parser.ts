/**
 * Agenda parser: extract event titles, times, and speakers from raw text
 * (e.g. from PDF or Word). Output format matches Excel import ParsedRow.
 *
 * - Starting point: first line that looks like an agenda time (digits:digits, optional AM/PM).
 *   Everything before it (headers, dates, "AGENDA", etc.) is skipped. Header-like lines
 *   are never treated as the first time.
 * - Duration: (next item's start time - this item's start time), e.g. 12:30pm Lunch to
 *   1:30pm Item 1 → Lunch duration = 1 hour.
 */

const DEFAULT_DURATION = '00:05:00';

const HEADER_PREFIXES =
  /^(agenda|date|schedule|title|event|meeting|location|venue|time|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}|\d{4})/i;

const TIME_LINE_REGEX =
  /^\s*[•\-]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm)?(?:\s*[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm)?)?\s*$/i;

const TIME_LINE_REGEX_NO_BULLET =
  /^\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm)?(?:\s*[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm)?)?\s*$/i;

const STARTS_WITH_TIME =
  /^\s*[•\-]?\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(AM|PM|am|pm)?\s*[-–—]?\s*(.*)/i;

export interface AgendaParsedItem {
  row: number;
  cue: string;
  segmentName: string;
  startTime: string;
  duration: string;
  shotType: string;
  hasPPT: boolean;
  hasQA: boolean;
  programType: string;
  notes: string;
  assets: string;
  speakers: string;
}

export interface ParseAgendaResult {
  items: AgendaParsedItem[];
  rawText: string;
  firstTimeLineIndex: number;
  rawLines: string[];
}

interface Block {
  time: number | null;
  timeRaw: string | null;
  timeEndRaw: string | null;
  lines: string[];
}

function normalizeLine(s: string): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

function isHeaderLike(line: string): boolean {
  const t = normalizeLine(line).toLowerCase();
  if (!t) return true;
  if (HEADER_PREFIXES.test(t)) return true;
  if (/^\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4}$/.test(t)) return true;
  return false;
}

function isTimeOnlyLine(line: string): boolean {
  const t = normalizeLine(line);
  if (!t) return false;
  return TIME_LINE_REGEX.test(t) || TIME_LINE_REGEX_NO_BULLET.test(t);
}

function lineHasTime(line: string): boolean {
  const t = normalizeLine(line);
  if (!t) return false;
  if (isHeaderLike(line)) return false;
  return isTimeOnlyLine(line) || STARTS_WITH_TIME.test(t);
}

export function parseTimeToMinutes(str: string): number | null {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim().replace(/\s+/g, ' ').toUpperCase();
  const ampmMatch = s.match(/\s*(AM|PM)\s*$/i);
  const hasAmPm = !!ampmMatch;
  const rest = hasAmPm ? s.replace(/\s*(AM|PM)\s*$/i, '').trim() : s;
  const parts = rest
    .split(/[:\s]+/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !isNaN(n));
  if (parts.length < 2) return null;
  let hours = parts[0];
  const minutes = parts[1];
  const seconds = parts.length >= 3 ? parts[2] : 0;
  if (hasAmPm && ampmMatch) {
    const ampm = ampmMatch[1].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  }
  return hours * 60 + minutes + seconds / 60;
}

export function minutesToHHMMSS(totalMinutes: number): string {
  if (totalMinutes == null || isNaN(totalMinutes) || totalMinutes < 0) return DEFAULT_DURATION;
  const totalSec = Math.round(totalMinutes * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [String(h).padStart(2, '0'), String(m).padStart(2, '0'), String(s).padStart(2, '0')].join(
    ':'
  );
}

function parseSpeakerLine(
  text: string,
  slot: number
): { id: string; slot: number; location: string; fullName: string; title: string; org: string; photoUrl: string } | null {
  if (!text || !String(text).trim()) return null;
  const t = String(text).trim();
  let name = t;
  let title = '';
  let org = '';
  if (/[,–—]/.test(t)) {
    const split = t.split(/[,–—]/).map((x) => x.trim()).filter(Boolean);
    if (split.length >= 1) name = split[0];
    if (split.length >= 2) title = split[1];
    if (split.length >= 3) org = split[2];
  }
  if (!name) return null;
  let location = 'Seat';
  if (name.startsWith('*P*')) {
    location = 'Podium';
    name = name.replace(/^\*P\*\s*/, '').trim();
  } else if (name.startsWith('*M*')) {
    location = 'Moderator';
    name = name.replace(/^\*M\*\s*/, '').trim();
  } else if (name.startsWith('*V*')) {
    location = 'Virtual';
    name = name.replace(/^\*V\*\s*/, '').trim();
  }
  return {
    id: `speaker-${slot}`,
    slot,
    location,
    fullName: name,
    title,
    org,
    photoUrl: ''
  };
}

/**
 * Find index of first line that contains a time. Everything before this is skipped (headers, etc.).
 */
export function findFirstTimeLineIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lineHasTime(lines[i])) return i;
  }
  return -1;
}

const PREVIEW_MAX_LEN = 50;

/**
 * Return 1-based line numbers and previews for all lines that look like agenda times.
 * Use for "Jump to lines with times" in the UI.
 */
export function getLinesWithTimeIndices(
  lines: string[]
): { lineNumber: number; preview: string }[] {
  const out: { lineNumber: number; preview: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lineHasTime(lines[i])) continue;
    const raw = (lines[i] || '').trim();
    const preview = raw.length > PREVIEW_MAX_LEN ? raw.slice(0, PREVIEW_MAX_LEN) + '…' : raw;
    out.push({ lineNumber: i + 1, preview: preview || `Line ${i + 1}` });
  }
  return out;
}

function buildTimeStringFromMatch(m: RegExpMatchArray): string {
  const h = m[1];
  const min = m[2];
  const sec = m[3] != null && m[3] !== '' ? `:${m[3]}` : '';
  const ampm = (m[4] || '').trim();
  return `${h}:${min}${sec}${ampm ? ' ' + ampm : ''}`;
}

function buildBlocks(
  lines: string[],
  overrideStartIndex: number
): { blocks: Block[]; firstTimeLineIndex: number } {
  const normalized = lines.map((l) => normalizeLine(l));
  const startIdx =
    overrideStartIndex >= 0
      ? Math.min(overrideStartIndex, normalized.length)
      : findFirstTimeLineIndex(normalized);
  if (startIdx < 0) return { blocks: [], firstTimeLineIndex: -1 };
  const fromFirstTime = normalized.slice(startIdx);

  const blocks: Block[] = [];
  let current: Block = { time: null, timeRaw: null, timeEndRaw: null, lines: [] };

  for (let i = 0; i < fromFirstTime.length; i++) {
    const line = fromFirstTime[i];
    const trimmed = line;
    if (!trimmed) continue;

    const timeOnly = isTimeOnlyLine(line);
    const startMatch = trimmed.match(STARTS_WITH_TIME);

    if (timeOnly) {
      if (current.lines.length > 0 || current.time !== null) {
        blocks.push({ ...current });
      }
      const bulletRemoved = trimmed.replace(/^\s*[•\-]\s*/, '');
      const m = bulletRemoved.match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(AM|PM|am|pm)?/i);
      const timeStr = m ? buildTimeStringFromMatch(m) : trimmed;
      const endPart = trimmed.match(
        /[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm)?/i
      );
      const endStr = endPart
        ? (endPart[1].replace(/\s+/g, ' ').trim() + (endPart[2] ? ' ' + endPart[2].trim() : '')).trim()
        : null;
      current = {
        time: parseTimeToMinutes(timeStr),
        timeRaw: timeStr,
        timeEndRaw: endStr,
        lines: []
      };
      continue;
    }

    if (startMatch) {
      const timeStr = buildTimeStringFromMatch(startMatch);
      const title = (startMatch[5] || '').trim();
      if (current.lines.length > 0 || current.time !== null) {
        blocks.push({ ...current });
      }
      current = {
        time: parseTimeToMinutes(timeStr),
        timeRaw: timeStr,
        timeEndRaw: null,
        lines: title ? [title] : []
      };
      continue;
    }

    current.lines.push(trimmed);
  }

  if (current.lines.length > 0 || current.time !== null) {
    blocks.push(current);
  }

  return { blocks, firstTimeLineIndex: startIdx };
}

/**
 * Parse agenda from raw text.
 * @param rawText - Full text from PDF or Word
 * @param startLineIndex - If >= 0, start parsing from this line (0-based). Else use first-time detection.
 */
export function parseAgenda(rawText: string, startLineIndex: number): ParseAgendaResult {
  if (!rawText || typeof rawText !== 'string') {
    return { items: [], rawText: '', firstTimeLineIndex: -1, rawLines: [] };
  }

  const raw = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  const { blocks, firstTimeLineIndex } = buildBlocks(lines, startLineIndex);

  const timedBlocks = blocks.filter((b) => b.time != null);
  const items: AgendaParsedItem[] = [];
  for (let i = 0; i < timedBlocks.length; i++) {
    const b = timedBlocks[i];
    let segmentName = '';
    const speakerLines: string[] = [];

    if (b.lines.length > 0) {
      segmentName = b.lines[0];
      for (let j = 1; j < b.lines.length; j++) {
        speakerLines.push(b.lines[j]);
      }
    }

    if (!segmentName) {
      segmentName = `Agenda Item ${i + 1}`;
    }

    let duration = DEFAULT_DURATION;
    if (b.timeEndRaw) {
      const endMins = parseTimeToMinutes(b.timeEndRaw);
      if (endMins != null && b.time != null && endMins > b.time) {
        duration = minutesToHHMMSS(endMins - b.time);
      }
    } else if (
      i + 1 < timedBlocks.length &&
      timedBlocks[i + 1].time != null &&
      b.time != null
    ) {
      const nextMins = timedBlocks[i + 1].time!;
      if (nextMins > b.time) {
        duration = minutesToHHMMSS(nextMins - b.time);
      }
    }

    const speakers: ReturnType<typeof parseSpeakerLine>[] = [];
    speakerLines.forEach((line, idx) => {
      const sp = parseSpeakerLine(line, idx + 1);
      if (sp && sp.fullName) speakers.push(sp);
    });

    const row = i + 1;
    const cue = `CUE ${row}`;
    items.push({
      row,
      cue,
      segmentName,
      startTime: b.timeRaw || '',
      duration,
      shotType: '',
      hasPPT: false,
      hasQA: false,
      programType: '',
      notes: '',
      assets: '',
      speakers: speakers.length ? JSON.stringify(speakers) : ''
    });
  }

  return { items, rawText: raw, firstTimeLineIndex, rawLines: lines };
}
