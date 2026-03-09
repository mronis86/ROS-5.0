/**
 * Agenda parser: extract event titles, times, and speakers from raw text
 * (e.g. from PDF or Word). Output format matches Excel import ParsedRow.
 *
 * Hints support: callers may pass timeExamples, segmentExamples, personExamples
 * (text strings selected from the document). The parser uses these to:
 *  1. Learn the structural POSITION of segments/speakers relative to times in
 *     this specific document (e.g. "segment is always on line N after the time").
 *  2. Learn string PATTERNS (prefix length, capitalization, punctuation style)
 *     so it can recognize similar lines it hasn't seen before.
 *  3. Disambiguate blocks where the first non-time line could be a segment OR
 *     something else (room number, track label, etc.).
 */

const DEFAULT_DURATION = '00:05:00';

const HEADER_PREFIXES =
  /^(agenda|date|schedule|title|event|meeting|location|venue|time|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}|\d{4})/i;

const TIME_LINE_REGEX =
  /^\s*[•\-]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?(?:\s*[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?)?\s*$/i;

const TIME_LINE_REGEX_NO_BULLET =
  /^\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?(?:\s*[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?)?\s*$/i;

const STARTS_WITH_TIME =
  /^\s*[•\-]?\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?\s*[-–—]?\s*(.*)/i;

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

// ─── Hints ───────────────────────────────────────────────────────────────────

export interface ParseHints {
  timeExamples?: string[];
  segmentExamples?: string[];
  personExamples?: string[];
}

interface LearnedStructure {
  segmentOffset: number | null;
  personOffset: number | null;
  segmentTexts: Set<string>;
  personTexts: Set<string>;
  looksLikeSegment: (line: string) => boolean;
  looksLikePerson: (line: string) => boolean;
}

function learnStructure(rawLines: string[], hints: ParseHints): LearnedStructure {
  const segExamples = (hints.segmentExamples || []).map(s => s.trim()).filter(Boolean);
  const perExamples = (hints.personExamples  || []).map(s => s.trim()).filter(Boolean);

  const segmentTexts = new Set(segExamples.map(s => s.toLowerCase()));
  const personTexts  = new Set(perExamples.map(s => s.toLowerCase()));

  const normalized = rawLines.map(l => normalizeLine(l));

  // Build list of time-line indices for offset calculation
  const timeLineIndices: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (lineHasTime(normalized[i])) timeLineIndices.push(i);
  }

  // For each example, find its line in the document, then count non-empty lines
  // between the preceding time line and the example line → that's the offset.
  function findOffsets(examples: string[]): number[] {
    const offsets: number[] = [];
    for (const ex of examples) {
      const exLow = ex.toLowerCase();
      for (let i = 0; i < normalized.length; i++) {
        if (normalized[i].toLowerCase().includes(exLow)) {
          let nearestTimeLine = -1;
          for (const tl of timeLineIndices) {
            if (tl <= i) nearestTimeLine = tl;
            else break;
          }
          if (nearestTimeLine >= 0 && nearestTimeLine < i) {
            // Count non-empty lines strictly between time line and example line
            let offset = 0;
            for (let k = nearestTimeLine + 1; k <= i; k++) {
              if (normalized[k].trim()) offset++;
            }
            offsets.push(offset);
          } else if (nearestTimeLine === i) {
            offsets.push(0); // On the same line as time
          }
        }
      }
    }
    return offsets;
  }

  function mostCommon(arr: number[]): number | null {
    if (!arr.length) return null;
    const freq: Record<number, number> = {};
    let best = arr[0], bestCount = 0;
    for (const v of arr) {
      freq[v] = (freq[v] || 0) + 1;
      if (freq[v] > bestCount) { bestCount = freq[v]; best = v; }
    }
    return best;
  }

  const segmentOffset = mostCommon(findOffsets(segExamples));
  const personOffset  = mostCommon(findOffsets(perExamples));

  // Pattern matching from examples
  const segWordCounts = segExamples.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgSegWords   = segWordCounts.length
    ? segWordCounts.reduce((a, b) => a + b, 0) / segWordCounts.length
    : 4;
  const segStartsWithCap = segExamples.some(s => /^[A-Z]/.test(s));
  const segAllCaps       = segExamples.some(s => s === s.toUpperCase() && s.length > 3);

  function looksLikePerson(line: string): boolean {
    const t = line.trim();
    if (!t) return false;
    if (personTexts.has(t.toLowerCase())) return true;
    if (perExamples.length === 0) return false;
    // Strip common label prefixes like "Speaker:", "Presenter:", etc.
    const stripped = t.replace(/^(?:Speaker|Presenter|Panelist|Moderator|Speakers?):\s*/i, '').trim();
    // Strip honorific prefix for pattern matching
    const hasHonorific = /^(?:Dr|Mr|Ms|Mrs|Prof|Rev)\./i.test(stripped);
    const name = stripped.replace(/^(?:Dr|Mr|Ms|Mrs|Prof|Rev)\.\s*/i, '').trim();
    // Guard: if any capitalized word is a common agenda/English word, not a person
    const COMMON = new Set([
      'open','forum','break','lunch','session','panel','keynote','discussion',
      'workshop','networking','reception','awards','ceremony','welcome','closing',
      'remarks','address','chat','talk','presentation','briefing','update',
      'review','summit','conference','meeting','intro','introduction',
    ]);
    const capitalizedWords = name.split(/\s+/).filter(w => /^[A-Z]/.test(w));
    const hasCommonWord = capitalizedWords.some(w => COMMON.has(w.toLowerCase()));
    const basicPattern =
      /^[A-Z][a-z]+(?:\s+[A-Z][a-z']+)+(?:\s*[,–—]\s*.+)?$/.test(name) ||
      /^[A-Z][a-z]+(?:\s+[A-Z][a-z']+)+(?:\s*[,–—]\s*.+)?$/.test(stripped);
    return basicPattern && (hasHonorific || !hasCommonWord);
  }

  function looksLikeSegment(line: string): boolean {
    const t = line.trim();
    if (!t || t.length < 2) return false;
    if (segmentTexts.has(t.toLowerCase())) return true;
    if (segExamples.length === 0) return false;
    if (lineHasTime(t)) return false;
    if (perExamples.length > 0 && looksLikePerson(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    const inRange = words.length >= 1 && words.length <= Math.max(avgSegWords * 2, 10);
    if (!inRange) return false;
    if (segAllCaps && t === t.toUpperCase()) return true;
    if (segStartsWithCap && /^[A-Z]/.test(t)) return true;
    return false;
  }

  return {
    segmentOffset,
    personOffset,
    segmentTexts,
    personTexts,
    looksLikeSegment,
    looksLikePerson,
  };
}

// ─── Core utilities ───────────────────────────────────────────────────────────

function normalizeLine(s: string): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

function stripLeadingTimeFromSegmentName(text: string): string {
  if (!text || typeof text !== 'string') return '';
  let t = text.trim();
  const timePrefix =
    /^\s*[•\-]?\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:a\.m\.|p\.m\.|AM|PM|am|pm)?\s*[-–—]?\s*/i;
  t = t.replace(timePrefix, '').trim();
  const leadingAmPm = /^\s*(?:a\.m\.|p\.m\.|am|pm)\s*[-–—]?\s*/i;
  t = t.replace(leadingAmPm, '').trim();
  const leftoverAmPm = /^\s*(?:a\.m\.|p\.m\.|am|pm)\s*[-–—]\s*/i;
  let prev = '';
  while (prev !== t) { prev = t; t = t.replace(leftoverAmPm, '').trim(); }
  const secondTimeInRange =
    /^\s*[-–—]\s*\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm)?\s*[-–—]\s*/i;
  prev = '';
  while (prev !== t) { prev = t; t = t.replace(secondTimeInRange, '').trim(); }
  return t;
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
  let s = str.trim().replace(/\s+/g, ' ');
  s = s.replace(/\s+a\.m\.\s*$/i, ' AM').replace(/\s+p\.m\.\s*$/i, ' PM');
  const u = s.toUpperCase();
  const ampmMatch = u.match(/\s*(AM|PM)\s*$/);
  const hasAmPm = !!ampmMatch;
  const rest = hasAmPm ? u.replace(/\s*(AM|PM)\s*$/, '').trim() : u;
  const parts = rest
    .split(/[:\s]+/)
    .map(p => parseInt(p, 10))
    .filter(n => !isNaN(n));
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
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':');
}

function parseSpeakerLine(
  text: string,
  slot: number
): { id: string; slot: number; location: string; fullName: string; title: string; org: string; photoUrl: string } | null {
  if (!text || !String(text).trim()) return null;
  const t = String(text).trim();
  let name = t, title = '', org = '';
  if (/[,–—]/.test(t)) {
    const split = t.split(/[,–—]/).map(x => x.trim()).filter(Boolean);
    if (split.length >= 1) name  = split[0];
    if (split.length >= 2) title = split[1];
    if (split.length >= 3) org   = split[2];
  }
  if (!name) return null;
  let location = 'Seat';
  if (name.startsWith('*P*')) { location = 'Podium';    name = name.replace(/^\*P\*\s*/, '').trim(); }
  if (name.startsWith('*M*')) { location = 'Moderator'; name = name.replace(/^\*M\*\s*/, '').trim(); }
  if (name.startsWith('*V*')) { location = 'Virtual';   name = name.replace(/^\*V\*\s*/, '').trim(); }
  return { id: `speaker-${slot}`, slot, location, fullName: name, title, org, photoUrl: '' };
}

export function findFirstTimeLineIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lineHasTime(lines[i])) return i;
  }
  return -1;
}

const PREVIEW_MAX_LEN = 50;

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
  const h = m[1], min = m[2];
  const sec  = m[3] != null && m[3] !== '' ? `:${m[3]}` : '';
  const ampmRaw = (m[4] || '').trim();
  const ampm = ampmRaw.replace(/^a\.m\.$/i, 'AM').replace(/^p\.m\.$/i, 'PM');
  return `${h}:${min}${sec}${ampm ? ' ' + ampm : ''}`;
}

