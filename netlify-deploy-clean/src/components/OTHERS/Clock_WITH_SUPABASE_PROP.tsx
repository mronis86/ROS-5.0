import React, { useState, useEffect } from 'react';
import DriftStatusIndicator from './DriftStatusIndicator';
import { DatabaseService, TimerMessage } from '../services/database';
import { driftDetector } from '../services/driftDetector';
import { supabase } from '../services/supabase';

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
  const [hybridTimerData, setHybridTimerData] = useState<any>(null);
  const [hybridPolling, setHybridPolling] = useState<NodeJS.Timeout | null>(null);
  const [secondaryTimerUpdate, setSecondaryTimerUpdate] = useState(0);
  const [secondaryTimerStartTime, setSecondaryTimerStartTime] = useState<Date | null>(null);
  const [lastActiveTimerId, setLastActiveTimerId] = useState<string | null>(null);
  const [lastActiveItemId, setLastActiveItemId] = useState<number | null>(null);
  const [lastActiveStartTime, setLastActiveStartTime] = useState<string | null>(null);
  const [localTimerInterval, setLocalTimerInterval] = useState<NodeJS.Timeout | null>(null);
  const [serverSyncedTimers, setServerSyncedTimers] = useState<Set<number>>(new Set());

  // Clock component always runs in Supabase-only mode

  // Clock always uses Supabase data, no props handling needed

  // Update timer progress when props change or hybrid data changes
  useEffect(() => {
    if (supabaseOnly && hybridTimerData?.activeTimer) {
      // Use hybrid data when in Supabase-only mode
      const activeTimer = hybridTimerData.activeTimer;
      
      if (activeTimer.is_running && activeTimer.is_active) {
        // Timer is running - calculate remaining time
        const now = new Date();
        const startedAt = new Date(activeTimer.started_at);
        const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
        const total = activeTimer.duration_seconds || 0;
        const remaining = Math.max(0, total - elapsed);
        
        setTimerProgress({
          elapsed: elapsed,
          total: total
        });
      } else {
        // Timer is not running - show 0 elapsed
        setTimerProgress({
          elapsed: 0,
          total: activeTimer.duration_seconds || 0
        });
      }
    } else {
      // Use props data when not in hybrid mode
    setTimerProgress({
      elapsed: elapsedTime,
      total: totalDuration
    });
    }
  }, [elapsedTime, totalDuration, supabaseOnly, hybridTimerData]);

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

  // Load message from Supabase
  useEffect(() => {
    if (!eventId) return;

    const loadMessage = async () => {
      setMessageLoading(true);
      try {
        const message = await DatabaseService.getTimerMessage(eventId);
        setSupabaseMessage(message);
        console.log('📨 Loaded timer message from Supabase:', message);
      } catch (error) {
        console.error('❌ Error loading timer message:', error);
      } finally {
        setMessageLoading(false);
      }
    };

    loadMessage();

    // Poll for new messages every 5 seconds
    const interval = setInterval(loadMessage, 5000);
    return () => clearInterval(interval);
  }, [eventId]);

  // Hybrid mode: Fetch timer data from Supabase when supabaseOnly is true
  useEffect(() => {
    if (!supabaseOnly || !eventId) {
      // Clear any existing polling
      if (hybridPolling) {
        clearInterval(hybridPolling);
        setHybridPolling(null);
      }
      // Reset timer tracking when exiting hybrid mode
      setLastActiveTimerId(null);
      setLastActiveItemId(null);
      setLastActiveStartTime(null);
      
      // Clean up drift detection
      if (lastActiveTimerId) {
        const itemId = parseInt(lastActiveTimerId.split('_')[0]);
        driftDetector.stopMonitoring(itemId);
      }
      
      // Clear drift sync interval
      if (localTimerInterval) {
        clearInterval(localTimerInterval);
        setLocalTimerInterval(null);
      }
      
      // Clear server-synced timers
      setServerSyncedTimers(new Set());
      
      return;
    }

    const fetchHybridData = async () => {
      try {
        console.log('🔄 Fetching hybrid timer data from Supabase...');
        const data = await DatabaseService.getHybridTimerData(eventId);
        setHybridTimerData(data);
        console.log('✅ Hybrid timer data updated:', data);
        
        // Debug secondary timer data
        if (data?.secondaryTimer) {
          console.log('🔍 Secondary timer data:', data.secondaryTimer);
        } else {
          console.log('❌ No secondary timer data found');
        }
        
        // Debug sub-cue timers data
        if (data?.subCueTimers && data.subCueTimers.length > 0) {
          console.log('🔍 Sub-cue timers data:', data.subCueTimers);
          console.log('🔍 First sub-cue timer structure:', data.subCueTimers[0]);
        } else {
          console.log('❌ No sub-cue timers data found');
        }
        
        // Debug secondary timer data (might be using sub-cue timers as fallback)
        if (data?.secondaryTimer) {
          console.log('🔍 Secondary timer data (from sub-cue fallback):', data.secondaryTimer);
        }
        
        // Debug active timer data for CUE display
        if (data?.activeTimer) {
          console.log('🔍 Active timer data for CUE display:', {
            cue_display: data.activeTimer.cue_display,
            cue: data.activeTimer.cue,
            item_id: data.activeTimer.item_id,
            allFields: Object.keys(data.activeTimer),
            fullData: data.activeTimer
          });
        }
        
        // Debug last loaded cue data
        if (data?.lastLoadedCue) {
          console.log('🔍 Last loaded cue data:', {
            cue: data.lastLoadedCue.cue,
            cue_display: data.lastLoadedCue.cue_display,
            segment_name: data.lastLoadedCue.segment_name,
            allFields: Object.keys(data.lastLoadedCue),
            fullData: data.lastLoadedCue
          });
        }
        
        // Debug CUE data
        if (data?.cueData) {
          console.log('🔍 CUE data from schedule/items table:', {
            allFields: Object.keys(data.cueData),
            fullData: data.cueData
          });
        } else {
          console.log('🔍 No CUE data found from schedule/items tables');
        }
        
        // Debug the full active timer data to see what fields are available
        if (data?.activeTimer) {
          console.log('🔍 Full active timer data structure:', data.activeTimer);
        }
        
        // Check if active timer has changed (cue jump detection)
        if (data?.activeTimer && supabaseOnly) {
          const currentActiveTimerId = `${data.activeTimer.item_id}_${data.activeTimer.started_at}`;
          const currentItemId = data.activeTimer.item_id;
          
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
          const currentStartTime = data.activeTimer.started_at;
          if (lastActiveStartTime && lastActiveStartTime !== currentStartTime) {
            console.log('🔄 Timer start time changed - restarting local timer');
            console.log('🔄 Previous start time:', lastActiveStartTime);
            console.log('🔄 New start time:', currentStartTime);
            // The local timer will automatically restart due to the dependency change
          }
          
          // Start drift detection for the new active timer
          if (data.activeTimer.is_running && data.activeTimer.is_active && data.activeTimer.started_at) {
            const startedAt = new Date(data.activeTimer.started_at);
            const duration = data.activeTimer.duration_seconds;
            
            console.log(`🔄 Starting drift detection for timer ${currentItemId} with duration ${duration}s`);
            
            // Stop any existing drift detection
            driftDetector.stopMonitoring(currentItemId);
            
            // Start drift detection for the new timer
            driftDetector.startMonitoring(
              currentItemId,
              startedAt,
              duration,
              (serverElapsed) => {
                console.log(`🔄 DriftDetector: Syncing timer ${currentItemId} with server elapsed: ${serverElapsed}s`);
                // Note: We don't update timer progress here anymore - let the local timer handle it
                // The drift detector is just for monitoring, not for UI updates
                
                // Mark this timer as server-synced for monitoring purposes
                setServerSyncedTimers(prev => new Set(prev).add(currentItemId));
              }
            );
            
            // Set up periodic drift sync
            const driftSyncInterval = setInterval(async () => {
              try {
                console.log(`🔄 DriftDetector: Starting periodic sync for timer ${currentItemId}`);
                await driftDetector.forceSync(currentItemId, async () => {
                  const activeTimer = await DatabaseService.getActiveTimer(eventId);
                  const serverElapsed = activeTimer?.elapsed_seconds || 0;
                  console.log(`🔄 DriftDetector: Server returned elapsed: ${serverElapsed}s for timer ${currentItemId}`);
                  return serverElapsed;
                });
              } catch (error) {
                console.warn(`⚠️ DriftDetector: Failed to sync timer ${currentItemId}:`, error);
              }
            }, 30000); // Force sync every 30 seconds
            
            // Store the drift sync interval for cleanup
            setLocalTimerInterval(driftSyncInterval);
          }
          
          setLastActiveTimerId(currentActiveTimerId);
          setLastActiveItemId(currentItemId);
          setLastActiveStartTime(currentStartTime);
        } else if (!data?.activeTimer && lastActiveTimerId && supabaseOnly) {
          // Active timer stopped completely - stop secondary timer and drift detection
          console.log('🔄 Active timer stopped - stopping secondary timer and drift detection');
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: null
          }));
          
          // Stop drift detection
          if (lastActiveTimerId) {
            const itemId = parseInt(lastActiveTimerId.split('_')[0]);
            driftDetector.stopMonitoring(itemId);
            setServerSyncedTimers(prev => {
              const newSet = new Set(prev);
              newSet.delete(itemId);
              return newSet;
            });
          }
          
          // Clear drift sync interval
          if (localTimerInterval) {
            clearInterval(localTimerInterval);
            setLocalTimerInterval(null);
          }
          
          setLastActiveTimerId(null);
          setLastActiveItemId(null);
          setLastActiveStartTime(null);
        }
      } catch (error) {
        console.error('❌ Error fetching hybrid timer data:', error);
      }
    };

    // Fetch immediately
    fetchHybridData();

    // Poll every 1 second when in hybrid mode
    const interval = setInterval(fetchHybridData, 1000);
    setHybridPolling(interval);

    return () => {
      clearInterval(interval);
      setHybridPolling(null);
    };
  }, [supabaseOnly, eventId]);

  // Update secondary timer every second when in hybrid mode
  useEffect(() => {
    if (!supabaseOnly || !hybridTimerData?.secondaryTimer) return;

    const interval = setInterval(() => {
      setSecondaryTimerUpdate(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [supabaseOnly, hybridTimerData?.secondaryTimer]);

  // Clock always uses Supabase data, no props mode needed

  // Always run local timer for smooth updates in Supabase-only mode
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
        
        // Update drift detector with local elapsed time
        driftDetector.updateLocalElapsed(itemId, elapsed);
        
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
  }, [supabaseOnly, hybridTimerData?.activeTimer, lastActiveStartTime]);

  // Cleanup drift detector on component unmount
  useEffect(() => {
    return () => {
      console.log('🔄 Cleaning up drift detector on component unmount');
      driftDetector.destroy();
      
      // Clear any remaining intervals
      if (localTimerInterval) {
        clearInterval(localTimerInterval);
      }
    };
  }, []);

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
    
    // In hybrid mode, check if timer is actually running
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
    
    // In hybrid mode, check if timer is actually running
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
    
    // In hybrid mode, check if timer is actually running
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
              if (supabaseOnly && hybridTimerData?.activeTimer) {
                const activeTimer = hybridTimerData.activeTimer;
                const lastLoadedCue = hybridTimerData?.lastLoadedCue;
                const cueData = hybridTimerData?.cueData;
                
                // Try CUE data from active timer cue_is column first
                if (activeTimer.cue_is) {
                  console.log('✅ Using CUE data from active timer cue_is:', activeTimer.cue_is);
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
                // Clock always runs in Supabase-only mode
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
            SUPABASE ONLY
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

      {/* Secondary Timer Display - Bottom layout when message is active, center when no message */}
      {(() => {
        // Check if we have a secondary timer in either mode
        if (supabaseOnly) {
          const currentSecondaryTimer = hybridTimerData?.secondaryTimer;
          if (!currentSecondaryTimer) return false;
          
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
                // Clock always runs in Supabase-only mode
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
                // Clock always runs in Supabase-only mode
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
        <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 left-1/3 transform -translate-x-1/2">
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
