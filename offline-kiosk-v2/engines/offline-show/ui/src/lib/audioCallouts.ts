/** Wall-clock VO / BGM callouts — one linked set with Notes chips. */

/** Event-wide popup switch. Missing / undefined means on. */
export function voAlertsEnabledFromSettings(settings: { voAlertsEnabled?: unknown } | null | undefined): boolean {
  return settings?.voAlertsEnabled !== false;
}

export type AudioCalloutKind = 'vo' | 'bgm';

export interface VoCue {
  id: string;
  /** 24h "HH:MM" venue wall clock */
  time: string;
  /** Optional short label (also written into Notes as formatted text) */
  label?: string;
  /** Voice-over or background music */
  kind?: AudioCalloutKind;
  /** Optional CUE-style prefix (e.g. "12A" → shows as CUE 12A) */
  cuePrefix?: string;
  /** IANA zone this wall-clock time belongs to (locked at save so all clients fire together) */
  timeZone?: string;
}

export function formatCalloutTime(time: string): string {
  const [hStr, mStr] = String(time || '').split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (Number.isNaN(h)) return time;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m}${ampm}`;
}

export function calloutKindLabel(kind?: AudioCalloutKind): string {
  return kind === 'bgm' ? 'BGM' : 'VO';
}

/** True when this callout's chip text is still present in Notes HTML/plain text. */
export function voCueAppearsInNotes(
  notes: string,
  vo: Pick<VoCue, 'time' | 'label' | 'kind' | 'cuePrefix'>
): boolean {
  const raw = String(notes || '');
  if (!raw) return false;
  const chip = formatCalloutChipText(vo);
  if (!chip) return false;
  if (raw.includes(chip)) return true;
  const escaped = escapeNotesHtml(chip);
  return escaped !== chip && raw.includes(escaped);
}

/**
 * Notes are the source of truth for the linked set.
 * Drop voCues whose chip was deleted from Notes so popups cannot fire from leftovers.
 */
export function reconcileVoCuesWithNotes(
  notes: string,
  voCues: VoCue[] | null | undefined
): VoCue[] {
  if (!Array.isArray(voCues) || voCues.length === 0) return [];
  return voCues.filter((vo) => voCueAppearsInNotes(notes, vo));
}

/** e.g. "CUE 1.1 VO - 4:45PM" or "VO - 4:45PM - 10 minutes" */
export function formatCalloutChipText(
  vo: Pick<VoCue, 'time' | 'label' | 'kind' | 'cuePrefix'>
): string {
  const rawPrefix = (vo.cuePrefix || '').trim();
  const cuePart = rawPrefix
    ? rawPrefix.toUpperCase().startsWith('CUE')
      ? rawPrefix
      : `CUE ${rawPrefix}`
    : '';
  const kind = calloutKindLabel(vo.kind);
  const time = formatCalloutTime(vo.time);
  const label = (vo.label || '').trim();
  const head = cuePart ? `${cuePart} ${kind}` : kind;
  const base = `${head} - ${time}`;
  return label ? `${base} - ${label}` : base;
}

export function escapeNotesHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Editor-only blank line below chips (stripped on save if still empty). */
export const NOTES_EDITOR_TYPING_SPACER =
  `<p data-ros-notes-continue="1" style="margin:0.35em 0;min-height:1.15em;font-weight:400;font-size:1em;font-style:normal;text-decoration:none;color:inherit;">` +
  `<span style="font-weight:400;font-size:1em;font-style:normal;text-decoration:none;">` +
  `<br></span></p>`;

const CONTINUE_P_RE =
  /<p[^>]*data-ros-notes-continue\s*=\s*["']?1["']?[^>]*>[\s\S]*?<\/p>/gi;

/** True if HTML is only chip lists (VO/Settle/Stage) and empty continue spacers. */
export function notesHtmlIsChipsOnly(html: string): boolean {
  const stripped = String(html || '')
    .replace(CONTINUE_P_RE, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/&nbsp;/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!stripped) return true;
  // Remove chip <ul>…</ul> blocks; anything left means freeform text exists
  const withoutChips = stripped
    .replace(/<ul\b[\s\S]*?<\/ul>/gi, '')
    .replace(/<\/?(div|span|li|p|b|i|u|strong|em)[^>]*>/gi, '')
    .trim();
  return withoutChips.length === 0;
}

export function notesHtmlHasChip(html: string): boolean {
  const raw = String(html || '');
  return (
    /data-ros-callout\s*=\s*["']?1["']?/i.test(raw) ||
    /data-settle-cue\s*=\s*["']?1["']?/i.test(raw) ||
    /data-stage-direction\s*=\s*["']?1["']?/i.test(raw) ||
    /<ul\b[^>]*>[\s\S]*?<span[^>]*font-weight:\s*700/i.test(raw)
  );
}

function notesHtmlHasTrailingSpacer(html: string): boolean {
  return /data-ros-notes-continue\s*=\s*["']?1["']?[^>]*>[\s\S]*<\/p>\s*$/i.test(String(html || '').trim());
}

/** Keep one blank line after chips so the next keystroke is normal text. */
export function withNotesTypingSpacer(html: string): string {
  const raw = String(html || '');
  const withoutEmpty = stripNotesEditorTypingSpacers(raw);
  if (!notesHtmlHasChip(withoutEmpty)) return withoutEmpty;
  return `${withoutEmpty}${NOTES_EDITOR_TYPING_SPACER}`;
}

function isNotesChipList(el: Element | null): el is HTMLElement {
  if (!el || el.tagName !== 'UL') return false;
  return (
    el.getAttribute('data-ros-callout') === '1' ||
    el.getAttribute('data-settle-cue') === '1' ||
    el.getAttribute('data-stage-direction') === '1' ||
    !!el.querySelector('span[style*="font-weight"]')
  );
}

function resetNotesTypingFormat(): void {
  try {
    document.execCommand('removeFormat', false, undefined);
    document.execCommand('unlink', false, undefined);
    if (document.queryCommandState('bold')) document.execCommand('bold', false, undefined);
    if (document.queryCommandState('italic')) document.execCommand('italic', false, undefined);
    if (document.queryCommandState('underline')) document.execCommand('underline', false, undefined);
  } catch {
    /* ignore */
  }
}

/** Enter inside a chip jumps to a plain line after it. */
export function handleNotesChipEnter(
  editor: HTMLElement | null | undefined,
  event: { key: string; shiftKey: boolean; preventDefault: () => void }
): boolean {
  if (!editor || event.key !== 'Enter' || event.shiftKey) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node: Node | null = sel.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const el = node as HTMLElement | null;
  if (!el || !editor.contains(el)) return false;
  const chipList = el.closest('ul');
  if (!isNotesChipList(chipList) || !editor.contains(chipList)) return false;

  event.preventDefault();
  let next = chipList.nextElementSibling as HTMLElement | null;
  if (!next || next.getAttribute('data-ros-notes-continue') !== '1') {
    chipList.insertAdjacentHTML('afterend', NOTES_EDITOR_TYPING_SPACER);
    next = chipList.nextElementSibling as HTMLElement | null;
  }
  if (!next) return true;
  const inner = (next.querySelector('span') as HTMLElement | null) || next;
  const range = document.createRange();
  range.selectNodeContents(inner);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  resetNotesTypingFormat();
  return true;
}

/** Remove empty editor typing spacers from HTML (for save / storage). Keeps spacers with real text. */
export function stripNotesEditorTypingSpacers(html: string): string {
  return String(html || '')
    .replace(
      /<p[^>]*data-ros-notes-continue\s*=\s*["']?1["']?[^>]*>[\s\S]*?<\/p>/gi,
      (block) => {
        const text = block
          .replace(/<br\s*\/?>/gi, '')
          .replace(/&nbsp;/gi, '')
          .replace(/<[^>]+>/g, '')
          .trim();
        return text ? block : '';
      }
    )
    .replace(/(?:<br\s*\/?>\s*)+$/i, '')
    .trim();
}

/**
 * While Notes modal is open: if content ends with chip blocks (or is chips-only),
 * append one empty paragraph so typing is normal — not list/bold from the chip.
 * Does not permanently store space when notes are chips-only (stripped on save).
 */
export function ensureNotesEditorTypingSpace(editor: HTMLElement | null | undefined): void {
  if (!editor) return;
  const html = editor.innerHTML || '';
  // Already has a continue spacer at the end
  if (notesHtmlHasTrailingSpacer(html)) {
    placeCaretInNotesFreeform(editor);
    return;
  }
  if (!notesHtmlHasChip(html)) return;

  editor.insertAdjacentHTML('beforeend', NOTES_EDITOR_TYPING_SPACER);
  placeCaretInNotesFreeform(editor);
}

/** Place caret in the last freeform spacer paragraph (ready for normal typing). */
export function placeCaretInNotesFreeform(editor: HTMLElement | null | undefined): void {
  if (!editor) return;
  try {
    editor.focus();
    const nodes = editor.querySelectorAll('[data-ros-notes-continue="1"]');
    const target = (nodes.length ? nodes[nodes.length - 1] : editor) as HTMLElement;
    const inner = (target.querySelector('span') as HTMLElement | null) || target;
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(inner);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
    resetNotesTypingFormat();
  } catch {
    /* ignore */
  }
}

/** VO/BGM note block — bold, highlighted, bulleted. */
export function buildCalloutNotesHtml(chipText: string, kind?: AudioCalloutKind): string {
  const isBgm = kind === 'bgm';
  const bg = isBgm ? 'rgba(13, 148, 136, 0.5)' : 'rgba(217, 119, 6, 0.5)';
  const border = isBgm ? '#2dd4bf' : '#fbbf24';
  const color = isBgm ? '#ecfdf5' : '#fffbeb';
  return (
    `<ul data-ros-callout="1" style="margin:0.4em 0;padding-left:1.4em;list-style-type:disc;font-size:1em;">` +
    `<li style="margin:0.25em 0;">` +
    `<span style="font-weight:700;line-height:1.4;background:${bg};color:${color};` +
    `border:1px solid ${border};border-radius:5px;padding:0.2em 0.5em;display:inline-block;">` +
    `${escapeNotesHtml(chipText)}` +
    `</span></li></ul>`
  );
}

