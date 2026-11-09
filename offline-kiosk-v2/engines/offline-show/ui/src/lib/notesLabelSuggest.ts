export type NoteLabelHint = {
  type: 'vo' | 'settle';
  line: string;
  kind?: 'vo' | 'bgm';
  time?: string | null;
  label?: string;
  cuePrefix?: string;
};

function escapeRegExp(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeNotesEntities(text: string): string {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function normalizeLooseTime(raw: string): string | null {
  let s = String(raw || '')
    .trim()
    .replace(/[\u00a0\u202f\u2007\u2009]/g, ' ')
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .replace(/\s*([ap]m)$/i, ' $1')
    .trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const m = Number(ampm[2]);
    const period = ampm[3].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return null;
}

export function extractNotesPlainLines(html: string): string[] {
  let s = String(html || '');
  s = s.replace(/<ul\b[^>]*data-ros-callout[\s\S]*?<\/ul>/gi, '');
  s = s.replace(/<ul\b[^>]*data-settle-cue[\s\S]*?<\/ul>/gi, '');
  s = s.replace(/<ul\b[^>]*data-stage-direction[\s\S]*?<\/ul>/gi, '');
  // Opening AND closing blocks — Chrome often does `line 1<div>line 2</div>`.
  s = s.replace(/<(br|p|div|li|h[1-6]|tr)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeNotesEntities(s);
  s = s.replace(/\r\n|\r|\u2028|\u2029/g, '\n');
  // A new cue-style prefix mid-string is a new line: "8.2 VO test 8.3 VO"
  s = s.replace(/(?<=\S)\s+(?=\d+\.\d+\b)/g, '\n');
  return s
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseLeadingCuePrefix(line: string): string {
  const raw = String(line || '').trim();
  const cueWord = raw.match(/\bCUE\s+([A-Z0-9.]+)/i);
  if (cueWord) return cueWord[1];
  const leading = raw.match(/^(\d+\.\d+|\d+[A-Z]?)\s+(?=(?:vo|bgm|settle|voice))/i);
  return leading ? leading[1] : '';
}

function parseVoHintLine(line: string): NoteLabelHint | null {
  const raw = String(line || '').trim();
  if (!raw || raw.length > 220) return null;
  const kindMatch = raw.match(/\b(bgm|vo|voice[\s-]?over)\b/i);
  if (!kindMatch) return null;
  const kind = /^bgm$/i.test(kindMatch[1]) ? 'bgm' : 'vo';
  const timeMatch = raw.match(/\b((?:1[0-2]|0?[1-9]|2[0-3])[:.][0-5]\d(?:\s*[ap]m)?|(?:1[0-2]|0?[1-9])\s*[ap]m)\b/i);
  const time = timeMatch ? normalizeLooseTime(timeMatch[1]) : null;
  const cuePrefix = parseLeadingCuePrefix(raw);
  const label = raw
    .replace(/\b(bgm|vo|voice[\s-]?over)\b/gi, ' ')
    .replace(/\bCUE\s+[A-Z0-9.]+/gi, ' ')
    .replace(cuePrefix ? new RegExp(`^${cuePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : '', ' ')
    .replace(timeMatch ? timeMatch[0] : '', ' ')
    .replace(/[-–—:|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    type: 'vo',
    line: raw,
    kind,
    time,
    label,
    cuePrefix,
  };
}

function parseSettleHintLine(line: string, fallbackCue?: string): NoteLabelHint | null {
  const raw = String(line || '').trim();
  if (!raw || raw.length > 220) return null;
  if (!/\bsettle(?:s|cue)?\b/i.test(raw) && !/\bsettle\s+motion\b/i.test(raw)) return null;
  if (/\b(bgm|vo|voice[\s-]?over)\b/i.test(raw)) return null;
  let cue = String(fallbackCue || '').replace(/^CUE\s+/i, '').replace(/\.1$/i, '').trim();
  const cueMatch =
    raw.match(/\bcue\s+([A-Z0-9.]+)(?:\.1)?\b/i) ||
    raw.match(/^(\d+\.\d+|\d+[A-Z]?)\b/i) ||
    raw.match(/\b([A-Z0-9]+)\.1\b/i);
  if (cueMatch) cue = String(cueMatch[1]).replace(/\.1$/i, '');
  return {
    type: 'settle',
    line: raw,
    cuePrefix: cue,
  };
}

export function parseNoteLabelHint(line: string, fallbackCue?: string): NoteLabelHint | null {
  return parseVoHintLine(line) || parseSettleHintLine(line, fallbackCue);
}

function alreadyConverted(
  hint: NoteLabelHint,
  existingVoCues: { time?: string; label?: string; kind?: string }[],
  existingNotesHtml: string
): boolean {
  if (hint.type === 'settle') {
    if (!hint.cuePrefix) return false;
    const needle = `Cue ${hint.cuePrefix}.1 - Settle Motion`;
    return String(existingNotesHtml || '').includes(needle);
  }
  const vos = Array.isArray(existingVoCues) ? existingVoCues : [];
  return vos.some((vo) => {
    if ((vo.kind || 'vo') !== hint.kind) return false;
    if (hint.time && String(vo.time || '') === hint.time) {
      const voLabel = String(vo.label || '').trim().toLowerCase();
      const hintLabel = String(hint.label || '').trim().toLowerCase();
      return !hintLabel || !voLabel || voLabel === hintLabel;
    }
    return false;
  });
}

export function suggestNoteLabelActions(
  html: string,
  opts?: { fallbackCue?: string; existingVoCues?: { time?: string; label?: string; kind?: string }[] }
): NoteLabelHint[] {
  const fallbackCue = opts?.fallbackCue || '';
  const existingVoCues = opts?.existingVoCues || [];
  const lines = extractNotesPlainLines(html);
  const out: NoteLabelHint[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const hint = parseNoteLabelHint(line, fallbackCue);
    if (!hint) continue;
    const key = `${hint.type}:${hint.line.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (alreadyConverted(hint, existingVoCues, html)) continue;
    seen.add(key);
    out.push(hint);
  }
  return out;
}

export function removePlainLineFromNotesHtml(html: string, line: string): string {
  const trimmed = String(line || '').trim();
  if (!trimmed) return html;
  let result = String(html || '');
  for (const text of [trimmed, escapeHtml(trimmed)]) {
    const e = escapeRegExp(text);
    result = result.replace(new RegExp(`<(p|div|li)([^>]*)>\\s*${e}\\s*</\\1>`, 'i'), '');
    result = result.replace(new RegExp(`${e}\\s*(<br\\s*/?>)`, 'i'), '');
    result = result.replace(new RegExp(`(<br\\s*/?>)\\s*${e}`, 'i'), '$1');
    result = result.replace(new RegExp(e, 'i'), '');
  }
  return result;
}
