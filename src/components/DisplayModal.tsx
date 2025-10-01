import React from 'react';

interface DisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFullscreenTimer: () => void;
  onSelectClock: () => void;
}

const DisplayModal: React.FC<DisplayModalProps> = ({ 
  isOpen, 
  onClose, 
  onSelectFullscreenTimer, 
  onSelectClock 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-2xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Select Display Mode</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <p className="text-slate-300 text-sm mb-6">
            Choose how you want to display the timer information:
          </p>
          
          <div className="bg-slate-700 rounded-lg p-3 mb-4">
            <p className="text-slate-400 text-xs">
              <strong>Fullscreen Timer:</strong> Browser dependent - opens in new browser window<br/>
              <strong>Clock:</strong> Full web based - integrated web display
            </p>
          </div>

          {/* Fullscreen Timer Option */}
          <button
            onClick={() => {
              onSelectFullscreenTimer();
              onClose();
            }}
            className="w-full p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold">Fullscreen Timer</h3>
                <p className="text-slate-400 text-sm">Browser dependent - opens in new browser window</p>
              </div>
            </div>
          </button>

          {/* Clock Option */}
          <button
            onClick={() => {
              onSelectClock();
              onClose();
            }}
            className="w-full p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold">Clock</h3>
                <p className="text-slate-400 text-sm">Full web based - integrated web display</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DisplayModal;
