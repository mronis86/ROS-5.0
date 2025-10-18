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
  const lineRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  
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
      console.log('📜 Teleprompter: Received scroll sync - line:', data.lineNumber, 'position:', data.scrollPosition);
      
      // Only process scroll sync if it's for the current event
      if (data.eventId && data.eventId !== eventId) {
        console.log('📜 Skipping scroll sync - different event');
        return;
      }
      
      // Sync font size first
      if (data.fontSize && data.fontSize !== settings.fontSize) {
        updateSettings({ fontSize: data.fontSize });
      }
      
      // Use line-based scrolling for better alignment
      // Find which line should be at the reading guide (50% viewport)
      if (scriptRef.current) {
        const containerHeight = scriptRef.current.clientHeight;
        const targetLineAtGuide = Math.floor(data.scrollPosition / (data.fontSize * settings.lineHeight));
        
        // Scroll so that line is at 50% of viewport
        const targetScroll = data.scrollPosition;
        targetScrollPositionRef.current = targetScroll;
        
        console.log('📜 Target line at guide:', targetLineAtGuide, 'Target scroll:', targetScroll);
      }
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
              <h1 className="text-xl font-bold text-white">{eventName} - Teleprompter</h1>
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
      
      {/* Main Area: Sidebar + Script */}
      <div className="flex flex-1" style={{ height: 'calc(100vh - 72px)' }}>
        {/* Left Sidebar - Controls (SCROLLER only) */}
        {userRole === 'SCROLLER' && (
          <div className={`bg-slate-800 border-r border-slate-700 transition-all duration-300 overflow-y-auto flex-shrink-0 ${
            showControls ? 'w-80' : 'w-12'
          }`}>
            <div className="p-3">
              {/* Toggle and Manual Mode Row */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setShowControls(!showControls)}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium transition-colors"
                >
                  {showControls ? '◀' : '▶'}
                </button>
                
                {showControls && (
                  <div className="flex-1 bg-slate-700 px-3 py-2 rounded-lg flex items-center justify-between">
                    <label className="text-xs text-slate-300 font-medium">Manual</label>
                    <button
                      onClick={toggleManualMode}
                      className={`relative h-6 w-12 items-center rounded-full transition-colors flex ${
                        isManualMode ? 'bg-blue-600' : 'bg-slate-500'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 ml-1 transform rounded-full bg-white transition-transform ${
                          isManualMode ? 'translate-x-6' : ''
                        }`}
                      />
                    </button>
                    <span className={`text-xs font-bold ${isManualMode ? 'text-blue-300' : 'text-slate-400'}`}>
                      {isManualMode ? 'ON' : 'OFF'}
                    </span>
                  </div>
                )}
              </div>
              
              {showControls && (
                <div className="space-y-3">
                  
                  {/* Playback Controls */}
                  <div>
                    <label className="text-xs text-slate-300 mb-2 block">Playback:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handlePlay}
                        disabled={isManualMode || isAutoScrolling}
                        className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                          isManualMode || isAutoScrolling
                            ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                            : 'bg-green-600 text-white hover:bg-green-500'
                        }`}
                      >
                        ▶️ Play
                      </button>
                      
                      <button
                        onClick={handlePause}
                        disabled={isManualMode || !isAutoScrolling}
                        className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                          isManualMode || !isAutoScrolling
                            ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                            : 'bg-yellow-600 text-white hover:bg-yellow-500'
                        }`}
                      >
                        ⏸️ Pause
                      </button>
                      
                      <button
                        onClick={handleStop}
                        disabled={isManualMode}
                        className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                          isManualMode
                            ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                            : 'bg-red-600 text-white hover:bg-red-500'
                        }`}
                      >
                        ⏹️ Stop
                      </button>
                      
                      <button
                        onClick={handleReset}
                        className="px-3 py-2 rounded text-xs font-bold bg-purple-600 text-white hover:bg-purple-500 transition-colors"
                      >
                        🔄 Reset
                      </button>
                    </div>
                  </div>
                  
                  {/* Scroll Speed */}
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Speed: {settings.scrollSpeed} px/s
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
                  
                  {/* Font Size */}
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Font: {settings.fontSize}px
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
                  
                  {/* Line Height */}
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
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
                  
                  {/* Text Alignment */}
                  <div>
                    <label className="text-xs text-slate-300 mb-2 block">Text Align:</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => updateSettings({ textAlign: align })}
                          className={`px-2 py-2 rounded text-xl transition-colors ${
                            settings.textAlign === align
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {align === 'left' ? '⬅️' : align === 'center' ? '↔️' : '➡️'}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Colors */}
                  <div>
                    <label className="text-xs text-slate-300 mb-2 block">Colors:</label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Background:</span>
                        <input
                          type="color"
                          value={settings.backgroundColor}
                          onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
                          className="w-12 h-8 rounded cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Text:</span>
                        <input
                          type="color"
                          value={settings.textColor}
                          onChange={(e) => updateSettings({ textColor: e.target.value })}
                          className="w-12 h-8 rounded cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Guide:</span>
                        <input
                          type="color"
                          value={settings.readingGuideColor}
                          onChange={(e) => updateSettings({ readingGuideColor: e.target.value })}
                          className="w-12 h-8 rounded cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Flip/Mirror */}
                  <div>
                    <label className="text-xs text-slate-300 mb-2 block">Flip/Mirror:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => updateSettings({ isMirroredHorizontal: !settings.isMirroredHorizontal })}
                        className={`px-2 py-2 rounded text-xs font-medium transition-colors ${
                          settings.isMirroredHorizontal ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        ↔️ H-Flip
                      </button>
                      
                      <button
                        onClick={() => updateSettings({ isMirroredVertical: !settings.isMirroredVertical })}
                        className={`px-2 py-2 rounded text-xs font-medium transition-colors ${
                          settings.isMirroredVertical ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        ↕️ V-Flip
                      </button>
                    </div>
                  </div>
                  
                  {/* Features */}
                  <div>
                    <label className="text-xs text-slate-300 mb-2 block">Features:</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => updateSettings({ showReadingGuide: !settings.showReadingGuide })}
                        className={`px-2 py-2 rounded text-xs font-medium transition-colors ${
                          settings.showReadingGuide ? 'bg-red-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        🎯 Guide
                      </button>
                      
                      <button
                        onClick={() => updateSettings({ showComments: !settings.showComments })}
                        className={`px-2 py-2 rounded text-xs font-medium transition-colors ${
                          settings.showComments ? 'bg-yellow-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        💬 Comments
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }
        
      {/* Reading Guide - Fixed at 50% viewport, only over script area */}
      {settings.showReadingGuide && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            left: userRole === 'SCROLLER' ? (showControls ? '320px' : '48px') : '0',
            right: '0',
            top: '50%',
            transform: 'translateY(-50%)',
            transition: 'left 0.3s ease'
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
      
      {/* Script Display - Full height, flex-1 to fill remaining space */}
      <div
        ref={scriptRef}
        onScroll={handleManualScroll}
        className="flex-1 overflow-y-auto"
        style={{
          height: 'calc(100vh - 72px)',
          transform: `${settings.isMirroredHorizontal ? 'scaleX(-1)' : 'scaleX(1)'} ${settings.isMirroredVertical ? 'scaleY(-1)' : 'scaleY(1)'}`,
          padding: '50vh 5vw 50vh 5vw',
          scrollBehavior: userRole === 'SCROLLER' && isManualMode ? 'smooth' : 'auto'
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
              <div 
                key={index} 
                className="mb-2"
                data-line-number={index}
                ref={(el) => {
                  if (el) lineRefsMap.current.set(index, el);
                }}
              >
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
      </div>
      </div>
    </div>
  );
};

export default TeleprompterPage;