/** Strip a callout line (styled HTML or plain) from Notes. */
export function removeCalloutFromNotes(notes: string, chipText: string): string {
  if (!notes || !chipText) return notes || '';
  const escapedHtml = escapeNotesHtml(chipText);
  let result = notes;
  result = result.replace(
    new RegExp(
      `<ul[^>]*>\\s*<li[^>]*>\\s*<span[^>]*>\\s*${escapeRegExp(escapedHtml)}\\s*</span>\\s*</li>\\s*</ul>`,
      'gi'
    ),
    ''
  );
  result = result.replace(
    new RegExp(`(<br\\s*/?>|\\r?\\n)?\\s*${escapeRegExp(chipText)}\\s*(<br\\s*/?>)?`, 'gi'),
    ''
  );
  return result.replace(/^(<br\s*\/?>|\s)+|(<br\s*\/?>|\s)+$/gi, '').trim();
}

/**
 * Sync VO/BGM list into Notes: remove deleted lines, put current callouts at the top.
 */
export function syncCalloutsIntoNotes(
  notes: string,
  previous: VoCue[],
  next: VoCue[]
): string {
  let result = notes || '';
  const allForRemoval = [...previous, ...next];
  const seenText = new Set<string>();
  for (const vo of allForRemoval) {
    const text = formatCalloutChipText(vo);
    if (seenText.has(text)) continue;
    seenText.add(text);
    result = removeCalloutFromNotes(result, text);
  }
  result = stripNotesEditorTypingSpacers(result);
  const sorted = [...next].sort((a, b) => a.time.localeCompare(b.time));
  const block = sorted.map((vo) => buildCalloutNotesHtml(formatCalloutChipText(vo), vo.kind)).join('');
  if (!block) return result;
  if (!result.trim()) return withNotesTypingSpacer(block);
  return withNotesTypingSpacer(`${block}${result}`);
}

