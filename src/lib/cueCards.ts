/** Cue Cards — web slides grouped by ROS cues, with Scripts Follow–style comments. */

export type CueCardCommentType = 'GENERAL' | 'CUE' | 'AUDIO' | 'GFX' | 'VIDEO' | 'LIGHTING';

export type CueCardRole = 'SCROLLER' | 'VIEWER';

export interface CueCardSlide {
  id: string;
  title: string;
  /** Main slide body — plain text; newlines preserved */
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
  { label: string; color: string; bgColor: string; icon: string }
> = {
  GENERAL: { label: 'General', color: 'text-slate-300', bgColor: 'bg-slate-600', icon: '💬' },
  CUE: { label: 'Cue', color: 'text-yellow-300', bgColor: 'bg-yellow-600', icon: '🎬' },
  AUDIO: { label: 'Audio', color: 'text-green-300', bgColor: 'bg-green-600', icon: '🎵' },
  GFX: { label: 'GFX', color: 'text-purple-300', bgColor: 'bg-purple-600', icon: '🎨' },
  VIDEO: { label: 'Video', color: 'text-red-300', bgColor: 'bg-red-600', icon: '📹' },
  LIGHTING: { label: 'Lighting', color: 'text-orange-300', bgColor: 'bg-orange-600', icon: '💡' },
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
    bgColor: '#0f172a',
    textColor: '#f8fafc',
    ...partial,
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
      bgColor: s.bgColor ? String(s.bgColor) : '#0f172a',
      textColor: s.textColor ? String(s.textColor) : '#f8fafc',
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