// ─── Block building ───────────────────────────────────────────────────────────

interface Block {
  time: number | null;
  timeRaw: string | null;
  timeEndRaw: string | null;
  lines: string[];
}

function buildBlocks(
  lines: string[],
  overrideStartIndex: number
): { blocks: Block[]; firstTimeLineIndex: number } {
  const normalized = lines.map(l => normalizeLine(l));
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
    if (!line) continue;

    const timeOnly = isTimeOnlyLine(line);
    const startMatch = line.match(STARTS_WITH_TIME);

    if (timeOnly) {
      if (current.lines.length > 0 || current.time !== null) blocks.push({ ...current });
      const bulletRemoved = line.replace(/^\s*[•\-]\s*/, '');
      const m = bulletRemoved.match(
        /(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i
      );
      const timeStr = m ? buildTimeStringFromMatch(m) : line;
      const endPart = line.match(
        /[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i
      );
      const endStr = endPart
        ? (endPart[1].replace(/\s+/g, ' ').trim() + (endPart[2] ? ' ' + endPart[2].trim() : '')).trim()
        : null;
      current = { time: parseTimeToMinutes(timeStr), timeRaw: timeStr, timeEndRaw: endStr, lines: [] };
      continue;
    }

    if (startMatch) {
      const timeStr = buildTimeStringFromMatch(startMatch);
      const title = (startMatch[5] || '').trim();
      if (current.lines.length > 0 || current.time !== null) blocks.push({ ...current });
      current = {
        time: parseTimeToMinutes(timeStr),
        timeRaw: timeStr,
        timeEndRaw: null,
        lines: title ? [title] : [],
      };
      continue;
    }

    current.lines.push(line);
  }

  if (current.lines.length > 0 || current.time !== null) blocks.push(current);
  return { blocks, firstTimeLineIndex: startIdx };
}

// ─── Hint-aware block interpretation ─────────────────────────────────────────

interface InterpretedBlock {
  time: number | null;
  timeRaw: string | null;
  timeEndRaw: string | null;
  segmentName: string;
  speakerLines: string[];
}

/**
 * Use learned structure to decide which line in a block is the segment name
 * and which are speaker lines — rather than blindly using lines[0]/lines[1..].
 *
 * Strategy (in priority order):
 *  1. Direct text match against segment examples → that line is the segment.
 *  2. Positional offset learned from where examples appear in the document.
 *  3. Pattern match: looksLikeSegment().
 *  4. Fallback: lines[0] is segment (original behaviour).
 *
 * Speaker lines: direct text match → person examples; or looksLikePerson() pattern;
 * or (no person hints) everything after the segment line.
 */
/**
 * Given a single line that may contain both a segment name AND a speaker name,
 * try to split them using:
 *   1. Known person examples — find the first occurrence and split there.
 *   2. Common separators (–, |, "with", "presented by", etc.) followed by
 *      text that looksLikePerson().
 *   3. A trailing parenthesized name: "Opening Remarks (Jane Smith)".
 *
 * Returns null if no speaker can be confidently detected in the line.
 */
function splitSegmentAndSpeaker(
  line: string,
  struct: LearnedStructure
): { segment: string; speakerNames: string[] } | null {
  const t = line.trim();
  if (!t) return null;

  const splitNames = (chunk: string): string[] =>
    chunk
      .split(/\s*(?:,|and|&)\s*/i)
      .map(n => n.replace(/[)]+$/, '').trim())   // strip stray closing parens
      .filter(n => n.length > 1);

  // ── 1. Direct person example match anywhere in the line ──────────────────
  const sortedPersonTexts = [...struct.personTexts].sort((a, b) => b.length - a.length);
  for (const pt of sortedPersonTexts) {
    const idx = t.toLowerCase().indexOf(pt.toLowerCase());
    if (idx > 0) {
      const before = t.slice(0, idx)
        .replace(/\s*(?:presented by|featuring|with|by|in conversation with)\s*$/i, '')
        .replace(/[\s\-–—|,(]+$/, '')
        .trim();
      const nameChunk = t.slice(idx).trim();
      if (before.length > 0) {
        return { segment: before, speakerNames: splitNames(nameChunk) };
      }
    }
  }

  // ── 2. Separator token + looksLikePerson ─────────────────────────────────
  // Match separator as a full token so we get clean before/after
  const SEP_RE = /(\s+(?:presented by|featuring|with|by|in conversation with)\s+|\s*[\-–—|]\s*)/gi;
  const splitPoints: { index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = SEP_RE.exec(t)) !== null) {
    splitPoints.push({ index: m.index, length: m[0].length });
  }
  // Try rightmost split point first (speaker is usually at the end)
  for (let si = splitPoints.length - 1; si >= 0; si--) {
    const { index, length } = splitPoints[si];
    const before = t.slice(0, index).trim();
    const after  = t.slice(index + length).trim();
    if (!before || !after) continue;
    const candidateNames = splitNames(after);
    if (candidateNames.length > 0 && candidateNames.every(n => struct.looksLikePerson(n))) {
      return { segment: before, speakerNames: candidateNames };
    }
  }

  // ── 3. Trailing parenthesized name: "Title (Name)" ───────────────────────
  const parenMatch = t.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const inner = parenMatch[2].trim();
    const candidateNames = splitNames(inner);
    if (candidateNames.length > 0 && candidateNames.every(n => struct.looksLikePerson(n))) {
      return { segment: parenMatch[1].trim(), speakerNames: candidateNames };
    }
  }

  return null;
}

