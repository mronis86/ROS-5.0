import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import {
  type CueCardComment,
  type CueCardCommentType,
  type CueCardDeck,
  type CueCardRange,
  type CueCardRole,
  type CueCardSlide,
  CUE_CARD_COMMENT_TYPES,
  CUE_CARD_DEFAULT_BG,
  CUE_CARD_DEFAULT_TEXT,
  bodyToDisplayHtml,
  bodyToPlainPreview,
  commentsForSlide,
  createEmptySlide,
  findRangeForSlide,
  looksLikeHtml,
  mapApiComment,
  mapApiDeck,
  newRangeId,
  normalizeCueLabel,
  plainBodyToHtml,
  sanitizeCueCardHtml,
} from '../lib/cueCards';

interface ScheduleCueOption {
  id: number;
  label: string;
  segmentName: string;
}

/** Font size options (px on the 1920×1080 stage). */
const FONT_SIZE_OPTIONS = [
  18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 108, 120, 144, 168, 192, 220, 260,
] as const;
const DEFAULT_FONT_SIZE_PX = 32;

function readSelectionFontSizePx(editor: HTMLElement | null): number | null {
  if (!editor) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const node =
    sel.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? (sel.anchorNode as HTMLElement)
      : sel.anchorNode?.parentElement;
  if (!node || !editor.contains(node)) return null;
  const raw = window.getComputedStyle(node).fontSize;
  const n = Math.round(parseFloat(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function saveEditorSelection(editor: HTMLElement | null): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

function restoreEditorSelection(editor: HTMLElement | null, range: Range | null) {
  if (!editor || !range) return;
  editor.focus();
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function AlignIcon({ mode }: { mode: 'left' | 'center' | 'right' }) {
  const lines =
    mode === 'left'
      ? [
          [2, 4, 14],
          [2, 8, 10],
          [2, 12, 14],
          [2, 16, 8],
        ]
      : mode === 'center'
        ? [
            [3, 4, 12],
            [5, 8, 8],
            [3, 12, 12],
            [6, 16, 6],
          ]
        : [
            [2, 4, 14],
            [6, 8, 10],
            [2, 12, 14],
            [8, 16, 8],
          ];
  return (
    <svg width="14" height="14" viewBox="0 0 18 20" aria-hidden className="block">
      {lines.map(([x, y, w], i) => (
        <rect key={i} x={x} y={y} width={w} height="2" rx="0.5" fill="currentColor" />
      ))}
    </svg>
  );
}

/** Keep list markers sized with text and glued to the line (works with center/right). */
function normalizeCueCardLists(root: HTMLElement) {
  root.querySelectorAll('ul, ol').forEach((list) => {
    const el = list as HTMLElement;
    el.style.listStylePosition = 'inside';
    el.style.paddingLeft = '0';
    el.style.marginLeft = '0';
  });
  root.querySelectorAll('li').forEach((item) => {
    const li = item as HTMLElement;
    li.style.listStylePosition = 'inside';
    // Marker inherits li font-size — pull size from nested span if present
    const sized = li.querySelector('span[style*="font-size"]') as HTMLElement | null;
    if (sized?.style.fontSize) {
      li.style.fontSize = sized.style.fontSize;
    }
  });
}

function FormatToolbar({
  editorRef,
  onBodyChange,
}: {
  editorRef: React.RefObject<HTMLDivElement | null>;
  onBodyChange?: (html: string) => void;
}) {
  const [currentSizePx, setCurrentSizePx] = useState<number | null>(DEFAULT_FONT_SIZE_PX);
  const savedSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    const sync = () => setCurrentSizePx(readSelectionFontSizePx(editorRef.current));
    document.addEventListener('selectionchange', sync);
    const el = editorRef.current;
    el?.addEventListener('keyup', sync);
    el?.addEventListener('mouseup', sync);
    el?.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('selectionchange', sync);
      el?.removeEventListener('keyup', sync);
      el?.removeEventListener('mouseup', sync);
      el?.removeEventListener('focus', sync);
    };
  }, [editorRef]);

  const persist = () => {
    const el = editorRef.current;
    if (!el) return;
    normalizeCueCardLists(el);
    onBodyChange?.(sanitizeCueCardHtml(el.innerHTML));
  };

  const run = (command: string, value?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* ignore unsupported commands */
    }
    persist();
  };

  /** Apply alignment to blocks AND list items so bullets stay with centered text. */
  const applyAlign = (command: 'justifyLeft' | 'justifyCenter' | 'justifyRight') => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const align =
      command === 'justifyCenter' ? 'center' : command === 'justifyRight' ? 'right' : 'left';
    try {
      document.execCommand(command);
    } catch {
      /* ignore */
    }
    // Ensure list containers inherit the same alignment (inside markers ride with the text)
    const sel = window.getSelection();
    const node =
      sel?.anchorNode &&
      (sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement);
    const list = node?.closest('ul, ol') as HTMLElement | null;
    const li = node?.closest('li') as HTMLElement | null;
    if (list) list.style.textAlign = align;
    if (li) {
      li.style.textAlign = align;
      li.style.listStylePosition = 'inside';
    }
    // If whole editor selection covers multiple lists, align all touched lists
    el.querySelectorAll('ul, ol').forEach((listEl) => {
      if (sel && sel.rangeCount && sel.getRangeAt(0).intersectsNode(listEl)) {
        (listEl as HTMLElement).style.textAlign = align;
        listEl.querySelectorAll('li').forEach((item) => {
          (item as HTMLElement).style.textAlign = align;
          (item as HTMLElement).style.listStylePosition = 'inside';
        });
      }
    });
    persist();
  };

  const insertList = (ordered: boolean) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();

    // Capture current alignment before list insert so markers stay with the text
    const sel = window.getSelection();
    const block =
      sel?.anchorNode &&
      (sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement);
    const priorAlign =
      (block?.closest('[style*="text-align"]') as HTMLElement | null)?.style.textAlign ||
      (block ? window.getComputedStyle(block).textAlign : 'left') ||
      'left';
    const align =
      priorAlign === 'center' || priorAlign === 'right' || priorAlign === 'left'
        ? priorAlign
        : 'left';

    try {
      document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
    } catch {
      /* ignore */
    }

    const after =
      sel?.anchorNode &&
      (sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement);
    const list = after?.closest('ul, ol') as HTMLElement | null;
    if (list) {
      list.style.textAlign = align;
      list.style.listStylePosition = 'inside';
      list.querySelectorAll('li').forEach((item) => {
        (item as HTMLElement).style.textAlign = align;
        (item as HTMLElement).style.listStylePosition = 'inside';
      });
    }
    normalizeCueCardLists(el);
    persist();
  };

  const applyFontSize = (px: string) => {
    const el = editorRef.current;
    if (!el) return;
    restoreEditorSelection(el, savedSelectionRef.current);
    el.focus();

    const sel = window.getSelection();
    const anchorLi =
      sel?.anchorNode &&
      (sel.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (sel.anchorNode as HTMLElement)
        : sel.anchorNode.parentElement
      )?.closest('li');

    try {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('fontSize', false, '7');
    } catch {
      /* ignore */
    }
    el.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement('span');
      span.style.fontSize = px;
      while (font.firstChild) span.appendChild(font.firstChild);
      font.parentNode?.replaceChild(span, font);
    });
    el.querySelectorAll('span[style*="font-size"]').forEach((span) => {
      const s = span as HTMLElement;
      if (s.style.fontSize === 'xxx-large' || s.style.fontSize === '-webkit-xxx-large') {
        s.style.fontSize = px;
      }
    });
    // Match bullet/number size to the line text
    if (anchorLi) {
      (anchorLi as HTMLElement).style.fontSize = px;
    } else {
      el.querySelectorAll('li').forEach((li) => {
        const sized = li.querySelector(`span[style*="font-size: ${px}"]`) as HTMLElement | null;
        if (sized) (li as HTMLElement).style.fontSize = px;
      });
    }
    setCurrentSizePx(Math.round(parseFloat(px)));
    savedSelectionRef.current = saveEditorSelection(el);
    persist();
  };

  const rememberSelection = () => {
    savedSelectionRef.current = saveEditorSelection(editorRef.current);
  };

  const btn =
    'rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700';
  const iconBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded border border-slate-500 text-slate-200 hover:bg-slate-700';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-700 bg-slate-900 px-3 py-2">
      <button type="button" onClick={() => run('bold')} className={`${btn} font-bold`} title="Bold">
        B
      </button>
      <button type="button" onClick={() => run('italic')} className={`${btn} italic`} title="Italic">
        I
      </button>
      <button type="button" onClick={() => run('underline')} className={`${btn} underline`} title="Underline">
        U
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden />
      <span className="mr-0.5 text-[10px] uppercase tracking-wide text-slate-500" title="Size of text at cursor">
        Size
      </span>
      <select
        value={
          currentSizePx != null && (FONT_SIZE_OPTIONS as readonly number[]).includes(currentSizePx)
            ? currentSizePx
            : ''
        }
        onMouseDown={rememberSelection}
        onFocus={rememberSelection}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n) || n <= 0) return;
          applyFontSize(`${n}px`);
        }}
        className="h-7 min-w-[4.75rem] rounded border border-slate-500 bg-slate-800 px-1.5 text-xs tabular-nums text-slate-100 outline-none hover:bg-slate-700 focus:border-slate-400"
        title="Font size"
      >
        {currentSizePx != null && !(FONT_SIZE_OPTIONS as readonly number[]).includes(currentSizePx) ? (
          <option value="">{currentSizePx}px</option>
        ) : null}
        {currentSizePx == null ? (
          <option value="" disabled>
            —
          </option>
        ) : null}
        {FONT_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}px
          </option>
        ))}
      </select>
      <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden />
      <button type="button" onClick={() => applyAlign('justifyLeft')} className={iconBtn} title="Align left">
        <AlignIcon mode="left" />
      </button>
      <button type="button" onClick={() => applyAlign('justifyCenter')} className={iconBtn} title="Align center">
        <AlignIcon mode="center" />
      </button>
      <button type="button" onClick={() => applyAlign('justifyRight')} className={iconBtn} title="Align right">
        <AlignIcon mode="right" />
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden />
      <button type="button" onClick={() => insertList(false)} className={btn} title="Bullet list">
        • List
      </button>
      <button type="button" onClick={() => insertList(true)} className={btn} title="Numbered list">
        1. List
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden />
      <button
        type="button"
        onClick={() => run('foreColor', '#ffffff')}
        className="h-6 w-6 rounded border border-slate-400 bg-white"
        title="White text"
      />
      <button
        type="button"
        onClick={() => run('foreColor', '#fbbf24')}
        className="h-6 w-6 rounded border border-slate-400 bg-amber-400"
        title="Amber text"
      />
      <button
        type="button"
        onClick={() => run('foreColor', '#60a5fa')}
        className="h-6 w-6 rounded border border-slate-400 bg-blue-400"
        title="Blue text"
      />
      <button
        type="button"
        onClick={() => run('foreColor', '#4ade80')}
        className="h-6 w-6 rounded border border-slate-400 bg-green-400"
        title="Green text"
      />
      <button
        type="button"
        onClick={() => run('foreColor', '#f472b6')}
        className="h-6 w-6 rounded border border-slate-400 bg-pink-400"
        title="Pink text"
      />
    </div>
  );
}

