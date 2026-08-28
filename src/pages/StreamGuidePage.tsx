import React, { useCallback, useEffect, useMemo, useState } from 'react';
import RetroTvGuideList from '../components/stream-guide/RetroTvGuideList';
import NoLiveStreamFrame from '../components/stream-guide/NoLiveStreamFrame';
import { buildDashboardSummaryFromExistingApis } from '../lib/buildDashboardSummary';
import {
  filterByTimeRange,
  filterRecordStreamingEvents,
  formatLongDate,
  getLocationColor,
  getRecordStreamingColor,
  sortEventsByDate,
} from '../lib/dashboardUtils';
import {
  findLivePrograms,
  formatLiveProgramWindow,
  liveProgramKey,
  type LiveProgramInfo,
} from '../lib/streamGuideLive';
import { DatabaseService } from '../services/database';
import type { DashboardEventSummary, DashboardSummaryResponse } from '../types/dashboard';
import './StreamGuidePage.css';

type StreamView = 'live' | 'guide';

async function loadStreamGuideEvents(): Promise<DashboardEventSummary[]> {
  let data: DashboardSummaryResponse | null = await DatabaseService.getDashboardSummary();

  if (!data?.events?.length) {
    try {
      data = await buildDashboardSummaryFromExistingApis({
        getCalendarEvents: () => DatabaseService.getCalendarEvents(),
        getRunOfShowData: (eventId) => DatabaseService.getRunOfShowData(eventId),
        getContentReviewData: (eventId) => DatabaseService.getContentReviewData(eventId),
      });
    } catch (err) {
      console.error('Stream guide fallback load failed:', err);
    }
  }

  return (data?.events || []).filter((e) => !e.isQuickMode);
}

function formatClock(now: Date): string {
  return now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

const StreamGuidePage: React.FC = () => {
  const [events, setEvents] = useState<DashboardEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<StreamView>('guide');
  const [selectedLiveKey, setSelectedLiveKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const loadEvents = useCallback(async () => {
    setError('');
    try {
      const list = await loadStreamGuideEvents();
      setEvents(list);
    } catch (err) {
      console.error(err);
      setError('Could not load event schedule data.');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
    const refresh = window.setInterval(() => void loadEvents(), 5 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, [loadEvents]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const livePrograms = useMemo(() => findLivePrograms(events, now), [events, now]);

  const guideEvents = useMemo(
    () => sortEventsByDate(filterByTimeRange(filterRecordStreamingEvents(events), 'upcoming'), 'upcoming'),
    [events]
  );

  const liveProgramKeys = useMemo(
    () => new Set(livePrograms.map((p) => liveProgramKey(p))),
    [livePrograms]
  );

  const selectedLive = useMemo(() => {
    if (livePrograms.length === 0) return null;
    if (selectedLiveKey) {
      const match = livePrograms.find((p) => liveProgramKey(p) === selectedLiveKey);
      if (match) return match;
    }
    return livePrograms[0];
  }, [livePrograms, selectedLiveKey]);

  useEffect(() => {
    if (view === 'live' && livePrograms.length > 0) {
      const keys = new Set(livePrograms.map(liveProgramKey));
      if (selectedLiveKey && !keys.has(selectedLiveKey)) {
        setSelectedLiveKey(liveProgramKey(livePrograms[0]));
      }
    }
  }, [livePrograms, view, selectedLiveKey]);

  const openGuide = () => setView('guide');
  const openLive = () => {
    if (livePrograms.length > 0) {
      setSelectedLiveKey(liveProgramKey(livePrograms[0]));
    }
    setView('live');
  };

  const header = (
    <header className="retro-tv-header shrink-0 px-3 py-2 sm:px-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="retro-tv-logo text-sm sm:text-lg truncate">Chamber Event Broadcasts</span>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={openLive}
            className={`retro-tv-mode-btn flex items-center gap-2 ${
              view === 'live' ? 'retro-tv-mode-btn-active-live' : ''
            }`}
          >
            {livePrograms.length > 0 ? (
              <span className="inline-flex h-2 w-2 rounded-full bg-red-400 animate-pulse" />
            ) : null}
            ▶ Live Stream
          </button>
          <button
            type="button"
            onClick={openGuide}
            className={`retro-tv-mode-btn ${view === 'guide' ? 'retro-tv-mode-btn-active-guide' : ''}`}
          >
            TV Guide
          </button>
        </div>

        <div className="retro-tv-clock text-right">
          <div className="font-bold text-[#ffd700]">{formatClock(now)}</div>
          <div className="text-[10px] uppercase tracking-wide">
            {now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="retro-tv-root fixed inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-[#8aa8cc]">Tuning channels…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="retro-tv-root fixed inset-0 flex flex-col overflow-hidden">
      {header}

      {error ? (
        <div className="shrink-0 border-b border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === 'guide' ? (
          <RetroTvGuideList
            events={guideEvents}
            liveProgramKeys={liveProgramKeys}
            totalCount={guideEvents.length}
          />
        ) : null}

        {view === 'live' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden gap-3 p-3 sm:p-4">
            {livePrograms.length > 1 ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {livePrograms.map((info: LiveProgramInfo) => {
                  const key = liveProgramKey(info);
                  const active = selectedLive && liveProgramKey(selectedLive) === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedLiveKey(key)}
                      className={`retro-tv-btn rounded px-3 py-1.5 text-xs font-bold ${
                        active ? 'bg-[#8b0000] border-[#ff6666] text-white' : ''
                      }`}
                    >
                      {info.event.location}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {selectedLive ? (
              <div className="shrink-0 flex flex-wrap items-start justify-between gap-2 border border-[#4a6fa5] bg-[#0d1440] px-3 py-2">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#ff8888]">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    Live · {selectedLive.event.location}
                  </div>
                  <h2 className="text-lg font-bold text-white sm:text-xl">{selectedLive.event.name}</h2>
                  <p className="text-xs text-[#8aa8cc]">
                    {formatLongDate(selectedLive.dayBlock.calendarDate)} ·{' '}
                    {formatLiveProgramWindow(selectedLive)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold text-white ${getLocationColor(
                      selectedLive.event.location
                    )}`}
                  >
                    {selectedLive.event.location}
                  </span>
                  {selectedLive.event.recordStreaming !== 'None' ? (
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold text-white ${getRecordStreamingColor(
                        selectedLive.event.recordStreaming
                      )}`}
                    >
                      {selectedLive.event.recordStreaming}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="shrink-0 border border-[#4a6fa5] bg-[#0d1440] px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#8aa8cc]">
                  Live Stream
                </div>
                <p className="text-sm text-[#c5daf5]">No program is scheduled on air right now.</p>
              </div>
            )}

            <div
              className="retro-tv-live-frame relative min-h-0 flex-1 overflow-hidden rounded"
              aria-label={selectedLive ? 'Live stream player' : 'No current stream'}
            >
              {selectedLive ? (
                <div className="flex h-full min-h-[12rem] items-center justify-center bg-[#0a0e1a] px-6 text-center">
                  <div>
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-4 border-[#444] bg-[#111] text-4xl text-[#666]">
                      ▶
                    </div>
                    <p className="text-lg font-bold text-[#ccc]">Live stream player</p>
                    <p className="mt-2 max-w-lg text-sm text-[#888]">
                      Embed your web player URL here. Feed will appear in this frame.
                    </p>
                  </div>
                </div>
              ) : (
                <NoLiveStreamFrame onOpenGuide={openGuide} />
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default StreamGuidePage;