function interpretBlock(block: Block, struct: LearnedStructure): InterpretedBlock {
  const { lines } = block;

  if (lines.length === 0) {
    return { ...block, segmentName: '', speakerLines: [] };
  }

  const hasSegHints = struct.segmentTexts.size > 0 || struct.segmentOffset !== null;
  const hasPerHints = struct.personTexts.size > 0 || struct.personOffset !== null;

  if (!hasSegHints && !hasPerHints) {
    // No hints at all — original behaviour
    return {
      ...block,
      segmentName: stripLeadingTimeFromSegmentName(lines[0]),
      speakerLines: lines.slice(1),
    };
  }

  // ── Find segment line ─────────────────────────────────────────────────────

  let segmentIdx = -1;

  // 1. Direct match
  for (let i = 0; i < lines.length; i++) {
    if (struct.segmentTexts.has(lines[i].toLowerCase())) { segmentIdx = i; break; }
  }

  // 2. Positional offset (segmentOffset = N means Nth non-empty line after time)
  //    lines[] already has empty lines stripped, so offset 1 → index 0, offset 2 → index 1, etc.
  if (segmentIdx < 0 && struct.segmentOffset !== null) {
    const idx = Math.max(0, struct.segmentOffset - 1);
    if (idx < lines.length) segmentIdx = idx;
  }

  // 2b. If we know person offset but not segment offset, segment is typically
  //     the line just before the person line.
  if (segmentIdx < 0 && struct.segmentOffset === null && struct.personOffset !== null) {
    const personIdx = Math.max(0, struct.personOffset - 1);
    const segIdx = personIdx - 1;
    if (segIdx >= 0 && segIdx < lines.length && !struct.looksLikePerson(lines[segIdx])) {
      segmentIdx = segIdx;
    }
  }

  // 3. Pattern match
  if (segmentIdx < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (struct.looksLikeSegment(lines[i])) { segmentIdx = i; break; }
    }
  }

  // 4. Fallback
  if (segmentIdx < 0) segmentIdx = 0;

  const rawSegmentLine = lines[segmentIdx];
  let segmentName = stripLeadingTimeFromSegmentName(rawSegmentLine);

  // ── Speaker lines from other block lines ──────────────────────────────────
  const speakerLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === segmentIdx) continue;
    const line = lines[i];
    if (struct.personTexts.has(line.toLowerCase())) {
      speakerLines.push(line);
    } else if (hasPerHints && struct.looksLikePerson(line)) {
      speakerLines.push(line);
    } else if (!hasPerHints && i > segmentIdx) {
      speakerLines.push(line);
    }
  }

  // ── Try to split a speaker name embedded in the segment line itself ───────
  // Only when we have person hints. If separate speaker lines were already
  // found, only add names that aren't already covered (avoids duplicates).
  if (hasPerHints) {
    const split = splitSegmentAndSpeaker(segmentName, struct);
    if (split) {
      segmentName = split.segment;
      for (const name of split.speakerNames) {
        const alreadyPresent = speakerLines.some(
          sl => sl.toLowerCase().includes(name.toLowerCase())
        );
        if (!alreadyPresent) speakerLines.push(name);
      }
    }
  }

  return { ...block, segmentName, speakerLines };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse agenda from raw text.
 * @param rawText        Full text from PDF or Word doc
 * @param startLineIndex 0-based line to start from (-1 = auto-detect first time)
 * @param hints          Optional examples the user selected in the UI
 */
