import React, { useEffect, useState } from 'react';
import {
  getHideFullscreenTimerOption,
  HIDE_FULLSCREEN_TIMER_CHANGE_EVENT,
} from '../lib/branding';
import { fetchPublicAppSettings } from '../lib/appSettings';
import {
  DSM_FULL_ZOOM_DEFAULT,
  DSM_FULL_ZOOM_LEVELS,
  normalizeDsmFullZoom,
} from '../lib/dsmClockLayout';
import { apiClient } from '../services/api-client';

const STORAGE_KEY = 'ros_display_open_external';

/** external = chrome-less popup; tab = new browser tab; same = replace this tab */
export type DisplayOpenMode = 'external' | 'tab' | 'same';

interface DisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFullscreenTimer: (mode: DisplayOpenMode) => void;
  onSelectClock: (mode: DisplayOpenMode) => void;
  onSelectDsmClock?: (mode: DisplayOpenMode) => void;
  /** When set, Full DSM zoom is loaded/saved as an event-level setting. */
  eventId?: string | null;
}

function normalizeSavedMode(saved: string | null): DisplayOpenMode {
  // Legacy "browser" meant same-tab navigate (mislabeled as new tab)
  if (saved === 'same' || saved === 'browser') return 'same';
  if (saved === 'tab') return 'tab';
  return 'external';
}

const DisplayModal: React.FC<DisplayModalProps> = ({
  isOpen,
  onClose,
  onSelectFullscreenTimer,
  onSelectClock,
  onSelectDsmClock,
  eventId,
}) => {
  const [openMode, setOpenMode] = useState<DisplayOpenMode>('external');
  const [hideFullscreenTimer, setHideFullscreenTimer] = useState(() => getHideFullscreenTimerOption());
  const [fullZoom, setFullZoom] = useState(DSM_FULL_ZOOM_DEFAULT);
  const [fullZoomSaving, setFullZoomSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    try {
      setOpenMode(normalizeSavedMode(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // ignore
    }
    setHideFullscreenTimer(getHideFullscreenTimerOption());
    void fetchPublicAppSettings()
      .then((settings) => {
        setHideFullscreenTimer(settings.hideFullscreenTimerOption === true);
      })
      .catch(() => {
        // keep cached value
      });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !eventId) {
      setFullZoom(DSM_FULL_ZOOM_DEFAULT);
      return;
    }
    let cancelled = false;
    void apiClient
      .getDsmClockLayout(eventId)
      .then((res) => {
        if (cancelled) return;
        setFullZoom(normalizeDsmFullZoom(res?.fullZoom));
      })
      .catch(() => {
        if (!cancelled) setFullZoom(DSM_FULL_ZOOM_DEFAULT);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, eventId]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ hideFullscreenTimerOption?: boolean }>).detail;
      if (typeof detail?.hideFullscreenTimerOption === 'boolean') {
        setHideFullscreenTimer(detail.hideFullscreenTimerOption);
      } else {
        setHideFullscreenTimer(getHideFullscreenTimerOption());
      }
    };
    window.addEventListener(HIDE_FULLSCREEN_TIMER_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(HIDE_FULLSCREEN_TIMER_CHANGE_EVENT, onChange);
  }, []);

  const setMode = (mode: DisplayOpenMode) => {
    setOpenMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  const saveFullZoom = async (next: number) => {
    const zoom = normalizeDsmFullZoom(next);
    setFullZoom(zoom);
    if (!eventId) return;
    setFullZoomSaving(true);
    try {
      await apiClient.setDsmClockLayout(eventId, { fullZoom: zoom });
    } catch (err) {
      console.warn('DSM Full zoom save failed:', err);
    } finally {
      setFullZoomSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Select Display Mode</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-slate-300 text-sm">
            Choose how you want to display the timer information:
          </p>

          <div className="bg-slate-700 rounded-lg p-4 space-y-3">
            <p className="text-white text-sm font-semibold">How to open</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="display-open-mode"
                checked={openMode === 'external'}
                onChange={() => setMode('external')}
                className="mt-1"
              />
              <span>
                <span className="text-white text-sm font-medium">New window (external)</span>
                <span className="block text-slate-400 text-xs mt-0.5">
                  Chrome-less popup — good for a projector or second monitor
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="display-open-mode"
                checked={openMode === 'tab'}
                onChange={() => setMode('tab')}
                className="mt-1"
              />
              <span>
                <span className="text-white text-sm font-medium">New tab</span>
                <span className="block text-slate-400 text-xs mt-0.5">
                  Opens in a new browser tab — keep Run of Show open here
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="display-open-mode"
                checked={openMode === 'same'}
                onChange={() => setMode('same')}
                className="mt-1"
              />
              <span>
                <span className="text-white text-sm font-medium">This tab</span>
                <span className="block text-slate-400 text-xs mt-0.5">
                  Replaces this page — capture that tab in OBS/vMix instead of pasting a Browser Source URL
                </span>
              </span>
            </label>
          </div>

          {!hideFullscreenTimer && (
            <button
              type="button"
              onClick={() => {
                onSelectFullscreenTimer(openMode);
                onClose();
              }}
              className="w-full p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-white font-semibold">Fullscreen Timer</h3>
                  <p className="text-slate-400 text-sm">Large countdown display for stage / confidence</p>
                </div>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onSelectClock(openMode);
              onClose();
            }}
            className="w-full p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold">Clock</h3>
                <p className="text-slate-400 text-sm">Full web clock with schedule and stage messages</p>
              </div>
            </div>
          </button>

          {typeof onSelectDsmClock === 'function' && (
            <button
              type="button"
              onClick={() => {
                if (eventId) void saveFullZoom(fullZoom);
                onSelectDsmClock(openMode);
                onClose();
              }}
              className="w-full p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-600 rounded-lg flex items-center justify-center shrink-0">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div>
                      <h3 className="text-white font-semibold">DSM Clock</h3>
                      <p className="text-slate-400 text-sm">DSM variant of the clock — safe to restyle without changing Clock</p>
                    </div>
                    <div
                      className="flex items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <span className="text-slate-400 text-xs whitespace-nowrap mr-0.5">Full zoom</span>
                      {DSM_FULL_ZOOM_LEVELS.map((level) => (
                        <button
                          key={level}
                          type="button"
                          disabled={!eventId || fullZoomSaving}
                          onClick={(e) => {
                            e.stopPropagation();
                            void saveFullZoom(level);
                          }}
                          className={`min-w-[2.35rem] px-1.5 py-1 rounded text-xs font-semibold tabular-nums transition-colors disabled:opacity-50 ${
                            fullZoom === level
                              ? 'bg-amber-500 text-black'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DisplayModal;
