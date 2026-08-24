import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchGuestEvent,
  formatGuestDuration,
  GUEST_PROGRAM_TYPE_COLORS,
  stripHtmlNotes,
  type GuestEventPayload,
  type GuestScheduleItem,
} from '../lib/eventGuestLinks';
import { findParentScheduleIndex, isIndentedScheduleItem } from '../lib/scheduleStartTime';
import {
  formatNameForTwoLines,
  formatSpeakerLocation,
  parseSpeakers,
  type ParsedSpeaker,
} from '../showcase/photoShowcaseHelpers';
import AppLogo from '../components/AppLogo';
import AppBrandTitle from '../components/AppBrandTitle';

type SpeakerView = 'photos' | 'info';

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function dayStartFor(
  day: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>
): string {
  if (dayStartTimes) {
    const keyed = dayStartTimes[day] ?? dayStartTimes[String(day)];
    if (keyed) return keyed;
  }
  return masterStartTime || '';
}

function calculateGuestStartTime(
  schedule: GuestScheduleItem[],
  index: number,
  masterStartTime?: string,
  dayStartTimes?: Record<number | string, string>
): string {
  const current = schedule[index];
  if (!current) return '';

  const indentedLookup = (id: number) =>
    !!schedule.find((row) => row.id === id && row.isIndented);

  if (isIndentedScheduleItem(current, indentedLookup)) {
    const parentIndex = findParentScheduleIndex(schedule, index, indentedLookup);
    if (parentIndex < 0) return '';
    return calculateGuestStartTime(schedule, parentIndex, masterStartTime, dayStartTimes);
  }

  const itemDay = current.day || 1;
  const startTime = dayStartFor(itemDay, masterStartTime, dayStartTimes);
  if (!startTime) return '';

  let totalSeconds = 0;
  for (let i = 0; i < index; i++) {
    const item = schedule[i];
    if ((item.day || 1) === itemDay && !isIndentedScheduleItem(item, indentedLookup)) {
      totalSeconds +=
        (Number(item.durationHours) || 0) * 3600 +
        (Number(item.durationMinutes) || 0) * 60 +
        (Number(item.durationSeconds) || 0);
    }
  }

  const [hours, minutes] = startTime.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
  const totalStartSeconds = hours * 3600 + minutes * 60 + totalSeconds;
  const finalHours = Math.floor(totalStartSeconds / 3600) % 24;
  const finalMinutes = Math.floor((totalStartSeconds % 3600) / 60);
  const date = new Date();
  date.setHours(finalHours, finalMinutes, 0, 0);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function speakersForItem(item: GuestScheduleItem): ParsedSpeaker[] {
  const fromText = parseSpeakers(item.speakersText);
  if (fromText.length) return fromText;
  return parseSpeakers(item.speakers);
}

function occupiedSpeakers(item: GuestScheduleItem): ParsedSpeaker[] {
  return speakersForItem(item)
    .filter((spk) => spk && (spk.fullName || spk.photoLink))
    .sort((a, b) => (a.slot || 0) - (b.slot || 0));
}

function notesHtml(notes: string): string {
  if (!notes) return '';
  return notes
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br>')
    .replace(/<(?!\/?(?:br|b|strong|i|em|u|font|span|div|p|h[1-6])\b)[^>]*>/gi, '');
}

function hasMeaningfulNotes(notes: string): boolean {
  const clean = stripHtmlNotes(notes || '');
  return !!(clean && clean !== 'None' && clean !== 'null' && clean !== 'undefined');
}

function pptQaLabel(item: GuestScheduleItem): string {
  const parts = [item.hasPPT ? 'PPT' : null, item.hasQA ? 'Q&A' : null].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'None';
}

function loadSpeakerView(): SpeakerView {
  try {
    const v = localStorage.getItem('guestViewSpeakerMode');
    return v === 'info' ? 'info' : 'photos';
  } catch {
    return 'photos';
  }
}

const GuestSpeakerPhotos: React.FC<{ speakers: ParsedSpeaker[]; killed?: boolean; compact?: boolean }> = ({
  speakers,
  killed,
  compact,
}) => (
  <div className={`flex flex-wrap items-start justify-center gap-4 ${compact ? 'gap-3' : 'gap-5 sm:gap-6'}`}>
    {speakers.map((speaker, idx) => {
      const fullName = String(speaker.fullName || 'Unnamed').trim();
      const titleOrg = [speaker.title, speaker.org].filter(Boolean).join(', ');
      const nameTwoLine = formatNameForTwoLines(fullName);
      return (
        <div
          key={`${speaker.slot ?? idx}-${fullName}`}
          className={`flex flex-col items-center text-center min-w-0 ${
            compact ? 'max-w-[7rem] flex-1' : 'max-w-[11rem] sm:max-w-[12rem] flex-1'
          }`}
        >
          <div
            className={`w-full aspect-[3/4] rounded-lg overflow-hidden border border-slate-600 shadow-xl bg-slate-900 ${
              compact ? 'max-h-28' : 'max-h-44 sm:max-h-52'
            }`}
          >
            <img
              src={speaker.photoLink || '/speaker-placeholder.svg'}
              alt={fullName}
              className="w-full h-full object-cover"
              style={{ objectPosition: 'center top' }}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/speaker-placeholder.svg';
              }}
            />
          </div>
          <div
            className={`mt-2 font-bold leading-tight w-full ${killed ? 'text-slate-400' : 'text-white'} ${
              nameTwoLine.needsSmallText ? 'text-sm' : 'text-base sm:text-lg'
            }`}
            dangerouslySetInnerHTML={{ __html: nameTwoLine.html }}
          />
          {titleOrg ? (
            <div className="text-xs sm:text-sm text-slate-400 mt-1 line-clamp-2">{titleOrg}</div>
          ) : null}
          {speaker.location ? (
            <div className="mt-1.5 text-xs font-semibold text-slate-100 bg-slate-700/90 px-2 py-0.5 rounded">
              {formatSpeakerLocation(speaker.location)}
            </div>
          ) : null}
        </div>
      );
    })}
  </div>
);

