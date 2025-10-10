import React, { useState, useEffect } from 'react';
import DriftStatusIndicator from './DriftStatusIndicator';
import { DatabaseService, TimerMessage } from '../services/database';
import { socketClient } from '../services/socket-client';

interface ClockProps {
  isRunning?: boolean;
  elapsedTime?: number;
  totalDuration?: number;
  onClose?: () => void;
  message?: string;
  messageEnabled?: boolean;
  itemId?: number; // Add itemId for drift detection
  eventId?: string; // Add eventId for Supabase message loading
  supabaseMessage?: TimerMessage | null; // Add supabaseMessage prop
  mainTimer?: {
    cue: string;
    segmentName: string;
  } | null;
  secondaryTimer?: {
    itemId: number;
    remaining: number;
    duration: number;
    cue: string;
    segmentName: string;
  } | null;
}

const Clock: React.FC<ClockProps> = ({
  isRunning = false,
  elapsedTime = 0,
  totalDuration = 0, // Default to 0 when no timer is running
  onClose,
  message = '',
  messageEnabled = false,
  itemId,
  eventId,
  supabaseMessage = null,
  mainTimer = null,
  secondaryTimer = null
}) => {
  const [timerProgress, setTimerProgress] = useState<{ elapsed: number; total: number }>({
    elapsed: elapsedTime,
    total: totalDuration
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [supabaseOnly, setSupabaseOnly] = useState(true);
  const [hybridTimerData, setHybridTimerData] = useState<any>({ activeTimer: null });
  const [secondaryTimerUpdate, setSecondaryTimerUpdate] = useState(0);
  const [secondaryTimerStartTime, setSecondaryTimerStartTime] = useState<Date | null>(null);
  const [lastActiveTimerId, setLastActiveTimerId] = useState<string | null>(null);
  const [lastActiveItemId, setLastActiveItemId] = useState<number | null>(null);
  const [lastActiveStartTime, setLastActiveStartTime] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Clock component always runs in WebSocket-only mode

  // Clock always uses WebSocket data, no props handling needed

  // Update timer progress when props change (non-WebSocket mode)
  useEffect(() => {
    if (!supabaseOnly) {
      // Use props data when not in hybrid mode
      setTimerProgress({
        elapsed: elapsedTime,
        total: totalDuration
      });
    }
  }, [elapsedTime, totalDuration, supabaseOnly]);

  // Real-time countdown timer for running timers
  useEffect(() => {
    if (supabaseOnly && hybridTimerData?.activeTimer?.is_running && hybridTimerData?.activeTimer?.is_active) {
      const activeTimer = hybridTimerData.activeTimer;
      const startedAt = new Date(activeTimer.started_at);
      const total = activeTimer.duration_seconds || 0;
      
      const updateCountdown = () => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
        
        setTimerProgress({
          elapsed: elapsed,
          total: total
        });
      };
      
      // Update immediately
      updateCountdown();
      
      // Set up interval for real-time updates
      const interval = setInterval(updateCountdown, 1000);
      
      return () => clearInterval(interval);
    } else if (supabaseOnly && hybridTimerData?.activeTimer && !hybridTimerData?.activeTimer?.is_running) {
      // Timer is loaded but not running - show 0 elapsed
      const activeTimer = hybridTimerData.activeTimer;
        setTimerProgress({
          elapsed: 0,
          total: activeTimer.duration_seconds || 0
        });
    } else if (supabaseOnly && !hybridTimerData?.activeTimer) {
      // No active timer - clear display
    setTimerProgress({
        elapsed: 0,
        total: 0
    });
    }
  }, [hybridTimerData?.activeTimer?.is_running, hybridTimerData?.activeTimer?.is_active, hybridTimerData?.activeTimer?.started_at, hybridTimerData?.activeTimer?.duration_seconds, hybridTimerData?.activeTimer, supabaseOnly]);

  // Update current time every second
  useEffect(() => {
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timeInterval);
  }, []);

  // Update timer progress every second when timer is running
  useEffect(() => {
    if (!isRunning) return;

    const timerInterval = setInterval(() => {
      setTimerProgress(prev => ({
        ...prev,
        elapsed: prev.elapsed + 1
      }));
    }, 1000);

    return () => clearInterval(timerInterval);
  }, [isRunning]);

  // Listen for full screen changes
  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);

  // Message loading is now handled by ClockPage via real-time subscriptions
  // No need for polling here since ClockPage already manages this

  // WebSocket mode: Fetch timer data via WebSocket when supabaseOnly is true
  useEffect(() => {
    if (!supabaseOnly || !eventId) {
      // Clear any existing WebSocket connections (handled in cleanup)
      // Reset timer tracking when exiting WebSocket mode
      setLastActiveTimerId(null);
      setLastActiveItemId(null);
      setLastActiveStartTime(null);
      
      // WebSocket provides real-time updates, no drift detection cleanup needed
      
      return;
    }

    console.log('🔄 Clock: Setting up WebSocket connection for eventId:', eventId);

    const loadActiveTimer = async () => {
      if (isLoading) {
        console.log('🔄 Already loading active timer, skipping...');
        return;
      }
      
      try {
        setIsLoading(true);
        console.log('🔄 Loading active timer from API...');
        const activeTimer = await DatabaseService.getActiveTimer(eventId);
        if (activeTimer && activeTimer.timer_state !== 'stopped' && activeTimer.is_active) {
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: activeTimer
          }));
          console.log('✅ Active timer updated:', activeTimer);
        } else {
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          console.log('❌ No active timer found or timer is stopped');
        }
        
        // Also load sub-cue timers and messages on initial load
        try {
          console.log('🔄 Clock: Loading sub-cue timers and messages on initial load...');
          
           // Load current sub-cue timers
           const subCueTimersResult = await DatabaseService.getActiveSubCueTimers(eventId);
           if (subCueTimersResult && subCueTimersResult.data && subCueTimersResult.data.length > 0) {
             // Find the first running sub-cue timer
             const runningSubCueTimer = subCueTimersResult.data.find(timer => 
               timer.timer_state === 'running' || timer.is_running === true
             );
            if (runningSubCueTimer) {
              setHybridTimerData(prev => ({
                ...prev,
                secondaryTimer: runningSubCueTimer
              }));
              console.log('✅ Clock: Initial load - sub-cue timer loaded:', runningSubCueTimer);
            }
          }
          
          // Load current timer message
          const timerMessage = await DatabaseService.getTimerMessage(eventId);
          if (timerMessage) {
            setHybridTimerData(prev => ({
              ...prev,
              timerMessage: timerMessage
            }));
            console.log('✅ Clock: Initial load - timer message loaded:', timerMessage);
          }
        } catch (error) {
          console.error('❌ Clock: Initial load failed to load sub-cue timers and messages:', error);
        }
        
        // Check if active timer has changed (cue jump detection)
        if (activeTimer && activeTimer.timer_state !== 'stopped' && activeTimer.is_active && supabaseOnly) {
          const currentActiveTimerId = `${activeTimer.item_id}_${activeTimer.started_at}`;
          const currentItemId = activeTimer.item_id;
          
          if (lastActiveTimerId && lastActiveTimerId !== currentActiveTimerId) {
            console.log('🔄 Active timer changed - stopping secondary timer');
            console.log('🔄 Previous timer:', lastActiveTimerId);
            console.log('🔄 New timer:', currentActiveTimerId);
            // Clear secondary timer when main timer changes
            setHybridTimerData(prev => ({
              ...prev,
              secondaryTimer: null
            }));
          }
          
          // Also check if the item_id changed (new cue loaded) - this should stop sub-cue timer
          if (lastActiveItemId && lastActiveItemId !== currentItemId) {
            console.log('🔄 New cue loaded - stopping secondary timer');
            console.log('🔄 Previous item_id:', lastActiveItemId);
            console.log('🔄 New item_id:', currentItemId);
            // Clear secondary timer when new cue is loaded
            setHybridTimerData(prev => ({
              ...prev,
              secondaryTimer: null
            }));
          }
          
          // Check if the start time changed (timer paused/resumed/restarted)
          const currentStartTime = activeTimer.started_at;
          if (lastActiveStartTime && lastActiveStartTime !== currentStartTime) {
            console.log('🔄 Timer start time changed - restarting local timer');
            console.log('🔄 Previous start time:', lastActiveStartTime);
            console.log('🔄 New start time:', currentStartTime);
            // The local timer will automatically restart due to the dependency change
          }
          
          // WebSocket provides real-time updates, no drift detection needed
          
          setLastActiveTimerId(currentActiveTimerId);
          setLastActiveItemId(currentItemId);
          setLastActiveStartTime(currentStartTime);
        } else if (!activeTimer && lastActiveTimerId && supabaseOnly) {
          // Active timer stopped completely - stop secondary timer and drift detection
          console.log('🔄 Active timer stopped - stopping secondary timer and drift detection');
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: null
          }));
          
          // WebSocket provides real-time updates, no drift detection cleanup needed
          
          setLastActiveTimerId(null);
          setLastActiveItemId(null);
          setLastActiveStartTime(null);
        }
      } catch (error) {
        console.error('❌ Error loading active timer:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Load initial data once
    loadActiveTimer();

    // Set up WebSocket connection for real-time timer updates
    const callbacks = {
      onTimerUpdated: (data: any) => {
        console.log('🔄 Clock: WebSocket timer update received:', data);
        console.log('🔄 Clock: Event ID check:', { received: data?.event_id, expected: eventId, match: data?.event_id === eventId });
        if (data && data.event_id === eventId) {
          // Update timer data directly from WebSocket
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: data
          }));
          console.log('✅ Clock: Timer updated via WebSocket:', data);
        } else {
          console.log('⚠️ Clock: Timer update ignored - event ID mismatch or no data');
        }
      },
      onActiveTimersUpdated: (data: any) => {
        console.log('🔄 Clock: WebSocket active timers update received:', data);
        
        // Handle array format (from server broadcast)
        let timerData = data;
        if (Array.isArray(data) && data.length > 0) {
          timerData = data[0]; // Take first timer from array
          console.log('🔄 Clock: Processing first timer from array:', timerData);
        }
        
        console.log('🔄 Clock: Event ID check:', { received: timerData?.event_id, expected: eventId, match: timerData?.event_id === eventId });
        if (timerData && timerData.event_id === eventId) {
          // Check if timer is stopped
          if (timerData.timer_state === 'stopped' || !timerData.is_active) {
            // Clear timer data when stopped
            setHybridTimerData(prev => ({
              ...prev,
              activeTimer: null
            }));
            console.log('✅ Clock: Timer stopped via WebSocket - cleared timer data');
          } else {
            // Update timer data directly from WebSocket
            setHybridTimerData(prev => ({
              ...prev,
              activeTimer: timerData
            }));
            console.log('✅ Clock: Active timer updated via WebSocket:', timerData);
          }
        } else {
          console.log('⚠️ Clock: Active timers update ignored - event ID mismatch or no data');
        }
      },
      onTimerStopped: (data: any) => {
        console.log('🔄 Clock: WebSocket timer stopped:', data);
        if (data && data.event_id === eventId) {
          // Clear timer data when stopped
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          console.log('✅ Clock: Timer cleared via WebSocket');
        }
      },
      onTimersStopped: (data: any) => {
        console.log('🔄 Clock: WebSocket all timers stopped:', data);
        if (data && data.event_id === eventId) {
          // Clear timer data when all stopped
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          console.log('✅ Clock: All timers cleared via WebSocket');
        }
      },
      onSubCueTimerStarted: (data: any) => {
        console.log('🔄 Clock: WebSocket sub-cue timer started:', data);
        if (data && data.event_id === eventId) {
          // Update secondary timer data
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: data
          }));
          console.log('✅ Clock: Sub-cue timer started via WebSocket:', data);
        }
      },
      onSubCueTimerStopped: (data: any) => {
        console.log('🔄 Clock: WebSocket sub-cue timer stopped:', data);
        if (data && data.event_id === eventId) {
          // Clear secondary timer data
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: null
          }));
          console.log('✅ Clock: Sub-cue timer stopped via WebSocket');
        }
      },
      onTimerMessageUpdated: (data: any) => {
        console.log('📨 Clock: WebSocket timer message updated:', data);
        if (data && data.event_id === eventId) {
          // Update timer message data
          setHybridTimerData(prev => ({
            ...prev,
            timerMessage: data
          }));
          console.log('✅ Clock: Timer message updated via WebSocket:', data);
        }
      },
      onInitialSync: async () => {
        console.log('🔄 Clock: Performing initial sync for sub-cue timers and messages');
        try {
          // Load current sub-cue timers
          const subCueTimersResult = await DatabaseService.getActiveSubCueTimers(eventId);
          if (subCueTimersResult && subCueTimersResult.data && subCueTimersResult.data.length > 0) {
            // Find the first running sub-cue timer
            const runningSubCueTimer = subCueTimersResult.data.find(timer => 
              timer.timer_state === 'running' || timer.is_running === true
            );
            if (runningSubCueTimer) {
              setHybridTimerData(prev => ({
                ...prev,
                secondaryTimer: runningSubCueTimer
              }));
              console.log('✅ Clock: Initial sync - sub-cue timer loaded:', runningSubCueTimer);
            }
          }
          
          // Load current timer message
          const timerMessage = await DatabaseService.getTimerMessage(eventId);
          if (timerMessage) {
            setHybridTimerData(prev => ({
              ...prev,
              timerMessage: timerMessage
            }));
            console.log('✅ Clock: Initial sync - timer message loaded:', timerMessage);
          }
        } catch (error) {
          console.error('❌ Clock: Initial sync failed to load sub-cue timers and messages:', error);
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('🔄 Clock: WebSocket connection status:', connected);
        if (connected) {
          // Reload timer when reconnected
          loadActiveTimer();
        }
      }
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      console.log('🔄 Clock: Cleaning up WebSocket connection');
      socketClient.disconnect(eventId);
    };
  }, [eventId]); // Removed supabaseOnly since it's always true in this component

  // Update secondary timer every second when in hybrid mode
  useEffect(() => {
    if (!supabaseOnly || !hybridTimerData?.secondaryTimer) return;

    const interval = setInterval(() => {
      setSecondaryTimerUpdate(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [supabaseOnly, hybridTimerData?.secondaryTimer]);

  // Clock always uses WebSocket data, no props mode needed

  // Always run local timer for smooth updates in WebSocket-only mode
  useEffect(() => {
    if (!supabaseOnly || !hybridTimerData?.activeTimer) return;

    const activeTimer = hybridTimerData.activeTimer;
    const itemId = activeTimer.item_id;
    
    if (activeTimer.is_running && activeTimer.is_active && activeTimer.started_at) {
      const startedAt = new Date(activeTimer.started_at);
      const duration = activeTimer.duration_seconds;
      
      console.log(`🔄 Starting continuous local timer for ${itemId} with duration ${duration}s, start time: ${startedAt.toISOString()}`);
      
      const continuousTimer = setInterval(() => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
        
        // Always update timer progress for smooth counting
        setTimerProgress(prev => ({
          ...prev,
          elapsed: elapsed,
          total: duration
        }));
        
        // WebSocket provides real-time updates, no drift detection needed
        
        // Debug logging for first few seconds
        if (elapsed <= 10) {
          console.log(`🕐 Timer ${itemId}: Continuous elapsed=${elapsed}s, Start=${startedAt.toISOString()}, Now=${now.toISOString()}`);
        }
      }, 1000);

      return () => {
        console.log(`🔄 Stopping continuous local timer for ${itemId}`);
        clearInterval(continuousTimer);
      };
    }
  }, [supabaseOnly, lastActiveStartTime]); // Removed hybridTimerData?.activeTimer to prevent constant restarts

  // WebSocket provides real-time updates, no drift detection cleanup needed

  // Helper function to format time (same as RunOfShowPage) - handles negative values
  const formatTime = (seconds: number) => {
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const secs = Math.floor(absSeconds % 60);
    const sign = isNegative ? '-' : '';
    // Hide hours if they are 0
    if (hours === 0) {
      return `${sign}${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Format time of day
  const formatTimeOfDay = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Get remaining time (same logic as RunOfShowPage) - allow negative values
  const getRemainingTime = () => {
    const progress = timerProgress;
    const remaining = progress.total - progress.elapsed;
    
    // In WebSocket mode, check if timer is actually running
    if (supabaseOnly && hybridTimerData?.activeTimer) {
      const activeTimer = hybridTimerData.activeTimer;
      if (!activeTimer.is_running || !activeTimer.is_active) {
        // Timer is not running, show full duration
        return progress.total;
      }
    }
    
    return remaining;
  };

  // Get remaining percentage for progress bar (same logic as RunOfShowPage)
  const getRemainingPercentage = () => {
    const progress = timerProgress;
    const remainingSeconds = progress.total - progress.elapsed;
    
    // In WebSocket mode, check if timer is actually running
    if (supabaseOnly && hybridTimerData?.activeTimer) {
      const activeTimer = hybridTimerData.activeTimer;
      if (!activeTimer.is_running || !activeTimer.is_active) {
        // Timer is not running, show 100% (full bar)
        return 100;
      }
    }
    
    return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
  };

  // Get progress bar color based on remaining time (same logic as RunOfShowPage)
  const getProgressBarColor = () => {
    const progress = timerProgress;
    const remainingSeconds = progress.total - progress.elapsed;
    
    // In WebSocket mode, check if timer is actually running
    if (supabaseOnly && hybridTimerData?.activeTimer) {
      const activeTimer = hybridTimerData.activeTimer;
      if (!activeTimer.is_running || !activeTimer.is_active) {
        // Timer is not running, show neutral color
        return '#6b7280'; // Gray
      }
    }
    
    // Color based on remaining time
    if (remainingSeconds > 120) { // More than 2 minutes
      return '#10b981'; // Green
    } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
      return '#f59e0b'; // Yellow
    } else { // Less than 30 seconds
      return '#ef4444'; // Red
    }
  };

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden flex flex-col items-center justify-center" style={{ padding: 0, margin: 0 }}>

      {/* Current Time - Top Left */}
      <div className="absolute top-10 left-10 text-3xl font-mono text-white">
        <div className="text-slate-400 text-lg mb-1">CURRENT TIME</div>
        <div className="text-white">
          {formatTimeOfDay(currentTime)}
        </div>
      </div>

      {/* Current Running CUE - Top Right */}
      <div className="fixed top-10 right-10 text-3xl font-mono text-white z-50 w-80 text-right">
        <div className="text-slate-400 text-lg mb-1">CURRENT CUE</div>
        <div className="text-white flex items-center justify-end gap-3 whitespace-nowrap">
          <span>
            {(() => {
              if (supabaseOnly) {
                if (hybridTimerData?.activeTimer) {
                const activeTimer = hybridTimerData.activeTimer;
                const lastLoadedCue = hybridTimerData?.lastLoadedCue;
                const cueData = hybridTimerData?.cueData;
                
                // Try CUE data from active timer cue_is column first
                if (activeTimer.cue_is) {
                  return activeTimer.cue_is;
                }
                
                // Try CUE data from schedule/items table second
                if (cueData) {
                  console.log('🔍 CUE data structure:', cueData);
                  console.log('🔍 CUE data fields:', Object.keys(cueData));
                  
                  const cueDisplay = cueData.customFields?.cue || cueData.cue || cueData.cue_display || cueData.name || cueData.title;
                  const segmentName = cueData.segmentName || cueData.segment_name || cueData.segment;
                  
                  if (cueDisplay) {
                    console.log('✅ Found CUE display:', cueDisplay);
                    return cueDisplay;
                  }
                }
                
                // Try active timer other fields
                const cueDisplay = activeTimer.cue_display || activeTimer.cue;
                const segmentName = activeTimer.segment_name || activeTimer.segmentName;
                
                if (cueDisplay) {
                  return cueDisplay;
                }
                
                // Fallback to last loaded cue
                if (lastLoadedCue) {
                  const lastCueDisplay = lastLoadedCue.cue_display || lastLoadedCue.cue;
                  const lastSegmentName = lastLoadedCue.segment_name || lastLoadedCue.segmentName;
                  if (lastCueDisplay) {
                    return lastCueDisplay;
                  }
                }
                
                // Final fallback: Generate CUE display from item_id
                if (activeTimer.item_id) {
                  // Extract a meaningful CUE number from the item_id
                  const itemIdStr = activeTimer.item_id.toString();
                  const lastDigits = itemIdStr.slice(-4); // Get last 4 digits
                  return `CUE ${lastDigits}`;
                }
                
                return 'No CUE';
              } else {
                  // No active timer - show "No Cue"
                  return 'No Cue';
                }
              } else {
                // Clock always runs in WebSocket-only mode
                return 'No CUE';
              }
            })()}
          </span>
          {/* Drift Status Indicator */}
          {itemId && (
            <DriftStatusIndicator 
              itemId={itemId} 
              className="flex-shrink-0"
            />
          )}
        </div>
      </div>

      {/* Timer Status Indicator - Bottom Left */}
      {!isFullScreen && supabaseOnly && hybridTimerData?.activeTimer && (
        <div className="absolute bottom-10 left-10 text-center">
          <div className={`text-lg font-bold px-4 py-2 rounded-lg ${
            hybridTimerData.activeTimer.is_running && hybridTimerData.activeTimer.is_active
              ? 'bg-green-600 text-white'
              : 'bg-gray-600 text-white'
          }`}>
            {hybridTimerData.activeTimer.is_running && hybridTimerData.activeTimer.is_active
              ? '⏱️ TIMER RUNNING'
              : '⏸️ TIMER LOADED'
            }
          </div>
        </div>
      )}

      {/* Full Screen Button - Hidden when in full screen */}
      {!isFullScreen && (
        <div className="absolute top-10 left-1/2 transform -translate-x-1/2 flex gap-3 z-50">
        <button
          onClick={() => {
            if (document.documentElement.requestFullscreen) {
              document.documentElement.requestFullscreen();
            }
          }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-lg transition-colors"
        >
          FULL SCREEN
        </button>
        {!isFullScreen && (
          <button
            className="px-4 py-2 rounded-lg font-bold text-lg bg-purple-600 text-white cursor-default"
            disabled
          >
            WEBSOCKET ONLY
          </button>
        )}
        </div>
      )}


      {/* Message Display */}
      {(() => {
        // When supabaseOnly is true, only show Supabase messages
        if (supabaseOnly) {
          // Use hybrid data if available, otherwise fall back to supabaseMessage
          const displayMessage = hybridTimerData?.timerMessage || supabaseMessage;
          return displayMessage && displayMessage.enabled;
        }
        // When supabaseOnly is false, show both local and Supabase messages
        return (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
      })() && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ transform: 'translateY(-40px)' }}>
          <div 
            className="font-bold text-white bg-black bg-opacity-50 rounded-lg border-4 border-white text-center flex items-center justify-center"
            style={{
              width: '80vw',
              minHeight: '50vh',
              maxHeight: '70vh',
              lineHeight: '1.2',
              whiteSpace: 'pre-line',
              overflow: 'visible',
              padding: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              wordWrap: 'break-word'
            }}
          >
            {(() => {
              // When supabaseOnly is true, only use Supabase message
              // When supabaseOnly is false, use Supabase message if available, otherwise use local message
              const displayMessage = supabaseOnly 
                ? (hybridTimerData?.timerMessage?.message || supabaseMessage?.message || '')
                : supabaseMessage?.message || message;
              // Break long messages into multiple lines
              const words = displayMessage.split(' ');
              let formattedMessage;
              let lineCount;
              
              if (words.length <= 3) {
                formattedMessage = displayMessage; // Keep short messages on one line
                lineCount = 1;
              } else if (words.length <= 6) {
                // Break into 2 lines
                const mid = Math.ceil(words.length / 2);
                formattedMessage = words.slice(0, mid).join(' ') + '\n' + words.slice(mid).join(' ');
                lineCount = 2;
              } else if (words.length <= 10) {
                // Break into 3 lines
                const third = Math.ceil(words.length / 3);
                formattedMessage = words.slice(0, third).join(' ') + '\n' + 
                       words.slice(third, third * 2).join(' ') + '\n' + 
                       words.slice(third * 2).join(' ');
                lineCount = 3;
              } else {
                // Break into 4 lines for very long messages
                const quarter = Math.ceil(words.length / 4);
                formattedMessage = words.slice(0, quarter).join(' ') + '\n' + 
                       words.slice(quarter, quarter * 2).join(' ') + '\n' + 
                       words.slice(quarter * 2, quarter * 3).join(' ') + '\n' + 
                       words.slice(quarter * 3).join(' ');
                lineCount = 4;
              }
              
              // Calculate font size based on message length and line count
              // Account for descenders (g, j, p, q, y) that hang below baseline
              let fontSize;
              const hasDescenders = /[gjpqy]/.test(displayMessage.toLowerCase());
              
              if (words.length <= 3) {
                fontSize = hasDescenders ? 'clamp(3rem, 12vw, 16rem)' : 'clamp(3.5rem, 13.5vw, 18rem)';
              } else if (words.length <= 6) {
                fontSize = hasDescenders ? 'clamp(1.9rem, 8vw, 12rem)' : 'clamp(2.25rem, 9vw, 13.5rem)';
              } else if (words.length <= 10) {
                fontSize = hasDescenders ? 'clamp(1.4rem, 6vw, 9rem)' : 'clamp(1.6rem, 7vw, 10.5rem)';
              } else {
                fontSize = hasDescenders ? 'clamp(0.9rem, 4vw, 6rem)' : 'clamp(1.1rem, 5vw, 7rem)';
              }
              
              return (
                <div style={{ fontSize }}>
                  {formattedMessage}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Secondary Timer Display - Only when NO message is active */}
      {(() => {
        // Check if we have a secondary timer in either mode
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (!currentSecondaryTimer) return false;
          
          // Check if there's a message active - if so, don't show this timer (use the new layout instead)
          const hasMessage = (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled);
          if (hasMessage) return false;
          
          console.log('🔍 Clock: Secondary timer data:', {
            is_running: currentSecondaryTimer.is_running,
            is_active: currentSecondaryTimer.is_active,
            remaining_seconds: currentSecondaryTimer.remaining_seconds,
            duration_seconds: currentSecondaryTimer.duration_seconds
          });
          
          // Hide timer if it's not running
          if (!currentSecondaryTimer.is_running) {
            console.log('🔍 Sub-cue timer not running - hiding');
            return false;
          }
          
          // Check if timer has expired (reached zero or negative)
          if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
            const now = new Date();
            const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
            const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
            const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
            const remaining = Math.max(0, totalDuration - elapsed);
            
            // Hide timer if it has expired (remaining <= 0)
            if (remaining <= 0) return false;
          }
          
          return true;
        } else {
          // Clock always runs in Supabase-only mode
          return false;
        }
      })() && (
        <div className={`absolute animate-in fade-in duration-500 ${(() => {
          // When supabaseOnly is true, only check Supabase messages
          if (supabaseOnly) {
            return supabaseMessage && supabaseMessage.enabled;
          }
          // When supabaseOnly is false, check both local and Supabase messages
          return (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        })() ? 'bottom-20 right-1/3 transform translate-x-1/2 flex flex-col items-center' : 'inset-0 flex flex-col items-center justify-center'}`} style={{ marginTop: (() => {
          // When supabaseOnly is true, only check Supabase messages
          if (supabaseOnly) {
            return supabaseMessage && supabaseMessage.enabled;
          }
          // When supabaseOnly is false, check both local and Supabase messages
          return (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        })() ? '0' : '-80px' }}>
          {/* CUE and Segment Name - Separated from countdown */}
          <div className={`absolute left-1/2 transform -translate-x-1/2 text-orange-400 font-bold animate-in slide-in-from-top duration-500 ${(() => {
            // When supabaseOnly is true, only check Supabase messages
            if (supabaseOnly) {
              return supabaseMessage && supabaseMessage.enabled ? 'text-lg md:text-xl lg:text-2xl' : 'text-xl md:text-2xl lg:text-3xl';
            }
            // When supabaseOnly is false, check both local and Supabase messages
            return (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled) ? 'text-lg md:text-xl lg:text-2xl' : 'text-xl md:text-2xl lg:text-3xl';
          })()} whitespace-nowrap ${(() => {
            // When supabaseOnly is true, only check Supabase messages
            if (supabaseOnly) {
              return supabaseMessage && supabaseMessage.enabled;
            }
            // When supabaseOnly is false, check both local and Supabase messages
            return (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
          })() ? 'bottom-20 left-1/2 transform -translate-x-1/2' : ''}`} style={{ lineHeight: '1.2', ...(() => {
            // When supabaseOnly is true, only check Supabase messages
            if (supabaseOnly) {
              return supabaseMessage && supabaseMessage.enabled ? { bottom: 'calc(5rem - 25px)' } : { top: 'calc(50% - 150px)' };
            }
            // When supabaseOnly is false, check both local and Supabase messages
            return (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled) ? { bottom: 'calc(5rem - 25px)' } : { top: 'calc(50% - 150px)' };
          })() }}>
            {(() => {
              const currentSecondaryTimer = supabaseOnly ? hybridTimerData?.secondaryTimer : secondaryTimer;
              if (!currentSecondaryTimer) return '';
              
              // Handle different data structures
              if (supabaseOnly) {
                // Supabase data structure (could be secondary_timers or sub_cue_timers)
                const cue = currentSecondaryTimer.cue_display || currentSecondaryTimer.cue || currentSecondaryTimer.cue_is || '';
                const segmentName = currentSecondaryTimer.segment_name || currentSecondaryTimer.segmentName || '';
                const formattedCue = cue.replace(/CUE(\d+)/, 'CUE $1');
                return segmentName ? `${formattedCue} - ${segmentName}` : formattedCue;
              } else {
                // Clock always runs in WebSocket-only mode
                return 'No CUE';
              }
            })()}
          </div>
          {/* Large Time without Outline */}
          <div
            className={`text-orange-400 font-mono font-bold animate-in zoom-in duration-500 ${(() => {
              const currentSecondaryTimer = supabaseOnly ? hybridTimerData?.secondaryTimer : secondaryTimer;
              if (!currentSecondaryTimer) return 'text-3xl md:text-4xl lg:text-5xl';
              
              // Use secondaryTimerUpdate to trigger re-calculation every second
              const _ = secondaryTimerUpdate;
              
              let remaining = 0;
              if (supabaseOnly) {
                // Supabase data structure - calculate remaining time in real-time
                if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                  // Calculate remaining time based on start time and duration
                  const now = new Date();
                  const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                  const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                  const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                  remaining = Math.max(0, totalDuration - elapsed);
                } else {
                  // Timer is not running, show full duration
                  remaining = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                }
              } else {
                remaining = currentSecondaryTimer.remaining || 0;
              }
              
              const hours = Math.floor(remaining / 3600);
              
              // When supabaseOnly is true, only check Supabase messages
              if (supabaseOnly) {
                const displayMessage = hybridTimerData?.timerMessage || supabaseMessage;
                if (displayMessage && displayMessage.enabled) {
                  return 'text-3xl md:text-4xl lg:text-5xl';
                }
              } else {
                // When supabaseOnly is false, check both local and Supabase messages
              if ((messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled)) {
                return 'text-3xl md:text-4xl lg:text-5xl';
                }
              }
              // Increase size by 25% when no hours (MM:SS format)
              return hours === 0 
                ? 'text-[15rem] md:text-[16.875rem] lg:text-[22.5rem]' // 25% larger
                : 'text-[12rem] md:text-[13.5rem] lg:text-[18rem]'; // Original size
            })()}`}
            style={{
              lineHeight: '1'
            }}
          >
            {(() => {
              const currentSecondaryTimer = supabaseOnly ? hybridTimerData?.secondaryTimer : secondaryTimer;
              if (!currentSecondaryTimer) return '00:00';
              
              // Use secondaryTimerUpdate to trigger re-calculation every second
              const _ = secondaryTimerUpdate;
              
              let remaining = 0;
              if (supabaseOnly) {
                // Supabase data structure - calculate remaining time in real-time
                if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                  // Calculate remaining time based on start time and duration
                  const now = new Date();
                  const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                  const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                  const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                  remaining = Math.max(0, totalDuration - elapsed);
                } else {
                  // Timer is not running, show full duration
                  remaining = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                }
              } else {
                // Clock always runs in WebSocket-only mode
                remaining = 0;
              }
              
              const hours = Math.floor(remaining / 3600);
              const minutes = Math.floor((remaining % 3600) / 60);
              const seconds = remaining % 60;

              if (hours === 0) {
                return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              } else {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              }
            })()}
          </div>
        </div>
      )}

      {/* Main Timer Layout - When there's both a secondary timer AND a message (small layout) */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Check if timer has expired (reached zero or negative)
            if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
              const now = new Date();
              const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
              const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
              const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
              const remaining = Math.max(0, totalDuration - elapsed);
              
              // Only show as active if timer hasn't expired
              hasSecondaryTimer = remaining > 0;
            } else {
              hasSecondaryTimer = true; // Show if timer is stopped but not expired
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasSecondaryTimer && hasMessage;
      })() && (
        <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 left-10">
          {/* Overtime Indicator - Above main timer when both message and secondary timer are active */}
          {getRemainingTime() < 0 && (
            <div className="mb-2">
              <div className="font-bold text-red-500 text-lg md:text-xl lg:text-2xl">
                OVER TIME
              </div>
            </div>
          )}
          
          <div 
            className="font-mono font-bold transition-all duration-500 ease-in-out text-3xl md:text-4xl lg:text-5xl"
            style={{ color: getProgressBarColor() }}
          >
            {formatTime(getRemainingTime())}
          </div>
        </div>
      )}

      {/* Sub-cue Timer Display - When there's both a secondary timer AND a message (small layout) */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Check if timer has expired (reached zero or negative)
            if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
              const now = new Date();
              const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
              const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
              const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
              const remaining = Math.max(0, totalDuration - elapsed);
              
              // Only show as active if timer hasn't expired
              hasSecondaryTimer = remaining > 0;
            } else {
              hasSecondaryTimer = true; // Show if timer is stopped but not expired
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasSecondaryTimer && hasMessage;
      })() && (
        <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 right-10 text-orange-400">
          {/* Sub-cue CUE and Segment Name */}
          <div className="text-lg mb-2 font-bold">
            {(() => {
              const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
              const cueDisplay = currentSecondaryTimer.cue_display || currentSecondaryTimer.cue || `CUE ${currentSecondaryTimer.item_id}`;
              const segmentName = currentSecondaryTimer.segment_name || currentSecondaryTimer.segmentName || 'Segment';
              return `${cueDisplay} - ${segmentName}`;
            })()}
          </div>
          
          {/* Sub-cue Countdown Timer */}
          <div className="font-mono text-3xl font-bold">
            {(() => {
              const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
              const now = new Date();
              const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
              const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
              const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
              const remaining = Math.max(0, totalDuration - elapsed);
              
              const hours = Math.floor(remaining / 3600);
              const minutes = Math.floor((remaining % 3600) / 60);
              const seconds = remaining % 60;
              
              if (hours > 0) {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              } else {
                return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              }
            })()}
          </div>
        </div>
      )}

      {/* Progress Bar - When there's both a secondary timer AND a message (small layout) */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Hide timer if it's not running
            if (!currentSecondaryTimer.is_running) {
              hasSecondaryTimer = false;
            } else {
              // Check if timer has expired (reached zero or negative)
              if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                const now = new Date();
                const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                const remaining = Math.max(0, totalDuration - elapsed);
                
                // Only show as active if timer hasn't expired
                hasSecondaryTimer = remaining > 0;
              } else {
                hasSecondaryTimer = true; // Show if timer is stopped but not expired
              }
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasSecondaryTimer && hasMessage;
      })() && (
        <div className="w-full transition-all duration-500 ease-in-out absolute bottom-8 left-1/2 transform -translate-x-1/2 max-w-2xl">
          <div className="w-full bg-slate-700 rounded-full overflow-hidden border-3 border-slate-600 relative h-2">
            <div 
              className="h-full transition-all duration-1000 absolute top-0 right-0"
              style={{
                width: `${Math.min(100, Math.max(0, (getRemainingTime() / (totalDuration || 1)) * 100))}%`,
                backgroundColor: getProgressBarColor()
              }}
            />
          </div>
        </div>
      )}

      {/* Main Timer Layout - Only when no secondary timer and no message */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Hide timer if it's not running
            if (!currentSecondaryTimer.is_running) {
              hasSecondaryTimer = false;
            } else {
              // Check if timer has expired (reached zero or negative)
              if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                const now = new Date();
                const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                const remaining = Math.max(0, totalDuration - elapsed);
                
                // Only show as active if timer hasn't expired
                hasSecondaryTimer = remaining > 0;
              } else {
                hasSecondaryTimer = true; // Show if timer is stopped but not expired
              }
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return !hasSecondaryTimer && !hasMessage;
      })() && (
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Overtime Indicator - -50px above timer */}
          {getRemainingTime() < 0 && (
            <div className="mb-[-50px]">
              <div className="font-bold text-red-500 text-5xl">
                OVER TIME
              </div>
            </div>
          )}
          
          {/* Countdown Timer - Centered */}
          <div className="text-center">
            <div 
              className={`font-mono font-bold ${(() => {
                const remaining = getRemainingTime();
                const hours = Math.floor(Math.abs(remaining) / 3600);
                // Increase size by 25% when no hours (MM:SS format)
                return hours === 0 
                  ? 'text-[15rem] md:text-[16.875rem] lg:text-[22.5rem]' // 25% larger
                  : 'text-[12rem] md:text-[13.5rem] lg:text-[18rem]'; // Original size
              })()}`}
              style={{ color: getProgressBarColor() }}
            >
              {formatTime(getRemainingTime())}
            </div>
          </div>
          
          {/* Progress Bar - 0px below timer */}
          <div className="w-full max-w-5xl mt-0">
            <div className="w-full bg-slate-700 rounded-full overflow-hidden border-3 border-slate-600 relative h-8">
              <div 
                className="h-full transition-all duration-1000 absolute top-0 right-0"
                style={{ 
                  width: `${getRemainingPercentage()}%`,
                  background: getProgressBarColor()
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Countdown Timer - Positioned at bottom when message is active */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Hide timer if it's not running
            if (!currentSecondaryTimer.is_running) {
              hasSecondaryTimer = false;
            } else {
              // Check if timer has expired (reached zero or negative)
              if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                const now = new Date();
                const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                const remaining = Math.max(0, totalDuration - elapsed);
                
                // Only show as active if timer hasn't expired
                hasSecondaryTimer = remaining > 0;
              } else {
                hasSecondaryTimer = true; // Show if timer is stopped but not expired
              }
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasMessage && !hasSecondaryTimer;
      })() && (
        <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 left-1/2 transform -translate-x-1/2">
          {/* Overtime Indicator - Above main timer when message is active */}
          {getRemainingTime() < 0 && (
            <div className="mb-2">
              <div className="font-bold text-red-500 text-lg md:text-xl lg:text-2xl">
                OVER TIME
              </div>
            </div>
          )}
          
          <div 
            className="font-mono font-bold transition-all duration-500 ease-in-out text-3xl md:text-4xl lg:text-5xl"
            style={{ color: getProgressBarColor() }}
          >
            {formatTime(getRemainingTime())}
          </div>
        </div>
      )}

      {/* Countdown Timer - Positioned at bottom when secondary timer is shown (but not when message is active) */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Hide timer if it's not running
            if (!currentSecondaryTimer.is_running) {
              hasSecondaryTimer = false;
            } else {
              // Check if timer has expired (reached zero or negative)
              if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                const now = new Date();
                const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                const remaining = Math.max(0, totalDuration - elapsed);
                
                // Only show as active if timer hasn't expired
                hasSecondaryTimer = remaining > 0;
              } else {
                hasSecondaryTimer = true; // Show if timer is stopped but not expired
              }
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasSecondaryTimer && !hasMessage;
      })() && (
        <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 left-1/2 transform -translate-x-1/2">
          {/* Overtime Indicator - Above main timer when secondary timer is active */}
          {getRemainingTime() < 0 && (
            <div className="mb-2">
              <div className="font-bold text-red-500 text-lg md:text-xl lg:text-2xl">
                OVER TIME
              </div>
            </div>
          )}
          
          <div 
            className="font-mono font-bold transition-all duration-500 ease-in-out text-3xl md:text-4xl lg:text-5xl"
            style={{ color: getProgressBarColor() }}
          >
            {formatTime(getRemainingTime())}
          </div>
        </div>
      )}

      {/* Progress Bar - Positioned at bottom when message is active */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Hide timer if it's not running
            if (!currentSecondaryTimer.is_running) {
              hasSecondaryTimer = false;
            } else {
              // Check if timer has expired (reached zero or negative)
              if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                const now = new Date();
                const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                const remaining = Math.max(0, totalDuration - elapsed);
                
                // Only show as active if timer hasn't expired
                hasSecondaryTimer = remaining > 0;
              } else {
                hasSecondaryTimer = true; // Show if timer is stopped but not expired
              }
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasMessage && !hasSecondaryTimer;
      })() && (
        <div className="w-full transition-all duration-500 ease-in-out absolute bottom-8 left-1/2 transform -translate-x-1/2 max-w-2xl">
          <div className="w-full bg-slate-700 rounded-full overflow-hidden border-3 border-slate-600 relative h-2">
            <div 
              className="h-full transition-all duration-1000 absolute top-0 right-0"
              style={{ 
                width: `${getRemainingPercentage()}%`,
                background: getProgressBarColor()
              }}
            />
          </div>
        </div>
      )}

      {/* Progress Bar - Positioned at bottom when secondary timer is shown (but not when message is active) */}
      {(() => {
        let hasSecondaryTimer = false;
        
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (currentSecondaryTimer) {
            // Hide timer if it's not running
            if (!currentSecondaryTimer.is_running) {
              hasSecondaryTimer = false;
            } else {
              // Check if timer has expired (reached zero or negative)
              if (currentSecondaryTimer.is_running && currentSecondaryTimer.is_active) {
                const now = new Date();
                const startedAt = new Date(currentSecondaryTimer.started_at || currentSecondaryTimer.created_at);
                const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                const totalDuration = currentSecondaryTimer.duration_seconds || currentSecondaryTimer.duration || 0;
                const remaining = Math.max(0, totalDuration - elapsed);
                
                // Only show as active if timer hasn't expired
                hasSecondaryTimer = remaining > 0;
              } else {
                hasSecondaryTimer = true; // Show if timer is stopped but not expired
              }
            }
          }
        } else {
          hasSecondaryTimer = !!secondaryTimer;
        }
        
        const hasMessage = supabaseOnly ? 
          (hybridTimerData?.timerMessage && hybridTimerData.timerMessage.enabled) || (supabaseMessage && supabaseMessage.enabled) :
          (messageEnabled && message) || (supabaseMessage && supabaseMessage.enabled);
        
        return hasSecondaryTimer && !hasMessage;
      })() && (
        <div className="w-full transition-all duration-500 ease-in-out absolute bottom-8 left-1/2 transform -translate-x-1/2 max-w-2xl">
          <div className="w-full bg-slate-700 rounded-full overflow-hidden border-3 border-slate-600 relative h-2">
            <div 
              className="h-full transition-all duration-1000 absolute top-0 right-0"
              style={{ 
                width: `${getRemainingPercentage()}%`,
                background: getProgressBarColor()
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Clock;
