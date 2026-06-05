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
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-5xl max-h-[90vh] flex flex-col min-h-0">
        {/* Header */}
        <div className="flex-shrink-0 flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">OSC Control Panel</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        {/* Content - scrollable so it stays inside modal */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 overflow-y-auto">
          
          {/* Left Column - Event Info & Download */}
          <div className="space-y-4 min-w-0">
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
              
              {/* Bitfocus Companion Module - PREFERRED (first) */}
              <div className="text-center mb-4">
                <div className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-emerald-700 text-emerald-100 mb-2">
                  PREFERRED
                </div>
                <a
                  href="/companion-module-runofshow-full.zip"
                  download="companion-module-runofshow-full.zip"
                  className="block bg-purple-600 hover:bg-purple-500 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                >
                  🎛️ Bitfocus Companion Module (full)
                </a>
                <div className="text-xs text-purple-400 mt-2">
                  Native API control • No Electron/Python • Load cue, timer, sub-timer • Includes node_modules
                </div>
              </div>

              <div className="text-center mb-4">
                <a
                  href="/companion-module-runofshow-resolume-full.zip"
                  download="companion-module-runofshow-resolume-full.zip"
                  className="block bg-fuchsia-700 hover:bg-fuchsia-600 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                >
                  🎬 Companion Module — Resolume Sync
                </a>
                <div className="text-xs text-fuchsia-300 mt-2">
                  Resolume OSC → ROS timer • Arm cue, clip sync, periodic re-sync • Separate module instance
                </div>
              </div>

              {/* Python OSC App (ros-osc-python-app) */}
              <div className="text-center mb-4">
                <a
                  href="/ros-osc-python-app.zip"
                  download="ros-osc-python-app.zip"
                  className="block bg-green-600 hover:bg-green-700 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                >
                  🐍 Python OSC App (GUI)
                </a>
                <div className="text-xs text-green-400 mt-2">
                  GUI toggle • Railway or Local • WebSocket • ros-osc-python-app
                </div>
              </div>

              {/* Electron: Portable (left) + Full/Desktop (right) side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div className="text-center">
                  <a
                    href="/ROS-OSC-Control-portable.zip"
                    download="ROS-OSC-Control-portable.zip"
                    className="block bg-amber-600 hover:bg-amber-500 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                  >
                    ⚡ ROS-OSC-Control (Portable)
                  </a>
                  <div className="text-xs text-amber-400 mt-2">
                    Single .exe • No install • ros-osc-control dist
                  </div>
                </div>
                <div className="text-center">
                  <a
                    href="/electron-osc-app.zip"
                    download="electron-osc-app.zip"
                    className="block bg-blue-600 hover:bg-blue-700 text-white text-sm py-3 px-6 rounded text-center transition-colors font-semibold"
                  >
                    🖥️ Electron OSC App (Desktop)
                  </a>
                  <div className="text-xs text-blue-400 mt-2">
                    Event list • Run of Show • OSC Log
                  </div>
                </div>
              </div>
              
              <div className="text-xs text-slate-500 mt-2 text-center leading-tight">
                <strong>Zips</strong> (updated by <code className="bg-slate-600 px-1 rounded">npm run prebuild</code>, <code className="bg-slate-600 px-1 rounded">node scripts/zip-companion-module-full.js</code>, <code className="bg-slate-600 px-1 rounded">node scripts/zip-companion-module-resolume-full.js</code>, or Netlify build). Portable: <code className="bg-slate-600 px-1 rounded">create-ros-osc-control-zip.bat</code>.
              </div>
            </div>
          </div>

          {/* Right Column - OSC Commands */}
          <div className="space-y-4 min-w-0">
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
                    <div>/timer/adjust/+1</div>
                    <div>/timer/adjust/-1</div>
                    <div>/timer/adjust/+5</div>
                    <div>/timer/adjust/-5</div>
                  </div>
                  <div className="text-slate-500 text-xs mt-1">Adjust: ±1 min, ±5 min (while timer running)</div>
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
