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

type ReadingGuideMode = 'off' | 'arrows' | 'arrows-with-lines';

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
  showReadingGuide: boolean; // Keep for backward compatibility
  readingGuideMode: ReadingGuideMode;
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
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [show16x9Preview, setShow16x9Preview] = useState<boolean>(true); // Default to 16x9 preview
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState<boolean>(false);
  const [disconnectDuration, setDisconnectDuration] = useState<string>('');
  const [disconnectTimerState, setDisconnectTimerState] = useState<NodeJS.Timeout | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState<boolean>(false);
  
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
    showReadingGuide: true, // Keep for backward compatibility
    readingGuideMode: 'arrows-with-lines',
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
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  

  // Handle disconnect timer confirmation
  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = (hours * 60) + minutes;
    
    if (totalMinutes === 0) {
      alert('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    
    setShowDisconnectModal(false);
    
    // Clear existing timer
    if (disconnectTimerState) {
      clearTimeout(disconnectTimerState);
    }
    
    // Set new timer
    const timeout = setTimeout(() => {
      console.log('⏰ Teleprompter: Auto-disconnecting after timer');
      socketClient.disconnect(eventId);
      setIsWebSocketConnected(false);
      setShowDisconnectNotification(true);
    }, totalMinutes * 60 * 1000);
    
    setDisconnectTimerState(timeout);
    
    // Format duration for display
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (minutes > 0) timeText += `${minutes}m`;
    console.log(`⏰ Teleprompter: Disconnect timer set to ${timeText.trim()}`);
  };
  
  const handleNeverDisconnect = () => {
    if (disconnectTimerState) clearTimeout(disconnectTimerState);
    setDisconnectTimerState(null);
    setShowDisconnectModal(false);
    console.log('⏰ Teleprompter: Disconnect timer set to Never');
  };

  const handleReconnect = () => {
    setShowDisconnectNotification(false);
    console.log('🔄 Teleprompter: Reconnecting...');
    socketClient.connect(eventId, {});
  };
  
  // Load script from database if not in state
  useEffect(() => {
    if (!scriptText && eventId) {
      loadScriptFromDatabase();
    }
  }, [eventId]);

  // Show disconnect timer modal only on first connect
  useEffect(() => {
    if (eventId && !hasShownModalOnce) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }
  }, [eventId, hasShownModalOnce]);
  
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
    
    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ Teleprompter: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(eventId);
        // Timer keeps running in background
      } else if (!socketClient.isConnected()) {
        console.log('👁️ Teleprompter: Tab visible - silently reconnecting WebSocket (no modal)');
        socketClient.connect(eventId, callbacks);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      console.log('🔄 Cleaning up Teleprompter WebSocket connection');
      socketClient.disconnect(eventId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
      
      // Set target scroll position for smooth animation
      const targetScroll = data.scrollPosition;
      targetScrollPositionRef.current = targetScroll;
      
      console.log('📜 Setting target scroll position:', targetScroll);
      
      // If we're not already animating, start the smooth scroll
      if (!viewerAnimationFrameRef.current) {
        const smoothScroll = () => {
          // Get the correct scroll container based on user role
          const scrollContainer = userRole === 'VIEWER' ? viewerScrollRef.current : scriptRef.current;
          if (scrollContainer && targetScrollPositionRef.current !== null) {
            const current = scrollContainer.scrollTop;
            const target = targetScrollPositionRef.current;
            const diff = target - current;
            
            if (Math.abs(diff) > 2) {
              scrollContainer.scrollTop = current + (diff * 0.6);
              viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
            } else {
              scrollContainer.scrollTop = target;
              viewerAnimationFrameRef.current = null;
              targetScrollPositionRef.current = null;
            }
          } else {
            viewerAnimationFrameRef.current = null;
          }
        };
        viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
      }
    };
    
    socket.on('scriptScrollSync', handleScrollSync);
    console.log('✅ Viewer: Teleprompter scroll sync listener attached');
    
    return () => {
      socket.off('scriptScrollSync', handleScrollSync);
    };
  }, [userRole, eventId, isWebSocketConnected]);
  
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
      // Get the correct scroll container based on user role
      const scrollContainer = userRole === 'VIEWER' ? viewerScrollRef.current : scriptRef.current;
      if (scrollContainer && targetScrollPositionRef.current !== null) {
        const current = scrollContainer.scrollTop;
        const target = targetScrollPositionRef.current;
        const diff = target - current;
        
        // Use faster interpolation - move 60% of the distance each frame for more responsive sync
        if (Math.abs(diff) > 2) {
          scrollContainer.scrollTop = current + (diff * 0.6);
          // Continue animation if still moving
          viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
        } else {
          // Close enough - stop animation and set exact position
          scrollContainer.scrollTop = target;
          viewerAnimationFrameRef.current = null;
          targetScrollPositionRef.current = null; // Clear target after reaching it
        }
      } else {
        // No target or ref - stop animation
        viewerAnimationFrameRef.current = null;
      }
    };
    
    // Only start animation if there's a target position and we're not already animating
    if (targetScrollPositionRef.current !== null && !viewerAnimationFrameRef.current) {
      viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
    }
    
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
            if (now - lastScrollBroadcastRef.current >= 50) { // 20 updates per second for smoother sync
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
        
        // Throttle to 20 updates per second for smoother sync
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
    
    // Reset scroll position based on user role
    if (userRole === 'VIEWER' && viewerScrollRef.current) {
      viewerScrollRef.current.scrollTop = 0;
    } else if (userRole === 'SCROLLER' && scriptRef.current) {
      scriptRef.current.scrollTop = 0;
    }
    
    // Also clear any pending scroll animations
    if (viewerAnimationFrameRef.current) {
      cancelAnimationFrame(viewerAnimationFrameRef.current);
      viewerAnimationFrameRef.current = null;
    }
    targetScrollPositionRef.current = null;
  };
  
  /**
   * Fullscreen toggle function for VIEWER role
   * 
   * This function enables distraction-free viewing mode for talent/presenters by:
   * - Entering native browser fullscreen mode (uses Fullscreen API)
   * - Hiding the header and all UI chrome when in fullscreen
   * - Adjusting layout to use full viewport height (100vh)
   * - Repositioning reading guide to accommodate fullscreen dimensions
   * 
   * The fullscreen state is synced with browser events (ESC key, F11, browser controls)
   * and automatically exits on component unmount to prevent stuck fullscreen states.
   */
  const toggleFullscreen = async () => {
    try {
      if (!isFullscreen) {
        // Enter fullscreen - requests native browser fullscreen on the entire document
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
        console.log('✅ Entered fullscreen mode');
      } else {
        // Exit fullscreen - returns to normal windowed mode
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
        setIsFullscreen(false);
        console.log('✅ Exited fullscreen mode');
      }
    } catch (error) {
      console.error('❌ Fullscreen error:', error);
    }
  };
  
  /**
   * Listen for fullscreen changes from browser controls
   * 
   * Syncs the isFullscreen state when user exits fullscreen via:
   * - ESC key
   * - F11 key (browser fullscreen)
   * - Browser UI controls
   * 
   * Also ensures fullscreen is properly exited when component unmounts
   * to prevent stuck fullscreen states when navigating away.
   */
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isCurrentlyFullscreen);
      console.log('🔄 Fullscreen state changed:', isCurrentlyFullscreen);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      // Exit fullscreen on unmount to prevent stuck states
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => console.log('Fullscreen exit error:', err));
      }
    };
  }, []);

  // Sync scroll positions for scroller (always in 16:9 preview mode now)
  useEffect(() => {
    if (userRole === 'SCROLLER') {
      // Force sync after a small delay to ensure DOM is ready
      setTimeout(() => {
        const mainScrollTop = scriptRef.current?.scrollTop || 0;
        // Force sync by setting scroll position directly
        if (scriptRef.current) {
          scriptRef.current.scrollTop = mainScrollTop;
        }
        console.log('🔄 Scroller mode initialized, syncing scroll position:', mainScrollTop);
      }, 50);
    }
  }, [userRole]);
  
  return (
    <div className="min-h-screen" style={{ backgroundColor: settings.backgroundColor }}>
      {/* Header - Hidden in fullscreen mode */}
      <div className="bg-slate-800 border-b border-slate-700 p-4" style={{ display: isFullscreen ? 'none' : 'block' }}>
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
            
            {/* Fullscreen Button - VIEWER only for distraction-free talent viewing */}
            {userRole === 'VIEWER' && (
              <button
                onClick={toggleFullscreen}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium transition-colors"
                title={isFullscreen ? 'Exit Fullscreen (ESC)' : 'Enter Fullscreen'}
              >
                {isFullscreen ? '⛶ Exit Fullscreen' : '⛶ Fullscreen'}
              </button>
            )}
            
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
      <div className="flex flex-1" style={{ height: isFullscreen ? '100vh' : 'calc(100vh - 72px)' }}>
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
                        onClick={() => {
                          const modes: ReadingGuideMode[] = ['arrows-with-lines', 'arrows', 'off'];
                          const currentIndex = modes.indexOf(settings.readingGuideMode);
                          const nextMode = modes[(currentIndex + 1) % modes.length];
                          updateSettings({ 
                            readingGuideMode: nextMode,
                            showReadingGuide: nextMode !== 'off' // Keep backward compatibility
                          });
                        }}
                        className={`px-2 py-2 rounded text-xs font-medium transition-colors ${
                          settings.readingGuideMode === 'arrows-with-lines' ? 'bg-red-600 text-white' :
                          settings.readingGuideMode === 'arrows' ? 'bg-orange-600 text-white' :
                          'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                        title={`Click to cycle guide modes`}
                      >
                        🎯 {settings.readingGuideMode === 'arrows-with-lines' ? 'Lines' : settings.readingGuideMode === 'arrows' ? 'Arrows' : 'Off'}
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
      
      {/* Script Display - Full height, flex-1 to fill remaining space */}
      <div
        ref={scriptRef}
        onScroll={handleManualScroll}
        className="flex-1 overflow-y-auto"
        style={{
          height: isFullscreen ? '100vh' : 'calc(100vh - 72px)',
          transform: `${settings.isMirroredHorizontal ? 'scaleX(-1)' : 'scaleX(1)'} ${settings.isMirroredVertical ? 'scaleY(-1)' : 'scaleY(1)'}`,
          padding: userRole === 'SCROLLER' ? '20px' : '0 5vw',
          scrollBehavior: userRole === 'SCROLLER' && isManualMode ? 'smooth' : 'auto',
          display: userRole === 'SCROLLER' ? 'flex' : 'block',
          justifyContent: userRole === 'SCROLLER' ? 'center' : 'flex-start',
          alignItems: userRole === 'SCROLLER' ? 'center' : 'stretch',
          backgroundColor: userRole === 'SCROLLER' ? '#1a1a1a' : 'transparent',
          overflow: userRole === 'SCROLLER' ? 'hidden' : 'auto' // Remove horizontal scrollbar in preview mode
        }}
      >
        {/* 16:9 Preview Window - Emulates VIEWER fullscreen with synchronized scrolling */}
        {userRole === 'SCROLLER' ? (
        <div
          style={{
              display: 'flex',
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}
          >
            {/* 16:9 Preview Container with scrollable content */}
            <div
              style={{
                width: '1920px',
                height: '1080px',
                backgroundColor: settings.backgroundColor,
                borderRadius: '12px',
                overflow: 'hidden',
                position: 'relative',
                transform: 'scale(0.6)', // Adjusted scale for better sizing
                transformOrigin: 'center center',
                border: '3px solid #333',
                boxShadow: '0 0 20px rgba(0,0,0,0.5)',
                flexShrink: 0
              }}
            >
              {/* Scrollable preview content - mirrors the main script content */}
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  overflow: 'auto',
                  position: 'relative'
                }}
                ref={(el) => {
                  // Sync this preview scroll with the main script scroll
                  if (el && scriptRef.current) {
                    // Force immediate sync without any delay
                    el.scrollTop = scriptRef.current.scrollTop;
                    // Also ensure the main container scroll is synced back
                    if (scriptRef.current.scrollTop !== el.scrollTop) {
                      scriptRef.current.scrollTop = el.scrollTop;
                    }
                  }
                }}
                onScroll={(e) => {
                  // Sync main script scroll with preview scroll
                  if (scriptRef.current) {
                    scriptRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                  
                  // Broadcast scroll position to viewers when scrolling in 16:9 preview mode
                  if (userRole === 'SCROLLER' && eventId) {
                    const now = Date.now();
                    const timeSinceLastBroadcast = now - lastScrollBroadcastRef.current;
                    
                    // Throttle to 20 updates per second for smoother sync
                    if (timeSinceLastBroadcast >= 50) {
                      const lineHeight = settings.fontSize * settings.lineHeight;
                      const currentLine = Math.floor(e.currentTarget.scrollTop / lineHeight);
                      
                      socketClient.emitScriptScroll(
                        e.currentTarget.scrollTop,
                        currentLine,
                        settings.fontSize
                      );
                      
                      lastScrollBroadcastRef.current = now;
                    }
                  }
                }}
                onWheel={(e) => {
                  // Handle wheel events on preview
                  e.preventDefault();
                  if (scriptRef.current) {
                    scriptRef.current.scrollTop += e.deltaY;
                  }
                }}
              >
                {/* Content wrapper with adjusted padding for 16:9 preview */}
                <div
                  style={{
                    minHeight: '100%',
                    paddingTop: '540px', // 50% of 1080px container height
                    paddingBottom: '540px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center'
                  }}
                >
                <div
                  style={{
                    fontSize: `${settings.fontSize * 1.35}px`, // Scale up font to compensate for 0.6 preview scale
            lineHeight: settings.lineHeight,
            textAlign: settings.textAlign,
            color: settings.textColor,
            fontFamily: 'Arial, sans-serif',
                    fontWeight: 500,
                    width: '95%',
                    margin: '0 auto'
                  }}
                >
                  {scriptLines.map((line, index) => {
                    const lineComments = settings.showComments && index > 0 ? getCommentsForLine(index - 1) : [];
                    
                    return (
                      <div 
                        key={index} 
                        className="mb-2"
                        data-line-number={index}
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
              
              {/* Reading Guide for Preview - Fixed to preview container, not scrollable content */}
              {settings.readingGuideMode !== 'off' && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: '0',
                    right: '0',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 50,
                    width: '100%',
                    height: '60px'
                  }}
                >
                  {/* Horizontal lines above and below - only in arrows-with-lines mode */}
                  {settings.readingGuideMode === 'arrows-with-lines' && (
                    <svg width="100%" height="60" style={{ position: 'absolute', top: 0, left: 0 }}>
                      <line 
                        x1="0" 
                        y1="0" 
                        x2="100%" 
                        y2="0" 
                        stroke={settings.readingGuideColor} 
                        strokeWidth="3"
                        opacity="0.7"
                      />
                      <line 
                        x1="0" 
                        y1="60" 
                        x2="100%" 
                        y2="60" 
                        stroke={settings.readingGuideColor} 
                        strokeWidth="3"
                        opacity="0.7"
                      />
                    </svg>
                  )}
                  
                  {/* Left arrow pointing RIGHT (inward) - at the very left edge */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2">
                    <svg width="60" height="60" viewBox="0 0 60 60">
                      <polygon 
                        points="15,10 45,30 15,50" 
                        fill={settings.readingGuideColor}
                        stroke={settings.readingGuideColor}
                        strokeWidth="4"
                        opacity="0.75"
                      />
                    </svg>
                  </div>
                  
                  {/* Right arrow pointing LEFT (inward) - at the very right edge */}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2">
                    <svg width="60" height="60" viewBox="0 0 60 60">
                      <polygon 
                        points="45,10 15,30 45,50" 
                        fill={settings.readingGuideColor}
                        stroke={settings.readingGuideColor}
                        strokeWidth="4"
                        opacity="0.75"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* VIEWER: Always show cropped 16x9 view (scaled down when not fullscreen) */
          <div
            style={{
              display: 'flex',
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              backgroundColor: !isFullscreen ? '#1a1a1a' : 'transparent' // Letterbox effect when not fullscreen
            }}
          >
            <div
              style={{
                width: '1920px',
                height: '1080px',
                backgroundColor: settings.backgroundColor,
                overflow: 'hidden',
                position: 'relative',
                transform: !isFullscreen 
                  ? `scale(${Math.min((window.innerWidth * 0.9) / 1920, (window.innerHeight * 0.8) / 1080)})` // Smaller scale when not fullscreen
                  : `scale(${Math.min(window.innerWidth / 1920, window.innerHeight / 1080)})`, // Full scale in fullscreen
                transformOrigin: 'center center',
                flexShrink: 0,
                border: !isFullscreen ? '3px solid #333' : 'none', // Border when not fullscreen
                borderRadius: !isFullscreen ? '12px' : '0',
                boxShadow: !isFullscreen ? '0 0 20px rgba(0,0,0,0.5)' : 'none'
              }}
            >
              {/* Scrollable viewer content at fixed 1920x1080 */}
              <div
                ref={(el) => {
                  // Store the viewer scroll container ref
                  if (el && userRole === 'VIEWER') {
                    viewerScrollRef.current = el;
                  }
                }}
                style={{
                  width: '100%',
                  height: '100%',
                  overflow: 'auto', // Allow scrolling to sync with scroller
                  position: 'relative'
                }}
              >
                <div
                  style={{
                    minHeight: '100%',
                    paddingTop: 'calc(50vh + 100px)', // Adjusted to better align with reading guide
                    paddingBottom: 'calc(50vh + 100px)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center'
                  }}
                >
                  <div
                    style={{
                      fontSize: `${settings.fontSize * 1.35}px`, // Match the 16x9 preview font scaling
                      lineHeight: settings.lineHeight,
                      textAlign: settings.textAlign,
                      color: settings.textColor,
                      fontFamily: 'Arial, sans-serif',
                      fontWeight: 500,
                      width: '95%', // Match the 16x9 preview width
                      margin: '0 auto'
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
      
              {/* Reading Guide for VIEWER - Fixed inside the 1920x1080 container */}
              {settings.readingGuideMode !== 'off' && (
                <div
                  style={{
                    position: 'absolute',
                    left: '0',
                    right: '0',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '100%',
                    height: '60px',
                    pointerEvents: 'none',
                    zIndex: 50
                  }}
                >
                  {/* Horizontal lines - only in arrows-with-lines mode */}
                  {settings.readingGuideMode === 'arrows-with-lines' && (
                    <svg width="100%" height="60" style={{ position: 'absolute', top: 0, left: 0 }}>
                      <line 
                        x1="0" 
                        y1="0" 
                        x2="100%" 
                        y2="0" 
                        stroke={settings.readingGuideColor} 
                        strokeWidth="3"
                        opacity="0.7"
                      />
                      <line 
                        x1="0" 
                        y1="60" 
                        x2="100%" 
                        y2="60" 
                        stroke={settings.readingGuideColor} 
                        strokeWidth="3"
                        opacity="0.7"
                      />
                    </svg>
                  )}
                  
                  {/* Left arrow pointing RIGHT (inward) - at the very left edge */}
                  <div className="absolute left-0 top-1/2 -translate-y-1/2">
                    <svg width="60" height="60" viewBox="0 0 60 60">
                      <polygon 
                        points="15,10 45,30 15,50" 
                        fill={settings.readingGuideColor}
                        stroke={settings.readingGuideColor}
                        strokeWidth="4"
                        opacity="0.75"
                      />
                    </svg>
                  </div>
                  
                  {/* Right arrow pointing LEFT (inward) - at the very right edge */}
                  <div className="absolute right-0 top-1/2 -translate-y-1/2">
                    <svg width="60" height="60" viewBox="0 0 60 60">
                      <polygon 
                        points="45,10 15,30 45,50" 
                        fill={settings.readingGuideColor}
                        stroke={settings.readingGuideColor}
                        strokeWidth="4"
                        opacity="0.75"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      

      {/* Disconnect Timer Modal */}
      {showDisconnectModal && <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />}
      
      {/* Disconnect Notification */}
      {showDisconnectNotification && <DisconnectNotification duration={disconnectDuration} onReconnect={handleReconnect} />}
      
      </div>
    </div>
  );
};

// Reuse the same components from PhotoViewPage
const DisconnectTimerModal: React.FC<{ onConfirm: (hours: number, mins: number) => void; onNever: () => void }> = ({ onConfirm, onNever }) => {
  const [hours, setHours] = useState(2);
  const [minutes, setMinutes] = useState(0);
  
  const minuteValues = [0, 5, 10, 15, 20, 25, 30];
  const hoursRef = React.useRef<HTMLDivElement>(null);
  const minutesRef = React.useRef<HTMLDivElement>(null);
  
  React.useEffect(() => {
    if (hoursRef.current) hoursRef.current.scrollTop = hours * 50;
    if (minutesRef.current) minutesRef.current.scrollTop = minuteValues.indexOf(minutes) * 50;
  }, []);
  
  const handleHoursScroll = () => {
    if (!hoursRef.current) return;
    const index = Math.round(hoursRef.current.scrollTop / 50);
    setHours(Math.max(0, Math.min(index, 24)));
  };
  
  const handleMinutesScroll = () => {
    if (!minutesRef.current) return;
    const index = Math.round(minutesRef.current.scrollTop / 50);
    setMinutes(minuteValues[Math.max(0, Math.min(index, minuteValues.length - 1))]);
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[999999]">
      <div className="bg-slate-800 p-10 rounded-2xl border border-slate-700 shadow-2xl max-w-3xl w-[90%]">
        <h3 className="text-slate-100 text-3xl font-semibold mb-2 text-center">⏰ Auto-Disconnect Timer</h3>
        <p className="text-slate-400 mb-8 text-center">How long should this connection stay active?</p>
        
        <div className="flex items-center justify-center gap-12 mb-10 py-8">
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Hours</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl shadow-inner overflow-hidden">
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-blue-500/10 border-y border-slate-500/20 pointer-events-none z-10" />
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20" />
              <div ref={hoursRef} onScroll={handleHoursScroll} className="h-full overflow-y-scroll scrollbar-hide pt-24 pb-24 snap-y snap-mandatory" style={{ scrollBehavior: 'smooth' }}>
                {Array.from({length: 25}, (_, i) => (
                  <div key={i} className={`h-12 flex items-center justify-center text-2xl font-medium snap-center transition-all ${hours === i ? 'text-slate-100 scale-110' : 'text-slate-600 scale-90'}`}>{i}</div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="text-slate-300 text-4xl font-light mt-10">:</div>
          
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Minutes</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl shadow-inner overflow-hidden">
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-blue-500/10 border-y border-slate-500/20 pointer-events-none z-10" />
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20" />
              <div ref={minutesRef} onScroll={handleMinutesScroll} className="h-full overflow-y-scroll scrollbar-hide pt-24 pb-24 snap-y snap-mandatory" style={{ scrollBehavior: 'smooth' }}>
                {minuteValues.map(m => (
                  <div key={m} className={`h-12 flex items-center justify-center text-2xl font-medium snap-center transition-all ${minutes === m ? 'text-slate-100 scale-110' : 'text-slate-600 scale-90'}`}>{m}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button onClick={() => onConfirm(hours, minutes)} className="flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/30">✓ Confirm</button>
          <button onClick={onNever} className="flex-1 px-8 py-4 bg-slate-600 hover:bg-slate-500 rounded-xl text-slate-200 text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-600/30">∞ Never Disconnect</button>
        </div>
        
        <p className="mt-6 text-sm text-slate-500 text-center">⚠️ "Never" may increase database costs</p>
      </div>
    </div>
  );
};

const DisconnectNotification: React.FC<{ duration: string; onReconnect: () => void }> = ({ duration, onReconnect }) => {
  React.useEffect(() => {
    console.log('🔔 Teleprompter DisconnectNotification mounted:', duration);
    return () => console.log('🔔 Teleprompter DisconnectNotification unmounted');
  }, []);
  
  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-70 z-[999998] animate-fade-in pointer-events-auto" />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999999] animate-slide-in pointer-events-auto">
        <div className="bg-gradient-to-br from-slate-800 to-slate-700 p-10 rounded-2xl border-2 border-slate-600 shadow-2xl flex items-center gap-6 min-w-[450px]">
          <div className="text-6xl animate-pulse-slow">🔌</div>
          <div className="flex-1">
            <h4 className="text-slate-100 text-2xl font-semibold mb-2">Connection Closed</h4>
            <p className="text-slate-400 text-base">Auto-disconnected after {duration}</p>
          </div>
          <button onClick={onReconnect} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-base font-medium whitespace-nowrap transition transform hover:-translate-y-1 hover:shadow-lg hover:shadow-blue-600/40">🔄 Reconnect</button>
        </div>
      </div>
    </>
  );
};

export default TeleprompterPage;