export function normalizeVoCues(raw: unknown): VoCue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v: any) => {
      const id = String(v?.id || '').trim();
      const time = String(v?.time || '').trim();
      if (!id || !time) return null;
      const kind: AudioCalloutKind = v?.kind === 'bgm' ? 'bgm' : 'vo';
      const label = typeof v?.label === 'string' ? v.label : '';
      const cuePrefix =
        typeof v?.cuePrefix === 'string' && v.cuePrefix.trim() ? v.cuePrefix.trim() : undefined;
      const timeZone =
        typeof v?.timeZone === 'string' && v.timeZone.trim() ? v.timeZone.trim() : undefined;
      return {
        id,
        time,
        label,
        kind,
        ...(cuePrefix ? { cuePrefix } : {}),
        ...(timeZone ? { timeZone } : {}),
      } as VoCue;
    })
    .filter(Boolean) as VoCue[];
}

/** e.g. cue "3" or "CUE 3" → "Cue 3.1 - Settle Motion & Presenters" */
export function formatSettleCueNoteText(cueRaw: string): string {
  let cue = String(cueRaw || '').trim().replace(/^CUE\s+/i, '').trim();
  if (!cue) return 'Cue ?.1 - Settle Motion & Presenters';
  cue = cue.replace(/\.1$/i, '');
  return `Cue ${cue}.1 - Settle Motion & Presenters`;
}