const GuestSpeakerInfoList: React.FC<{ speakers: ParsedSpeaker[]; killed?: boolean }> = ({
  speakers,
  killed,
}) => (
  <ul className="space-y-3">
    {speakers.map((speaker, idx) => {
      const fullName = String(speaker.fullName || 'Unnamed').trim();
      const titleOrg = [speaker.title, speaker.org].filter(Boolean).join(', ');
      return (
        <li
          key={`${speaker.slot ?? idx}-${fullName}`}
          className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {speaker.slot != null ? (
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Slot {speaker.slot}
              </span>
            ) : null}
            <span className={`font-semibold text-lg ${killed ? 'text-slate-400' : 'text-white'}`}>
              {fullName}
            </span>
            {speaker.location ? (
              <span className="text-xs font-medium text-slate-300 bg-slate-700 px-2 py-0.5 rounded">
                {formatSpeakerLocation(speaker.location)}
              </span>
            ) : null}
          </div>
          {titleOrg ? (
            <p className={`mt-1 text-sm ${killed ? 'text-slate-500' : 'text-slate-300'}`}>{titleOrg}</p>
          ) : null}
        </li>
      );
    })}
  </ul>
);

const GuestEventPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GuestEventPayload | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [showAllDays, setShowAllDays] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [tickElapsed, setTickElapsed] = useState(0);
  const [query, setQuery] = useState('');
  const [speakerView, setSpeakerView] = useState<SpeakerView>(loadSpeakerView);
  const [notesOnly, setNotesOnly] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError('This guest link is missing a token.');
      setLoading(false);
      return;
    }
    try {
      const data = await fetchGuestEvent(token);
      if (!data.ok || data.error) {
        setError(data.error || 'Invalid guest link.');
        setPayload(null);
        return;
      }
      setPayload(data);
      setError(null);
      setTickElapsed(Number(data.activeTimer?.elapsedSeconds) || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load guest view.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const timer = payload?.activeTimer;
    if (!timer?.isRunning) return;
    const id = window.setInterval(() => setTickElapsed((prev) => prev + 1), 1000);
    return () => window.clearInterval(id);
  }, [payload?.activeTimer?.isRunning, payload?.activeTimer?.itemId, payload?.serverTime]);

  useEffect(() => {
    setTickElapsed(Number(payload?.activeTimer?.elapsedSeconds) || 0);
  }, [payload?.activeTimer?.elapsedSeconds, payload?.activeTimer?.itemId, payload?.serverTime]);

  useEffect(() => {
    try {
      localStorage.setItem('guestViewSpeakerMode', speakerView);
    } catch {
      /* ignore */
    }
  }, [speakerView]);

  const allItems = payload?.scheduleItems || [];
  const daysFromItems = useMemo(() => {
    const max = allItems.reduce((acc, item) => Math.max(acc, Number(item.day) || 1), 1);
    return Math.max(1, Number(payload?.event?.numberOfDays) || 1, max);
  }, [allItems, payload?.event?.numberOfDays]);

  const startTimesById = useMemo(() => {
    const map = new Map<number, string>();
    for (let i = 0; i < allItems.length; i++) {
      map.set(
        allItems[i].id,
        calculateGuestStartTime(
          allItems,
          i,
          payload?.event?.masterStartTime,
          payload?.event?.dayStartTimes
        )
      );
    }
    return map;
  }, [allItems, payload?.event?.masterStartTime, payload?.event?.dayStartTimes]);

  const visibleItems = useMemo(() => {
    let rows = showAllDays ? allItems : allItems.filter((item) => (item.day || 1) === selectedDay);
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((item) => {
      const speakers = occupiedSpeakers(item)
        .map((s) => `${s.fullName || ''} ${s.title || ''} ${s.org || ''}`)
        .join(' ')
        .toLowerCase();
      const notes = stripHtmlNotes(item.notes || '').toLowerCase();
      return (
        String(item.cue || '').toLowerCase().includes(q) ||
        String(item.segmentName || '').toLowerCase().includes(q) ||
        String(item.programType || '').toLowerCase().includes(q) ||
        speakers.includes(q) ||
        notes.includes(q)
      );
    });
  }, [allItems, selectedDay, showAllDays, query]);

  const activeItemId = payload?.activeTimer?.itemId != null ? Number(payload.activeTimer.itemId) : null;

  // Follow live cue when timer moves; keep manual selection otherwise
  useEffect(() => {
    if (activeItemId != null && allItems.some((i) => i.id === activeItemId)) {
      setSelectedItemId(activeItemId);
    }
  }, [activeItemId, allItems]);

  useEffect(() => {
    if (selectedItemId != null && visibleItems.some((i) => i.id === selectedItemId)) return;
    if (visibleItems.length > 0) {
      setSelectedItemId(visibleItems[0].id);
    } else {
      setSelectedItemId(null);
    }
  }, [visibleItems, selectedItemId]);

  const selectedItem =
    visibleItems.find((i) => i.id === selectedItemId) ||
    allItems.find((i) => i.id === selectedItemId) ||
    null;

  const selectedIndex = selectedItem ? allItems.findIndex((i) => i.id === selectedItem.id) : -1;
  const nextItem = selectedIndex >= 0 ? allItems[selectedIndex + 1] : null;

  const remaining = useMemo(() => {
    const timer = payload?.activeTimer;
    if (!timer) return null;
    return (Number(timer.durationSeconds) || 0) - tickElapsed;
  }, [payload?.activeTimer, tickElapsed]);

  const isLiveSelected = activeItemId != null && selectedItem?.id === activeItemId;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="shrink-0 border-b border-slate-800 bg-slate-950/95 backdrop-blur z-20">
        <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo size="sm" />
            <div className="min-w-0">
              <AppBrandTitle titleClassName="text-sm font-semibold text-white leading-tight" showTagline={false} />
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Guest view · read only</p>
            </div>
          </div>
          {payload?.event ? (
            <div className="text-right min-w-0">
              <p className="font-semibold text-white truncate max-w-[min(100vw-2rem,28rem)]">
                {payload.event.name}
              </p>
              <p className="text-[11px] text-slate-400">
                {[payload.event.date, payload.event.location].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : null}
        </div>

        {payload ? (
          <div className="px-4 pb-2.5 flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2">
            {daysFromItems > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowAllDays(true)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    showAllDays ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  All days
                </button>
                {Array.from({ length: daysFromItems }, (_, i) => i + 1).map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setShowAllDays(false);
                      setSelectedDay(day);
                    }}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      !showAllDays && selectedDay === day
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    Day {day}
                  </button>
                ))}
              </>
            ) : null}

            <div className="flex items-center rounded-md border border-slate-700 bg-slate-900 overflow-hidden ml-auto">
              <button
                type="button"
                onClick={() => {
                  setSpeakerView('photos');
                  setNotesOnly(false);
                }}
                className={`px-3 py-1 text-xs font-semibold ${
                  speakerView === 'photos' && !notesOnly
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Photos
              </button>
              <button
                type="button"
                onClick={() => {
                  setSpeakerView('info');
                  setNotesOnly(false);
                }}
                className={`px-3 py-1 text-xs font-semibold border-l border-slate-700 ${
                  speakerView === 'info' && !notesOnly
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Speaker info
              </button>
              <button
                type="button"
                onClick={() => setNotesOnly((v) => !v)}
                className={`px-3 py-1 text-xs font-semibold border-l border-slate-700 ${
                  notesOnly ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {notesOnly ? 'Notes focus on' : 'Notes focus'}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {loading && !payload ? (
        <p className="p-6 text-slate-400 text-sm">Loading event…</p>
      ) : error && !payload ? (
        <div className="m-4 rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : payload ? (
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          {/* Rundown list — pick any cue */}
          <aside className="lg:w-72 xl:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col max-h-[38vh] lg:max-h-none lg:h-[calc(100vh-7.5rem)]">
            <div className="p-3 border-b border-slate-800 space-y-2 shrink-0">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cues, notes, speakers…"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                {visibleItems.length} cues · select to view
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleItems.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 text-center">No cues to show.</p>
              ) : (
                visibleItems.map((item) => {
                  const isSelected = item.id === selectedItemId;
                  const isLive = item.id === activeItemId;
                  const hasNotes = hasMeaningfulNotes(item.notes);
                  const start = item.isIndented ? '↘' : startTimesById.get(item.id) || '—';
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full text-left px-3 py-2.5 border-b border-slate-800/80 transition-colors ${
                        isSelected
                          ? 'bg-sky-950/80 border-l-2 border-l-sky-500'
                          : 'hover:bg-slate-900/80 border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-xs text-amber-400/90 shrink-0 mt-0.5 min-w-[2.5rem]">
                          {item.cue || '—'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-sm font-medium truncate ${
                                isLive ? 'text-emerald-300' : 'text-slate-100'
                              }`}
                            >
                              {item.segmentName || 'Untitled'}
                            </span>
                            {hasNotes ? (
                              <span
                                className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400"
                                title="Has notes"
                              />
                            ) : null}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {showAllDays ? `Day ${item.day || 1} · ` : ''}
                            {start}
                            {item.programType ? ` · ${item.programType}` : ''}
                          </div>
                        </div>
                        {isLive ? (
                          <span className="text-[9px] font-bold uppercase text-emerald-400 shrink-0">Live</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Large-view detail — notes first */}
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {!selectedItem ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 p-8">
                Select a cue from the rundown
              </div>
            ) : (
              <>
                {/* Cue header bar (Large View style) */}
                <div
                  className={`shrink-0 px-4 sm:px-6 py-4 border-b border-slate-800 ${
                    isLiveSelected ? 'bg-emerald-950/30' : 'bg-slate-900/50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-mono text-lg sm:text-xl font-bold text-amber-300">
                          {selectedItem.cue ? `CUE ${selectedItem.cue}` : '—'}
                        </span>
                        {selectedItem.programType ? (
                          <span
                            className="px-2 py-0.5 rounded text-xs font-semibold text-white"
                            style={{
                              backgroundColor:
                                GUEST_PROGRAM_TYPE_COLORS[selectedItem.programType] || '#475569',
                            }}
                          >
                            {selectedItem.programType}
                          </span>
                        ) : null}
                        {isLiveSelected ? (
                          <span className="text-xs font-bold uppercase text-emerald-400">Now</span>
                        ) : null}
                      </div>
                      <h2
                        className={`text-xl sm:text-2xl font-bold leading-tight ${
                          selectedItem.programType === 'KILLED'
                            ? 'line-through text-slate-400'
                            : 'text-white'
                        }`}
                      >
                        {selectedItem.segmentName || 'Untitled segment'}
                      </h2>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                        <span>
                          Start{' '}
                          <strong className="text-slate-200 font-mono">
                            {selectedItem.isIndented
                              ? '↘'
                              : startTimesById.get(selectedItem.id) || '—'}
                          </strong>
                        </span>
                        <span>
                          Dur{' '}
                          <strong className="text-slate-200 font-mono">
                            {selectedItem.isIndented ? '—' : formatGuestDuration(selectedItem)}
                          </strong>
                        </span>
                        {selectedItem.shotType ? (
                          <span>
                            Shot <strong className="text-slate-200">{selectedItem.shotType}</strong>
                          </span>
                        ) : null}
                        <span>
                          PPT/Q&A <strong className="text-slate-200">{pptQaLabel(selectedItem)}</strong>
                        </span>
                      </div>
                    </div>
                    {isLiveSelected && remaining != null && payload.activeTimer ? (
                      <div className="text-right shrink-0">
                        <div
                          className={`font-mono font-bold tabular-nums text-3xl sm:text-4xl px-4 py-2 rounded-lg border border-slate-600 bg-slate-800 ${
                            remaining < 0 ? 'text-red-300' : 'text-white'
                          }`}
                        >
                          {remaining < 0
                            ? `+${formatClock(Math.abs(remaining))}`
                            : formatClock(remaining)}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {payload.activeTimer.isRunning ? 'Remaining' : 'Timer'}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Main content: notes + speakers (Large View proportions) */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
                  <div
                    className={`flex flex-col gap-5 min-h-[min(24rem,50vh)] ${
                      notesOnly ? '' : 'lg:flex-row lg:items-stretch'
                    }`}
                  >
                    {/* Notes — always prominent */}
                    <section
                      className={`flex flex-col rounded-xl border border-slate-700 bg-slate-900/70 overflow-hidden ${
                        notesOnly ? 'flex-1' : 'lg:flex-[1.15] min-h-[14rem] lg:min-h-0'
                      }`}
                    >
                      <div className="px-4 py-2.5 border-b border-slate-700 bg-slate-800/80 flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-widest text-amber-400/90">
                          Notes
                        </span>
                        {hasMeaningfulNotes(selectedItem.notes) ? (
                          <span className="text-[10px] text-slate-500">Primary focus for guests</span>
                        ) : null}
                      </div>
                      <div className="flex-1 p-4 sm:p-5 overflow-y-auto">
                        {hasMeaningfulNotes(selectedItem.notes) ? (
                          <div
                            className="text-base sm:text-lg leading-relaxed text-slate-100 break-words"
                            style={{ whiteSpace: 'pre-line' }}
                            dangerouslySetInnerHTML={{ __html: notesHtml(selectedItem.notes) }}
                          />
                        ) : (
                          <p className="text-slate-500 text-base italic">No notes for this cue.</p>
                        )}
                      </div>
                    </section>

                    {/* Speakers — photos or info list */}
                    {!notesOnly ? (
                      <section className="lg:flex-[0.85] min-h-[12rem] flex flex-col rounded-xl border border-slate-700 bg-slate-900/50 overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-slate-700 bg-slate-800/60 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                            Speakers
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {speakerView === 'photos' ? 'Photo view' : 'Info only'}
                          </span>
                        </div>
                        <div className="flex-1 p-4 sm:p-5 overflow-y-auto flex items-start justify-center">
                          {occupiedSpeakers(selectedItem).length === 0 ? (
                            <p className="text-slate-500 text-sm self-center">No speakers on this cue.</p>
                          ) : speakerView === 'photos' ? (
                            <GuestSpeakerPhotos
                              speakers={occupiedSpeakers(selectedItem)}
                              killed={selectedItem.programType === 'KILLED'}
                            />
                          ) : (
                            <div className="w-full max-w-lg">
                              <GuestSpeakerInfoList
                                speakers={occupiedSpeakers(selectedItem)}
                                killed={selectedItem.programType === 'KILLED'}
                              />
                            </div>
                          )}
                        </div>
                      </section>
                    ) : null}
                  </div>

                  {/* Next cue strip (Large View style) */}
                  {nextItem ? (
                    <div className="mt-6 rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3 flex flex-wrap items-center gap-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 shrink-0">
                        Next
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200 truncate">
                          {nextItem.cue ? `CUE ${nextItem.cue}` : '—'}
                          {nextItem.segmentName ? ` · ${nextItem.segmentName}` : ''}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {nextItem.programType || '—'}
                        </div>
                      </div>
                      {speakerView === 'photos' && !notesOnly ? (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {occupiedSpeakers(nextItem)
                            .slice(0, 4)
                            .map((spk, idx) => (
                              <img
                                key={`next-${spk.slot ?? idx}`}
                                src={spk.photoLink || '/speaker-placeholder.svg'}
                                alt={spk.fullName || ''}
                                title={spk.fullName || ''}
                                className="h-12 w-9 object-cover rounded border border-slate-600 shrink-0"
                                style={{ objectPosition: 'center top' }}
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.src = '/speaker-placeholder.svg';
                                }}
                              />
                            ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setSelectedItemId(nextItem.id)}
                        className="text-xs font-semibold text-sky-400 hover:text-sky-300 shrink-0"
                      >
                        View →
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </main>
        </div>
      ) : null}
    </div>
  );
};

export default GuestEventPage;
