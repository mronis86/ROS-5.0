/** Cue Cards — web slides grouped by ROS cues, with Scripts Follow–style comments. */

export type CueCardCommentType = 'GENERAL' | 'CUE' | 'AUDIO' | 'GFX' | 'VIDEO' | 'LIGHTING';

export type CueCardRole = 'SCROLLER' | 'VIEWER';

/** Stage fill — always black unless we later add themes. */
export const CUE_CARD_DEFAULT_BG = '#000000';
/** Default body/title color; user can override per slide or per selection. */
export const CUE_CARD_DEFAULT_TEXT = '#ffffff';

export interface CueCardSlide {
  id: string;
  /** List/label only — not shown on the stage card. */
  title: string;
  /**
   * Main slide body. May be plain text (legacy) or a small HTML subset
   * (bold / italic / underline / lists / colored spans / align / font size).
   */
  body: string;
  /** Scroller-only speaker / stage note (not shown on VIEWER) */
  scrollerNote?: string;
  bgColor?: string;
  textColor?: string;
}

export interface CueCardRange {
  id: string;
  /** Display label, e.g. "CUE 2" */
  cueLabel: string;
  /** Optional schedule item id from ROS */
  scheduleItemId?: number | null;
  /** Inclusive 0-based slide indices */
  startIndex: number;
  endIndex: number;
}

export interface CueCardComment {
  id: string;
  slideId: string;
  text: string;
  type: CueCardCommentType;
  author: string;
  timestamp: string;
}

export interface CueCardDeck {
  eventId: string;
  title: string;
  slides: CueCardSlide[];
  cueRanges: CueCardRange[];
  comments: CueCardComment[];
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export const CUE_CARD_COMMENT_TYPES: Record<
  CueCardCommentType,
  { label: string; color: string; bgColor: string; borderColor: string; icon: string }
> = {
  GENERAL: {
    label: 'General',
    color: 'text-slate-300',
    bgColor: 'bg-slate-600',
    borderColor: 'border-slate-400',
    icon: '💬',
  },
  CUE: {
    label: 'Cue',
    color: 'text-yellow-300',
    bgColor: 'bg-yellow-600',
    borderColor: 'border-yellow-400',
    icon: '🎬',
  },
  AUDIO: {
    label: 'Audio',
    color: 'text-green-300',
    bgColor: 'bg-green-600',
    borderColor: 'border-green-400',
    icon: '🎵',
  },
  GFX: {
    label: 'GFX',
    color: 'text-purple-300',
    bgColor: 'bg-purple-600',
    borderColor: 'border-purple-400',
    icon: '🎨',
  },
  VIDEO: {
    label: 'Video',
    color: 'text-red-300',
    bgColor: 'bg-red-600',
    borderColor: 'border-red-400',
    icon: '📹',
  },
  LIGHTING: {
    label: 'Lighting',
    color: 'text-orange-300',
    bgColor: 'bg-orange-600',
    borderColor: 'border-orange-400',
    icon: '💡',
  },
};

export function newSlideId(): string {
  return `slide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newRangeId(): string {
  return `range_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptySlide(partial?: Partial<CueCardSlide>): CueCardSlide {
  return {
    id: newSlideId(),
    title: '',
    body: '',
    scrollerNote: undefined,
    ...partial,
    bgColor: CUE_CARD_DEFAULT_BG,
    textColor: partial?.textColor || CUE_CARD_DEFAULT_TEXT,
  };
}

export function normalizeCueLabel(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^CUE\s+/i.test(t)) return t.replace(/^CUE\s+/i, 'CUE ').toUpperCase().replace(/^CUE\s+/, 'CUE ');
  return `CUE ${t}`;
}

/** Find cue range covering a slide index, if any. */
export function findRangeForSlide(
  ranges: CueCardRange[],
  slideIndex: number
): CueCardRange | null {
  if (!Number.isFinite(slideIndex) || slideIndex < 0) return null;
  return (
    ranges.find((r) => slideIndex >= r.startIndex && slideIndex <= r.endIndex) || null
  );
}

export function commentsForSlide(
  comments: CueCardComment[],
  slideId: string | null | undefined
): CueCardComment[] {
  if (!slideId) return [];
  return comments.filter((c) => c.slideId === slideId);
}

export function mapApiComment(row: any): CueCardComment {
  return {
    id: String(row.id),
    slideId: String(row.slide_id || row.slideId || ''),
    text: String(row.comment_text ?? row.text ?? ''),
    type: (row.comment_type || row.type || 'GENERAL') as CueCardCommentType,
    author: String(row.author || 'Unknown'),
    timestamp: String(row.updated_at || row.created_at || row.timestamp || new Date().toISOString()),
  };
}

export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(String(s || ''));
}

export function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Legacy plain-text bodies → simple paragraphs for the rich editor / stage. */
export function plainBodyToHtml(plain: string): string {
  const t = String(plain || '');
  if (!t) return '';
  return t
    .split(/\r\n|\n|\r/)
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('');
}