/** SettleCue note block — bold chip, distinct from VO/BGM. */
export function buildSettleCueNotesHtml(cueRaw: string): string {
  const chipText = formatSettleCueNoteText(cueRaw);
  const bg = 'rgba(37, 99, 235, 0.45)';
  const border = '#60a5fa';
  const color = '#eff6ff';
  return (
    `<ul style="margin:0.4em 0;padding-left:1.4em;list-style-type:disc;font-size:1em;" data-settle-cue="1">` +
    `<li style="margin:0.25em 0;">` +
    `<span style="font-weight:700;line-height:1.4;background:${bg};color:${color};` +
    `border:1px solid ${border};border-radius:5px;padding:0.2em 0.5em;display:inline-block;">` +
    `${escapeNotesHtml(chipText)}` +
    `</span></li></ul>`
  );
}

/** Prepend SettleCue note if not already present for this cue. */
export function prependSettleCueNote(notes: string, cueRaw: string): string {
  const chipText = formatSettleCueNoteText(cueRaw);
  const existing = stripNotesEditorTypingSpacers(notes || '');
  if (
    existing.includes(chipText) ||
    existing.includes(escapeNotesHtml(chipText))
  ) {
    return existing;
  }
  const block = buildSettleCueNotesHtml(cueRaw);
  if (!existing.trim()) return withNotesTypingSpacer(block);
  return withNotesTypingSpacer(`${block}${existing}`);
}

/** Preset Stage Direction lines (also allow custom free text). */
export const STAGE_DIRECTION_PRESETS = [
  'Panel from SR',
  'Keynote/Presenter from SL',
] as const;

export function formatStageDirectionNoteText(directionRaw: string): string {
  const text = String(directionRaw || '').trim();
  if (!text) return 'Stage Direction';
  // Strip legacy "Stage Direction — …" prefix if present
  return text.replace(/^stage\s*direction\s*[—:\-]\s*/i, '').trim() || text;
}

/** Stage Direction note block — violet chip, distinct from Settle / VO / BGM. */
export function buildStageDirectionNotesHtml(directionRaw: string): string {
  const chipText = formatStageDirectionNoteText(directionRaw);
  const bg = 'rgba(124, 58, 237, 0.45)';
  const border = '#c4b5fd';
  const color = '#f5f3ff';
  return (
    `<ul style="margin:0.4em 0;padding-left:1.4em;list-style-type:disc;font-size:1em;" data-stage-direction="1">` +
    `<li style="margin:0.25em 0;">` +
    `<span style="font-weight:700;line-height:1.4;background:${bg};color:${color};` +
    `border:1px solid ${border};border-radius:5px;padding:0.2em 0.5em;display:inline-block;">` +
    `${escapeNotesHtml(chipText)}` +
    `</span></li></ul>`
  );
}

/** Prepend Stage Direction note if that exact line is not already present. */
export function prependStageDirectionNote(notes: string, directionRaw: string): string {
  const chipText = formatStageDirectionNoteText(directionRaw);
  const existing = stripNotesEditorTypingSpacers(notes || '');
  if (
    existing.includes(chipText) ||
    existing.includes(escapeNotesHtml(chipText))
  ) {
    return existing;
  }
  const block = buildStageDirectionNotesHtml(directionRaw);
  if (!existing.trim()) return withNotesTypingSpacer(block);
  return withNotesTypingSpacer(`${block}${existing}`);
}
