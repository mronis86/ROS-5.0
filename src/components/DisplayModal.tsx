import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'ros_display_open_external';

export type DisplayOpenMode = 'external' | 'browser';

interface DisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFullscreenTimer: (mode: DisplayOpenMode) => void;
  onSelectClock: (mode: DisplayOpenMode) => void;
}

const DisplayModal: React.FC<DisplayModalProps> = ({
  isOpen,
  onClose,
  onSelectFullscreenTimer,
  onSelectClock,
}) => {
  const [openMode, setOpenMode] = useState<DisplayOpenMode>('external');

  useEffect(() => {
    if (!isOpen) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'browser' || saved === 'external') {
        setOpenMode(saved);
      }
    } catch {
      // ignore
    }
  }, [isOpen]);

  const setMode = (mode: DisplayOpenMode) => {
    setOpenMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl">
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
                checked={openMode === 'browser'}
                onChange={() => setMode('browser')}
                className="mt-1"
              />
              <span>
                <span className="text-white text-sm font-medium">This browser (new tab)</span>
                <span className="block text-slate-400 text-xs mt-0.5">
                  Opens in the same browser — capture that tab/window in OBS/vMix instead of pasting a Browser Source URL
                </span>
              </span>
            </label>
          </div>

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
        </div>
      </div>
    </div>
  );
};

export default DisplayModal;
