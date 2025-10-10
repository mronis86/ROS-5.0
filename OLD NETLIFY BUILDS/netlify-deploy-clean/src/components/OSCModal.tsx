import React, { useState, useEffect, useRef } from 'react';

interface OSCMessage {
  id: string;
  timestamp: Date;
  address: string;
  args: any[];
  direction: 'incoming' | 'outgoing';
}

interface OSCConnectionStatus {
  isConnected: boolean;
  serverPort: number;
  lastPing?: Date;
  error?: string;
}

interface OSCModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: any;
  schedule: any[];
  activeItemId: number | null;
  activeTimers: Record<number, boolean>;
  onLoadCue?: (cueId: string) => void;
  onStartTimer?: (timerId: string) => void;
  onStopTimer?: (timerId: string) => void;
  onResetTimer?: (timerId: string) => void;
  onStartSubTimer?: (itemId: number) => void;
  onStopSubTimer?: (itemId: number) => void;
}

const OSCModal: React.FC<OSCModalProps> = ({ 
  isOpen, 
  onClose, 
  event, 
  schedule,
  activeItemId,
  activeTimers,
  onLoadCue, 
  onStartTimer, 
  onStopTimer, 
  onResetTimer,
  onStartSubTimer,
  onStopSubTimer
}) => {
  const [connectionStatus, setConnectionStatus] = useState<OSCConnectionStatus>({
    isConnected: false,
    serverPort: 57121
  });
  const [serverHost, setServerHost] = useState('localhost');
  
  const [messages, setMessages] = useState<OSCMessage[]>([]);
  const [cueName, setCueName] = useState('');
  const [timerId, setTimerId] = useState('');
  const [isLogging, setIsLogging] = useState(true);
  const [oscClient, setOscClient] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'controls' | 'messages' | 'status' | 'schedule'>('controls');

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle OSC responses by calling Run of Show functions
  const handleOSCResponse = (address: string, args: any[]) => {
    console.log("🎯 Handling OSC response:", address, args);
    
    if (address === '/cue/loaded' && args.length >= 1) {
      const cueId = args[0];
      console.log("🎯 Cue loaded, finding item for cue ID:", cueId);
      console.log("🎯 Available schedule items:", schedule.map(item => ({
        id: item.id,
        cue: item.cue,
        customFieldsCue: item.customFields?.cue,
        segmentName: item.segmentName
      })));
      
      // Find the item in the schedule by cue ID
      const item = findItemByCueId(cueId);
      if (item && onLoadCue) {
        console.log("🎯 Found item for cue, calling onLoadCue:", item.id);
        console.log("🎯 About to call onLoadCue with itemId:", item.id.toString());
        onLoadCue(item.id.toString());
      } else {
        console.log("❌ Could not find item for cue ID:", cueId);
        console.log("❌ Available items:", schedule.map(item => ({
          id: item.id,
          cue: item.cue,
          customFieldsCue: item.customFields?.cue
        })));
      }
    } else if (address === '/timer/started') {
      console.log("🎯 Generic timer started - controlling currently loaded cue");
      console.log("🔍 Current activeItemId:", activeItemId);
      
      // Find the most recently loaded item by looking at the schedule
      // and finding items that are marked as loaded
      const loadedItem = schedule.find(item => loadedItems[item.id]);
      console.log("🔍 Found loaded item:", loadedItem);
      
      if (loadedItem && onStartTimer) {
        console.log("🎯 About to call onStartTimer with loaded item ID:", loadedItem.id);
        onStartTimer(loadedItem.id.toString());
      } else if (onStartTimer) {
        console.log("🎯 No loaded item found, trying generic start");
        onStartTimer('generic');
      } else {
        console.log("❌ onStartTimer prop not available");
      }
    } else if (address === '/timer/stopped') {
      console.log("🎯 Generic timer stopped - controlling currently running timer");
      console.log("🔍 Current activeItemId:", activeItemId);
      // Generic stop - control whatever is currently running
      if (onStopTimer) {
        console.log("🎯 About to call onStopTimer with 'generic'");
        onStopTimer('generic');
      } else {
        console.log("❌ onStopTimer prop not available");
      }
    } else if (address === '/timer/reset') {
      console.log("🎯 Generic timer reset - using resetAllStates");
      // Generic reset - control whatever is currently running
      if (onResetTimer) {
        onResetTimer('generic');
      }
    } else if (address === '/subtimer/started' && args.length >= 1) {
      const subTimerId = args[0];
      console.log("🎯 Sub-timer started, finding item for sub-timer ID:", subTimerId);
      
      // Find the item in the schedule by sub-timer ID
      const item = findItemBySubTimerId(subTimerId);
      if (item && onStartSubTimer) {
        console.log("🎯 Found item for sub-timer, calling onStartSubTimer:", item.id);
        onStartSubTimer(item.id);
      } else {
        console.log("❌ Could not find item for sub-timer ID:", subTimerId);
      }
    } else if (address === '/subtimer/stopped' && args.length >= 1) {
      const subTimerId = args[0];
      console.log("🎯 Sub-timer stopped, finding item for sub-timer ID:", subTimerId);
      
      // Find the item in the schedule by sub-timer ID
      const item = findItemBySubTimerId(subTimerId);
      if (item && onStopSubTimer) {
        console.log("🎯 Found item for sub-timer, calling onStopSubTimer:", item.id);
        onStopSubTimer(item.id);
      } else {
        console.log("❌ Could not find item for sub-timer ID:", subTimerId);
      }
    }
  };

  // Find item by cue ID (supports various formats like "1", "1.1", "1A")
  const findItemByCueId = (cueId: string) => {
    if (!schedule.length) return null;
    
    console.log("🔍 Finding item for cue ID:", cueId);
    console.log("🔍 Schedule items:", schedule.map(item => ({
      id: item.id,
      cue: item.cue,
      customFieldsCue: item.customFields?.cue,
      segmentName: item.segmentName
    })));
    
    const foundItem = schedule.find(item => {
      const itemCue = item.customFields?.cue || item.cue || '';
      const matches = itemCue === cueId || 
             itemCue === `CUE ${cueId}` || 
             itemCue === `CUE${cueId}` ||
             item.cue === cueId ||
             item.id.toString() === cueId;
      
      if (matches) {
        console.log("✅ Found matching item:", {
          id: item.id,
          cue: item.cue,
          customFieldsCue: item.customFields?.cue,
          segmentName: item.segmentName
        });
      }
      
      return matches;
    });
    
    if (!foundItem) {
      console.log("❌ No item found for cue ID:", cueId);
    }
    
    return foundItem;
  };

  // Find item by timer ID (5-digit format)
  const findItemByTimerId = (timerId: string) => {
    if (!schedule.length) return null;
    
    return schedule.find(item => {
      return item.timerId === timerId || item.id.toString() === timerId;
    });
  };

  // Find item by sub-timer ID (can be any cue number)
  const findItemBySubTimerId = (subTimerId: string) => {
    if (!schedule.length) return null;
    
    return schedule.find(item => {
      // Look for items by cue number, timerId, or ID
      const itemCue = item.customFields?.cue || item.cue || '';
      return item.timerId === subTimerId || 
             item.id.toString() === subTimerId ||
             item.cue === subTimerId ||
             itemCue === subTimerId ||
             itemCue.includes(subTimerId);
    });
  };

  // Initialize WebSocket OSC client
  useEffect(() => {
    if (!isOpen) return;

    const initOSC = () => {
      try {
        // Create WebSocket connection to OSC server
        const ws = new WebSocket(`ws://${serverHost}:${connectionStatus.serverPort}/osc`);
        
        ws.onopen = () => {
          console.log("🔌 OSC WebSocket connected");
          setConnectionStatus(prev => ({ ...prev, isConnected: true, error: undefined }));
          addMessage({
            address: "/system/connected",
            args: [],
            direction: 'outgoing'
          });
        };

        ws.onmessage = (event) => {
          try {
            console.log("📨 OSC WebSocket message received:", event.data);
            const data = JSON.parse(event.data);
            
            if (data.type === 'connected') {
              console.log("✅ OSC Server:", data.message);
            } else if (data.type === 'osc_response') {
              console.log("📥 OSC Response:", data.address, data.args);
              addMessage({
                address: data.address,
                args: data.args,
                direction: 'incoming'
              });
              
              // Handle OSC responses by calling Run of Show functions
              handleOSCResponse(data.address, data.args);
            } else if (data.type === 'pong') {
              console.log("🏓 Pong received");
              addMessage({
                address: "/pong",
                args: ["server", "alive"],
                direction: 'incoming'
              });
            }
          } catch (error) {
            console.error("❌ Error parsing WebSocket message:", error);
          }
        };

        ws.onerror = (error) => {
          console.error("❌ WebSocket error:", error);
          setConnectionStatus(prev => ({ 
            ...prev, 
            isConnected: false, 
            error: 'OSC server not running - start osc-websocket-server.js'
          }));
        };

        ws.onclose = () => {
          console.log("🔌 OSC WebSocket disconnected");
          setConnectionStatus(prev => ({ 
            ...prev, 
            isConnected: false, 
            error: 'Connection closed'
          }));
        };

        setOscClient(ws);

        // Test connection
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log("🏓 Sending ping to OSC server...");
            ws.send(JSON.stringify({
              type: 'osc',
              address: '/ping',
              args: []
            }));
          } else {
            console.log("❌ WebSocket not ready for ping");
          }
        }, 1000);

      } catch (error) {
        console.error("❌ Failed to initialize OSC WebSocket:", error);
        setConnectionStatus(prev => ({ 
          ...prev, 
          isConnected: false, 
          error: 'Failed to create WebSocket connection'
        }));
      }
    };

    initOSC();

    return () => {
      if (oscClient && oscClient.readyState === WebSocket.OPEN) {
        oscClient.close();
      }
    };
  }, [isOpen]);

  const addMessage = (message: Omit<OSCMessage, 'id' | 'timestamp'>) => {
    if (!isLogging) return;
    
    const newMessage: OSCMessage = {
      ...message,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev.slice(-99), newMessage]); // Keep last 100 messages
  };


  const sendOSCMessage = (address: string, args: any[] = []) => {
    if (!oscClient || !connectionStatus.isConnected) {
      console.log("❌ OSC server not connected - cannot send message");
      alert('OSC server not connected');
      return;
    }

    try {
      const message = {
        type: 'osc',
        address,
        args
      };
      console.log("📤 Sending OSC message:", message);
      oscClient.send(JSON.stringify(message));
      addMessage({ address, args, direction: 'outgoing' });
    } catch (error) {
      console.error('❌ Error sending OSC message:', error);
      alert('Failed to send OSC message');
    }
  };

  const loadCue = () => {
    if (!cueName.trim()) {
      alert('Please enter a cue name');
      return;
    }
    const cueId = cueName.trim();
    sendOSCMessage(`/cue/${cueId}/load`, []);
  };

  // Generic start/stop - control whatever is currently loaded
  const startTimer = () => {
    if (activeItemId) {
      console.log("🎯 Generic start - controlling currently loaded item:", activeItemId);
      sendOSCMessage(`/timer/start`, []);
    } else {
      alert('No cue is currently loaded. Please load a cue first.');
    }
  };

  const stopTimer = () => {
    const runningTimerIds = Object.keys(activeTimers);
    if (runningTimerIds.length > 0) {
      const runningTimerId = parseInt(runningTimerIds[0]);
      console.log("🎯 Generic stop - controlling currently running timer:", runningTimerId);
      sendOSCMessage(`/timer/stop`, []);
    } else {
      alert('No timer is currently running.');
    }
  };

  const resetTimer = () => {
    console.log("🎯 Generic reset - using resetAllStates (same as Reset button)");
    sendOSCMessage(`/timer/reset`, []);
  };

  // Sub-timer controls for indented items
  const startSubTimer = () => {
    if (!timerId.trim()) {
      alert('Please enter a cue number');
      return;
    }
    sendOSCMessage(`/subtimer/cue/${timerId.trim()}/start`, []);
  };

  const stopSubTimer = () => {
    if (!timerId.trim()) {
      alert('Please enter a cue number');
      return;
    }
    sendOSCMessage(`/subtimer/cue/${timerId.trim()}/stop`, []);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">OSC Control Panel</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-600 mb-6">
          <button
            onClick={() => setActiveTab('controls')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'controls'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            🎮 Controls
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'messages'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            📨 Messages ({messages.length})
          </button>
          <button
            onClick={() => setActiveTab('status')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'status'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            📊 Status
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'schedule'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            📋 Schedule ({schedule.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {/* Controls Tab */}
          {activeTab === 'controls' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
              {/* Server Configuration */}
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Server Configuration</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Server Host/IP
                    </label>
                    <input
                      type="text"
                      value={serverHost}
                      onChange={(e) => setServerHost(e.target.value)}
                      placeholder="localhost, 192.168.1.100, or your computer's IP"
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Use 'localhost' for same computer, or your computer's IP address for network access
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Server Port
                    </label>
                    <input
                      type="number"
                      value={connectionStatus.serverPort}
                      onChange={(e) => setConnectionStatus(prev => ({ ...prev, serverPort: parseInt(e.target.value) || 57121 }))}
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (connectionStatus.isConnected) {
                        // Disconnect first
                        setConnectionStatus(prev => ({ ...prev, isConnected: false }));
                      } else {
                        // Connect with new settings
                        initOSC();
                      }
                    }}
                    className={`w-full px-4 py-2 rounded-md font-medium ${
                      connectionStatus.isConnected
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {connectionStatus.isConnected ? 'Disconnect' : 'Connect'}
                  </button>
                </div>
              </div>

              {/* Controls */}
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Cue & Timer Controls</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Cue Name (to load)
                    </label>
                    <input
                      type="text"
                      value={cueName}
                      onChange={(e) => setCueName(e.target.value)}
                      placeholder="Enter cue name (1, 1.1, 1A, etc.)"
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Sub-Timer ID (for indented items)
                    </label>
                    <input
                      type="text"
                      value={timerId}
                      onChange={(e) => setTimerId(e.target.value)}
                      placeholder="Enter sub-timer ID"
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-md text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  {/* Main Cue Controls */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-slate-300">Main Cue Controls</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={loadCue}
                        className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors"
                      >
                        Load Cue
                      </button>
                      <button
                        onClick={startTimer}
                        className="px-3 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                      >
                        Start (Generic)
                      </button>
                      <button
                        onClick={stopTimer}
                        className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
                      >
                        Stop (Generic)
                      </button>
                      <button
                        onClick={resetTimer}
                        className="px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded transition-colors"
                      >
                        Reset (Generic)
                      </button>
                    </div>
                  </div>

                  {/* Sub-Timer Controls */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-slate-300">Sub-Timer Controls</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={startSubTimer}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                      >
                        Start Sub-Timer
                      </button>
                      <button
                        onClick={stopSubTimer}
                        className="px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded transition-colors"
                      >
                        Stop Sub-Timer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages Tab */}
          {activeTab === 'messages' && (
            <div className="bg-slate-700 rounded-lg p-4 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">OSC Message Log</h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isLogging}
                      onChange={(e) => setIsLogging(e.target.checked)}
                      className="rounded"
                    />
                    <label className="text-sm text-slate-300">Enable Logging</label>
                  </div>
                  <button
                    onClick={clearMessages}
                    className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded transition-colors"
                  >
                    Clear Messages
                  </button>
                </div>
              </div>
              <div className="bg-slate-900 rounded-lg p-4 flex-1 overflow-y-auto font-mono text-sm">
                {messages.length === 0 ? (
                  <div className="text-slate-500 text-center py-8">
                    {!connectionStatus.isConnected ? (
                      <div>
                        <div className="text-red-400 mb-2">⚠️ OSC Server Not Connected</div>
                        {connectionStatus.error?.includes('Node.js environment') ? (
                          <div>
                            <div className="text-sm text-yellow-400 mb-2">OSC requires local Node.js server</div>
                            <div className="text-sm">For online deployment, OSC is not available.</div>
                            <div className="text-sm">For local use with OSC:</div>
                            <div className="text-xs font-mono bg-slate-800 p-2 rounded mt-2">
                              start-both-servers.bat
                            </div>
                            <div className="text-xs mt-1">Or: start-websocket-osc-server.bat</div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-sm">Start the OSC server using:</div>
                            <div className="text-xs font-mono bg-slate-800 p-2 rounded mt-2">
                              node osc-server.js
                            </div>
                            <div className="text-xs mt-2">Or use the batch file: start-osc-server.bat</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      "No messages yet. Send OSC commands to see messages."
                    )}
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex items-start gap-3 py-1 ${
                        message.direction === 'incoming' ? 'text-green-400' : 'text-blue-400'
                      }`}
                    >
                      <span className="text-slate-500 text-xs w-20 flex-shrink-0">
                        {formatTimestamp(message.timestamp)}
                      </span>
                      <span className="text-slate-500 text-xs w-20 flex-shrink-0">
                        {message.direction === 'incoming' ? '←' : '→'}
                      </span>
                      <span className="text-yellow-400 flex-shrink-0">
                        {message.address}
                      </span>
                      {message.args.length > 0 && (
                        <span className="text-slate-300">
                          {JSON.stringify(message.args)}
                        </span>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}

          {/* Status Tab */}
          {activeTab === 'status' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
              {/* Connection Status */}
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-4">Connection Status</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${connectionStatus.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span className="text-sm">
                      {connectionStatus.isConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                  <div className="text-sm text-slate-400">
                    Server: {serverHost}:{connectionStatus.serverPort}
                  </div>
                  
                  {/* Current State Display */}
                  <div className="border-t border-slate-600 pt-3">
                    <div className="text-sm font-medium text-slate-300 mb-2">Current State:</div>
                    <div className="text-xs text-slate-400 space-y-1">
                      <div>Loaded Cue: {activeItemId ? `Item ${activeItemId}` : 'None'}</div>
                      <div>Running Timers: {Object.keys(activeTimers).length}</div>
                      {Object.keys(activeTimers).length > 0 && (
                        <div className="text-green-400">
                          Active: {Object.keys(activeTimers).map(id => `Item ${id}`).join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {connectionStatus.error && (
                    <div className="text-sm text-red-400">
                      Error: {connectionStatus.error}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (oscClient && oscClient.readyState === WebSocket.OPEN) {
                          oscClient.send(JSON.stringify({
                            type: 'osc',
                            address: '/ping',
                            args: []
                          }));
                        }
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                    >
                      Test Connection
                    </button>
                    {!connectionStatus.isConnected && (
                      <button
                        onClick={() => {
                          // Force reconnection by closing and reopening
                          if (oscClient) {
                            oscClient.close();
                          }
                          // The useEffect will handle reconnection
                          setConnectionStatus(prev => ({ ...prev, error: undefined }));
                        }}
                        className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* OSC Commands Reference */}
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-4">OSC Commands Reference</h3>
                <div className="text-xs text-slate-400 space-y-3">
                  <div>
                    <div className="font-semibold text-slate-300 mb-1">Main Cue Commands:</div>
                    <div className="font-mono bg-slate-800 p-2 rounded">
                      <div>/cue/1/load</div>
                      <div>/cue/1.1/load</div>
                      <div>/cue/1A/load</div>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-300 mb-1">Generic Timer Commands:</div>
                    <div className="font-mono bg-slate-800 p-2 rounded">
                      <div>/timer/start</div>
                      <div>/timer/stop</div>
                      <div>/timer/reset</div>
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-300 mb-1">Sub-Timer Commands:</div>
                    <div className="font-mono bg-slate-800 p-2 rounded">
                      <div>/subtimer/cue/5/start</div>
                      <div>/subtimer/cue/5/stop</div>
                    </div>
                  </div>
                  
                  {/* Download Links */}
                  <div className="border-t border-slate-600 pt-3">
                    <div className="font-semibold text-slate-300 mb-2">Download OSC Tools:</div>
                    <div className="space-y-2">
                      <a
                        href="/start-osc-server.bat"
                        download="start-osc-server.bat"
                        className="block w-full bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3 rounded text-center transition-colors"
                      >
                        📥 Download OSC Server (start-osc-server.bat)
                      </a>
                      <a
                        href="/start-osc-cli.bat"
                        download="start-osc-cli.bat"
                        className="block w-full bg-green-600 hover:bg-green-700 text-white text-xs py-2 px-3 rounded text-center transition-colors"
                      >
                        📥 Download OSC CLI (start-osc-cli.bat)
                      </a>
                      <a
                        href="/start-react-server.bat"
                        download="start-react-server.bat"
                        className="block w-full bg-purple-600 hover:bg-purple-700 text-white text-xs py-2 px-3 rounded text-center transition-colors"
                      >
                        📥 Download React Server (start-react-server.bat)
                      </a>
                      <a
                        href="/start-osc-with-cli.bat"
                        download="start-osc-with-cli.bat"
                        className="block w-full bg-orange-600 hover:bg-orange-700 text-white text-xs py-2 px-3 rounded text-center transition-colors"
                      >
                        📥 Download OSC Server + CLI (start-osc-with-cli.bat)
                      </a>
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      Place these files in your project folder and run them to start the OSC server, CLI, and React app. The orange button starts both OSC server and CLI together.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Schedule Tab */}
          {activeTab === 'schedule' && (
            <div className="bg-slate-700 rounded-lg p-4 h-full flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">Schedule Items ({schedule.length})</h3>
                <div className="text-sm text-slate-400">
                  Active Item: {activeItemId ? `Item ${activeItemId}` : 'None'}
                </div>
              </div>
              <div className="bg-slate-900 rounded-lg p-4 flex-1 overflow-y-auto min-h-0 max-h-96">
                {schedule.length === 0 ? (
                  <div className="text-slate-500 text-center py-8">
                    No schedule items available
                  </div>
                ) : (
                  <div className="space-y-2">
                    {schedule.map((item, index) => (
                      <div
                        key={item.id}
                        className={`p-3 rounded-lg border ${
                          activeItemId === item.id
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-slate-800 border-slate-600 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-mono text-slate-400">
                              #{index + 1}
                            </div>
                            <div className="font-medium">
                              {item.segmentName || 'Untitled Segment'}
                            </div>
                            {item.customFields?.cue && (
                              <div className="text-xs bg-slate-700 px-2 py-1 rounded">
                                {item.customFields.cue}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {activeTimers[item.id] && (
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            )}
                            <div className="text-xs text-slate-400">
                              ID: {item.id}
                            </div>
                          </div>
                        </div>
                        {item.isIndented && (
                          <div className="text-xs text-slate-400 mt-1 ml-6">
                            Sub-item (indented)
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OSCModal;
