import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import LedWysiwygEditor from '../components/led/LedWysiwygEditor';
import LedFontRoleSettings from '../components/led/LedFontRoleSettings';
import LedOutputAnimationSettings from '../components/led/LedOutputAnimationSettings';
import LedClockSettings from '../components/led/LedClockSettings';
import {
  DEFAULT_LED_OUTPUT_ANIMATION,
  parseLedOutputFromSettings,
} from '../lib/ledOutputAnimation';
import {
  DEFAULT_LED_OUTPUT_CLOCK,
  parseLedClockFromSettings,
} from '../lib/ledClock';
import {
  DEFAULT_LED_LAYOUT,
  getLayoutSummary,
  getLedLayoutFromItem,
  getSpeakerForLayoutSlot,
  getTitleFromSource,
  ledLayoutToCustomFields,
  mergeLedStyles,
  normalizeLedLayout,
  parseScheduleItems,
  resolveLedTitle,
  toggleSpeakerSlot,
  updateSpeakerPlacement,
} from '../lib/ledText';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { dispatchLedOutputClear } from '../lib/ledOutputClear';
import { Event } from '../types/Event';
import type { LedElementKey, LedLayoutConfig, LedTextStyles } from '../types/ledText';
import type { LedOutputAnimation } from '../types/ledOutput';
import type { LedOutputClock } from '../types/ledClock';

interface ScheduleItem {
  id: number;
  segmentName: string;
  speakersText: string;
  customFields?: Record<string, unknown>;
}

function formatCueLabel(item: ScheduleItem): string {
  const cue = item.customFields?.cue;
  return typeof cue === 'string' && cue.trim() ? cue.trim() : `ID ${item.id}`;
}