const ALLOWED_TAGS = new Set([
  'P',
  'BR',
  'DIV',
  'SPAN',
  'STRONG',
  'B',
  'EM',
  'I',
  'U',
  'UL',
  'OL',
  'LI',
  'FONT',
]);

function sanitizeColor(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(v)) return v;
  if (/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/.test(v)) return v;
  return null;
}

function sanitizeFontSize(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(v)) return v;
  return null;
}

function sanitizeTextAlign(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') return v;
  return null;
}

/** Allowlist HTML for cue card bodies (format / lists / color / size / align). */
export function sanitizeCueCardHtml(html: string): string {
  if (typeof document === 'undefined') {
    return String(html || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  }
  const wrapped = `<div id="cue-sanitize-root">${html || ''}</div>`;
  const doc = new DOMParser().parseFromString(wrapped, 'text/html');
  const root = doc.getElementById('cue-sanitize-root');
  if (!root) return '';

  const clean = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (!ALLOWED_TAGS.has(tag)) {
      const frag = doc.createDocumentFragment();
      Array.from(el.childNodes).forEach((child) => {
        const c = clean(child);
        if (c) frag.appendChild(c);
      });
      return frag;
    }
    const out = doc.createElement(tag === 'FONT' ? 'SPAN' : tag);
    if (
      tag === 'SPAN' ||
      tag === 'FONT' ||
      tag === 'P' ||
      tag === 'LI' ||
      tag === 'DIV' ||
      tag === 'UL' ||
      tag === 'OL'
    ) {
      const color =
        sanitizeColor(el.getAttribute('color')) ||
        sanitizeColor(el.style?.color || null);
      if (color) out.style.color = color;
      const fontSize = sanitizeFontSize(el.style?.fontSize || null);
      if (fontSize) out.style.fontSize = fontSize;
      const align = sanitizeTextAlign(el.style?.textAlign || el.getAttribute('align'));
      if (align) out.style.textAlign = align;
      if (tag === 'UL' || tag === 'OL' || tag === 'LI') {
        out.style.listStylePosition = 'inside';
      }
    }
    Array.from(el.childNodes).forEach((child) => {
      const c = clean(child);
      if (c) out.appendChild(c);
    });
    return out;
  };

  const result = doc.createElement('div');
  Array.from(root.childNodes).forEach((child) => {
    const c = clean(child);
    if (c) result.appendChild(c);
  });
  return result.innerHTML;
}

export function bodyToDisplayHtml(body: string): string {
  const raw = String(body || '');
  if (!raw.trim()) return '';
  return sanitizeCueCardHtml(looksLikeHtml(raw) ? raw : plainBodyToHtml(raw));
}

/** HTML (or plain) → short plain preview for the slide list. */
export function bodyToPlainPreview(body: string, maxLen = 48): string {
  const raw = String(body || '');
  if (!raw) return '';
  let text = raw;
  if (looksLikeHtml(raw)) {
    if (typeof document !== 'undefined') {
      const div = document.createElement('div');
      div.innerHTML = sanitizeCueCardHtml(raw);
      text = div.textContent || '';
    } else {
      text = raw.replace(/<[^>]+>/g, ' ');
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function mapApiDeck(row: any, comments: CueCardComment[] = []): CueCardDeck {
  const slides = Array.isArray(row?.slides) ? row.slides : [];
  const cueRanges = Array.isArray(row?.cue_ranges)
    ? row.cue_ranges
    : Array.isArray(row?.cueRanges)
      ? row.cueRanges
      : [];
  return {
    eventId: String(row?.event_id || row?.eventId || ''),
    title: String(row?.title || 'Cue Cards'),
    slides: slides.map((s: any) => ({
      id: String(s.id || newSlideId()),
      title: String(s.title || ''),
      body: String(s.body || ''),
      scrollerNote: s.scrollerNote ? String(s.scrollerNote) : undefined,
      bgColor: CUE_CARD_DEFAULT_BG,
      textColor: s.textColor ? String(s.textColor) : CUE_CARD_DEFAULT_TEXT,
    })),
    cueRanges: cueRanges.map((r: any) => ({
      id: String(r.id || newRangeId()),
      cueLabel: normalizeCueLabel(String(r.cueLabel || r.cue_label || '')),
      scheduleItemId:
        r.scheduleItemId != null
          ? Number(r.scheduleItemId)
          : r.schedule_item_id != null
            ? Number(r.schedule_item_id)
            : null,
      startIndex: Math.max(0, Number(r.startIndex ?? r.start_index ?? 0) || 0),
      endIndex: Math.max(0, Number(r.endIndex ?? r.end_index ?? 0) || 0),
    })),
    comments,
    updatedAt: row?.updated_at || row?.updatedAt || null,
    updatedBy: row?.updated_by || row?.updatedBy || null,
  };
}