/** 16:9 stage — click/type on the card when editable. */
function SlideStage({
  slide,
  comments = [],
  showComments = true,
  editable = false,
  onBodyChange,
  bodyEditorRef,
  className = '',
}: {
  slide: CueCardSlide | null;
  comments?: CueCardComment[];
  showComments?: boolean;
  editable?: boolean;
  onBodyChange?: (html: string) => void;
  bodyEditorRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const localBodyRef = useRef<HTMLDivElement>(null);
  const bodyRef = bodyEditorRef || localBodyRef;

  useEffect(() => {
    if (!editable || !slide) return;
    const el = bodyRef.current;
    if (!el) return;
    const next = looksLikeHtml(slide.body)
      ? sanitizeCueCardHtml(slide.body)
      : plainBodyToHtml(slide.body);
    if (el.innerHTML !== next) {
      el.innerHTML = next || '';
    }
  }, [editable, slide?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!slide) {
    return (
      <div
        className={`flex items-center justify-center bg-black text-slate-400 ${className}`}
      >
        No slides yet — click + Add
      </div>
    );
  }

  const textColor = slide.textColor || CUE_CARD_DEFAULT_TEXT;
  const bodyHtml = bodyToDisplayHtml(slide.body);
  const bodyClass =
    'cue-card-body min-h-0 flex-1 overflow-y-auto px-8 py-6 text-[32px] leading-snug outline-none [&_p]:my-2';
  const visibleComments = showComments ? comments : [];
  const hasBottomChrome = visibleComments.length > 0;

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden ${className}`}
      style={{
        backgroundColor: CUE_CARD_DEFAULT_BG,
        color: textColor,
      }}
    >
      {editable ? (
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Click here and type…"
          onInput={(e) => {
            onBodyChange?.(
              sanitizeCueCardHtml((e.currentTarget as HTMLDivElement).innerHTML)
            );
          }}
          className={`${bodyClass} empty:before:pointer-events-none empty:before:text-white/30 empty:before:content-[attr(data-placeholder)] ${
            hasBottomChrome ? 'pb-48' : ''
          }`}
        />
      ) : bodyHtml ? (
        <div
          className={`${bodyClass} ${hasBottomChrome ? 'pb-48' : ''}`}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-slate-500">Empty slide</div>
      )}

      {/* Comment bars across the bottom as columns (Teleprompter-style, larger type) */}
      {hasBottomChrome ? (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 px-5 pb-5 pt-2">
          <div
            className="pointer-events-auto grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${Math.min(visibleComments.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {visibleComments.map((c) => {
              const meta = CUE_CARD_COMMENT_TYPES[c.type] || CUE_CARD_COMMENT_TYPES.GENERAL;
              return (
                <div
                  key={c.id}
                  className={`${meta.bgColor} max-h-56 overflow-y-auto rounded-xl border-l-8 px-5 py-4 shadow-xl ${meta.borderColor}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 text-5xl leading-none" aria-hidden>
                      {meta.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-2xl font-bold ${meta.color}`}>{meta.label}</div>
                      <div className="mt-2 whitespace-pre-wrap text-4xl font-semibold leading-tight text-white">
                        {c.text}
                      </div>
                      {c.author ? (
                        <div className="mt-2 text-lg text-white/70">{c.author}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const CUE_CARD_DESIGN_W = 1920;
const CUE_CARD_DESIGN_H = 1080;

/**
 * Always 16:9. Renders children at a fixed design size and scales to fit so
 * scroller edit and viewer preview stay 1:1 (fonts, layout, lists).
 */
function SixteenByNineFrame({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / CUE_CARD_DESIGN_W, h / CUE_CARD_DESIGN_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scaledW = CUE_CARD_DESIGN_W * scale;
  const scaledH = CUE_CARD_DESIGN_H * scale;
  const useZoom =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1');

  return (
    <div
      ref={outerRef}
      className={`grid min-h-0 flex-1 place-items-center overflow-hidden bg-zinc-950 ${
        padded ? 'p-3' : 'p-0'
      } ${className}`}
    >
      <div
        className={`relative overflow-hidden bg-black ${
          padded ? 'rounded-lg border border-slate-600 shadow-2xl' : ''
        }`}
        style={{ width: scaledW, height: scaledH }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={
            useZoom
              ? {
                  width: CUE_CARD_DESIGN_W,
                  height: CUE_CARD_DESIGN_H,
                  zoom: scale,
                }
              : {
                  width: CUE_CARD_DESIGN_W,
                  height: CUE_CARD_DESIGN_H,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const CueCardsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const eventId = searchParams.get('eventId') || '';
  const eventName = searchParams.get('eventName') || 'Event';

  const [role, setRole] = useState<CueCardRole>('SCROLLER');
  const [deck, setDeck] = useState<CueCardDeck | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [scheduleCues, setScheduleCues] = useState<ScheduleCueOption[]>([]);
  const [panel, setPanel] = useState<'edit' | 'cues' | 'comments'>('edit');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentType, setCommentType] = useState<CueCardCommentType>('GENERAL');
  const [viewerCommentTypes, setViewerCommentTypes] = useState<Set<CueCardCommentType>>(
    () => new Set(Object.keys(CUE_CARD_COMMENT_TYPES) as CueCardCommentType[])
  );
  /** Scroller has pushed the current slide to Clock / Fullscreen Timer */
  const [clockFeedActive, setClockFeedActive] = useState(false);
  const [rangeDraft, setRangeDraft] = useState({
    cueLabel: '',
    scheduleItemId: '' as string,
    startIndex: '1',
    endIndex: '1',
  });

  const roleRef = useRef(role);
  const slideIndexRef = useRef(slideIndex);
  const clockFeedActiveRef = useRef(clockFeedActive);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageBodyEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    slideIndexRef.current = slideIndex;
  }, [slideIndex]);
  useEffect(() => {
    clockFeedActiveRef.current = clockFeedActive;
  }, [clockFeedActive]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      /* user gesture / browser denied */
    }
  }, []);

  const goToScroller = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
    setRole('SCROLLER');
  }, []);

  const slides = deck?.slides || [];
  const currentSlide = slides[slideIndex] || null;
  const activeRange = findRangeForSlide(deck?.cueRanges || [], slideIndex);
  const slideComments = commentsForSlide(deck?.comments || [], currentSlide?.id);
  const viewerVisibleComments = useMemo(
    () => slideComments.filter((c) => viewerCommentTypes.has(c.type)),
    [slideComments, viewerCommentTypes]
  );

  const toggleViewerCommentType = useCallback((t: CueCardCommentType) => {
    setViewerCommentTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const setAllViewerCommentTypes = useCallback((on: boolean) => {
    setViewerCommentTypes(
      on
        ? new Set(Object.keys(CUE_CARD_COMMENT_TYPES) as CueCardCommentType[])
        : new Set()
    );
  }, []);

  const authorName = useMemo(
    () => user?.full_name || user?.email || 'Operator',
    [user]
  );

  const loadDeck = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/cue-cards/${encodeURIComponent(eventId)}`, {
        headers: apiJsonHeaders(),
      });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const data = await res.json();
      const comments = Array.isArray(data.comments)
        ? data.comments.map(mapApiComment)
        : [];
      const mapped = mapApiDeck(data.deck || {}, comments);
      setDeck(mapped);
      setSlideIndex((i) => Math.min(i, Math.max(0, mapped.slides.length - 1)));
    } catch (e: any) {
      setError(e?.message || 'Failed to load cue cards');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const loadScheduleCues = useCallback(async () => {
    if (!eventId) return;
    try {
      const data = await DatabaseService.getRunOfShowData(eventId);
      const items = Array.isArray(data?.schedule_items) ? data.schedule_items : [];
      const opts: ScheduleCueOption[] = [];
      for (const item of items) {
        const raw = item?.customFields?.cue ?? item?.cue;
        const label = normalizeCueLabel(String(raw || '').trim());
        if (!label) continue;
        opts.push({
          id: Number(item.id),
          label,
          segmentName: String(item.segmentName || item.segment_name || ''),
        });
      }
      setScheduleCues(opts);
    } catch {
      setScheduleCues([]);
    }
  }, [eventId]);

  useEffect(() => {
    void loadDeck();
    void loadScheduleCues();
  }, [loadDeck, loadScheduleCues]);

  const persistDeck = useCallback(
    async (next: CueCardDeck, broadcast = true) => {
      if (!eventId) return;
      setSaving(true);
      try {
        const savedSlides = next.slides.map((s) => ({
          ...s,
          bgColor: CUE_CARD_DEFAULT_BG,
          textColor: s.textColor || CUE_CARD_DEFAULT_TEXT,
          body: sanitizeCueCardHtml(
            looksLikeHtml(s.body) ? s.body : plainBodyToHtml(s.body)
          ),
        }));
        const res = await fetch(`${getApiBaseUrl()}/api/cue-cards/${encodeURIComponent(eventId)}`, {
          method: 'PUT',
          headers: apiJsonHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            title: next.title,
            slides: savedSlides,
            cueRanges: next.cueRanges,
            updatedBy: authorName,
          }),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        if (broadcast) {
          socketClient.emitCueCardsDeck({
            title: next.title,
            slides: savedSlides,
            cueRanges: next.cueRanges,
          });
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [authorName, eventId]
  );

  const schedulePersist = useCallback(
    (next: CueCardDeck) => {
      setDeck(next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistDeck(next);
      }, 600);
    },
    [persistDeck]
  );

  const goToSlide = useCallback(
    (index: number, broadcast = true) => {
      if (!deck || deck.slides.length === 0) return;
      const clamped = Math.max(0, Math.min(deck.slides.length - 1, index));
      setSlideIndex(clamped);
      if (broadcast && roleRef.current === 'SCROLLER') {
        const slide = deck.slides[clamped];
        socketClient.emitCueCardsSlide(clamped, slide?.id);
        // Keep Clock / Fullscreen Timer in sync while feed is live
        if (clockFeedActiveRef.current && slide) {
          const comments = commentsForSlide(deck.comments || [], slide.id);
          socketClient.emitCueCardsClock({
            enabled: true,
            slideIndex: clamped,
            slide,
            comments,
          });
        }
      }
    },
    [deck]
  );

  const sendCurrentSlideToClock = useCallback(() => {
    if (!deck || !currentSlide) return;
    const comments = commentsForSlide(deck.comments || [], currentSlide.id);
    socketClient.emitCueCardsClock({
      enabled: true,
      slideIndex,
      slide: currentSlide,
      comments,
    });
    setClockFeedActive(true);
  }, [deck, currentSlide, slideIndex]);

  const clearSlideFromClock = useCallback(() => {
    socketClient.emitCueCardsClock({ enabled: false });
    setClockFeedActive(false);
  }, []);

  // Socket connect + sync
  useEffect(() => {
    if (!eventId) return;
    socketClient.connect(eventId, {});
    const socket = socketClient.getSocket();
    if (!socket) return;

    const onSlideSync = (data: any) => {
      if (!data || String(data.eventId) !== String(eventId)) return;
      if (roleRef.current !== 'VIEWER') return;
      if (typeof data.slideIndex === 'number') {
        setSlideIndex(data.slideIndex);
      }
    };
    const onDeckSync = (data: any) => {
      if (!data || String(data.eventId) !== String(eventId)) return;
      if (roleRef.current === 'SCROLLER') return;
      setDeck((prev) => {
        if (!prev) return prev;
        const incoming = data.deck || {};
        return {
          ...prev,
          title: incoming.title ?? prev.title,
          slides: Array.isArray(incoming.slides) ? incoming.slides : prev.slides,
          cueRanges: Array.isArray(incoming.cueRanges)
            ? incoming.cueRanges
            : Array.isArray(incoming.cue_ranges)
              ? incoming.cue_ranges
              : prev.cueRanges,
        };
      });
    };
    const onCommentSync = (data: any) => {
      if (!data || String(data.eventId) !== String(eventId)) return;
      setDeck((prev) => {
        if (!prev) return prev;
        const action = data.action;
        if (action === 'add' && data.comment) {
          const c = mapApiComment(data.comment);
          if (prev.comments.some((x) => x.id === c.id)) return prev;
          return { ...prev, comments: [...prev.comments, c] };
        }
        if (action === 'edit' && data.comment) {
          const c = mapApiComment(data.comment);
          return {
            ...prev,
            comments: prev.comments.map((x) => (x.id === c.id ? c : x)),
          };
        }
        if (action === 'delete' && data.commentId) {
          return {
            ...prev,
            comments: prev.comments.filter((x) => x.id !== String(data.commentId)),
          };
        }
        return prev;
      });
    };

    socket.on('cueCardsSlideSync', onSlideSync);
    socket.on('cueCardsDeckSync', onDeckSync);
    socket.on('cueCardsCommentSync', onCommentSync);
    return () => {
      socket.off('cueCardsSlideSync', onSlideSync);
      socket.off('cueCardsDeckSync', onDeckSync);
      socket.off('cueCardsCommentSync', onCommentSync);
    };
  }, [eventId]);

  // Keyboard — scroller + viewer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (el?.isContentEditable) return;

      if (e.key === 'Escape') {
        if (document.fullscreenElement) {
          e.preventDefault();
          void document.exitFullscreen?.();
          return;
        }
        if (role === 'VIEWER') {
          e.preventDefault();
          goToScroller();
        }
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        if (role !== 'VIEWER') return;
        e.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (role === 'VIEWER' && e.key === ' ')) {
        e.preventDefault();
        goToSlide(slideIndexRef.current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToSlide(slideIndexRef.current - 1);
      } else if (role === 'SCROLLER' && e.key === ' ') {
        e.preventDefault();
        goToSlide(slideIndexRef.current + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, goToSlide, toggleFullscreen, goToScroller]);

  const updateCurrentSlide = (patch: Partial<CueCardSlide>) => {
    if (!deck || !currentSlide) return;
    const nextSlides = deck.slides.map((s, i) =>
      i === slideIndex
        ? {
            ...s,
            ...patch,
            bgColor: CUE_CARD_DEFAULT_BG,
          }
        : s
    );
    schedulePersist({ ...deck, slides: nextSlides });
  };

  const addSlide = () => {
    if (!deck) return;
    const slide = createEmptySlide({ title: `Slide ${deck.slides.length + 1}` });
    const next = { ...deck, slides: [...deck.slides, slide] };
    schedulePersist(next);
    setTimeout(() => goToSlide(next.slides.length - 1), 0);
  };

  const deleteSlide = () => {
    if (!deck || !currentSlide) return;
    if (!window.confirm('Delete this slide?')) return;
    const nextSlides = deck.slides.filter((_, i) => i !== slideIndex);
    const nextRanges = deck.cueRanges
      .map((r) => {
        let { startIndex, endIndex } = r;
        if (slideIndex < startIndex) {
          startIndex -= 1;
          endIndex -= 1;
        } else if (slideIndex <= endIndex) {
          endIndex -= 1;
        }
        return { ...r, startIndex: Math.max(0, startIndex), endIndex: Math.max(0, endIndex) };
      })
      .filter((r) => r.endIndex >= r.startIndex && nextSlides.length > 0);
    const nextComments = deck.comments.filter((c) => c.slideId !== currentSlide.id);
    const next = { ...deck, slides: nextSlides, cueRanges: nextRanges, comments: nextComments };
    schedulePersist(next);
    setSlideIndex((i) => Math.max(0, Math.min(i, nextSlides.length - 1)));
  };

  const duplicateSlide = () => {
    if (!deck || !currentSlide) return;
    const copy = createEmptySlide({
      title: currentSlide.title ? `${currentSlide.title} (copy)` : 'Untitled',
      body: currentSlide.body,
      scrollerNote: currentSlide.scrollerNote,
      bgColor: currentSlide.bgColor,
      textColor: currentSlide.textColor,
    });
    const nextSlides = [
      ...deck.slides.slice(0, slideIndex + 1),
      copy,
      ...deck.slides.slice(slideIndex + 1),
    ];
    const nextRanges = deck.cueRanges.map((r) => {
      if (slideIndex < r.startIndex) {
        return { ...r, startIndex: r.startIndex + 1, endIndex: r.endIndex + 1 };
      }
      if (slideIndex <= r.endIndex) {
        return { ...r, endIndex: r.endIndex + 1 };
      }
      return r;
    });
    schedulePersist({ ...deck, slides: nextSlides, cueRanges: nextRanges });
    setTimeout(() => goToSlide(slideIndex + 1), 0);
  };

  const moveSlide = (direction: -1 | 1) => {
    if (!deck || !currentSlide) return;
    const from = slideIndex;
    const to = from + direction;
    if (to < 0 || to >= deck.slides.length) return;
    const nextSlides = [...deck.slides];
    const [item] = nextSlides.splice(from, 1);
    nextSlides.splice(to, 0, item);
    schedulePersist({ ...deck, slides: nextSlides });
    setSlideIndex(to);
    if (roleRef.current === 'SCROLLER') {
      socketClient.emitCueCardsSlide(to, item?.id);
    }
  };

  const addCueRange = () => {
    if (!deck) return;
    const start = Math.max(1, parseInt(rangeDraft.startIndex, 10) || 1) - 1;
    const end = Math.max(start, (parseInt(rangeDraft.endIndex, 10) || 1) - 1);
    const max = Math.max(0, deck.slides.length - 1);
    const range: CueCardRange = {
      id: newRangeId(),
      cueLabel: normalizeCueLabel(rangeDraft.cueLabel),
      scheduleItemId: rangeDraft.scheduleItemId
        ? Number(rangeDraft.scheduleItemId)
        : null,
      startIndex: Math.min(start, max),
      endIndex: Math.min(end, max),
    };
    if (!range.cueLabel) {
      alert('Pick or enter a cue label');
      return;
    }
    schedulePersist({ ...deck, cueRanges: [...deck.cueRanges, range] });
    setRangeDraft({ cueLabel: '', scheduleItemId: '', startIndex: '1', endIndex: '1' });
  };

  const removeCueRange = (id: string) => {
    if (!deck) return;
    schedulePersist({
      ...deck,
      cueRanges: deck.cueRanges.filter((r) => r.id !== id),
    });
  };

  const jumpToCueRange = (range: CueCardRange) => {
    goToSlide(range.startIndex);
  };

  const addComment = async () => {
    if (!eventId || !currentSlide || !commentDraft.trim()) return;
    try {
      const res = await fetch(
        `${getApiBaseUrl()}/api/cue-cards/${encodeURIComponent(eventId)}/comments`,
        {
          method: 'POST',
          headers: apiJsonHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            slideId: currentSlide.id,
            text: commentDraft.trim(),
            type: commentType,
            author: authorName,
          }),
        }
      );
      if (!res.ok) throw new Error('Could not add comment');
      const row = await res.json();
      const mapped = mapApiComment(row);
      setDeck((prev) =>
        prev ? { ...prev, comments: [...prev.comments, mapped] } : prev
      );
      socketClient.emitCueCardsComment('add', row);
      setCommentDraft('');
    } catch (e: any) {
      alert(e?.message || 'Failed to add comment');
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!eventId) return;
    try {
      await fetch(
        `${getApiBaseUrl()}/api/cue-cards/${encodeURIComponent(eventId)}/comments/${commentId}`,
        { method: 'DELETE', headers: apiJsonHeaders() }
      );
      setDeck((prev) =>
        prev
          ? { ...prev, comments: prev.comments.filter((c) => c.id !== commentId) }
          : prev
      );
      socketClient.emitCueCardsComment('delete', undefined, commentId);
    } catch {
      alert('Failed to delete comment');
    }
  };

  if (!eventId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        Open Cue Cards from an event (missing eventId).
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-300">
        Loading Cue Cards…
      </div>
    );
  }

  // VIEWER: same 16:9 design canvas as scroller (1:1), with clear exit chrome
  if (role === 'VIEWER') {
    return (
      <div className="relative flex h-screen flex-col bg-black">
        {!isFullscreen ? (
          <header className="z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700 bg-slate-900/95 px-3 py-2">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
              onClick={goToScroller}
            >
              ← Back to Scroller
            </button>
            <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
                onClick={goToScroller}
              >
                Scroller
              </button>
              <button
                type="button"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white"
              >
                Viewer
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold hover:bg-slate-600 disabled:opacity-40"
                onClick={() => goToSlide(slideIndex - 1)}
                disabled={slideIndex <= 0}
              >
                ←
              </button>
              <span className="min-w-[4.5rem] text-center text-sm font-mono text-slate-200">
                {slides.length ? `${slideIndex + 1}/${slides.length}` : '0/0'}
              </span>
              <button
                type="button"
                className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold hover:bg-slate-600 disabled:opacity-40"
                onClick={() => goToSlide(slideIndex + 1)}
                disabled={slideIndex >= slides.length - 1}
              >
                →
              </button>
              {activeRange ? (
                <span className="rounded bg-yellow-700/80 px-2 py-1 text-xs font-bold text-yellow-50">
                  {activeRange.cueLabel}
                </span>
              ) : null}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Comments
                </span>
                <button
                  type="button"
                  onClick={() => setAllViewerCommentTypes(true)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setAllViewerCommentTypes(false)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
                >
                  None
                </button>
                {(Object.keys(CUE_CARD_COMMENT_TYPES) as CueCardCommentType[]).map((t) => {
                  const meta = CUE_CARD_COMMENT_TYPES[t];
                  const on = viewerCommentTypes.has(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleViewerCommentType(t)}
                      title={`${on ? 'Hide' : 'Show'} ${meta.label}`}
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        on
                          ? `${meta.bgColor} text-white`
                          : 'bg-slate-800 text-slate-500 line-through'
                      }`}
                    >
                      {meta.icon} {meta.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                className="rounded border border-slate-500 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                title="Fullscreen (F)"
              >
                Fullscreen
              </button>
              <span className="hidden text-[11px] text-slate-500 sm:inline">Esc = Scroller</span>
              <Link
                to={`/run-of-show?eventId=${encodeURIComponent(eventId)}`}
                className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Exit to Run of Show
              </Link>
            </div>
          </header>
        ) : (
          <div className="absolute inset-x-0 top-0 z-20 flex h-auto flex-wrap items-start justify-end gap-2 p-3 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-600 bg-slate-900/95 px-2 py-1">
              {(Object.keys(CUE_CARD_COMMENT_TYPES) as CueCardCommentType[]).map((t) => {
                const meta = CUE_CARD_COMMENT_TYPES[t];
                const on = viewerCommentTypes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleViewerCommentType(t)}
                    title={`${on ? 'Hide' : 'Show'} ${meta.label}`}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                      on ? `${meta.bgColor} text-white` : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {meta.icon}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="rounded bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => void toggleFullscreen()}
            >
              Exit fullscreen (Esc)
            </button>
          </div>
        )}
        <SixteenByNineFrame padded={!isFullscreen} className="bg-black">
          <SlideStage
            key={currentSlide?.id || 'empty'}
            slide={currentSlide}
            comments={viewerVisibleComments}
            className="h-full w-full"
          />
        </SixteenByNineFrame>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-900 px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{eventName}</div>
          <div className="text-xs text-slate-400">
            Cue Cards · {saving ? 'Saving…' : 'Ready'}
            {error ? <span className="text-red-400"> · {error}</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold"
          >
            Scroller
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            onClick={() => setRole('VIEWER')}
          >
            Viewer
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold hover:bg-slate-600"
            onClick={() => goToSlide(slideIndex - 1)}
            disabled={slideIndex <= 0}
          >
            ←
          </button>
          <span className="min-w-[4.5rem] text-center text-sm font-mono text-slate-200">
            {slides.length ? `${slideIndex + 1}/${slides.length}` : '0/0'}
          </span>
          <button
            type="button"
            className="rounded bg-slate-700 px-3 py-1.5 text-sm font-semibold hover:bg-slate-600"
            onClick={() => goToSlide(slideIndex + 1)}
            disabled={slideIndex >= slides.length - 1}
          >
            →
          </button>
          {activeRange ? (
            <span className="rounded bg-yellow-700/80 px-2 py-1 text-xs font-bold text-yellow-50">
              {activeRange.cueLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={sendCurrentSlideToClock}
          disabled={!currentSlide}
          className={`rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
            clockFeedActive
              ? 'border border-emerald-400 bg-emerald-700 text-white hover:bg-emerald-600'
              : 'border border-emerald-600 bg-slate-800 text-emerald-200 hover:bg-slate-700'
          }`}
          title="Show this slide on Clock / Fullscreen Timer (timers stay visible)"
        >
          {clockFeedActive ? 'On Clock · Update' : 'Send to Clock'}
        </button>
        {clockFeedActive ? (
          <button
            type="button"
            onClick={clearSlideFromClock}
            className="rounded border border-red-700/70 bg-red-950/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/50"
            title="Clear cue card from Clock displays"
          >
            Clear Clock
          </button>
        ) : null}
        <Link
          to={`/run-of-show?eventId=${encodeURIComponent(eventId)}`}
          className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Exit to Run of Show
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: slide list */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-slate-700 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Slides
            </span>
            <button
              type="button"
              onClick={addSlide}
              className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold hover:bg-blue-500"
            >
              + Add
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {slides.map((s, i) => {
              const range = findRangeForSlide(deck?.cueRanges || [], i);
              const hasComments = (deck?.comments || []).some((c) => c.slideId === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goToSlide(i)}
                  className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                    i === slideIndex
                      ? 'border-blue-400 bg-blue-950/60'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-slate-400">{i + 1}</span>
                    {hasComments ? <span title="Has comments">💬</span> : null}
                  </div>
                  <div className="truncate font-semibold text-slate-100">
                    {s.title?.trim() || `Slide ${i + 1}`}
                  </div>
                  {bodyToPlainPreview(s.body) ? (
                    <div className="mt-0.5 truncate text-[10px] text-slate-400">
                      {bodyToPlainPreview(s.body)}
                    </div>
                  ) : null}
                  {range ? (
                    <div className="mt-0.5 truncate text-[10px] text-yellow-300">
                      {range.cueLabel}
                    </div>
                  ) : null}
                </button>
              );
            })}
            {slides.length === 0 ? (
              <p className="px-1 py-4 text-center text-xs text-slate-500">
                Add a slide to start
              </p>
            ) : null}
          </div>
        </aside>

        {/* Center stage — type on the 16:9 card */}
        <main className="flex min-w-0 flex-1 flex-col border-b border-slate-800 bg-black">
          <FormatToolbar
            editorRef={stageBodyEditorRef}
            onBodyChange={(body) => updateCurrentSlide({ body })}
          />
          <SixteenByNineFrame>
            <SlideStage
              key={currentSlide?.id || 'empty'}
              slide={currentSlide}
              comments={slideComments}
              editable
              bodyEditorRef={stageBodyEditorRef}
              onBodyChange={(body) => updateCurrentSlide({ body })}
              className="h-full w-full"
            />
          </SixteenByNineFrame>
        </main>

        {/* Right tools */}
        <aside className="flex w-[22rem] shrink-0 flex-col border-l border-slate-700 bg-slate-900">
          <div className="flex border-b border-slate-700">
            {(
              [
                ['edit', 'Edit'],
                ['cues', 'Cue groups'],
                ['comments', 'Comments'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                className={`flex-1 px-2 py-2 text-xs font-semibold ${
                  panel === id
                    ? 'border-b-2 border-blue-400 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
                {id === 'comments' && slideComments.length
                  ? ` (${slideComments.length})`
                  : ''}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {panel === 'edit' && currentSlide ? (
              <div className="space-y-3">
                <label className="block text-xs text-slate-400">
                  Slide label
                  <span className="ml-1 font-normal text-slate-500">(list only — not on card)</span>
                  <input
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
                    value={currentSlide.title}
                    onChange={(e) => updateCurrentSlide({ title: e.target.value })}
                    placeholder={`Slide ${slideIndex + 1}`}
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Type on the card. Select text, then use the toolbar for size, alignment,
                  bold/italic, lists, and color.
                </p>
                <label className="block text-xs text-slate-400">
                  Scroller-only note
                  <span className="ml-1 font-normal text-slate-500">(panel only — not on card)</span>
                  <textarea
                    className="mt-1 min-h-[4rem] w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-amber-100"
                    value={currentSlide.scrollerNote || ''}
                    onChange={(e) =>
                      updateCurrentSlide({ scrollerNote: e.target.value })
                    }
                    placeholder="Operator note — never shown on the cue slide"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => moveSlide(-1)}
                    disabled={slideIndex <= 0}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSlide(1)}
                    disabled={slideIndex >= slides.length - 1}
                    className="rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                  >
                    Move down
                  </button>
                </div>
                <button
                  type="button"
                  onClick={duplicateSlide}
                  className="w-full rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700"
                >
                  Duplicate slide
                </button>
                <button
                  type="button"
                  onClick={deleteSlide}
                  className="w-full rounded border border-red-700/60 bg-red-950/40 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-900/50"
                >
                  Delete slide
                </button>
              </div>
            ) : null}

            {panel === 'edit' && !currentSlide ? (
              <p className="text-sm text-slate-500">Add a slide to edit.</p>
            ) : null}

            {panel === 'cues' ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">
                  Map slide number ranges to ROS cues (e.g. slides 1–3 → CUE 2).
                </p>
                <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-800/40 p-2">
                  <label className="block text-xs text-slate-400">
                    Cue from schedule
                    <select
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm"
                      value={rangeDraft.scheduleItemId}
                      onChange={(e) => {
                        const id = e.target.value;
                        const opt = scheduleCues.find((c) => String(c.id) === id);
                        setRangeDraft((d) => ({
                          ...d,
                          scheduleItemId: id,
                          cueLabel: opt?.label || d.cueLabel,
                        }));
                      }}
                    >
                      <option value="">Custom / type below</option>
                      {scheduleCues.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                          {c.segmentName ? ` — ${c.segmentName}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-400">
                    Cue label
                    <input
                      className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm"
                      value={rangeDraft.cueLabel}
                      onChange={(e) =>
                        setRangeDraft((d) => ({ ...d, cueLabel: e.target.value }))
                      }
                      placeholder="CUE 2"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-slate-400">
                      Start slide #
                      <input
                        type="number"
                        min={1}
                        className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm"
                        value={rangeDraft.startIndex}
                        onChange={(e) =>
                          setRangeDraft((d) => ({ ...d, startIndex: e.target.value }))
                        }
                      />
                    </label>
                    <label className="block text-xs text-slate-400">
                      End slide #
                      <input
                        type="number"
                        min={1}
                        className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm"
                        value={rangeDraft.endIndex}
                        onChange={(e) =>
                          setRangeDraft((d) => ({ ...d, endIndex: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={addCueRange}
                    className="w-full rounded bg-yellow-700 px-3 py-1.5 text-sm font-bold hover:bg-yellow-600"
                  >
                    Add cue group
                  </button>
                </div>
                <ul className="space-y-2">
                  {(deck?.cueRanges || []).map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-yellow-700/40 bg-yellow-950/30 px-2 py-2"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => jumpToCueRange(r)}
                      >
                        <div className="text-sm font-bold text-yellow-100">{r.cueLabel}</div>
                        <div className="text-xs text-yellow-200/80">
                          Slides {r.startIndex + 1}–{r.endIndex + 1}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="text-xs font-bold text-red-300"
                        onClick={() => removeCueRange(r.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                  {(deck?.cueRanges || []).length === 0 ? (
                    <li className="text-xs text-slate-500">No cue groups yet.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {panel === 'comments' ? (
              <div className="space-y-3">
                {!currentSlide ? (
                  <p className="text-sm text-slate-500">Select a slide first.</p>
                ) : (
                  <>
                    <p className="text-xs text-slate-400">
                      Comments appear on the card (like Teleprompter) for scroller and
                      viewer. Same types as Scripts Follow.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(CUE_CARD_COMMENT_TYPES) as CueCardCommentType[]).map(
                        (t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setCommentType(t)}
                            className={`rounded px-2 py-1 text-[11px] font-semibold ${
                              commentType === t
                                ? `${CUE_CARD_COMMENT_TYPES[t].bgColor} text-white`
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {CUE_CARD_COMMENT_TYPES[t].icon}{' '}
                            {CUE_CARD_COMMENT_TYPES[t].label}
                          </button>
                        )
                      )}
                    </div>
                    <textarea
                      className="min-h-[5rem] w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Add a comment for this slide…"
                    />
                    <button
                      type="button"
                      onClick={() => void addComment()}
                      className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-bold hover:bg-blue-500"
                    >
                      Add comment
                    </button>
                    <ul className="space-y-2">
                      {slideComments.map((c: CueCardComment) => {
                        const meta = CUE_CARD_COMMENT_TYPES[c.type] || CUE_CARD_COMMENT_TYPES.GENERAL;
                        return (
                          <li
                            key={c.id}
                            className="rounded-lg border border-slate-700 bg-slate-800/60 px-2 py-2"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${meta.bgColor}`}
                              >
                                {meta.icon} {meta.label}
                              </span>
                              <button
                                type="button"
                                className="text-xs text-red-300"
                                onClick={() => void deleteComment(c.id)}
                              >
                                Delete
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-slate-100">
                              {c.text}
                            </p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {c.author}
                            </p>
                          </li>
                        );
                      })}
                      {slideComments.length === 0 ? (
                        <li className="text-xs text-slate-500">No comments on this slide.</li>
                      ) : null}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default CueCardsPage;