export function parseAgenda(
  rawText: string,
  startLineIndex: number,
  hints?: ParseHints
): ParseAgendaResult {
  if (!rawText || typeof rawText !== 'string') {
    return { items: [], rawText: '', firstTimeLineIndex: -1, rawLines: [] };
  }

  const raw   = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');

  const { blocks, firstTimeLineIndex } = buildBlocks(lines, startLineIndex);
  const struct = learnStructure(lines, hints || {});

  const timedBlocks = blocks.filter(b => b.time != null);
  const items: AgendaParsedItem[] = [];

  for (let i = 0; i < timedBlocks.length; i++) {
    const b      = timedBlocks[i];
    const interp = interpretBlock(b, struct);

    const segmentName = interp.segmentName || `Agenda Item ${i + 1}`;

    let duration = DEFAULT_DURATION;
    if (b.timeEndRaw) {
      const endMins = parseTimeToMinutes(b.timeEndRaw);
      if (endMins != null && b.time != null && endMins > b.time)
        duration = minutesToHHMMSS(endMins - b.time);
    } else if (i + 1 < timedBlocks.length && timedBlocks[i + 1].time != null && b.time != null) {
      const nextMins = timedBlocks[i + 1].time!;
      if (nextMins > b.time) duration = minutesToHHMMSS(nextMins - b.time);
    }

    const speakers: ReturnType<typeof parseSpeakerLine>[] = [];
    interp.speakerLines.forEach((line, idx) => {
      const sp = parseSpeakerLine(line, idx + 1);
      if (sp?.fullName) speakers.push(sp);
    });

    items.push({
      row: i + 1,
      cue: `CUE ${i + 1}`,
      segmentName,
      startTime: b.timeRaw || '',
      duration,
      shotType: '',
      hasPPT: false,
      hasQA: false,
      programType: '',
      notes: '',
      assets: '',
      speakers: speakers.length ? JSON.stringify(speakers) : '',
    });
  }

  return { items, rawText: raw, firstTimeLineIndex, rawLines: lines };
}
