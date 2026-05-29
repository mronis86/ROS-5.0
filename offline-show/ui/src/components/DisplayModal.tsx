import React from 'react';

interface DisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOfflineTimer: () => void;
}

const DisplayModal: React.FC<DisplayModalProps> = ({ isOpen, onClose, onSelectOfflineTimer }) => {
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

          <div className="bg-amber-950/40 border border-amber-700/50 rounded-lg p-3 mb-4">
            <p className="text-amber-200 text-xs font-semibold mb-1">Offline show · port 3004</p>
            <p className="text-slate-400 text-xs leading-relaxed">
              Syncs with Run of Show on this show laptop over LAN. When <strong className="text-slate-300">Cloud on</strong>{' '}
              is enabled, updates also bridge to the hosted app.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              onSelectOfflineTimer();
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
                  Full-screen countdown, messages, and sub-cue — opens in a new window
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
