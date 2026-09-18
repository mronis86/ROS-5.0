import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  commentsForSlide,
  createEmptySlide,
  findRangeForSlide,
  mapApiComment,
  mapApiDeck,
  newRangeId,
  normalizeCueLabel,
} from '../lib/cueCards';

interface ScheduleCueOption {
  id: number;
  label: string;
  segmentName: string;
}

function SlideStage({
  slide,
  showScrollerNote,
  className = '',
}: {
  slide: CueCardSlide | null;
  showScrollerNote?: boolean;
  className?: string;
}) {
  if (!slide) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-950 text-slate-400 ${className}`}
      >
        No slides yet
      </div>
    );
  }
  return (
    <div
      className={`relative flex flex-col justify-center overflow-hidden px-8 py-10 text-center ${className}`}
      style={{
        backgroundColor: slide.bgColor || '#0f172a',
        color: slide.textColor || '#f8fafc',
      }}
    >
      {slide.title ? (
        <h1 className="mb-4 text-3xl font-bold leading-tight md:text-5xl lg:text-6xl">
          {slide.title}
        </h1>
      ) : null}
      {slide.body ? (
        <div className="mx-auto max-w-5xl whitespace-pre-wrap text-left text-lg leading-relaxed md:text-2xl lg:text-3xl">
          {slide.body}
        </div>
      ) : !slide.title ? (
        <p className="text-slate-400">Empty slide</p>
      ) : null}
      {showScrollerNote && slide.scrollerNote ? (
        <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-amber-500/40 bg-black/55 px-3 py-2 text-left text-sm text-amber-100">
          <span className="font-semibold text-amber-300">Scroller: </span>
          {slide.scrollerNote}
        </div>
      ) : null}
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
  const [scheduleCues, setScheduleCues] = useState<ScheduleCueOption[]>([]);
  const [panel, setPanel] = useState<'edit' | 'cues' | 'comments'>('edit');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentType, setCommentType] = useState<CueCardCommentType>('GENERAL');
  const [rangeDraft, setRangeDraft] = useState({
    cueLabel: '',
    scheduleItemId: '' as string,
    startIndex: '1',
    endIndex: '1',
  });

  const roleRef = useRef(role);
  const slideIndexRef = useRef(slideIndex);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    slideIndexRef.current = slideIndex;
  }, [slideIndex]);

  const slides = deck?.slides || [];
  const currentSlide = slides[slideIndex] || null;
  const activeRange = findRangeForSlide(deck?.cueRanges || [], slideIndex);
  const slideComments = commentsForSlide(deck?.comments || [], currentSlide?.id);

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
        const res = await fetch(`${getApiBaseUrl()}/api/cue-cards/${encodeURIComponent(eventId)}`, {
          method: 'PUT',
          headers: apiJsonHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            title: next.title,
            slides: next.slides,
            cueRanges: next.cueRanges,
            updatedBy: authorName,
          }),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        if (broadcast) {
          socketClient.emitCueCardsDeck({
            title: next.title,
            slides: next.slides,
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
      }
    },
    [deck]
  );

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

  // Keyboard for scroller
  useEffect(() => {
    if (role !== 'SCROLLER') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goToSlide(slideIndexRef.current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToSlide(slideIndexRef.current - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, goToSlide]);

  const updateCurrentSlide = (patch: Partial<CueCardSlide>) => {
    if (!deck || !currentSlide) return;
    const nextSlides = deck.slides.map((s, i) =>
      i === slideIndex ? { ...s, ...patch } : s
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

  // VIEWER: full-bleed only
  if (role === 'VIEWER') {
    return (
      <div className="relative flex h-screen flex-col bg-black">
        <div className="absolute right-3 top-3 z-20 flex gap-2 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            className="rounded bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-white"
            onClick={() => setRole('SCROLLER')}
          >
            Switch to Scroller
          </button>
        </div>
        <SlideStage slide={currentSlide} className="h-full w-full" />
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/40 px-2 py-1 text-xs text-white/70">
          {slides.length ? `${slideIndex + 1} / ${slides.length}` : '0'}
          {activeRange ? ` · ${activeRange.cueLabel}` : ''}
        </div>
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
                    {s.title || 'Untitled'}
                  </div>
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

        {/* Center stage */}
        <main className="flex min-w-0 flex-1 flex-col">
          <SlideStage
            slide={currentSlide}
            showScrollerNote
            className="min-h-0 flex-1 border-b border-slate-800"
          />
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
                  Title
                  <input
                    className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
                    value={currentSlide.title}
                    onChange={(e) => updateCurrentSlide({ title: e.target.value })}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Body
                  <textarea
                    className="mt-1 min-h-[10rem] w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
                    value={currentSlide.body}
                    onChange={(e) => updateCurrentSlide({ body: e.target.value })}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Scroller-only note
                  <textarea
                    className="mt-1 min-h-[4rem] w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-amber-100"
                    value={currentSlide.scrollerNote || ''}
                    onChange={(e) =>
                      updateCurrentSlide({ scrollerNote: e.target.value })
                    }
                    placeholder="Not shown on Viewer"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-400">
                    Background
                    <input
                      type="color"
                      className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-600 bg-slate-800"
                      value={currentSlide.bgColor || '#0f172a'}
                      onChange={(e) => updateCurrentSlide({ bgColor: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-slate-400">
                    Text
                    <input
                      type="color"
                      className="mt-1 h-9 w-full cursor-pointer rounded border border-slate-600 bg-slate-800"
                      value={currentSlide.textColor || '#f8fafc'}
                      onChange={(e) => updateCurrentSlide({ textColor: e.target.value })}
                    />
                  </label>
                </div>
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
                      Same comment types as Scripts Follow / Teleprompter — attached to
                      this slide.
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