const LedLayoutsPage: React.FC = () => {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const eventId = urlParams.get('eventId');
  const eventName = urlParams.get('eventName');

  const event: Event = location.state?.event || {
    id: eventId || '',
    name: eventName || 'Current Event',
    date: '',
    location: '',
  };

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [layouts, setLayouts] = useState<Record<number, LedLayoutConfig>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<LedElementKey | null>('session-title');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastTextRefresh, setLastTextRefresh] = useState<Date | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [outputAnimation, setOutputAnimation] = useState<LedOutputAnimation>(
    DEFAULT_LED_OUTPUT_ANIMATION
  );
  const [outputClock, setOutputClock] = useState<LedOutputClock>(DEFAULT_LED_OUTPUT_CLOCK);
  const [runOfShowMeta, setRunOfShowMeta] = useState<{
    event_date: string;
    custom_columns: unknown[];
    settings: Record<string, unknown>;
  } | null>(null);

  const applyScheduleFromItems = useCallback((items: ScheduleItem[], replaceLayouts = false) => {
    setSchedule(items);
    setLayouts((prev) => {
      if (replaceLayouts) {
        const layoutMap: Record<number, LedLayoutConfig> = {};
        items.forEach((item) => {
          layoutMap[item.id] = getLedLayoutFromItem(item);
        });
        return layoutMap;
      }
      const next = { ...prev };
      items.forEach((item) => {
        if (!next[item.id]) {
          next[item.id] = getLedLayoutFromItem(item);
        }
      });
      return next;
    });
  }, []);

  const fetchLatestSchedule = useCallback(async (): Promise<ScheduleItem[]> => {
    const id = event?.id || eventId;
    if (!id) return [];

    const data = await DatabaseService.getRunOfShowData(id);
    if (data) {
      setRunOfShowMeta({
        event_date: data.event_date || '',
        custom_columns: data.custom_columns || [],
        settings: data.settings || {},
      });
      setOutputAnimation(parseLedOutputFromSettings(data.settings));
      setOutputClock(parseLedClockFromSettings(data.settings));
      const items = parseScheduleItems(data.schedule_items);
      if (items.length) return items;
    }

    const saved = localStorage.getItem(`runOfShowSchedule_${id}`);
    if (saved) return JSON.parse(saved);
    return [];
  }, [event?.id, eventId]);

  const loadData = useCallback(async () => {
    const id = event?.id || eventId;
    if (!id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const items = await fetchLatestSchedule();
      applyScheduleFromItems(items, true);
      if (items.length) setSelectedId((prev) => prev ?? items[0].id);
      setLastTextRefresh(new Date());
    } catch (error) {
      console.error('LedLayoutsPage: load failed', error);
    } finally {
      setIsLoading(false);
    }
  }, [event?.id, eventId, fetchLatestSchedule, applyScheduleFromItems]);

  const refreshScheduleText = useCallback(
    async (manual = false) => {
      const id = event?.id || eventId;
      if (!id) return;

      setIsRefreshing(true);
      setSaveMessage(null);
      try {
        const items = await fetchLatestSchedule();
        if (!items.length) {
          if (manual) setSaveMessage('No schedule data found to refresh.');
          return;
        }

        applyScheduleFromItems(items, false);
        localStorage.setItem(`runOfShowSchedule_${id}`, JSON.stringify(items));
        setLastTextRefresh(new Date());
        if (manual) {
          setSaveMessage('Text refreshed — segment names and speakers updated from schedule.');
        }
      } catch (error) {
        console.error('LedLayoutsPage: refresh failed', error);
        if (manual) setSaveMessage('Refresh failed — check console.');
      } finally {
        setIsRefreshing(false);
      }
    },
    [event?.id, eventId, fetchLatestSchedule, applyScheduleFromItems]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const id = event?.id || eventId;
    if (!id) return;

    const callbacks = {
      onRunOfShowDataUpdated: (data: {
        schedule_items?: unknown;
        settings?: Record<string, unknown>;
      }) => {
        if (data?.settings) {
          setOutputAnimation(parseLedOutputFromSettings(data.settings));
          setOutputClock(parseLedClockFromSettings(data.settings));
        }
        const items = parseScheduleItems(data?.schedule_items);
        if (!items.length) return;
        applyScheduleFromItems(items, false);
        setLayouts((prev) => {
          const next = { ...prev };
          items.forEach((item) => {
            if (item.customFields?.ledLayout) {
              next[item.id] = getLedLayoutFromItem(item);
            }
          });
          return next;
        });
        setLastTextRefresh(new Date());
      },
    };

    socketClient.connect(id, callbacks);
    return () => socketClient.disconnect(id);
  }, [event?.id, eventId, applyScheduleFromItems]);

  const selectedItem = useMemo(
    () => schedule.find((s) => s.id === selectedId) ?? null,
    [schedule, selectedId]
  );

  const selectedLayout =
    selectedId != null ? layouts[selectedId] ?? DEFAULT_LED_LAYOUT : DEFAULT_LED_LAYOUT;

  const setSelectedLayout = (layout: LedLayoutConfig) => {
    if (selectedId == null) return;
    setLayouts((prev) => ({ ...prev, [selectedId]: normalizeLedLayout(layout) }));
  };

  const patchSelectedLayout = (patch: Partial<LedLayoutConfig>) => {
    setSelectedLayout({ ...selectedLayout, ...patch });
  };

  const syncCurrentTitleFromSchedule = () => {
    if (!selectedItem || selectedId == null) return;
    setSelectedLayout({
      ...selectedLayout,
      sessionTitle: {
        ...selectedLayout.sessionTitle,
        displayText: getTitleFromSource(selectedItem, selectedLayout.sessionTitle),
      },
    });
    setSaveMessage('Title text synced from schedule for this cue.');
  };

  const updateSelectedStyles = (patch: Partial<LedTextStyles>) => {
    setSelectedLayout({
      ...selectedLayout,
      styles: { ...selectedLayout.styles, ...patch },
    });
  };

  const title = selectedItem ? resolveLedTitle(selectedItem, selectedLayout) : '';
  const mergedStyles = mergeLedStyles(selectedLayout.styles);

  const animationPreview = useMemo(() => {
    if (!selectedItem) return null;
    const speakersBySlot = new Map(
      [1, 2, 3, 4, 5, 6, 7].map((slot) => [
        slot,
        getSpeakerForLayoutSlot(selectedItem.speakersText, slot),
      ])
    );
    return {
      layout: selectedLayout,
      title,
      speakersBySlot,
    };
  }, [selectedItem, selectedLayout, title]);

  const selectedSpeaker =
    selectedKey?.startsWith('speaker-')
      ? selectedLayout.speakers.find((s) => `speaker-${s.id}` === selectedKey) ?? null
      : null;

  const selectedTransform =
    selectedKey === 'session-title'
      ? selectedLayout.sessionTitle
      : selectedSpeaker ?? selectedLayout.sessionTitle;

  const updateSelectedTransform = (patch: {
    x?: number;
    y?: number;
    scale?: number;
    align?: LedTextStyles['titleAlign'];
    maxWidth?: number;
  }) => {
    if (selectedKey === 'session-title') {
      setSelectedLayout({
        ...selectedLayout,
        sessionTitle: { ...selectedLayout.sessionTitle, ...patch },
      });
    } else if (selectedSpeaker) {
      setSelectedLayout(updateSpeakerPlacement(selectedLayout, selectedSpeaker.id, patch));
    }
  };

  const outputUrl = `/led-output?eventId=${encodeURIComponent(event?.id || eventId || '')}`;

  const handleClearOutput = async () => {
    const id = event?.id || eventId;
    if (!id) return;

    dispatchLedOutputClear(id);
    socketClient.connect(id, {});
    socketClient.emitLedOutputClear();

    const ok = await DatabaseService.clearLedOutput(id);
    setSaveMessage(ok ? 'Output clear sent.' : 'Output clear sent (local). API sync pending deploy.');
  };

  const handleSave = async () => {
    const id = event?.id || eventId;
    if (!id) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const updatedSchedule = schedule.map((item) => ({
        ...item,
        customFields: ledLayoutToCustomFields(
          item.customFields,
          layouts[item.id] ?? DEFAULT_LED_LAYOUT
        ),
      }));

      localStorage.setItem(`runOfShowSchedule_${id}`, JSON.stringify(updatedSchedule));

      const existing = await DatabaseService.getRunOfShowData(id);
      const baseSettings = {
        ...(existing?.settings || runOfShowMeta?.settings || {}),
        ledOutput: outputAnimation,
        ledClock: outputClock,
      };
      await DatabaseService.saveRunOfShowData({
        event_id: id,
        event_name: event?.name || existing?.event_name || 'Event',
        event_date: existing?.event_date || runOfShowMeta?.event_date || '',
        schedule_items: updatedSchedule,
        custom_columns: existing?.custom_columns || runOfShowMeta?.custom_columns || [],
        settings: baseSettings,
      });

      setRunOfShowMeta((prev) => ({
        event_date: prev?.event_date || existing?.event_date || '',
        custom_columns: prev?.custom_columns || existing?.custom_columns || [],
        settings: baseSettings,
      }));

      setSchedule(updatedSchedule);
      setSaveMessage('Layouts saved.');
    } catch (error) {
      console.error('LedLayoutsPage: save failed', error);
      setSaveMessage('Save failed — check console.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white pt-[var(--app-header-height)]">
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-[1800px] mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">LED Text Layouts</h1>
            <p className="text-slate-400 text-sm mt-1">
              {event?.name || 'Event'} · Drag elements on the canvas · 4K scales to HD
              {lastTextRefresh ? (
                <span className="text-slate-500"> · Text synced {lastTextRefresh.toLocaleTimeString()}</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => refreshScheduleText(true)}
              disabled={isRefreshing || !schedule.length}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh text'}
            </button>
            <button
              type="button"
              onClick={() => window.open(outputUrl, '_blank')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium"
            >
              Open Output Page
            </button>
            <button
              type="button"
              onClick={handleClearOutput}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-sm font-medium"
              title="Hide graphics on the output page without stopping the loaded cue or timer"
            >
              Clear Output
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !schedule.length}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {isSaving ? 'Saving…' : 'Save Layouts'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-4 py-6">
        {saveMessage ? (
          <div className="mb-4 px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-green-400">
            {saveMessage}
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-slate-400">Loading schedule…</p>
        ) : !schedule.length ? (
          <p className="text-slate-400">No schedule items found for this event.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-3 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 font-semibold text-sm">Cues</div>
              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto divide-y divide-slate-700">
                {schedule.map((item) => {
                  const layout = layouts[item.id] ?? DEFAULT_LED_LAYOUT;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setSelectedKey('session-title');
                      }}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-700/60 transition-colors ${
                        item.id === selectedId ? 'bg-blue-900/40 border-l-4 border-blue-400' : ''
                      }`}
                    >
                      <div className="font-mono text-xs text-blue-300">{formatCueLabel(item)}</div>
                      <div className="text-sm font-medium truncate">{item.segmentName || 'Untitled'}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{getLayoutSummary(layout)}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedItem ? (
              <>
                <div className="lg:col-span-4 space-y-4 max-h-[calc(100vh-10rem)] overflow-y-auto pr-1">
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                    <h2 className="font-semibold mb-3 text-sm">
                      {formatCueLabel(selectedItem)} — {selectedItem.segmentName || 'Untitled'}
                    </h2>

                    <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedLayout.sessionTitle.enabled}
                        onChange={(e) =>
                          patchSelectedLayout({
                            sessionTitle: {
                              ...selectedLayout.sessionTitle,
                              enabled: e.target.checked,
                            },
                          })
                        }
                        className="rounded"
                      />
                      <span>Show session title</span>
                    </label>

                    {selectedLayout.sessionTitle.enabled ? (
                      <div className="space-y-3 mb-4 pl-6">
                        <label className="block text-sm">
                          <span className="text-slate-400">Title source</span>
                          <select
                            value={selectedLayout.sessionTitle.titleSource}
                            onChange={(e) =>
                              patchSelectedLayout({
                                sessionTitle: {
                                  ...selectedLayout.sessionTitle,
                                  titleSource: e.target.value as 'segment' | 'custom',
                                },
                              })
                            }
                            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2"
                          >
                            <option value="segment">Segment name</option>
                            <option value="custom">Custom title</option>
                          </select>
                        </label>

                        {selectedLayout.sessionTitle.titleSource === 'custom' ? (
                          <label className="block text-sm">
                            <span className="text-slate-400">Custom title (stored value)</span>
                            <input
                              type="text"
                              value={selectedLayout.sessionTitle.customTitle}
                              onChange={(e) =>
                                patchSelectedLayout({
                                  sessionTitle: {
                                    ...selectedLayout.sessionTitle,
                                    customTitle: e.target.value,
                                  },
                                })
                              }
                              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2"
                              placeholder="One-line custom title"
                            />
                          </label>
                        ) : null}

                        <label className="block text-sm">
                          <span className="text-slate-400">
                            Title on screen (press Enter for line breaks)
                          </span>
                          <textarea
                            rows={4}
                            value={
                              selectedLayout.sessionTitle.displayText ||
                              resolveLedTitle(selectedItem, selectedLayout)
                            }
                            onChange={(e) =>
                              patchSelectedLayout({
                                sessionTitle: {
                                  ...selectedLayout.sessionTitle,
                                  displayText: e.target.value,
                                },
                              })
                            }
                            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-medium resize-y min-h-[5rem]"
                            placeholder="Session title — use Enter to wrap to a new line"
                          />
                        </label>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => refreshScheduleText(true)}
                            disabled={isRefreshing}
                            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500"
                          >
                            Refresh all text
                          </button>
                          <button
                            type="button"
                            onClick={syncCurrentTitleFromSchedule}
                            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500"
                          >
                            Sync this cue&apos;s title
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              patchSelectedLayout({
                                sessionTitle: {
                                  ...selectedLayout.sessionTitle,
                                  displayText: getTitleFromSource(selectedItem, {
                                    ...selectedLayout.sessionTitle,
                                    titleSource: 'segment',
                                  }),
                                },
                              })
                            }
                            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500"
                          >
                            Load segment name
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              patchSelectedLayout({
                                sessionTitle: {
                                  ...selectedLayout.sessionTitle,
                                  displayText: getTitleFromSource(selectedItem, {
                                    ...selectedLayout.sessionTitle,
                                    titleSource: 'custom',
                                  }),
                                },
                              })
                            }
                            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500"
                          >
                            Load custom title
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              patchSelectedLayout({
                                sessionTitle: {
                                  ...selectedLayout.sessionTitle,
                                  displayText: '',
                                },
                              })
                            }
                            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500"
                          >
                            Auto from source
                          </button>
                        </div>
                        <p className="text-xs text-slate-500">
                          Edit the title text directly to break lines and avoid overlapping other graphics.
                          Drag the title on the canvas to reposition.
                        </p>
                      </div>
                    ) : null}

                    <div className="border-t border-slate-700 pt-3">
                      <div className="text-slate-400 text-xs uppercase tracking-wide mb-2">Speakers on layout</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[1, 2, 3, 4, 5, 6, 7].map((slot) => {
                          const placement = selectedLayout.speakers.find((s) => s.slot === slot);
                          const enabled = placement?.enabled ?? false;
                          const sp = getSpeakerForLayoutSlot(selectedItem.speakersText, slot);
                          const label = sp?.fullName?.trim() || `Person ${slot}`;
                          return (
                            <label
                              key={slot}
                              className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg cursor-pointer border ${
                                enabled ? 'border-cyan-500/50 bg-cyan-950/30' : 'border-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => {
                                  const next = toggleSpeakerSlot(selectedLayout, slot, e.target.checked);
                                  setSelectedLayout(next);
                                  if (e.target.checked) {
                                    const added = next.speakers.find((s) => s.slot === slot);
                                    if (added) setSelectedKey(`speaker-${added.id}`);
                                  }
                                }}
                                className="rounded"
                              />
                              <span className="truncate" title={label}>
                                {slot}. {label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                    <h3 className="font-semibold mb-3 text-sm">Grid</h3>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLayout.showGrid}
                          onChange={(e) => patchSelectedLayout({ showGrid: e.target.checked })}
                          className="rounded"
                        />
                        Show alignment grid
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLayout.snapToGrid}
                          onChange={(e) => patchSelectedLayout({ snapToGrid: e.target.checked })}
                          className="rounded"
                        />
                        Snap to grid when dragging
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Grid size (4K px)</span>
                        <input
                          type="number"
                          min={20}
                          max={400}
                          value={selectedLayout.gridSize}
                          onChange={(e) =>
                            patchSelectedLayout({
                              gridSize: parseInt(e.target.value, 10) || 80,
                            })
                          }
                          className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">
                          Grid opacity ({Math.round(selectedLayout.gridOpacity * 100)}%)
                        </span>
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={Math.round(selectedLayout.gridOpacity * 100)}
                          onChange={(e) =>
                            patchSelectedLayout({
                              gridOpacity: parseInt(e.target.value, 10) / 100,
                            })
                          }
                          className="mt-2 w-full"
                        />
                      </label>
                    </div>
                  </div>

                  {selectedKey ? (
                    <div className="bg-slate-800 rounded-xl border border-cyan-700/50 p-4">
                      <h3 className="font-semibold mb-3 text-sm text-cyan-300">
                        Selected:{' '}
                        {selectedKey === 'session-title'
                          ? 'Session title'
                          : `Speaker ${selectedSpeaker?.slot ?? ''}`}
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-sm">
                          <span className="text-slate-400">X ({selectedTransform.x.toFixed(1)}%)</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={selectedTransform.x}
                            onChange={(e) =>
                              updateSelectedTransform({ x: parseFloat(e.target.value) })
                            }
                            className="mt-1 w-full"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-slate-400">Y ({selectedTransform.y.toFixed(1)}%)</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={0.5}
                            value={selectedTransform.y}
                            onChange={(e) =>
                              updateSelectedTransform({ y: parseFloat(e.target.value) })
                            }
                            className="mt-1 w-full"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-slate-400">Scale ({selectedTransform.scale.toFixed(2)}×)</span>
                          <input
                            type="range"
                            min={0.25}
                            max={2.5}
                            step={0.05}
                            value={selectedTransform.scale}
                            onChange={(e) =>
                              updateSelectedTransform({ scale: parseFloat(e.target.value) })
                            }
                            className="mt-1 w-full"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-slate-400">Align</span>
                          <select
                            value={selectedTransform.align}
                            onChange={(e) =>
                              updateSelectedTransform({
                                align: e.target.value as LedTextStyles['titleAlign'],
                              })
                            }
                            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2"
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <LedOutputAnimationSettings
                    value={outputAnimation}
                    onChange={setOutputAnimation}
                    preview={animationPreview}
                  />

                  <LedClockSettings value={outputClock} onChange={setOutputClock} />

                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                    <h3 className="font-semibold mb-3 text-sm">Global style</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <LedFontRoleSettings
                        label="Segment / custom"
                        fontFamily={mergedStyles.sessionFontFamily}
                        fontWeight={mergedStyles.sessionFontWeight}
                        fontStyle={mergedStyles.sessionFontStyle}
                        onFontFamilyChange={(value) =>
                          updateSelectedStyles({
                            sessionFontFamily: value.trim() || mergedStyles.sessionFontFamily,
                          })
                        }
                        onFontWeightChange={(value) =>
                          updateSelectedStyles({ sessionFontWeight: value })
                        }
                        onFontStyleChange={(value) =>
                          updateSelectedStyles({ sessionFontStyle: value })
                        }
                      />
                      <LedFontRoleSettings
                        label="Name"
                        fontFamily={mergedStyles.nameFontFamily}
                        fontWeight={mergedStyles.nameFontWeight}
                        fontStyle={mergedStyles.nameFontStyle}
                        onFontFamilyChange={(value) =>
                          updateSelectedStyles({
                            nameFontFamily: value.trim() || mergedStyles.nameFontFamily,
                          })
                        }
                        onFontWeightChange={(value) =>
                          updateSelectedStyles({ nameFontWeight: value })
                        }
                        onFontStyleChange={(value) =>
                          updateSelectedStyles({ nameFontStyle: value })
                        }
                      />
                      <LedFontRoleSettings
                        label="Title / org"
                        fontFamily={mergedStyles.detailFontFamily}
                        fontWeight={mergedStyles.detailFontWeight}
                        fontStyle={mergedStyles.detailFontStyle}
                        onFontFamilyChange={(value) =>
                          updateSelectedStyles({
                            detailFontFamily: value.trim() || mergedStyles.detailFontFamily,
                          })
                        }
                        onFontWeightChange={(value) =>
                          updateSelectedStyles({ detailFontWeight: value })
                        }
                        onFontStyleChange={(value) =>
                          updateSelectedStyles({ detailFontStyle: value })
                        }
                      />
                      <label className="block text-sm">
                        <span className="text-slate-400">Primary</span>
                        <input
                          type="color"
                          value={mergedStyles.primaryColor}
                          onChange={(e) => updateSelectedStyles({ primaryColor: e.target.value })}
                          className="mt-1 w-full h-10 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Accent</span>
                        <input
                          type="color"
                          value={mergedStyles.accentColor}
                          onChange={(e) => updateSelectedStyles({ accentColor: e.target.value })}
                          className="mt-1 w-full h-10 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Title base size</span>
                        <input
                          type="number"
                          min={24}
                          max={400}
                          value={mergedStyles.titleFontSize}
                          onChange={(e) =>
                            updateSelectedStyles({ titleFontSize: parseInt(e.target.value, 10) || 180 })
                          }
                          className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-slate-400">Name base size</span>
                        <input
                          type="number"
                          min={24}
                          max={300}
                          value={mergedStyles.nameFontSize}
                          onChange={(e) =>
                            updateSelectedStyles({ nameFontSize: parseInt(e.target.value, 10) || 120 })
                          }
                          className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 lg:sticky lg:top-[calc(var(--app-header-height)+1rem)]">
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
                    <h3 className="font-semibold mb-2 text-sm">Layout editor</h3>
                    <p className="text-xs text-slate-400 mb-3">
                      Click an element to select it, then drag to position. Use sliders for fine control.
                    </p>
                    <LedWysiwygEditor
                      layout={selectedLayout}
                      onLayoutChange={setSelectedLayout}
                      item={selectedItem}
                      title={title}
                      selectedKey={selectedKey}
                      onSelectKey={setSelectedKey}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="lg:col-span-9 text-slate-400 text-sm">Select a cue to edit its layout.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LedLayoutsPage;
