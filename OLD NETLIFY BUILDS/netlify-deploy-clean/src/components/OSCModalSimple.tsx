import React from 'react';

interface OSCModalSimpleProps {
  isOpen: boolean;
  onClose: () => void;
  event: any;
}

const OSCModalSimple: React.FC<OSCModalSimpleProps> = ({ 
  isOpen, 
  onClose, 
  event
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-4xl h-5/6 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">OSC Control Panel</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            
            {/* Event Information */}
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">Event Information</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Event ID
                  </label>
                  <div className="px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-blue-400 font-mono text-sm">
                    {event?.id || 'Not set'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Event Name
                  </label>
                  <div className="px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-green-400 text-sm">
                    {event?.name || 'Not set'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Event Date
                  </label>
                  <div className="px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-slate-300 text-sm">
                    {event?.date || 'Not set'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Location
                  </label>
                  <div className="px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-slate-300 text-sm">
                    {event?.location || 'Not set'}
                  </div>
                </div>
              </div>
            </div>

            {/* OSC Commands Reference */}
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-4">OSC Commands Reference</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-blue-400 font-mono">/set-event &lt;eventId&gt;</div>
                  <div className="text-slate-400 text-xs">Set the current event to work with</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/cue/&lt;cueName&gt;/load</div>
                  <div className="text-slate-400 text-xs">Load a cue (e.g., /cue/1/load)</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/timer/start</div>
                  <div className="text-slate-400 text-xs">Start main timer</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/timer/stop</div>
                  <div className="text-slate-400 text-xs">Stop main timer</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/timer/reset</div>
                  <div className="text-slate-400 text-xs">Reset main timer</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/subtimer/cue/&lt;cueNumber&gt;/start</div>
                  <div className="text-slate-400 text-xs">Start sub-timer for specific cue</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/subtimer/cue/&lt;cueNumber&gt;/stop</div>
                  <div className="text-slate-400 text-xs">Stop sub-timer for specific cue</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/status</div>
                  <div className="text-slate-400 text-xs">Get current status</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono">/list-cues</div>
                  <div className="text-slate-400 text-xs">List available cues</div>
                </div>
              </div>
            </div>

            {/* Download Links */}
            <div className="bg-slate-700 rounded-lg p-4 lg:col-span-2">
              <h3 className="text-lg font-semibold text-white mb-4">Download OSC Tools</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <a
                  href="/start-osc-server.bat"
                  download="start-osc-server.bat"
                  className="block w-full bg-blue-600 hover:bg-blue-700 text-white text-sm py-3 px-4 rounded text-center transition-colors"
                >
                  📥 Download OSC Server<br />
                  <span className="text-xs">(start-osc-server.bat)</span>
                </a>
                <a
                  href="/start-osc-cli.bat"
                  download="start-osc-cli.bat"
                  className="block w-full bg-green-600 hover:bg-green-700 text-white text-sm py-3 px-4 rounded text-center transition-colors"
                >
                  📥 Download OSC CLI<br />
                  <span className="text-xs">(start-osc-cli.bat)</span>
                </a>
                <a
                  href="/start-react-server.bat"
                  download="start-react-server.bat"
                  className="block w-full bg-purple-600 hover:bg-purple-700 text-white text-sm py-3 px-4 rounded text-center transition-colors"
                >
                  📥 Download React Server<br />
                  <span className="text-xs">(start-react-server.bat)</span>
                </a>
              </div>
              <div className="text-xs text-slate-500 mt-4">
                <strong>Instructions:</strong> Place these files in your project folder and run them to start the OSC server, CLI, and React app.
                <br />
                <strong>Note:</strong> The OSC server runs independently and connects directly to Supabase for timer operations.
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default OSCModalSimple;
