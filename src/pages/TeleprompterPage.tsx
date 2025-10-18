import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { useAuth } from '../contexts/AuthContext';

type UserRole = 'SCROLLER' | 'VIEWER';

type CommentType = 'GENERAL' | 'CUE' | 'AUDIO' | 'GFX' | 'VIDEO' | 'LIGHTING';

interface Comment {
  id: string;
  lineNumber: number;
  text: string;
  author: string;
  timestamp: Date | string;
  type: CommentType;
}

// Comment type configuration with colors and icons
const COMMENT_TYPES: Record<CommentType, { label: string; color: string; bgColor: string; icon: string }> = {
  GENERAL: { label: 'General', color: 'text-slate-300', bgColor: 'bg-slate-700', icon: '💬' },
  CUE: { label: 'Cue', color: 'text-yellow-300', bgColor: 'bg-yellow-700', icon: '🎬' },
  AUDIO: { label: 'Audio', color: 'text-green-300', bgColor: 'bg-green-700', icon: '🎵' },
  GFX: { label: 'GFX', color: 'text-purple-300', bgColor: 'bg-purple-700', icon: '🎨' },
  VIDEO: { label: 'Video', color: 'text-red-300', bgColor: 'bg-red-700', icon: '📹' },
  LIGHTING: { label: 'Lighting', color: 'text-orange-300', bgColor: 'bg-orange-700', icon: '💡' }
};

interface TeleprompterSettings {
  scrollSpeed: number;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  isMirroredHorizontal: boolean;
  isMirroredVertical: boolean;
  backgroundColor: string;
  textColor: string;
  lineHeight: number;
  showComments: boolean;
  showReadingGuide: boolean;
  readingGuideColor: string;
}

const TeleprompterPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  
  const eventId = searchParams.get('eventId');
  const eventName = searchParams.get('eventName') || 'Teleprompter';
  const scriptId = searchParams.get('scriptId');
  
  // Get script text and comments from navigation state
  const scriptTextFromState = location.state?.scriptText || '';
  const commentsFromState = location.state?.comments || [];
  const scriptIdFromState = location.state?.scriptId || scriptId;
  const scriptNameFromState = location.state?.scriptName || '';
  
  // State
  const [scriptText, setScriptText] = useState<string>(scriptTextFromState);
  const [comments, setComments] = useState<Comment[]>(commentsFromState);
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(scriptIdFromState);
  const [currentScriptName, setCurrentScriptName] = useState<string>(scriptNameFromState);
  const [userRole, setUserRole] = useState<UserRole>('VIEWER');
  const [isAutoScrolling, setIsAutoScrolling] = useState<boolean>(false);
  const [isManualMode, setIsManualMode] = useState<boolean>(true); // Manual mode by default
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  
  // Teleprompter settings
  const [settings, setSettings] = useState<TeleprompterSettings>({
    scrollSpeed: 50, // pixels per second
    fontSize: 48,
    textAlign: 'center',
    isMirroredHorizontal: false,
    isMirroredVertical: false,
    backgroundColor: '#000000',
    textColor: '#FFFFFF',
    lineHeight: 1.8,
    showComments: true,
    showReadingGuide: true,
    readingGuideColor: '#FF0000'
  });
  
  // Refs
  const scriptRef = useRef<HTMLDivElement>(null);
  const lastScrollBroadcastRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);
  const isAutoScrollingRef = useRef<boolean>(false);
  const targetScrollPositionRef = useRef<number>(0);
  const viewerAnimationFrameRef = useRef<number | null>(null);
  
  // Load script from database if not in state
  useEffect(() => {
    if (!scriptText && eventId) {
      loadScriptFromDatabase();
    }
  }, [eventId]);
  
  const loadScriptFromDatabase = async () => {
    if (!eventId) return;
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/scripts/${eventId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.script_text) {
          setScriptText(data.script_text);
        }
        // Load comments if available
        if (data.comments) {
          setComments(data.comments);
        }
      }
    } catch (error) {
      console.error('Error loading script:', error);
    }
  };
  
  // WebSocket connection
  useEffect(() => {
    if (!eventId) return;
    
    console.log('📡 Connecting to WebSocket for teleprompter...');
    
    const callbacks = {
      onConnectionChange: (connected: boolean) => {
        console.log(connected ? '✅ WebSocket connected for teleprompter' : '❌ WebSocket disconnected');
        setIsWebSocketConnected(connected);
      }
    };
    
    socketClient.connect(eventId, callbacks);
    
    return () => {
      console.log('🔄 Cleaning up Teleprompter WebSocket connection');
      socketClient.disconnect(eventId);
    };
  }, [eventId]);
  
  // Listen for scroll sync events (Viewers only) using raw socket
  useEffect(() => {
    if (userRole !== 'VIEWER' || !eventId) return;
    
    const socket = socketClient.getSocket();
    if (!socket) return;
    
    console.log('👁️ Viewer: Setting up teleprompter scroll sync listener');
    
    const handleScrollSync = (data: { scrollPosition: number; lineNumber: number; fontSize: number; timestamp: number; eventId?: string }) => {
      console.log('📜 Teleprompter: Received scroll sync:', data);
      
      // Only process scroll sync if it's for the current event
      if (data.eventId && data.eventId !== eventId) {
        console.log('📜 Skipping scroll sync - different event');
        return;
      }
      
      // Set target position for smooth interpolation
      targetScrollPositionRef.current = data.scrollPosition;
    };
    
    socket.on('scriptScrollSync', handleScrollSync);
    console.log('✅ Viewer: Teleprompter scroll sync listener attached');
    
    return () => {
      socket.off('scriptScrollSync', handleScrollSync);
    };
  }, [userRole, eventId]);
  
  // Smooth scroll interpolation for viewers
  useEffect(() => {
    if (userRole !== 'VIEWER') {
      if (viewerAnimationFrameRef.current) {
        cancelAnimationFrame(viewerAnimationFrameRef.current);
        viewerAnimationFrameRef.current = null;
      }
      return;
    }
    
    const smoothScroll = () => {
      if (scriptRef.current && targetScrollPositionRef.current !== null) {
        const current = scriptRef.current.scrollTop;
        const target = targetScrollPositionRef.current;
        const diff = target - current;
        
        // Use smooth interpolation - move 15% of the distance each frame
        if (Math.abs(diff) > 0.5) {
          scriptRef.current.scrollTop = current + (diff * 0.15);
        }
      }
      
      viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
    };
    
    viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
    
    return () => {
      if (viewerAnimationFrameRef.current) {
        cancelAnimationFrame(viewerAnimationFrameRef.current);
        viewerAnimationFrameRef.current = null;
      }
    };
  }, [userRole]);
  
  // Listen for settings sync events (Viewers only) using raw socket
  useEffect(() => {
    if (userRole !== 'VIEWER' || !eventId) return;
    
    const socket = socketClient.getSocket();
    if (!socket) return;
    
    const handleSettingsSync = (data: { settings: TeleprompterSettings; eventId?: string }) => {
      console.log('🎨 Teleprompter: Received settings sync:', data);
      
      if (data.eventId && data.eventId !== eventId) {
        console.log('🎨 Skipping settings sync - different event');
        return;
      }
      
      setSettings(data.settings);
    };
    
    socket.on('teleprompterSettingsUpdated', handleSettingsSync);
    
    return () => {
      socket.off('teleprompterSettingsUpdated', handleSettingsSync);
    };
  }, [userRole, eventId]);
  
  // Auto-scroll engine (only works when NOT in manual mode)
  useEffect(() => {
    if (isManualMode || !isAutoScrolling || userRole !== 'SCROLLER') {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      isAutoScrollingRef.current = false;
      return;
    }
    
    isAutoScrollingRef.current = true; // Mark that we're auto-scrolling
    
    const scroll = (timestamp: number) => {
      if (lastTimestampRef.current) {
        const delta = (timestamp - lastTimestampRef.current) / 1000; // seconds
        const scrollAmount = settings.scrollSpeed * delta;
        
        if (scriptRef.current) {
          scriptRef.current.scrollTop += scrollAmount;
          
          // Broadcast position via WebSocket (throttled)
          const now = Date.now();
          if (now - lastScrollBroadcastRef.current >= 50) { // 20 updates per second max
            const lineHeight = settings.fontSize * settings.lineHeight;
            const currentLine = Math.floor(scriptRef.current.scrollTop / lineHeight);
            
            socketClient.emitScriptScroll(
              scriptRef.current.scrollTop,
              currentLine,
              settings.fontSize
            );
            lastScrollBroadcastRef.current = now;
          }
        }
      }
      lastTimestampRef.current = timestamp;
      animationFrameIdRef.current = requestAnimationFrame(scroll);
    };
    
    animationFrameIdRef.current = requestAnimationFrame(scroll);
    
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [isManualMode, isAutoScrolling, settings.scrollSpeed, settings.fontSize, settings.lineHeight, userRole, eventId]);
  
  // Broadcast settings changes
  const updateSettings = (newSettings: Partial<TeleprompterSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    
    if (userRole === 'SCROLLER' && eventId) {
      // Broadcast settings to viewers
      const socket = socketClient.getSocket();
      if (socket) {
        socket.emit('teleprompterSettingsUpdate', {
          eventId,
          settings: updatedSettings
        });
      }
    }
  };
  
  // Handle manual scroll (pauses auto-scroll for SCROLLER and switches to manual mode)
  const handleManualScroll = () => {
    if (userRole !== 'SCROLLER' || !scriptRef.current) return;
    
    // Broadcast scroll position if we're the scroller
    if (eventId) {
      const now = Date.now();
      const timeSinceLastBroadcast = now - lastScrollBroadcastRef.current;
      
      // Throttle to 20 updates per second
      if (timeSinceLastBroadcast >= 50) {
        const lineHeight = settings.fontSize * settings.lineHeight;
        const currentLine = Math.floor(scriptRef.current.scrollTop / lineHeight);
        
        socketClient.emitScriptScroll(
          scriptRef.current.scrollTop,
          currentLine,
          settings.fontSize
        );
        lastScrollBroadcastRef.current = now;
      }
    }
    
    // If auto-scrolling, switch to manual mode
    if (isAutoScrolling && !isManualMode && !isAutoScrollingRef.current) {
      console.log('📜 Manual scroll detected - switching to Manual Mode');
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      setIsAutoScrolling(false);
      setIsManualMode(true);
      setIsPaused(false);
    }
  };
  
  // Parse script into lines
  const scriptLines = scriptText.split('\n');
  
  // Get comments for a specific line
  const getCommentsForLine = (lineNumber: number): Comment[] => {
    return comments.filter(c => c.lineNumber === lineNumber);
  };

  const toggleManualMode = () => {
    const newManualMode = !isManualMode;
    console.log(`✋ Manual mode: ${newManualMode ? 'ON' : 'OFF'}`);
    setIsManualMode(newManualMode);
    
    // If enabling manual mode, stop auto-scroll
    if (newManualMode && isAutoScrolling) {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      setIsAutoScrolling(false);
      setIsPaused(false);
    }
  };

  const handlePlay = () => {
    if (!isManualMode) {
      console.log('▶️ Play auto-scroll');
      setIsAutoScrolling(true);
      setIsPaused(false);
    }
  };

  const handlePause = () => {
    if (!isManualMode && isAutoScrolling) {
      console.log('⏸️ Pause auto-scroll');
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      setIsAutoScrolling(false);
      setIsPaused(true);
    }
  };

  const handleStop = () => {
    if (!isManualMode) {
      console.log('⏹️ Stop auto-scroll');
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
      setIsAutoScrolling(false);
      setIsPaused(false);
    }
  };

  const handleReset = () => {
    console.log('🔄 Reset - scrolling to top');
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    setIsAutoScrolling(false);
    setIsPaused(false);
    if (scriptRef.current) {
      scriptRef.current.scrollTop = 0;
    }
  };
  
  return (
    <div className="min-h-screen" style={{ backgroundColor: settings.backgroundColor }}>
      {/* Header - Always show for easy role switching */}
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  // Navigate back to Scripts Follow with the current script and comments
                  navigate(`/scripts-follow?eventId=${eventId}&eventName=${encodeURIComponent(eventName || '')}`, {
                    state: {
                      scriptText,
                      comments,
                      scriptId: currentScriptId,
                      scriptName: currentScriptName
                    }
                  });
                }}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
              >
                ← Back to Scripts Follow
              </button>
              {userRole === 'SCROLLER' && (
                <h1 className="text-xl font-bold text-white">{eventName} - Teleprompter</h1>
              )}
            </div>
          
          <div className="flex items-center gap-4">
            {/* Role Toggle - Always visible */}
            <div className="flex gap-2">
              <button
                onClick={() => setUserRole('SCROLLER')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  userRole === 'SCROLLER'
                    ? 'bg-green-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                🎬 Scroller
              </button>
              <button
                onClick={() => setUserRole('VIEWER')}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  userRole === 'VIEWER'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                👁️ Viewer
              </button>
            </div>
            
            {/* Connection Status */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded ${
              isWebSocketConnected ? 'bg-green-600' : 'bg-red-600'
            }`}>
              <div className={`w-2 h-2 rounded-full ${isWebSocketConnected ? 'bg-white animate-pulse' : 'bg-white'}`} />
              <span className="text-xs font-bold text-white">
                {isWebSocketConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Controls Panel - SCROLLER only */}
      {userRole === 'SCROLLER' && (
        <div className={`bg-slate-800 border-b border-slate-700 transition-all duration-300 ${showControls ? 'max-h-96' : 'max-h-12'} overflow-hidden`}>
          <div className="p-4">
            <button
              onClick={() => setShowControls(!showControls)}
              className="text-sm text-slate-400 hover:text-white mb-2"
            >
              {showControls ? '▼ Hide Controls' : '▶ Show Controls'}
            </button>
            
            {showControls && (
              <div className="space-y-4">
                {/* Row 1: Manual Mode Toggle and Control Buttons */}
                <div className="flex items-center gap-4">
                  {/* Manual Mode Toggle Switch */}
                  <div className="flex items-center gap-3 bg-slate-700 px-4 py-3 rounded-lg">
                    <label className="text-sm text-slate-300 font-medium">Manual Mode:</label>
                    <button
                      onClick={toggleManualMode}
                      className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                        isManualMode ? 'bg-blue-600' : 'bg-slate-500'
                      }`}
                    >
                      <span
                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                          isManualMode ? 'translate-x-9' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className={`text-sm font-bold ${isManualMode ? 'text-blue-300' : 'text-slate-400'}`}>
                      {isManualMode ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  
                  {/* Playback Control Buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePlay}
                      disabled={isManualMode || isAutoScrolling}
                      className={`px-5 py-3 rounded-lg font-bold text-base transition-colors ${
                        isManualMode || isAutoScrolling
                          ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                          : 'bg-green-600 text-white hover:bg-green-500'
                      }`}
                      title={isManualMode ? 'Turn off Manual Mode to use auto-scroll' : isAutoScrolling ? 'Already playing' : 'Start auto-scroll'}
                    >
                      ▶️ Play
                    </button>
                    
                    <button
                      onClick={handlePause}
                      disabled={isManualMode || !isAutoScrolling}
                      className={`px-5 py-3 rounded-lg font-bold text-base transition-colors ${
                        isManualMode || !isAutoScrolling
                          ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                          : 'bg-yellow-600 text-white hover:bg-yellow-500'
                      }`}
                      title={isManualMode ? 'Disabled in Manual Mode' : ''}
                    >
                      ⏸️ Pause
                    </button>
                    
                    <button
                      onClick={handleStop}
                      disabled={isManualMode}
                      className={`px-5 py-3 rounded-lg font-bold text-base transition-colors ${
                        isManualMode
                          ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                          : 'bg-red-600 text-white hover:bg-red-500'
                      }`}
                      title={isManualMode ? 'Disabled in Manual Mode' : ''}
                    >
                      ⏹️ Stop
                    </button>
                    
                    <button
                      onClick={handleReset}
                      className="px-5 py-3 rounded-lg font-bold text-base bg-purple-600 text-white hover:bg-purple-500 transition-colors"
                      title="Scroll to top of script"
                    >
                      🔄 Reset
                    </button>
                  </div>
                  
                  <div className="flex-1">
                    <label className="block text-sm text-slate-300 mb-1">
                      Scroll Speed: {settings.scrollSpeed} px/s
                      <span className="ml-2 text-xs text-slate-400">
                        (Tip: Manual scroll auto-pauses)
                      </span>
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="1000"
                      step="10"
                      value={settings.scrollSpeed}
                      onChange={(e) => updateSettings({ scrollSpeed: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </div>
                
                {/* Row 2: Font Size and Line Height */}
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="block text-sm text-slate-300 mb-1">
                      Font Size: {settings.fontSize}px
                    </label>
                    <input
                      type="range"
                      min="24"
                      max="96"
                      step="2"
                      value={settings.fontSize}
                      onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                  
                  <div className="flex-1">
                    <label className="block text-sm text-slate-300 mb-1">
                      Line Height: {settings.lineHeight}
                    </label>
                    <input
                      type="range"
                      min="1.2"
                      max="2.5"
                      step="0.1"
                      value={settings.lineHeight}
                      onChange={(e) => updateSettings({ lineHeight: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </div>
                
                {/* Row 3: Text Alignment */}
                <div className="flex items-center gap-4">
                  <label className="text-sm text-slate-300">Text Align:</label>
                  <div className="flex gap-2">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        onClick={() => updateSettings({ textAlign: align })}
                        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                          settings.textAlign === align
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {align === 'left' ? '⬅️ Left' : align === 'center' ? '↔️ Center' : '➡️ Right'}
                      </button>
                    ))}
                  </div>
                </div>
                
                {/* Row 4: Colors and Mirror */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-300">Background:</label>
                    <input
                      type="color"
                      value={settings.backgroundColor}
                      onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
                      className="w-16 h-10 rounded cursor-pointer"
                    />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-300">Text Color:</label>
                    <input
                      type="color"
                      value={settings.textColor}
                      onChange={(e) => updateSettings({ textColor: e.target.value })}
                      className="w-16 h-10 rounded cursor-pointer"
                    />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-300">Guide:</label>
                    <input
                      type="color"
                      value={settings.readingGuideColor}
                      onChange={(e) => updateSettings({ readingGuideColor: e.target.value })}
                      className="w-16 h-10 rounded cursor-pointer"
                    />
                  </div>
                </div>
                
                {/* Row 5: Flip/Mirror and Features */}
                <div className="flex items-center gap-4 flex-wrap">
                  <button
                    onClick={() => updateSettings({ isMirroredHorizontal: !settings.isMirroredHorizontal })}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      settings.isMirroredHorizontal
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    ↔️ {settings.isMirroredHorizontal ? 'H-Flip ON' : 'Flip Horizontal'}
                  </button>
                  
                  <button
                    onClick={() => updateSettings({ isMirroredVertical: !settings.isMirroredVertical })}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      settings.isMirroredVertical
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    ↕️ {settings.isMirroredVertical ? 'V-Flip ON' : 'Flip Vertical'}
                  </button>
                  
                  <button
                    onClick={() => updateSettings({ showReadingGuide: !settings.showReadingGuide })}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      settings.showReadingGuide
                        ? 'bg-red-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    🎯 {settings.showReadingGuide ? 'Guide ON' : 'Reading Guide'}
                  </button>
                  
                  <button
                    onClick={() => updateSettings({ showComments: !settings.showComments })}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      settings.showComments
                        ? 'bg-yellow-600 text-white'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    }`}
                  >
                    💬 {settings.showComments ? 'Comments ON' : 'Show Comments'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Reading Guide - Fixed at 50% viewport */}
      {settings.showReadingGuide && (
        <div
          className="fixed left-0 right-0 pointer-events-none z-50"
          style={{
            top: '50%',
            transform: 'translateY(-50%)'
          }}
        >
          {/* Left arrow pointing RIGHT (inward) */}
          <div className="absolute left-8 top-1/2 -translate-y-1/2">
            <svg width="60" height="60" viewBox="0 0 60 60">
              <polygon 
                points="15,10 45,30 15,50" 
                fill={settings.readingGuideColor}
                stroke={settings.readingGuideColor}
                strokeWidth="4"
              />
            </svg>
          </div>
          
          {/* Right arrow pointing LEFT (inward) */}
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <svg width="60" height="60" viewBox="0 0 60 60">
              <polygon 
                points="45,10 15,30 45,50" 
                fill={settings.readingGuideColor}
                stroke={settings.readingGuideColor}
                strokeWidth="4"
              />
            </svg>
          </div>
        </div>
      )}
      
      {/* Script Display */}
      <div
        ref={scriptRef}
        onScroll={handleManualScroll}
        className="overflow-y-auto"
        style={{
          height: userRole === 'SCROLLER' ? 'calc(100vh - 280px)' : '100vh',
          transform: `${settings.isMirroredHorizontal ? 'scaleX(-1)' : 'scaleX(1)'} ${settings.isMirroredVertical ? 'scaleY(-1)' : 'scaleY(1)'}`,
          padding: '20vh 5vw'
        }}
      >
        <div
          style={{
            fontSize: `${settings.fontSize}px`,
            lineHeight: settings.lineHeight,
            textAlign: settings.textAlign,
            color: settings.textColor,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 500
          }}
        >
          {scriptLines.map((line, index) => {
            // Get comments from PREVIOUS line (index - 1) to show after it
            // Comment on line 39 (stored as lineNumber: 38) appears before line 40 (index 39)
            const lineComments = settings.showComments && index > 0 ? getCommentsForLine(index - 1) : [];
            
            return (
              <div key={index} className="mb-2">
                {/* Render comment bars from PREVIOUS line BEFORE current line text */}
                {lineComments.length > 0 && (
                  <div className="mb-2 space-y-2">
                    {lineComments.map((comment) => {
                      const commentConfig = COMMENT_TYPES[comment.type];
                      return (
                        <div
                          key={comment.id}
                          className={`${commentConfig.bgColor} px-4 py-3 rounded-lg border-l-4 border-${comment.type.toLowerCase()}-400`}
                          style={{
                            fontSize: `${settings.fontSize * 0.6}px`,
                            transform: settings.isMirroredHorizontal ? 'scaleX(-1)' : 'none'
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-2xl">{commentConfig.icon}</span>
                            <div className="flex-1">
                              <div className={`font-bold ${commentConfig.color} text-sm`}>
                                {commentConfig.label}
                              </div>
                              <div className="text-white mt-1">{comment.text}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                
                {/* Current line text */}
                <div>{line || '\u00A0'}</div>
              </div>
            );
          })}
        </div>
        
        {/* Spacer at the end */}
        <div style={{ height: '50vh' }} />
      </div>
    </div>
  );
};

export default TeleprompterPage;

