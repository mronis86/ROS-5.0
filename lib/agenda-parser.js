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

// Lines that start with these (case-insensitive) are never the "first time" — skip when scanning.
const HEADER_PREFIXES = /^(agenda|date|schedule|title|event|meeting|location|venue|time|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}|\d{4})/i;

// Time-only line: optional bullet/dash, then time, optional " - endTime", nothing else meaningful.
const TIME_LINE_REGEX = /^\s*[•\-]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?(?:\s*[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?)?\s*$/i;

const TIME_LINE_REGEX_NO_BULLET = /^\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?(?:\s*[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?)?\s*$/i;

// Line starts with optional bullet/dash, then time, then optional title (e.g. "9:00 a.m. Opening")
// Match a.m., p.m. (with periods) so they go to Start time, not segment title
const STARTS_WITH_TIME = /^\s*[•\-]?\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?\s*[-–—]?\s*(.*)/i;

function normalizeLine(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

function isHeaderLike(line) {
  const t = normalizeLine(line).toLowerCase();
  if (!t) return true;
  if (HEADER_PREFIXES.test(t)) return true;
  if (/^\d{1,4}[\-\/\.]\d{1,2}[\-\/\.]\d{1,4}$/.test(t)) return true;
  return false;
}

function isTimeOnlyLine(line) {
  const t = normalizeLine(line);
  if (!t) return false;
  return TIME_LINE_REGEX.test(t) || TIME_LINE_REGEX_NO_BULLET.test(t);
}

/**
 * Line is a valid "agenda time" line: time-only or starts with time + title.
 * Excludes header-like lines so we never treat "Agenda" or "Date: ..." as start.
 */
function lineHasTime(line) {
  const t = normalizeLine(line);
  if (!t) return false;
  if (isHeaderLike(line)) return false;
  return isTimeOnlyLine(line) || STARTS_WITH_TIME.test(t);
}

/**
 * Parse time string to minutes since midnight. Handles "12:30pm", "1:30 pm", "9:00 AM", "14:30".
 */
function parseTimeToMinutes(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str.trim().replace(/\s+/g, ' ');
  s = s.replace(/\s+a\.m\.\s*$/i, ' AM').replace(/\s+p\.m\.\s*$/i, ' PM');
  const u = s.toUpperCase();
  const ampmMatch = u.match(/\s*(AM|PM)\s*$/);
  const hasAmPm = !!ampmMatch;
  const rest = hasAmPm ? u.replace(/\s*(AM|PM)\s*$/, '').trim() : u;
  const parts = rest.split(/[:\s]+/).map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
  if (parts.length < 2) return null;
  let hours = parts[0];
  const minutes = parts[1];
  const seconds = parts.length >= 3 ? parts[2] : 0;
  if (hasAmPm) {
    const ampm = ampmMatch[1].toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
  }
  return hours * 60 + minutes + seconds / 60;
}

function minutesToHHMMSS(totalMinutes) {
  if (totalMinutes == null || isNaN(totalMinutes) || totalMinutes < 0) return DEFAULT_DURATION;
  const totalSec = Math.round(totalMinutes * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0')
  ].join(':');
}

function parseSpeakerLine(text, slot) {
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
function findFirstTimeLineIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lineHasTime(lines[i])) return i;
  }
  return -1;
}

function buildTimeStringFromMatch(m) {
  const h = m[1];
  const min = m[2];
  const sec = m[3] != null && m[3] !== '' ? `:${m[3]}` : '';
  const ampmRaw = (m[4] || '').trim();
  const ampm = ampmRaw.replace(/^a\.m\.$/i, 'AM').replace(/^p\.m\.$/i, 'PM');
  return `${h}:${min}${sec}${ampm ? ' ' + ampm : ''}`;
}

/**
 * @param {string[]} lines - Normalized lines
 * @param {number} [overrideStartIndex] - If >= 0, use this as start line (0-based). Else use first time detection.
 * @returns {{ blocks: object[], firstTimeLineIndex: number }}
 */
function buildBlocks(lines, overrideStartIndex) {
  const normalized = lines.map((l) => normalizeLine(l));
  let startIdx = overrideStartIndex >= 0 ? Math.min(overrideStartIndex, normalized.length) : findFirstTimeLineIndex(normalized);
  if (startIdx < 0) return { blocks: [], firstTimeLineIndex: -1 };
  const fromFirstTime = normalized.slice(startIdx);

  const blocks = [];
  let current = { time: null, timeRaw: null, timeEndRaw: null, lines: [] };

  for (let i = 0; i < fromFirstTime.length; i++) {
    const line = fromFirstTime[i];
    const trimmed = line;
    if (!trimmed) {
      continue;
    }

    const timeOnly = isTimeOnlyLine(line);
    const startMatch = trimmed.match(STARTS_WITH_TIME);

    if (timeOnly) {
      if (current.lines.length > 0 || current.time !== null) {
        blocks.push({ ...current });
      }
      const m = trimmed.replace(/^\s*[•\-]\s*/, '').match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i);
      const timeStr = m ? buildTimeStringFromMatch(m) : trimmed;
      const endPart = trimmed.match(/[-–—]\s*(\d{1,2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)\s*(AM|PM|am|pm|a\.m\.|p\.m\.)?/i);
      const endStr = endPart ? (endPart[1].replace(/\s+/g, ' ').trim() + (endPart[2] ? ' ' + endPart[2].trim() : '')).trim() : null;
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
 * @param {string} rawText - Full text from PDF or Word
 * @param {number} [startLineIndex] - If >= 0, start parsing from this line (0-based). Else use first-time detection.
 * @returns {{ items: Array<{...}>, rawText: string, firstTimeLineIndex: number, rawLines: string[] }}
 */
function parseAgenda(rawText, startLineIndex) {
  if (!rawText || typeof rawText !== 'string') {
    return { items: [], rawText: '', firstTimeLineIndex: -1, rawLines: [] };
  }

  const raw = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  const { blocks, firstTimeLineIndex } = buildBlocks(lines, startLineIndex);

  const timedBlocks = blocks.filter((b) => b.time != null);
  const items = [];
  for (let i = 0; i < timedBlocks.length; i++) {
    const b = timedBlocks[i];
    let segmentName = '';
    const speakerLines = [];

    if (b.lines.length > 0) {
      segmentName = stripLeadingTimeFromSegmentName(b.lines[0]);
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
    } else if (i + 1 < timedBlocks.length && timedBlocks[i + 1].time != null && b.time != null) {
      const nextMins = timedBlocks[i + 1].time;
      if (nextMins > b.time) {
        duration = minutesToHHMMSS(nextMins - b.time);
      }
    }

    const speakers = [];
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

module.exports = { parseAgenda, parseTimeToMinutes, minutesToHHMMSS, buildBlocks, findFirstTimeLineIndex };
