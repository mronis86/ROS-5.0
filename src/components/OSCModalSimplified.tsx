import React from 'react';

interface OSCModalSimplifiedProps {
  isOpen: boolean;
  onClose: () => void;
  event: any;
}

const OSCModalSimplified: React.FC<OSCModalSimplifiedProps> = ({ 
  isOpen, 
  onClose, 
  event
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-5xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">OSC Control Panel</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Left Column - Event Info & Download */}
          <div className="space-y-4">
            {/* Event Information */}
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Event Information</h3>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-slate-400 mb-1">Event ID:</div>
                  <div className="px-3 py-2 bg-slate-600 border border-slate-500 rounded text-blue-400 font-mono text-sm">
                    {event?.id || 'No event selected'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 mb-1">Event Name:</div>
                  <div className="px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm">
                    {event?.name || 'No event selected'}
                  </div>
                </div>
              </div>
            </div>

            {/* Download Section */}
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3 text-center">📥 Download OSC Apps</h3>
              
              {/* Electron OSC App */}
              <div className="text-center mb-4">
                <a
                  href="/electron-osc-app.zip"
                  download="electron-osc-app.zip"
                  className="block bg-blue-600 hover:bg-blue-700 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                >
                  🖥️ Electron OSC App (Desktop)
                </a>
                <div className="text-xs text-blue-400 mt-2">
                  ⚡ Desktop app • Event list • Run of Show • OSC Log
                </div>
              </div>
              
              {/* Python WebSocket Version */}
              <div className="text-center">
                <a
                  href="/OSC_WebSocket_App.zip"
                  download="OSC_WebSocket_App.zip"
                  className="block bg-green-600 hover:bg-green-700 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                >
                  🐍 Python OSC App (GUI)
                </a>
                <div className="text-xs text-green-400 mt-2">
                  ✨ GUI toggle • Railway or Local • WebSocket
                </div>
              </div>
              
              <div className="text-xs text-slate-500 mt-3 text-center">
                <strong>Instructions:</strong> Extract zip, run install.bat (or install-dependencies.bat) to install, then start the app
              </div>
            </div>
          </div>

          {/* Right Column - OSC Commands */}
          <div className="space-y-4">
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3">OSC Commands Reference</h3>
              <div className="text-xs text-slate-400 space-y-3">
                <div>
                  <div className="font-semibold text-slate-300 mb-2">Main Cue Commands (Day-Aware):</div>
                  <div className="font-mono bg-slate-800 p-2 rounded text-xs space-y-1">
                    <div>/cue/1/load</div>
                    <div>/cue/1.1/load</div>
                    <div>/cue/1A/load</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-slate-300 mb-2">Timer Commands:</div>
                  <div className="font-mono bg-slate-800 p-2 rounded text-xs space-y-1">
                    <div>/timer/start</div>
                    <div>/timer/stop</div>
                    <div>/timer/reset</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-slate-300 mb-2">Sub-Timer Commands (Day-Aware):</div>
                  <div className="font-mono bg-slate-800 p-2 rounded text-xs space-y-1">
                    <div>/subtimer/cue/5/start</div>
                    <div>/subtimer/cue/5/stop</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-slate-300 mb-2">🆕 Multi-Day Commands:</div>
                  <div className="font-mono bg-slate-800 p-2 rounded text-xs space-y-1">
                    <div>/set-day 2</div>
                    <div>/get-day</div>
                    <div>/list-cues (shows current day only)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default OSCModalSimplified;
