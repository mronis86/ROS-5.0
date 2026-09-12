/** Wall-clock VO / BGM callouts — metadata only; also written into Notes HTML. */

export type AudioCalloutKind = 'vo' | 'bgm';

export interface VoCue {
  id: string;
  /** 24h "HH:MM" */
  time: string;
  /** Optional short label (also written into Notes as formatted text) */
  label?: string;
  /** Voice-over or background music */
  kind?: AudioCalloutKind;
  /** Optional CUE-style prefix (e.g. "12A" → shows as CUE 12A) */
  cuePrefix?: string;
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

/** VO/BGM note block — bold, highlighted, bulleted. */
export function buildCalloutNotesHtml(chipText: string, kind?: AudioCalloutKind): string {
  const isBgm = kind === 'bgm';
  const bg = isBgm ? 'rgba(13, 148, 136, 0.5)' : 'rgba(217, 119, 6, 0.5)';
  const border = isBgm ? '#2dd4bf' : '#fbbf24';
  const color = isBgm ? '#ecfdf5' : '#fffbeb';
  return (
    `<ul style="margin:0.4em 0;padding-left:1.4em;list-style-type:disc;font-size:1em;">` +
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
  const sorted = [...next].sort((a, b) => a.time.localeCompare(b.time));
  const block = sorted.map((vo) => buildCalloutNotesHtml(formatCalloutChipText(vo), vo.kind)).join('');
  if (!block) return result;
  if (!result.trim()) return block;
  return `${block}${result}`;
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
      return {
        id,
        time,
        label,
        kind,
        ...(cuePrefix ? { cuePrefix } : {}),
      } as VoCue;
    })
    .filter(Boolean) as VoCue[];
}
