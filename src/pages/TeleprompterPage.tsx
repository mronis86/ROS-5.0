import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  tokenizeScriptForSpeech,
  alignTranscriptVoicePrompt,
  normalizeSpeechToken,
  type ScriptSpeechToken
} from '../lib/teleprompter-voice-alignment';
import {
  audioConstraintsForMic,
  computeMicLevelFromTimeDomain,
  isEdgeBrowser,
  listAudioInputDevices,
  unlockAndListMics,
  writeStoredMicId,
} from '../lib/teleprompter-mic';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import { useAuth } from '../contexts/AuthContext';
import {
  DISPLAY_SESSION_MAX_HOURS,
  DISPLAY_SESSION_MAX_HINT,
  DISPLAY_SESSION_MAX_LABEL,
  DISPLAY_SESSION_PICK_TIME_ALERT,
} from '../lib/displaySession';

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
  const [isManualMode, setIsManualMode] = useState<boolean>(true); // Manual mode by default
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [zoomCompensation, setZoomCompensation] = useState<number>(1);
  const [viewerZoomCompensation, setViewerZoomCompensation] = useState<number>(1);
  const [hideViewerScrollbar, setHideViewerScrollbar] = useState<boolean>(false);
  const [showViewerSettings, setShowViewerSettings] = useState<boolean>(false);
  const [scrollerScale, setScrollerScale] = useState<number>(0.6);
  const [viewerScale, setViewerScale] = useState<number>(0.6);
  const [guideLinePosition, setGuideLinePosition] = useState<number>(50); // Percentage from top (50% = center)
  const [commentSize, setCommentSize] = useState<number>(1); // Comment text size multiplier (1 = normal, 1.5 = larger, etc.)
  const [preserveScrollPosition, setPreserveScrollPosition] = useState<boolean>(false);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [show16x9Preview, setShow16x9Preview] = useState<boolean>(true); // Default to 16x9 preview
  const [showDisconnectModal, setShowDisconnectModal] = useState<boolean>(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState<boolean>(false);
  const [disconnectDuration, setDisconnectDuration] = useState<string>('');
  const [disconnectTimerState, setDisconnectTimerState] = useState<NodeJS.Timeout | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState<boolean>(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  /** False after auto-disconnect until user reconnects — blocks socket reconnect. */
  const connectionEnabledRef = useRef(true);

  /** Mic + Web Speech: align transcript to script and scroll */
  const [voiceListenEnabled, setVoiceListenEnabled] = useState(false);
  const [voiceMicCheckOnly, setVoiceMicCheckOnly] = useState(false);
  const [voiceHighlightLine, setVoiceHighlightLine] = useState<number | null>(null);
  /** Matched script word index for word-underline highlight. */
  const [voiceHighlightWordIndex, setVoiceHighlightWordIndex] = useState<number | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string>('');
  const [voiceInterimPreview, setVoiceInterimPreview] = useState<string>('');
  /** off | words (underline) | band (soft fill) */
  const [voiceHighlightStyle, setVoiceHighlightStyle] = useState<'off' | 'words' | 'band'>('words');
  const [voiceHighlightColor, setVoiceHighlightColor] = useState<string>(() => {
    try {
      return localStorage.getItem('ros.teleprompter.voiceHighlightColor') || '#FBBF24';
    } catch {
      return '#FBBF24';
    }
  });
  const [audioInputDevices, setAudioInputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>(() => {
    try {
      return localStorage.getItem('ros.teleprompter.micDeviceId') || '';
    } catch {
      return '';
    }
  });
  const [voiceMicLevel, setVoiceMicLevel] = useState(0);
  const [voiceHeardAnything, setVoiceHeardAnything] = useState(false);
  
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
  const targetScrollPositionRef = useRef<number | null>(null);
  const viewerAnimationFrameRef = useRef<number | null>(null);
  const autoPlayAnimationRef = useRef<number | null>(null);
  const lastAutoPlayTimestampRef = useRef<number>(0);
  const lineRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const viewerScrollRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);

  const voiceListenEnabledRef = useRef(false);
  const voiceMicCheckOnlyRef = useRef(false);
  /** Script word index — VoicePrompt-style matcher advances from here (final + interim). */
  const voiceCommittedAnchorRef = useRef(0);
  const voiceRecentTranscriptWordsRef = useRef<string[]>([]);
  /** Dedupe interim `processHeardText` calls (voice_prompt uses last 8 words when interim changes). */
  const lastVoiceInterimProcessedRef = useRef('');
  /** Pixel scrollTop the voice loop eases toward (stable vs interim transcript noise). */
  const voiceDesiredScrollTopRef = useRef<number | null>(null);
  const voiceScrollLoopRafRef = useRef<number | null>(null);
  /** Last line we ran a full scroll snap; same-line speech only nudges pixels (avoids per-word snapping). */
  const voiceScrollSnapLineRef = useRef(-1);
  /** performance.now() of last successful word advance — drives pause / pace. */
  const voiceLastMatchAtRef = useRef(0);
  /** Smoothed spoken words/sec from match timing. */
  const voiceSpeechRateWpsRef = useRef(2.4);
  /** Current scroll velocity px/s (smoothed toward speech pace). */
  const voiceScrollVelocityRef = useRef(0);
  /** Current matched script word — RAF recomputes guide target from this each frame. */
  const voiceFollowWordRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecognitionRef = useRef<any>(null);
  const voiceMicStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioCtxRef = useRef<AudioContext | null>(null);
  const voiceLevelRafRef = useRef<number | null>(null);

  // Handle disconnect timer confirmation
  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = (hours * 60) + minutes;
    
    if (totalMinutes === 0) {
      alert(DISPLAY_SESSION_PICK_TIME_ALERT);
      return;
    }
    
    setShowDisconnectModal(false);
    connectionEnabledRef.current = true;

    if (disconnectTimerState) {
      clearTimeout(disconnectTimerState);
    }

    const timeout = setTimeout(() => {
      console.log('⏰ Teleprompter: Auto-disconnecting after timer');
      connectionEnabledRef.current = false;
      socketClient.disconnect(eventId || '');
      setIsWebSocketConnected(false);
      setShowDisconnectNotification(true);
    }, totalMinutes * 60 * 1000);
    
    setDisconnectTimerState(timeout);
    
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (minutes > 0) timeText += `${minutes}m`;
    console.log(`⏰ Teleprompter: Disconnect timer set to ${timeText.trim()}`);

    if (eventId && !socketClient.isConnected()) {
      setReconnectKey((k) => k + 1);
    }
  };
  
  const handleNeverDisconnect = () => {
    handleDisconnectTimerConfirm(DISPLAY_SESSION_MAX_HOURS, 0);
  };

  const handleReconnect = () => {
    connectionEnabledRef.current = true;
    setShowDisconnectNotification(false);
    console.log('🔄 Teleprompter: Reconnecting...');
    setReconnectKey((k) => k + 1);
    setShowDisconnectModal(true);
  };
  
  // Calculate zoom compensation based on device pixel ratio
  useEffect(() => {
    const calculateZoomCompensation = () => {
      const devicePixelRatio = window.devicePixelRatio || 1;
      console.log('🖥️ Device pixel ratio:', devicePixelRatio);
      
      // Base compensation for different DPI settings
      let compensation = 1;
      
      if (devicePixelRatio >= 2) {
        // High DPI displays (Retina, 4K, etc.)
        compensation = 0.8;
      } else if (devicePixelRatio >= 1.5) {
        // Medium DPI displays
        compensation = 0.9;
      } else if (devicePixelRatio < 1) {
        // Low DPI displays or zoomed out
        compensation = 1.2;
      }
      
      console.log('🔍 Zoom compensation:', compensation);
      setZoomCompensation(compensation);
      setViewerZoomCompensation(compensation); // Set viewer zoom to same initial value
    };
    
    calculateZoomCompensation();
    
    // Recalculate on window resize (user might change zoom)
    window.addEventListener('resize', calculateZoomCompensation);
    
    return () => {
      window.removeEventListener('resize', calculateZoomCompensation);
    };
  }, []);
  
  // Calculate scroller scale based on window size (responds to browser zoom)
  useEffect(() => {
    const calculateScrollerScale = () => {
      const scale = Math.min((window.innerWidth * 0.9) / 1920, (window.innerHeight * 0.8) / 1080);
      setScrollerScale(scale);
      console.log('📏 Scroller scale:', scale);
    };
    
    calculateScrollerScale();
    window.addEventListener('resize', calculateScrollerScale);
    
    return () => {
      window.removeEventListener('resize', calculateScrollerScale);
    };
  }, []);
  
  // Calculate viewer scale based on window size (responds to browser zoom)
  useEffect(() => {
    const calculateViewerScale = () => {
      const scale = !isFullscreen 
        ? Math.min((window.innerWidth * 0.9) / 1920, (window.innerHeight * 0.8) / 1080)
        : Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      setViewerScale(scale);
      console.log('📏 Viewer scale:', scale);
    };
    
    calculateViewerScale();
    window.addEventListener('resize', calculateViewerScale);
    
    return () => {
      window.removeEventListener('resize', calculateViewerScale);
    };
  }, [isFullscreen]);
  
  // Load script from database if not in state
  useEffect(() => {
    if (!scriptText && eventId) {
      loadScriptFromDatabase();
    }
  }, [eventId]);

  // Show disconnect timer modal only on first connect
  useEffect(() => {
    if (eventId && !hasShownModalOnce && connectionEnabledRef.current) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }
  }, [eventId, hasShownModalOnce]);
  
  const loadScriptFromDatabase = async () => {
    if (!eventId) return;
    
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/scripts/${eventId}`, {
        headers: apiJsonHeaders(),
      });
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
    connectionEnabledRef.current = true;
    
    console.log('📡 Connecting to WebSocket for teleprompter...');
    
    const callbacks = {
      onConnectionChange: (connected: boolean) => {
        console.log(connected ? '✅ WebSocket connected for teleprompter' : '❌ WebSocket disconnected');
        setIsWebSocketConnected(connected);
      }
    };
    
    if (connectionEnabledRef.current) {
      socketClient.connect(eventId, callbacks);
    }
    
    const handleVisibilityChange = () => {
      if (!connectionEnabledRef.current) return;
      if (document.hidden) {
        console.log('👁️ Teleprompter: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(eventId);
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
  }, [eventId, reconnectKey]);
  
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
      
      // Only handle scroll sync for VIEWER mode
      if (userRole === 'VIEWER') {
        // Set target scroll position for smooth animation
        const targetScroll = data.scrollPosition;
        targetScrollPositionRef.current = targetScroll;
        
        console.log('📜 Setting target scroll position for viewer:', targetScroll);
        
        // If we're not already animating, start the smooth scroll
        if (!viewerAnimationFrameRef.current) {
          const smoothScroll = () => {
            // Only use viewerScrollRef for viewers
            if (viewerScrollRef.current && targetScrollPositionRef.current !== null) {
              const current = viewerScrollRef.current.scrollTop;
              const target = targetScrollPositionRef.current;
              const diff = target - current;
              
              if (Math.abs(diff) > 2) {
                viewerScrollRef.current.scrollTop = current + (diff * 0.6);
                viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
              } else {
                viewerScrollRef.current.scrollTop = target;
                viewerAnimationFrameRef.current = null;
                targetScrollPositionRef.current = null;
              }
            } else {
              viewerAnimationFrameRef.current = null;
            }
          };
          viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
        }
      } else {
        console.log('📜 Scroll sync ignored for scroller mode');
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
      // Clear any target position for non-viewers
      targetScrollPositionRef.current = null;
      return;
    }
    
    const smoothScroll = () => {
      // Only run smooth scroll for viewers
      if (viewerScrollRef.current && targetScrollPositionRef.current !== null) {
        const current = viewerScrollRef.current.scrollTop;
        const target = targetScrollPositionRef.current;
        const diff = target - current;
        
        console.log('🔄 Viewer scroll sync:', {
          current,
          target,
          diff
        });
        
        // Use faster interpolation - move 60% of the distance each frame for more responsive sync
        if (Math.abs(diff) > 2) {
          viewerScrollRef.current.scrollTop = current + (diff * 0.6);
          // Continue animation if still moving
          viewerAnimationFrameRef.current = requestAnimationFrame(smoothScroll);
        } else {
          // Close enough - stop animation and set exact position
          viewerScrollRef.current.scrollTop = target;
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
    
    const handleGuideLineSync = (data: { guideLinePosition: number; eventId?: string }) => {
      console.log('📏 Teleprompter: Received guide line sync:', data);
      
      if (data.eventId && data.eventId !== eventId) {
        console.log('📏 Skipping guide line sync - different event');
        return;
      }
      
      setGuideLinePosition(data.guideLinePosition);
    };
    
    socket.on('teleprompterSettingsUpdated', handleSettingsSync);
    socket.on('teleprompterGuideLineUpdated', handleGuideLineSync);
    
    return () => {
      socket.off('teleprompterSettingsUpdated', handleSettingsSync);
      socket.off('teleprompterGuideLineUpdated', handleGuideLineSync);
    };
  }, [userRole, eventId]);
  
  // Auto-play functionality
  useEffect(() => {
    console.log('🎬 Auto-play useEffect triggered:', { isAutoPlaying, isPaused, isManualMode, userRole });
    
    if (!isAutoPlaying || isPaused || isManualMode || userRole !== 'SCROLLER' || voiceListenEnabled) {
      // Stop auto-play
      if (autoPlayAnimationRef.current) {
        console.log('🎬 Stopping auto-play animation');
        cancelAnimationFrame(autoPlayAnimationRef.current);
        autoPlayAnimationRef.current = null;
      }
      return;
    }

    console.log('🎬 Starting auto-play');
    
    const autoScroll = (timestamp: number) => {
      if (lastAutoPlayTimestampRef.current) {
        const deltaTime = (timestamp - lastAutoPlayTimestampRef.current) / 1000; // seconds
        const scrollAmount = settings.scrollSpeed * deltaTime;
        
        if (previewScrollRef.current) {
          previewScrollRef.current.scrollTop += scrollAmount;
        }
        
        // Also sync the main script container
        if (scriptRef.current && previewScrollRef.current) {
          scriptRef.current.scrollTop = previewScrollRef.current.scrollTop;
        }
        
        // Broadcast scroll position to viewers
        if (eventId && previewScrollRef.current) {
          const now = Date.now();
          if (now - lastScrollBroadcastRef.current >= 50) { // 20 updates per second
            const lineHeight = settings.fontSize * settings.lineHeight;
            const currentLine = Math.floor(previewScrollRef.current.scrollTop / lineHeight);
            
            socketClient.emitScriptScroll(
              previewScrollRef.current.scrollTop,
              currentLine,
              settings.fontSize
            );
            lastScrollBroadcastRef.current = now;
          }
        }
      }
      
      lastAutoPlayTimestampRef.current = timestamp;
      autoPlayAnimationRef.current = requestAnimationFrame(autoScroll);
    };
    
    autoPlayAnimationRef.current = requestAnimationFrame(autoScroll);
    
    return () => {
      if (autoPlayAnimationRef.current) {
        cancelAnimationFrame(autoPlayAnimationRef.current);
        autoPlayAnimationRef.current = null;
      }
    };
  }, [isAutoPlaying, isPaused, isManualMode, userRole, voiceListenEnabled, settings.scrollSpeed, settings.fontSize, settings.lineHeight, eventId]);

  // Manual scroll handling - simplified without auto-scroll
  
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
  
  // Broadcast guide line position changes to viewers
  const updateGuideLinePosition = (position: number) => {
    setGuideLinePosition(position);
    
    if (userRole === 'SCROLLER' && eventId) {
      // Broadcast guide line position to viewers
      const socket = socketClient.getSocket();
      if (socket) {
        socket.emit('teleprompterGuideLineUpdate', {
          eventId,
          guideLinePosition: position
        });
      }
    }
  };
  
  // Preserve scroll position when comment size changes
  useEffect(() => {
    if (preserveScrollPosition && scriptRef.current) {
      const currentScrollTop = scriptRef.current.scrollTop;
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (scriptRef.current) {
          scriptRef.current.scrollTop = currentScrollTop;
        }
      });
      setPreserveScrollPosition(false);
    }
  }, [commentSize, preserveScrollPosition]);
  
  // Handle manual scroll - broadcast position to viewers
  const handleManualScroll = () => {
    if (userRole !== 'SCROLLER' || !scriptRef.current) return;
    
    // Don't broadcast if auto-play is running (it handles its own broadcasting)
    if (isAutoPlaying && !isPaused) return;
    
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
  };

  const clearVoiceScrollTarget = useCallback(() => {
    voiceDesiredScrollTopRef.current = null;
    voiceScrollSnapLineRef.current = -1;
    voiceLastMatchAtRef.current = 0;
    voiceSpeechRateWpsRef.current = 2.4;
    voiceScrollVelocityRef.current = 0;
    voiceFollowWordRef.current = null;
  }, []);

  /**
   * How far (in scrollTop px) to move so the matched word sits on the guide.
   * Uses live on-screen positions — highlight vs guide — not a stale content offset.
   */
  const measureScrollDeltaWordToGuide = useCallback(
    (wordIndex: number, tokens: ScriptSpeechToken[]): number | null => {
      const container = previewScrollRef.current;
      if (!container || tokens.length === 0) return null;

      const wi = Math.max(0, Math.min(wordIndex, tokens.length - 1));
      const lineIndex = tokens[wi].lineIndex;

      const cRect = container.getBoundingClientRect();
      if (cRect.height < 2) return null;
      const guideY = cRect.top + (guideLinePosition / 100) * cRect.height;

      // Prefer the actual highlighted word DOM node when present
      const wordEl = container.querySelector(
        `[data-voice-word="${wi}"]`
      ) as HTMLElement | null;

      let wordY: number;
      if (wordEl) {
        const wRect = wordEl.getBoundingClientRect();
        wordY = wRect.top + wRect.height * 0.5;
      } else {
        const lineEl = lineRefsMap.current.get(lineIndex);
        if (!lineEl) return null;
        let lineStart = wi;
        while (lineStart > 0 && tokens[lineStart - 1].lineIndex === lineIndex) lineStart--;
        let lineEnd = wi;
        while (lineEnd < tokens.length - 1 && tokens[lineEnd + 1].lineIndex === lineIndex) {
          lineEnd++;
        }
        const wordsOnLine = Math.max(1, lineEnd - lineStart + 1);
        const frac = (wi - lineStart + 0.5) / wordsOnLine;
        const lRect = lineEl.getBoundingClientRect();
        wordY = lRect.top + lRect.height * Math.min(0.85, Math.max(0.15, frac));
      }

      // Positive => word is below the guide => scroll down
      const deltaScreen = wordY - guideY;
      const scaleY = cRect.height / (container.offsetHeight || 1);
      if (!Number.isFinite(scaleY) || scaleY < 0.05) return null;
      return deltaScreen / scaleY;
    },
    [guideLinePosition]
  );

  const setVoiceScrollDesiredFromWord = useCallback(
    (wordIndex: number, _tokens: ScriptSpeechToken[]) => {
      if (userRole !== 'SCROLLER') return;
      voiceFollowWordRef.current = wordIndex;
      // Target is refreshed from live measurements in the RAF loop
      const el = previewScrollRef.current;
      if (el) voiceDesiredScrollTopRef.current = el.scrollTop;
    },
    [userRole]
  );

  useEffect(() => {
    if (!voiceListenEnabled || userRole !== 'SCROLLER') {
      if (voiceScrollLoopRafRef.current !== null) {
        cancelAnimationFrame(voiceScrollLoopRafRef.current);
        voiceScrollLoopRafRef.current = null;
      }
      return;
    }

    const lineHeightPx = settings.fontSize * settings.lineHeight * 1.35;
    const tokens = tokenizeScriptForSpeech(scriptText);
    let lastTs = performance.now();

    const tick = (ts: number) => {
      const el = previewScrollRef.current;
      const dt = Math.min(0.05, Math.max(0.008, (ts - lastTs) / 1000));
      lastTs = ts;

      if (el && voiceFollowWordRef.current != null && tokens.length > 0) {
        const delta = measureScrollDeltaWordToGuide(voiceFollowWordRef.current, tokens);
        if (delta != null && Number.isFinite(delta)) {
          const maxS = Math.max(0, el.scrollHeight - el.clientHeight);
          const absDelta = Math.abs(delta);
          const sinceMatchSec =
            voiceLastMatchAtRef.current > 0
              ? (ts - voiceLastMatchAtRef.current) / 1000
              : 99;

          if (sinceMatchSec > 2.5 && absDelta < lineHeightPx * 0.35) {
            // Real pause and nearly aligned — hold
            voiceScrollVelocityRef.current *= 0.85;
          } else if (absDelta < 1.5) {
            // Already on guide
            voiceScrollVelocityRef.current *= 0.6;
          } else {
            // Close the on-screen gap: word below guide → positive delta → scroll down
            const lagLines = absDelta / Math.max(1, lineHeightPx);
            const wps = Math.max(1.4, Math.min(7.5, voiceSpeechRateWpsRef.current));

            // Fraction of the visual error to close this frame (snappier when farther behind)
            let closeFrac =
              lagLines > 1.2 ? 0.55 : lagLines > 0.5 ? 0.42 : lagLines > 0.2 ? 0.32 : 0.22;
            if (sinceMatchSec > 1.2) closeFrac *= 0.55;

            // Also keep a speech-rate floor so we don't stall while talking
            const paceStep = ((wps / 8) * lineHeightPx) * dt;
            const gapStep = delta * closeFrac;
            let step =
              Math.sign(delta) *
              Math.max(Math.abs(gapStep), delta > 0 ? paceStep * 0.35 : 0);

            // Cap speed (~5–9 lines/sec) so catch-up is quick but not a hard snap
            const maxStep = lineHeightPx * (lagLines > 1 ? 9 : 5.5) * dt;
            if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;

            // Never scroll past closing the gap this frame
            if (Math.abs(step) > absDelta) step = delta;

            const next = Math.max(0, Math.min(el.scrollTop + step, maxS));
            el.scrollTop = next;
            voiceDesiredScrollTopRef.current = next;
            voiceScrollVelocityRef.current = step / Math.max(dt, 0.008);
          }

          if (scriptRef.current) scriptRef.current.scrollTop = el.scrollTop;

          if (eventId) {
            const now = Date.now();
            if (now - lastScrollBroadcastRef.current >= 100) {
              const currentLine = Math.floor(el.scrollTop / Math.max(1, lineHeightPx));
              socketClient.emitScriptScroll(el.scrollTop, currentLine, settings.fontSize);
              lastScrollBroadcastRef.current = now;
            }
          }
        }
      }
      voiceScrollLoopRafRef.current = requestAnimationFrame(tick);
    };

    voiceScrollLoopRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (voiceScrollLoopRafRef.current !== null) {
        cancelAnimationFrame(voiceScrollLoopRafRef.current);
        voiceScrollLoopRafRef.current = null;
      }
    };
  }, [
    voiceListenEnabled,
    userRole,
    eventId,
    scriptText,
    measureScrollDeltaWordToGuide,
    settings.fontSize,
    settings.lineHeight,
    settings.scrollSpeed,
    guideLinePosition,
  ]);
  const scriptSpeechTokens = useMemo(() => tokenizeScriptForSpeech(scriptText), [scriptText]);  const clearVoiceHighlight = useCallback(() => {
    setVoiceHighlightLine(null);
    setVoiceHighlightWordIndex(null);
  }, []);

  const hexWithAlpha = useCallback((hex: string, alpha: string) => {
    const raw = hex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return `${raw}${alpha}`;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      const r = raw[1];
      const g = raw[2];
      const b = raw[3];
      return `#${r}${r}${g}${g}${b}${b}${alpha}`;
    }
    return raw;
  }, []);

  /** Spoken words underlined up to the match cursor (Words highlight mode). */
  const renderVoiceLineText = useCallback(
    (line: string, lineIndex: number) => {
      if (!line) return '\u00A0';

      // Always tag words while listening so scroll can measure highlight vs guide
      if (!voiceListenEnabled) return line;

      const parts = line.split(/(\s+)/);
      let tokenIdx = scriptSpeechTokens.findIndex((t) => t.lineIndex === lineIndex);
      if (tokenIdx < 0) return line;

      const useUnderline =
        voiceHighlightStyle === 'words' && voiceHighlightWordIndex != null;

      return parts.map((part, i) => {
        if (!part || /^\s+$/.test(part)) {
          return <React.Fragment key={i}>{part}</React.Fragment>;
        }
        if (/^\[[^\]]*\]$/.test(part.trim())) {
          return <React.Fragment key={i}>{part}</React.Fragment>;
        }
        const norm = normalizeSpeechToken(part);
        const expected = tokenIdx >= 0 ? scriptSpeechTokens[tokenIdx] : null;
        if (!norm || !expected || expected.lineIndex !== lineIndex || expected.word !== norm) {
          return <React.Fragment key={i}>{part}</React.Fragment>;
        }
        const thisWordIdx = tokenIdx;
        tokenIdx += 1;
        const spoken =
          useUnderline && voiceHighlightWordIndex != null && thisWordIdx <= voiceHighlightWordIndex;
        const current = useUnderline && thisWordIdx === voiceHighlightWordIndex;
        return (
          <span
            key={i}
            data-voice-word={thisWordIdx}
            style={
              spoken
                ? {
                    textDecoration: 'underline',
                    textDecorationColor: voiceHighlightColor,
                    textDecorationThickness: current ? '3px' : '2px',
                    textUnderlineOffset: '6px',
                    color: current ? voiceHighlightColor : undefined,
                  }
                : undefined
            }
          >
            {part}
          </span>
        );
      });
    },
    [
      voiceListenEnabled,
      voiceHighlightStyle,
      voiceHighlightWordIndex,
      voiceHighlightColor,
      scriptSpeechTokens,
    ]
  );

  useEffect(() => {
    voiceCommittedAnchorRef.current = 0;
    voiceRecentTranscriptWordsRef.current = [];
    lastVoiceInterimProcessedRef.current = '';
    clearVoiceScrollTarget();
    clearVoiceHighlight();
  }, [scriptText, clearVoiceScrollTarget, clearVoiceHighlight]);
  useEffect(() => {
    voiceListenEnabledRef.current = voiceListenEnabled;
  }, [voiceListenEnabled]);

  useEffect(() => {
    voiceMicCheckOnlyRef.current = voiceMicCheckOnly;
  }, [voiceMicCheckOnly]);

  const stopVoiceMicCapture = useCallback(() => {
    if (voiceLevelRafRef.current != null) {
      cancelAnimationFrame(voiceLevelRafRef.current);
      voiceLevelRafRef.current = null;
    }
    if (voiceAudioCtxRef.current) {
      void voiceAudioCtxRef.current.close().catch(() => {});
      voiceAudioCtxRef.current = null;
    }
    if (voiceMicStreamRef.current) {
      voiceMicStreamRef.current.getTracks().forEach((t) => t.stop());
      voiceMicStreamRef.current = null;
    }
    setVoiceMicLevel(0);
  }, []);

  const refreshAudioInputs = useCallback(async (opts?: { unlock?: boolean }) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      let tempStream: MediaStream | null = null;
      if (opts?.unlock) {
        // Permission unlock so Chrome fills real deviceId + labels
        tempStream = (
          await unlockAndListMics(selectedMicId || undefined)
        ).stream;
      }
      const inputs = await listAudioInputDevices();
      setAudioInputDevices(inputs);
      if (tempStream && !voiceListenEnabledRef.current) {
        tempStream.getTracks().forEach((t) => t.stop());
      } else if (tempStream && voiceListenEnabledRef.current) {
        // Listening — keep using existing capture; drop unlock stream
        tempStream.getTracks().forEach((t) => t.stop());
      }
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setVoiceStatus(
        name === 'NotAllowedError'
          ? 'Microphone blocked — allow mic for localhost:3003, then click List mics.'
          : 'Could not list microphones.'
      );
    }
  }, [selectedMicId]);

  useEffect(() => {
    if (userRole !== 'SCROLLER') return;
    void refreshAudioInputs();
    const onChange = () => void refreshAudioInputs();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, [userRole, refreshAudioInputs]);

  const startVoiceLevelMeter = useCallback(async (deviceId: string) => {
    stopVoiceMicCapture();
    const stream = await navigator.mediaDevices.getUserMedia(audioConstraintsForMic(deviceId));
    voiceMicStreamRef.current = stream;
    const devices = await listAudioInputDevices();
    setAudioInputDevices(devices);

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return stream;

    const ctx = new AudioCtx();
    voiceAudioCtxRef.current = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tickLevel = () => {
      analyser.getByteTimeDomainData(data);
      setVoiceMicLevel(computeMicLevelFromTimeDomain(data));
      voiceLevelRafRef.current = requestAnimationFrame(tickLevel);
    };
    voiceLevelRafRef.current = requestAnimationFrame(tickLevel);
    return stream;
  }, [stopVoiceMicCapture]);

  // Meter-only mic check (SpeechRecognition mutes getUserMedia meters in Chrome — keep them separate)
  useEffect(() => {
    if (!voiceListenEnabled || !voiceMicCheckOnly || userRole !== 'SCROLLER') {
      return;
    }

    let cancelled = false;
    setVoiceStatus('Opening mic for audio meter…');
    setVoiceHeardAnything(false);
    setVoiceInterimPreview('');

    (async () => {
      try {
        await startVoiceLevelMeter(selectedMicId);
        if (cancelled) return;
        setVoiceStatus('Meter live — talk and watch the bars. (Speech-to-text is separate: use Auto-scroll.)');
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setVoiceStatus(
          name === 'NotAllowedError'
            ? 'Microphone blocked — allow mic for this site.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'Could not open that mic — pick System default or another device.'
              : 'Could not open microphone.'
        );
        setVoiceListenEnabled(false);
        setVoiceMicCheckOnly(false);
      }
    })();

    return () => {
      cancelled = true;
      stopVoiceMicCapture();
    };
  }, [
    voiceListenEnabled,
    voiceMicCheckOnly,
    selectedMicId,
    userRole,
    startVoiceLevelMeter,
    stopVoiceMicCapture,
  ]);

  // Speech-to-text follow (no concurrent meter stream — Chrome exclusive mic)
  useEffect(() => {
    if (!voiceListenEnabled || voiceMicCheckOnly || userRole !== 'SCROLLER') {
      if (!voiceListenEnabled || voiceMicCheckOnly) {
        if (speechRecognitionRef.current) {
          const rec = speechRecognitionRef.current;
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          rec.onaudiostart = null;
          rec.onspeechstart = null;
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
          speechRecognitionRef.current = null;
        }
      }
      if (!voiceListenEnabled) {
        clearVoiceScrollTarget();
        if (!voiceMicCheckOnly) stopVoiceMicCapture();
        setVoiceInterimPreview('');
        setVoiceHeardAnything(false);
        if (!voiceMicCheckOnly) setVoiceStatus('');
      }
      return;
    }

    const SpeechRecognitionApi =
      typeof window !== 'undefined'
        ? ((window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
            (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition)
        : null;

    if (!SpeechRecognitionApi) {
      setVoiceStatus('Speech recognition needs Chrome or Edge.');
      setVoiceListenEnabled(false);
      return;
    }

    let cancelled = false;

    setIsManualMode(false);
    setIsAutoPlaying(false);
    setIsPaused(false);
    if (autoPlayAnimationRef.current) {
      cancelAnimationFrame(autoPlayAnimationRef.current);
      autoPlayAnimationRef.current = null;
    }

    setVoiceHeardAnything(false);
    setVoiceInterimPreview('');
    setVoiceStatus('Claiming selected mic, then starting speech recognition…');
    lastVoiceInterimProcessedRef.current = '';

    if (previewScrollRef.current) {
      voiceDesiredScrollTopRef.current = previewScrollRef.current.scrollTop;
    }
    voiceLastMatchAtRef.current = 0;
    voiceSpeechRateWpsRef.current = 2.4;
    voiceScrollVelocityRef.current = 0;

    if (scriptSpeechTokens.length > 0 && previewScrollRef.current) {
      const scrollEl = previewScrollRef.current;
      const lh = settings.fontSize * settings.lineHeight * 1.35;
      const approxLine = Math.floor(scrollEl.scrollTop / Math.max(1, lh * 0.82));
      const maxLine = scriptSpeechTokens[scriptSpeechTokens.length - 1]?.lineIndex ?? 0;
      const lineClamped = Math.max(0, Math.min(maxLine, approxLine));
      const wi = scriptSpeechTokens.findIndex((t) => t.lineIndex >= lineClamped);
      voiceCommittedAnchorRef.current = wi >= 0 ? wi : 0;
      // Start snap at the visible line so the first match can't yank us back to line 0
      voiceScrollSnapLineRef.current = lineClamped;
      // Don't highlight until speech actually matches a line
      clearVoiceHighlight();
    } else {
      voiceCommittedAnchorRef.current = 0;
      voiceScrollSnapLineRef.current = 0;
    }

    const startRecognition = async () => {
      const onEdge = isEdgeBrowser();
      // Briefly open the chosen device so the browser prefers it, then release for SpeechRecognition
      try {
        stopVoiceMicCapture();
        const claim = await navigator.mediaDevices.getUserMedia(
          audioConstraintsForMic(selectedMicId, { exactDevice: onEdge && !!selectedMicId })
        );
        const devices = await listAudioInputDevices();
        setAudioInputDevices(devices);
        claim.getTracks().forEach((t) => t.stop());
        // Edge needs a longer handoff before SpeechRecognition can grab the mic
        await new Promise((r) => setTimeout(r, onEdge ? 550 : 120));
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        if (onEdge && name === 'OverconstrainedError' && selectedMicId) {
          // Fall back to default mic if Edge rejects exact deviceId
          try {
            const claim = await navigator.mediaDevices.getUserMedia(audioConstraintsForMic(''));
            claim.getTracks().forEach((t) => t.stop());
            await new Promise((r) => setTimeout(r, 550));
            setVoiceStatus('Edge couldn’t lock that mic — using system default. Set Edge’s default mic in Windows Sound settings if needed.');
          } catch (err2) {
            const name2 = err2 instanceof DOMException ? err2.name : '';
            setVoiceStatus(
              name2 === 'NotAllowedError'
                ? 'Microphone blocked — allow mic for this site in Edge.'
                : 'Could not open the microphone in Edge.'
            );
            setVoiceListenEnabled(false);
            return;
          }
        } else {
          setVoiceStatus(
            name === 'NotAllowedError'
              ? onEdge
                ? 'Microphone blocked — allow mic for this site in Edge (lock icon in address bar).'
                : 'Microphone blocked — allow mic for this site.'
              : 'Could not open the selected microphone.'
          );
          setVoiceListenEnabled(false);
          return;
        }
      }

      if (cancelled) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec: any = new (SpeechRecognitionApi as any)();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.maxAlternatives = onEdge ? 1 : 3;

      const lastWordIndexOnLine = (lineIndex: number): number => {
        let last = -1;
        for (let i = 0; i < scriptSpeechTokens.length; i++) {
          if (scriptSpeechTokens[i].lineIndex === lineIndex) last = i;
          if (scriptSpeechTokens[i].lineIndex > lineIndex) break;
        }
        return last >= 0 ? last : voiceCommittedAnchorRef.current;
      };

      const nextSpokenLineAfter = (lineIndex: number): number => {
        for (let i = 0; i < scriptSpeechTokens.length; i++) {
          if (scriptSpeechTokens[i].lineIndex > lineIndex) {
            return scriptSpeechTokens[i].lineIndex;
          }
        }
        return lineIndex + 1;
      };

      const applyVoiceAlign = (heardWordList: string[]): boolean => {
        if (scriptSpeechTokens.length === 0 || heardWordList.length === 0) return false;
        const prevIdx = voiceCommittedAnchorRef.current;
        const align = alignTranscriptVoicePrompt(
          scriptSpeechTokens,
          heardWordList,
          voiceCommittedAnchorRef.current
        );
        if (!align) return false;

        if (align.scriptWordIndex <= prevIdx) return false;

        const floorLine = Math.max(0, voiceScrollSnapLineRef.current);
        if (align.lineIndex < floorLine) return false;

        let nextIdx: number;
        if (align.isSkipAhead) {
          // Reader jumped ahead — snap to the matched phrase (don't drip one line at a time)
          nextIdx = align.scriptWordIndex;
        } else {
          // Normal reading: advance at most one spoken line / a few words per tick
          const nextSpoken = nextSpokenLineAfter(floorLine);
          const maxLine = Math.max(floorLine + 1, nextSpoken);
          const cappedWord =
            align.lineIndex > maxLine
              ? lastWordIndexOnLine(maxLine)
              : align.scriptWordIndex;
          const maxWordAdvance = Math.max(
            2,
            Math.min(5, Math.round(voiceSpeechRateWpsRef.current * 0.85))
          );
          nextIdx = Math.min(
            prevIdx + maxWordAdvance,
            Math.max(prevIdx + 1, Math.min(cappedWord, align.scriptWordIndex))
          );
        }
        if (nextIdx <= prevIdx) return false;

        const nextLine = scriptSpeechTokens[nextIdx]?.lineIndex ?? floorLine;
        const advanced = nextIdx - prevIdx;
        const nowMatch = performance.now();
        const prevMatchAt = voiceLastMatchAtRef.current;
        if (prevMatchAt > 0 && advanced > 0) {
          const dtSec = (nowMatch - prevMatchAt) / 1000;
          if (dtSec > 0.06 && dtSec < 2.8) {
            const instantWps = align.isSkipAhead
              ? Math.min(6, advanced / Math.max(dtSec, 0.25))
              : advanced / dtSec;
            voiceSpeechRateWpsRef.current =
              voiceSpeechRateWpsRef.current * 0.62 + instantWps * 0.38;
          }
        } else if (advanced > 0) {
          voiceSpeechRateWpsRef.current = Math.max(voiceSpeechRateWpsRef.current, 2.6);
        }
        voiceLastMatchAtRef.current = nowMatch;

        voiceCommittedAnchorRef.current = nextIdx;
        voiceScrollSnapLineRef.current = Math.max(floorLine, nextLine);

        if (voiceHighlightStyle !== 'off') {
          setVoiceHighlightLine(nextLine);
          setVoiceHighlightWordIndex(nextIdx);
        }
        setVoiceScrollDesiredFromWord(nextIdx, scriptSpeechTokens);
        return true;
      };

      rec.onaudiostart = () => {
        if (!cancelled) setVoiceStatus('Speech engine listening — speak the script…');
      };
      rec.onspeechstart = () => {
        if (!cancelled) setVoiceStatus('Hearing speech — matching to script…');
      };

      rec.onresult = (event: {
        resultIndex: number;
        results: { length: number; [i: number]: { 0: { transcript: string }; isFinal: boolean } };
      }) => {
        let interim = '';
        let finalText = '';
        let newFinalWordCount = 0;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += piece;
            const words = piece
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .map(normalizeSpeechToken)
              .filter((w) => w.length > 0);
            newFinalWordCount += words.length;
            words.forEach((w) => voiceRecentTranscriptWordsRef.current.push(w));
            if (voiceRecentTranscriptWordsRef.current.length > 120) {
              voiceRecentTranscriptWordsRef.current = voiceRecentTranscriptWordsRef.current.slice(-120);
            }
          } else {
            interim += piece;
          }
        }
        const interimWords = interim
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(normalizeSpeechToken)
          .filter((w) => w.length > 0);
        const combined = [...voiceRecentTranscriptWordsRef.current, ...interimWords];
        const preview = combined.slice(-16).join(' ');
        setVoiceInterimPreview(preview);
        if (preview.trim()) setVoiceHeardAnything(true);

        if (scriptSpeechTokens.length === 0) return;

        // Longer tail helps detect skip-ahead to a later phrase
        const alignTail = combined.slice(-14);
        const finalTrim = finalText.trim();
        if (finalTrim.length > 0 || newFinalWordCount > 0) {
          applyVoiceAlign(alignTail);
        }

        if (interim && interim !== lastVoiceInterimProcessedRef.current && interim.trim().length > 3) {
          lastVoiceInterimProcessedRef.current = interim;
          applyVoiceAlign(alignTail);
        }
      };

      rec.onerror = (e: { error: string }) => {
        if (e.error === 'not-allowed') {
          setVoiceStatus('Microphone blocked — allow mic for this site.');
          setVoiceListenEnabled(false);
        } else if (e.error === 'no-speech') {
          setVoiceStatus('No speech yet — speak louder, or Mic check the meter first.');
        } else if (e.error === 'audio-capture') {
          setVoiceStatus(
            isEdgeBrowser()
              ? 'Edge audio capture failed — close other tabs using the mic, allow mic permission, then try Auto-scroll again.'
              : 'Audio capture failed — try Mic check, then Auto-scroll again.'
          );
          setVoiceListenEnabled(false);
        } else if (e.error !== 'aborted') {
          setVoiceStatus(`Voice: ${e.error}`);
        }
      };

      rec.onend = () => {
        if (voiceListenEnabledRef.current && !voiceMicCheckOnlyRef.current && speechRecognitionRef.current) {
          const restartMs = isEdgeBrowser() ? 450 : 250;
          window.setTimeout(() => {
            try {
              if (voiceListenEnabledRef.current && !voiceMicCheckOnlyRef.current && speechRecognitionRef.current) {
                speechRecognitionRef.current.start();
              }
            } catch {
              /* already running */
            }
          }, restartMs);
        }
      };

      speechRecognitionRef.current = rec;
      try {
        rec.start();
        setVoiceStatus(
          isEdgeBrowser()
            ? 'Listening (Edge) — if silent, set Windows default mic to this device, then retry Auto-scroll.'
            : 'Listening for script — Chrome speech engine active.'
        );
      } catch {
        setVoiceStatus(
          isEdgeBrowser()
            ? 'Could not start Edge speech recognition — try Mic meter first, or use Chrome.'
            : 'Could not start speech recognition.'
        );
        setVoiceListenEnabled(false);
      }
    };

    void startRecognition();

    return () => {
      cancelled = true;
      clearVoiceScrollTarget();
      if (speechRecognitionRef.current) {
        const r = speechRecognitionRef.current;
        r.onresult = null;
        r.onerror = null;
        r.onend = null;
        r.onaudiostart = null;
        r.onspeechstart = null;
        try {
          r.stop();
        } catch {
          /* ignore */
        }
        speechRecognitionRef.current = null;
      }
    };
  }, [
    voiceListenEnabled,
    voiceMicCheckOnly,
    selectedMicId,
    userRole,
    scriptSpeechTokens,
    voiceHighlightStyle,
    settings.fontSize,
    settings.lineHeight,
    setVoiceScrollDesiredFromWord,
    clearVoiceScrollTarget,
    clearVoiceHighlight,
    stopVoiceMicCapture,
  ]);

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
  };

  // Auto-play control functions
  const handlePlay = () => {
    if (!isManualMode && userRole === 'SCROLLER') {
      if (isAutoPlaying && isPaused) {
        console.log('▶️ Resuming auto-play');
        setIsPaused(false);
      } else if (!isAutoPlaying) {
        console.log('▶️ Starting auto-play');
        setIsAutoPlaying(true);
        setIsPaused(false);
        lastAutoPlayTimestampRef.current = 0; // Reset timestamp
      }
    }
  };

  const handlePause = () => {
    if (isAutoPlaying) {
      console.log('⏸️ Pausing auto-play');
      console.log('⏸️ Preview scroll position:', previewScrollRef.current?.scrollTop);
      console.log('⏸️ Script scroll position:', scriptRef.current?.scrollTop);
      setIsPaused(true);
      // Don't reset scroll position or timestamp - just pause
    }
  };

  const handleStop = () => {
    console.log('⏹️ Stopping auto-play at position:', previewScrollRef.current?.scrollTop);
    setIsAutoPlaying(false);
    setIsPaused(false);
    if (autoPlayAnimationRef.current) {
      cancelAnimationFrame(autoPlayAnimationRef.current);
      autoPlayAnimationRef.current = null;
    }
    // Don't reset scroll position - just stop auto-play
  };

  const handleReset = () => {
    console.log('🔄 Reset - scrolling to top');
    console.log('🔄 Current user role:', userRole);
    console.log('🔄 scriptRef.current:', scriptRef.current);
    console.log('🔄 viewerScrollRef.current:', viewerScrollRef.current);
    console.log('🔄 previewScrollRef.current:', previewScrollRef.current);
    
    // Stop auto-play if running (without calling handleStop)
    setIsAutoPlaying(false);
    setIsPaused(false);
    if (autoPlayAnimationRef.current) {
      cancelAnimationFrame(autoPlayAnimationRef.current);
      autoPlayAnimationRef.current = null;
    }
    
    // Reset scroll position based on user role
    if (userRole === 'VIEWER' && viewerScrollRef.current) {
      console.log('🔄 Resetting viewer scroll to top');
      viewerScrollRef.current.scrollTop = 0;
    } else if (userRole === 'SCROLLER') {
      console.log('🔄 Resetting scroller scroll to top');
      // Reset both the main script container and the 16:9 preview container
      if (scriptRef.current) {
        scriptRef.current.scrollTop = 0;
      }
      if (previewScrollRef.current) {
        previewScrollRef.current.scrollTop = 0;
      }
    } else {
      console.log('🔄 No valid scroll container found for reset');
    }
    
    // Clear any pending scroll animations
    if (viewerAnimationFrameRef.current) {
      cancelAnimationFrame(viewerAnimationFrameRef.current);
      viewerAnimationFrameRef.current = null;
    }
    targetScrollPositionRef.current = null;

    voiceCommittedAnchorRef.current = 0;
    voiceRecentTranscriptWordsRef.current = [];
    lastVoiceInterimProcessedRef.current = '';
    clearVoiceScrollTarget();
    clearVoiceHighlight();
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

  // Sync scroll positions for scroller - DISABLED to prevent scroll position reset
  // useEffect(() => {
  //   if (userRole === 'SCROLLER') {
  //     // Force sync after a small delay to ensure DOM is ready
  //     setTimeout(() => {
  //       const mainScrollTop = scriptRef.current?.scrollTop || 0;
  //       // Force sync by setting scroll position directly
  //       if (scriptRef.current) {
  //         scriptRef.current.scrollTop = mainScrollTop;
  //       }
  //       console.log('🔄 Scroller mode initialized, syncing scroll position:', mainScrollTop);
  //     }, 50);
  //   }
  // }, [userRole]);
  
  return (
    <>
      {/* CSS for hiding scrollbars */}
      <style>
        {`
          .scrollbar-hide {
            -ms-overflow-style: none;  /* IE and Edge */
            scrollbar-width: none;  /* Firefox */
          }
          .scrollbar-hide::-webkit-scrollbar {
            display: none;  /* Chrome, Safari and Opera */
          }
        `}
      </style>
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
                        disabled={isManualMode || userRole !== 'SCROLLER'}
                        className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                          isManualMode || userRole !== 'SCROLLER'
                            ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                            : isAutoPlaying && !isPaused
                            ? 'bg-green-600 text-white animate-pulse'
                            : 'bg-green-600 text-white hover:bg-green-500'
                        }`}
                      >
                        ▶️ Play
                      </button>
                      
                      <button
                        onClick={handlePause}
                        disabled={!isAutoPlaying}
                        className={`px-3 py-2 rounded text-xs font-bold transition-colors ${
                          !isAutoPlaying
                            ? 'bg-slate-600 text-slate-400 cursor-not-allowed opacity-50'
                            : 'bg-yellow-600 text-white hover:bg-yellow-500'
                        }`}
                      >
                        ⏸️ Pause
                      </button>
                    </div>
                    
                    {/* Reset Button - Larger and more descriptive */}
                    <div className="mt-3">
                      <button
                        onClick={handleReset}
                        className="w-full px-3 py-2 rounded text-sm font-bold bg-purple-600 text-white hover:bg-purple-500 transition-colors"
                      >
                        🔄 Reset to Top
                      </button>
                    </div>
                  </div>

                  {/* Voice-follow: Web Speech + script alignment */}
                  <div>
                    <label className="mb-2 block text-xs text-slate-300">Voice follow:</label>
                    <label className="mb-1 block text-[10px] text-slate-400">Microphone</label>
                    <div className="mb-2 flex gap-1">
                      <select
                        value={selectedMicId}
                        disabled={userRole !== 'SCROLLER'}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSelectedMicId(id);
                          writeStoredMicId(id);
                        }}
                        className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-[11px] text-white disabled:opacity-50"
                      >
                        <option value="">System default</option>
                        {audioInputDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={userRole !== 'SCROLLER'}
                        onClick={() => void refreshAudioInputs({ unlock: true })}
                        className="shrink-0 rounded border border-cyan-700/70 bg-cyan-950/40 px-2 py-1 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-900/50 disabled:opacity-50"
                        title="Allow mic access and load device names"
                      >
                        List mics
                      </button>
                    </div>
                    <p className="mb-2 text-[10px] text-slate-500">
                      {audioInputDevices.length === 0
                        ? 'Click List mics (allow permission) so devices appear.'
                        : `${audioInputDevices.length} mic(s) found. Selection is saved.`}
                    </p>
                    {voiceListenEnabled && voiceMicCheckOnly && (
                      <div className="mb-2 rounded-lg border border-slate-600 bg-slate-950/80 p-2">
                        <div className="mb-1.5 flex items-center justify-between text-[10px]">
                          <span className="font-semibold uppercase tracking-wide text-slate-300">Audio meter</span>
                          <span
                            className={
                              voiceMicLevel > 12
                                ? 'font-semibold text-emerald-300'
                                : voiceMicLevel > 4
                                  ? 'text-amber-300'
                                  : 'text-slate-500'
                            }
                          >
                            {voiceMicLevel > 12 ? 'LIVE' : voiceMicLevel > 4 ? 'low' : 'silent'}
                            {' · '}
                            {voiceMicLevel}%
                          </span>
                        </div>
                        <div
                          className="flex h-8 items-end gap-0.5"
                          role="meter"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={voiceMicLevel}
                          aria-label="Microphone audio level"
                        >
                          {Array.from({ length: 20 }, (_, i) => {
                            const threshold = (i + 1) * 5;
                            const active = voiceMicLevel >= threshold;
                            const color =
                              i < 12
                                ? active
                                  ? 'bg-emerald-400'
                                  : 'bg-slate-800'
                                : i < 16
                                  ? active
                                    ? 'bg-amber-400'
                                    : 'bg-slate-800'
                                  : active
                                    ? 'bg-rose-500'
                                    : 'bg-slate-800';
                            return (
                              <div
                                key={i}
                                className={`min-w-0 flex-1 rounded-sm ${color} transition-colors duration-75`}
                                style={{ height: `${35 + i * 3.25}%` }}
                              />
                            );
                          })}
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Speak — bars should bounce. Switch mics above if silent.
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (voiceListenEnabled && voiceMicCheckOnly) {
                            setVoiceListenEnabled(false);
                            setVoiceMicCheckOnly(false);
                            clearVoiceHighlight();
                            return;
                          }
                          setVoiceMicCheckOnly(true);
                          setVoiceListenEnabled(true);
                          clearVoiceHighlight();
                        }}
                        disabled={userRole !== 'SCROLLER'}
                        className={`rounded px-2 py-2 text-[11px] font-bold transition-colors ${
                          userRole !== 'SCROLLER'
                            ? 'cursor-not-allowed bg-slate-600 text-slate-400'
                            : voiceListenEnabled && voiceMicCheckOnly
                              ? 'animate-pulse bg-amber-700 text-white hover:bg-amber-600'
                              : 'bg-amber-900/80 text-amber-100 hover:bg-amber-800'
                        }`}
                      >
                        {voiceListenEnabled && voiceMicCheckOnly ? 'Stop meter' : 'Mic meter'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (voiceListenEnabled && !voiceMicCheckOnly) {
                            setVoiceListenEnabled(false);
                            clearVoiceHighlight();
                            return;
                          }
                          setVoiceMicCheckOnly(false);
                          setVoiceListenEnabled(true);
                          clearVoiceHighlight();
                        }}
                        disabled={userRole !== 'SCROLLER'}
                        className={`rounded px-2 py-2 text-[11px] font-bold transition-colors ${
                          userRole !== 'SCROLLER'
                            ? 'cursor-not-allowed bg-slate-600 text-slate-400'
                            : voiceListenEnabled && !voiceMicCheckOnly
                              ? 'animate-pulse bg-rose-700 text-white hover:bg-rose-600'
                              : 'bg-cyan-700 text-white hover:bg-cyan-600'
                        }`}
                      >
                        {voiceListenEnabled && !voiceMicCheckOnly ? 'Stop listen' : 'Auto-scroll'}
                      </button>
                    </div>
                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          Highlight
                        </div>
                        {voiceHighlightStyle !== 'off' ? (
                          <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            Color
                            <input
                              type="color"
                              value={/^#[0-9a-fA-F]{6}$/.test(voiceHighlightColor) ? voiceHighlightColor : '#FBBF24'}
                              onChange={(e) => {
                                const next = e.target.value;
                                setVoiceHighlightColor(next);
                                try {
                                  localStorage.setItem('ros.teleprompter.voiceHighlightColor', next);
                                } catch {
                                  /* ignore */
                                }
                              }}
                              className="h-6 w-8 cursor-pointer rounded border border-slate-600 bg-slate-800 p-0"
                              title="Highlight color"
                            />
                          </label>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(
                          [
                            { id: 'off', label: 'Off' },
                            { id: 'words', label: 'Words' },
                            { id: 'band', label: 'Band' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setVoiceHighlightStyle(opt.id);
                              if (opt.id === 'off') clearVoiceHighlight();
                            }}
                            className={`rounded px-1.5 py-1.5 text-[11px] font-semibold transition-colors ${
                              voiceHighlightStyle === opt.id
                                ? 'bg-slate-200 text-slate-900'
                                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Words underlines spoken text · Band soft-fills the line
                      </p>
                    </div>
                    {voiceStatus ? (
                      <p className="mt-1 text-xs text-amber-200">{voiceStatus}</p>
                    ) : null}
                    {voiceListenEnabled && !voiceMicCheckOnly ? (
                      <p
                        className={`mt-1 min-h-[2.5rem] break-words font-mono text-xs ${
                          voiceHeardAnything ? 'text-emerald-200' : 'text-slate-500'
                        }`}
                        title={voiceInterimPreview || undefined}
                      >
                        {voiceInterimPreview
                          ? `Heard: ${voiceInterimPreview}`
                          : 'Waiting for speech-to-text words…'}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[10px] leading-snug text-slate-500">
                      1) List mics → pick device → <span className="text-slate-300">Mic meter</span> (bars only).
                      2) Then <span className="text-slate-300">Auto-scroll</span> for speech matching.
                      Chrome speech engine can&apos;t share the mic with the meter, so they stay separate.
                    </p>
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
                  
                  {/* Zoom Compensation */}
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Zoom: {(zoomCompensation * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={zoomCompensation}
                      onChange={(e) => setZoomCompensation(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="text-xs text-slate-400 mt-1">
                      Auto: {window.devicePixelRatio?.toFixed(1)}x DPI
                    </div>
                  </div>
                  
                  {/* Guide Line Position */}
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Guide Line: {guideLinePosition}%
                    </label>
                    <input
                      type="range"
                      min="20"
                      max="80"
                      step="5"
                      value={guideLinePosition}
                      onChange={(e) => updateGuideLinePosition(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="text-xs text-slate-400 mt-1">
                      Position from top
                    </div>
                  </div>
                  
                  {/* Comment Size */}
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Comment Size: {commentSize}x
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="4.0"
                      step="0.1"
                      value={commentSize}
                      onChange={(e) => {
                        setPreserveScrollPosition(true);
                        setCommentSize(Number(e.target.value));
                      }}
                      className="w-full"
                    />
                    <div className="text-xs text-slate-400 mt-1">
                      Text size multiplier
                    </div>
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
                transform: `scale(${scrollerScale * zoomCompensation})`, // Apply calculated scale + compensation
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
                  // Callback refs re-fire on every re-render (e.g. voice highlight).
                  // Never copy scriptRef.scrollTop here — for SCROLLER that outer
                  // container is overflow:hidden (scrollTop stays 0) and would yank
                  // the preview to the top on every match update.
                  previewScrollRef.current = el;
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
                  // Handle wheel events for manual scrolling
                  // Note: preventDefault() removed to avoid passive event listener error
                  // The scrolling will still work without it
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
                    
                    const voiceLineActive =
                      voiceListenEnabled &&
                      voiceHighlightStyle === 'band' &&
                      voiceHighlightLine === index;

                    const voiceHighlightCss: React.CSSProperties = voiceLineActive
                      ? {
                          backgroundColor: hexWithAlpha(voiceHighlightColor, '40'),
                          borderRadius: 4,
                          boxShadow: `inset 0 0 0 1px ${hexWithAlpha(voiceHighlightColor, '88')}`,
                          paddingLeft: '0.5rem',
                          paddingRight: '0.5rem',
                        }
                      : {};

                    return (
                      <div 
                        key={index} 
                        className="mb-2 transition-[background-color,box-shadow] duration-200"
                        style={voiceHighlightCss}
                        data-line-number={index}
                        ref={(el) => {
                          if (el) lineRefsMap.current.set(index, el);
                          else lineRefsMap.current.delete(index);
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
                                    <span className="text-3xl">{commentConfig.icon}</span>
                                    <div className="flex-1">
                                      <div className={`font-bold ${commentConfig.color} text-base`}>
                                        {commentConfig.label}
                                      </div>
                                      <div 
                                        className="text-white mt-1" 
                                        style={{ fontSize: `${commentSize}em` }}
                                      >
                                        {comment.text}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        
                        {/* Current line text */}
                        <div>{renderVoiceLineText(line, index)}</div>
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
                    top: `${guideLinePosition}%`,
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
                transform: `scale(${viewerScale * viewerZoomCompensation})`, // Apply calculated scale + compensation
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
                  position: 'relative',
                  scrollbarWidth: hideViewerScrollbar ? 'none' : 'auto', // Firefox
                  msOverflowStyle: hideViewerScrollbar ? 'none' : 'auto' // IE/Edge
                }}
                className={hideViewerScrollbar ? 'scrollbar-hide' : ''} // Tailwind class for webkit browsers
              >
                <div
                  style={{
                    minHeight: '100%',
                    paddingTop: '540px', // 50% of 1080px container height - same as scroller
                    paddingBottom: '540px',
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
                            <span className="text-3xl">{commentConfig.icon}</span>
                            <div className="flex-1">
                              <div className={`font-bold ${commentConfig.color} text-base`}>
                                {commentConfig.label}
                              </div>
                              <div 
                                className="text-white mt-1" 
                                style={{ fontSize: `${commentSize}em` }}
                              >
                                {comment.text}
                              </div>
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
                    top: `${guideLinePosition}%`,
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
      
      {/* Viewer Settings Cog - Only show for VIEWER role */}
      {userRole === 'VIEWER' && (
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={() => setShowViewerSettings(!showViewerSettings)}
            className="p-3 bg-slate-800 hover:bg-slate-700 rounded-full shadow-lg transition-colors"
            title="Viewer Settings"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          
          {/* Viewer Settings Panel */}
          {showViewerSettings && (
            <div className="absolute top-14 right-0 bg-slate-800 rounded-lg shadow-xl border border-slate-700 p-4 w-64">
              <h3 className="text-white text-sm font-semibold mb-3">Viewer Settings</h3>
              
              {/* Zoom Control */}
              <div className="mb-4">
                <label className="block text-xs text-slate-300 mb-2">
                  Zoom: {(viewerZoomCompensation * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={viewerZoomCompensation}
                  onChange={(e) => setViewerZoomCompensation(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-slate-400 mt-1">
                  Auto: {window.devicePixelRatio?.toFixed(1)}x DPI
                </div>
              </div>
              
              {/* Hide Scrollbar Toggle */}
              <div className="mb-4">
                <label className="flex items-center justify-between text-xs text-slate-300">
                  <span>Hide Scrollbar</span>
                  <button
                    onClick={() => setHideViewerScrollbar(!hideViewerScrollbar)}
                    className={`relative h-6 w-12 items-center rounded-full transition-colors flex ${
                      hideViewerScrollbar ? 'bg-blue-600' : 'bg-slate-500'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 ml-1 transform rounded-full bg-white transition-transform ${
                        hideViewerScrollbar ? 'translate-x-6' : ''
                      }`}
                    />
                  </button>
                </label>
              </div>
              
              {/* Close Button */}
              <button
                onClick={() => setShowViewerSettings(false)}
                className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-white transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* Disconnect Timer Modal */}
      {showDisconnectModal && <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />}
      
      {/* Disconnect Notification */}
      {showDisconnectNotification && <DisconnectNotification duration={disconnectDuration} onReconnect={handleReconnect} />}
      
      </div>
      </div>
    </>
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
          <button onClick={onNever} className="flex-1 px-8 py-4 bg-slate-600 hover:bg-slate-500 rounded-xl text-slate-200 text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-600/30">{DISPLAY_SESSION_MAX_LABEL}</button>
        </div>
        
        <p className="mt-6 text-sm text-slate-500 text-center">⚠️ {DISPLAY_SESSION_MAX_HINT}</p>
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

