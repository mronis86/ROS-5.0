import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'ros_offline_display_open_external';

export type DisplayOpenMode = 'external' | 'browser';

interface DisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOfflineTimer: (mode: DisplayOpenMode) => void;
}

const DisplayModal: React.FC<DisplayModalProps> = ({ isOpen, onClose, onSelectOfflineTimer }) => {
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] p-4">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl border border-slate-700">
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
          <p className="text-slate-300 text-sm mb-2">
            Open the timer display for stage monitors, iPads, and confidence screens on the show network.
          </p>

          <div className="bg-amber-950/40 border border-amber-700/50 rounded-lg p-3">
            <p className="text-amber-200 text-xs font-semibold mb-1">Offline show · port 3004</p>
            <p className="text-slate-400 text-xs leading-relaxed">
              Syncs with Run of Show on this show laptop over LAN. When{' '}
              <strong className="text-slate-300">Cloud on</strong> is enabled, updates also bridge to the hosted app.
            </p>
          </div>

          <div className="bg-slate-700 rounded-lg p-4 space-y-3">
            <p className="text-white text-sm font-semibold">How to open</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="offline-display-open-mode"
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
                name="offline-display-open-mode"
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
              onSelectOfflineTimer(openMode);
              onClose();
            }}
            className="w-full p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left ring-1 ring-amber-600/50"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-600 rounded-lg flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold">Offline Timer Screen</h3>
                <p className="text-slate-400 text-sm">
                  Full-screen countdown, messages, and sub-cue
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DisplayModal;
