import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { Event } from '../types/Event';
// import { driftDetector } from '../services/driftDetector'; // REMOVED: Using WebSocket-only approach
import { socketClient } from '../services/socket-client';

interface ScheduleItem {
  id: number;
  day: number;
  programType: string;
  shotType: string;
  segmentName: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  notes: string;
  assets: string;
  speakers: string;
  speakersText: string;
  hasPPT: boolean;
  hasQA: boolean;
  timerId: string;
  customFields?: {
    cue?: string;
    [key: string]: any;
  };
  isPublic?: boolean;
}

const GreenRoomPage: React.FC = () => {
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const eventId = urlParams.get('eventId');
  const eventName = urlParams.get('eventName');
  const eventDate = urlParams.get('eventDate');
  const eventLocation = urlParams.get('eventLocation');
  
  const event: Event = location.state?.event || {
    id: eventId || '',
    name: eventName || 'Current Event',
    date: eventDate || '',
    location: eventLocation || '',
    numberOfDays: 1
  };
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [eventTimezone, setEventTimezone] = useState('America/New_York');
  const [timerProgress, setTimerProgress] = useState<{[key: number]: {elapsed: number, total: number, startedAt: Date | null}}>({});
  const [timerState, setTimerState] = useState<string | null>(null); // 'loaded' or 'running'
  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});
  
  // Overtime data (same as RunOfShowPage)
  const [overtimeMinutes, setOvertimeMinutes] = useState<Record<number, number>>({});
  const [showStartOvertime, setShowStartOvertime] = useState<number>(0);
  const [startCueId, setStartCueId] = useState<number | null>(null);

  // Timezone utility functions (same as RunOfShowPage)
  const convertToEventTimezone = (date: Date) => {
    return new Date(date.toLocaleString("en-US", { timeZone: eventTimezone }));
  };

  const getCurrentTimeInEventTimezone = () => {
    return convertToEventTimezone(new Date());
  };
  
  // Track last loaded cue to keep it visible when timer stops
  const [lastLoadedCueId, setLastLoadedCueId] = useState<number | null>(null);
  
  const [masterStartTime, setMasterStartTime] = useState<string>('09:00');
  const [dayStartTimes, setDayStartTimes] = useState<{[key: number]: string}>({});
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [numberOfDays, setNumberOfDays] = useState<number>(1);
  const [localTimerInterval, setLocalTimerInterval] = useState<NodeJS.Timeout | null>(null);
  const [serverSyncedTimers, setServerSyncedTimers] = useState<Set<number>>(new Set());
  const [clockOffset, setClockOffset] = useState<number>(0); // Offset between client and server clocks in ms
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [disconnectTimer, setDisconnectTimer] = useState<NodeJS.Timeout | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);

  // Calculate start time function (same as RunOfShowPage)
  const calculateStartTime = (index: number, scheduleData?: any[], masterStartTimeOverride?: string) => {
    const currentSchedule = scheduleData || schedule;
    const effectiveMasterStartTime = masterStartTimeOverride || masterStartTime;
    console.log(`🔄 calculateStartTime called for index ${index}:`, {
      masterStartTime: effectiveMasterStartTime,
      scheduleLength: currentSchedule.length,
      eventTimezone
    });
    
    if (!effectiveMasterStartTime) {
      console.log('❌ No master start time, returning empty string');
      return '';
    }
    
    let totalMinutes = 0;
    for (let i = 0; i < index; i++) {
      const item = currentSchedule[i];
      if (!item) {
        console.log(`  Item ${i}: undefined/null item, skipping`);
        continue;
      }
      
      const durationHours = item.durationHours || 0;
      const durationMinutes = item.durationMinutes || 0;
      const itemMinutes = (durationHours * 60) + durationMinutes;
      totalMinutes += itemMinutes;
      console.log(`  Item ${i} (${item.segmentName || 'Unknown'}): ${durationHours}h ${durationMinutes}m = ${itemMinutes} total minutes`);
    }
    
    const [startHours, startMinutes] = effectiveMasterStartTime.split(':').map(Number);
    const totalStartMinutes = startHours * 60 + startMinutes;
    const finalMinutes = totalStartMinutes + totalMinutes;
    
    const hours = Math.floor(finalMinutes / 60);
    const minutes = finalMinutes % 60;
    
    const period = hours >= 12 ? 'PM' : 'AM';
    let displayHours = hours;
    if (hours > 12) displayHours = hours - 12;
    if (hours === 0) displayHours = 12;
    
    const result = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    
    console.log(`🔄 calculateStartTime result for index ${index}:`, {
      masterStartTime: effectiveMasterStartTime,
      totalMinutes,
      totalStartMinutes,
      finalMinutes,
      hours,
      minutes,
      period,
      displayHours,
      result
    });
    
    return result;
  };

  // Calculate start time with automatic overtime adjustments (same as RunOfShowPage)
  const calculateStartTimeWithOvertime = (index: number, scheduleData?: any[], masterStartTimeOverride?: string) => {
    const currentSchedule = scheduleData || schedule;
    const currentItem = currentSchedule[index];
    if (!currentItem) {
      console.log(`❌ No current item at index ${index}`);
      return '';
    }
    
    // Get the base start time
    const baseStartTime = calculateStartTime(index, scheduleData, masterStartTimeOverride);
    if (!baseStartTime) {
      console.log(`❌ No base start time for index ${index}`);
      return '';
    }
    
    console.log(`🔄 calculateStartTimeWithOvertime for index ${index}:`, {
      baseStartTime,
      overtimeMinutes,
      showStartOvertime,
      startCueId,
      currentItemId: currentItem.id
    });
    
    // Calculate total overtime from previous cues, but ignore rows ABOVE the STAR
    let totalOvertimeMinutes = 0;
    
    // Find the START cue index to know where to start counting overtime
    const startCueIndex = startCueId ? currentSchedule.findIndex(s => s.id === startCueId) : -1;
    const startCountingFrom = startCueIndex !== -1 ? startCueIndex : 0;
    
    console.log(`🔄 Overtime calculation:`, {
      startCueIndex,
      startCountingFrom,
      index,
      scheduleLength: currentSchedule.length
    });
    
    // Only count overtime from START cue onwards (ignore rows above STAR)
    for (let i = startCountingFrom; i < index; i++) {
      const item = currentSchedule[i];
      const itemDay = item.day || 1;
      const currentItemDay = currentItem.day || 1;
      
      // Only count overtime from the same day
      if (itemDay === currentItemDay) {
        const itemOvertime = overtimeMinutes[item.id] || 0;
        totalOvertimeMinutes += itemOvertime;
        console.log(`  Item ${i} (${item.segmentName}): ${itemOvertime} minutes overtime`);
      }
    }
    
    // Add show start overtime for START cue and all rows after it
    if (showStartOvertime !== 0 && startCueId !== null && startCueIndex !== -1 && index >= startCueIndex) {
      totalOvertimeMinutes += showStartOvertime;
      console.log(`  Added show start overtime: ${showStartOvertime} minutes`);
    }
    
    console.log(`🔄 Total overtime: ${totalOvertimeMinutes} minutes`);
    
    // If no overtime, return the base start time
    if (totalOvertimeMinutes === 0) {
      console.log(`🔄 No overtime, returning base start time: ${baseStartTime}`);
      return baseStartTime;
    }
    
    // Parse the base start time and add overtime
    const [timePart, period] = baseStartTime.split(' ');
    const [hours, minutes] = timePart.split(':').map(Number);
    
    let hour24 = hours;
    if (period === 'PM' && hours !== 12) hour24 += 12;
    if (period === 'AM' && hours === 12) hour24 = 0;
    
    // Add overtime minutes
    const totalMinutes = hour24 * 60 + minutes + totalOvertimeMinutes;
    const finalHours = Math.floor(totalMinutes / 60) % 24;
    const finalMinutes = totalMinutes % 60;
    
    // Convert back to 12-hour format
    const date = new Date();
    date.setHours(finalHours, finalMinutes, 0, 0);
    const result = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    console.log(`🔄 Final result: ${result}`);
    return result;
  };

  // Load master start time and day start times from localStorage
  useEffect(() => {
    if (event?.id) {
      console.log('🔍 Loading master start time for event ID:', event.id);
      const savedMasterTime = localStorage.getItem(`masterStartTime_${event.id}`);
      const savedDayTimes = localStorage.getItem(`dayStartTimes_${event.id}`);
      
      console.log('🔍 Raw localStorage values:', {
        masterStartTime: savedMasterTime,
        dayStartTimes: savedDayTimes,
        eventId: event.id
      });
      
      if (savedMasterTime) {
        setMasterStartTime(savedMasterTime);
        console.log('📥 Loaded master start time from localStorage:', savedMasterTime);
      } else {
        console.log('❌ No master start time found in localStorage for event:', event.id);
        console.log('🔍 Available localStorage keys:', Object.keys(localStorage).filter(key => key.includes('masterStartTime')));
        console.log('🔍 All localStorage keys:', Object.keys(localStorage));
        
        // Try to find any master start time in localStorage
        const allMasterTimes = Object.keys(localStorage)
          .filter(key => key.includes('masterStartTime'))
          .map(key => ({ key, value: localStorage.getItem(key) }));
        console.log('🔍 All master start times in localStorage:', allMasterTimes);
        
        // Look for the most recent or most likely master start time
        // Priority: 1) Any time that's not 09:00, 2) Any time that looks like PM, 3) First available
        let selectedTime = null;
        
        // First, try to find a time that's not the default 09:00
        const nonDefaultTime = allMasterTimes.find(t => t.value && t.value !== '09:00');
        if (nonDefaultTime) {
          selectedTime = nonDefaultTime;
          console.log('📥 Found non-default master start time:', nonDefaultTime.value);
        } else {
          // If no non-default time, use the first available
          selectedTime = allMasterTimes.find(t => t.value);
          console.log('📥 Using first available master start time:', selectedTime?.value);
        }
        
        if (selectedTime && selectedTime.value) {
          console.log('📥 Setting master start time to:', selectedTime.value);
          setMasterStartTime(selectedTime.value);
        } else {
          console.log('❌ No suitable master start time found in localStorage');
          console.log('🔍 Will try to get master start time from API data...');
        }
      }
      if (savedDayTimes) {
        setDayStartTimes(JSON.parse(savedDayTimes));
        console.log('📥 Loaded day start times from localStorage:', JSON.parse(savedDayTimes));
      } else {
        console.log('❌ No day start times found in localStorage for event:', event.id);
      }
    }
  }, [event?.id]);

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Load active timer data
  const loadActiveTimer = async () => {
    if (!event?.id) return;

    try {
      console.log('🔄 Loading active timer for Green Room...');
      const activeTimer = await DatabaseService.getActiveTimer(event.id);
      
      if (activeTimer) {
        console.log('🔄 Active timer found:', activeTimer);
        console.log('🔄 Timer state:', activeTimer.timer_state);
        console.log('🔄 Item ID:', activeTimer.item_id);
        
        setActiveItemId(parseInt(activeTimer.item_id));
        setTimerState(activeTimer.timer_state); // 'loaded' or 'running'
        setLastLoadedCueId(parseInt(activeTimer.item_id)); // Track last loaded cue
        
        // Mark this item as loaded
        setLoadedItems({ [parseInt(activeTimer.item_id)]: true });
        console.log('🔄 Set loaded items:', { [parseInt(activeTimer.item_id)]: true });
        
        // Drift detection removed - WebSocket handles all timer synchronization
        if (activeTimer.timer_state === 'running' && activeTimer.started_at) {
          console.log(`🔄 Green Room: Timer ${activeTimer.item_id} is running - WebSocket will handle updates`);
        }
        
        // Use elapsed_seconds from database (already calculated)
        setTimerProgress({
          [parseInt(activeTimer.item_id)]: {
            elapsed: activeTimer.elapsed_seconds || 0,
            total: activeTimer.duration_seconds || 0,
            startedAt: activeTimer.started_at ? new Date(activeTimer.started_at) : null
          }
        });
      } else {
        console.log('🔄 No active timer found');
        setActiveItemId(null);
        setTimerState(null);
        setLoadedItems({}); // Clear all loaded items
        setTimerProgress({});
        
        // Drift detection removed - WebSocket-only approach
        
        // Clear drift sync interval
        if (localTimerInterval) {
          clearInterval(localTimerInterval);
          setLocalTimerInterval(null);
        }
      }
    } catch (error) {
      console.error('❌ Error loading active timer:', error);
    }
  };

  // WebSocket connection for active timer changes
  useEffect(() => {
    if (!event?.id) return;
    
    loadActiveTimer(); // Load initial data
    
    console.log('🔌 Setting up WebSocket connection for Green Room timer updates');
    
    const callbacks = {
      onServerTime: (data: any) => {
        // Sync client clock with server clock
        const serverTime = new Date(data.serverTime).getTime();
        const clientTime = new Date().getTime();
        const offset = serverTime - clientTime;
        setClockOffset(offset);
        console.log('🕐 GreenRoom: Clock sync:', {
          serverTime: data.serverTime,
          clientTime: new Date().toISOString(),
          offsetMs: offset,
          offsetSeconds: Math.floor(offset / 1000)
        });
      },
      onTimerUpdated: (data: any) => {
        console.log('📡 Green Room: Timer updated via WebSocket', data);
        // Update timer state directly from WebSocket data (like PhotoViewPage)
        if (data && data.item_id) {
          setTimerProgress(prev => ({
            ...prev,
            [data.item_id]: {
              elapsed: data.elapsed_seconds || 0,
              total: data.duration_seconds || 300,
              startedAt: data.started_at ? new Date(data.started_at) : null
            }
          }));
          
          // Update timer state based on timer_state from active_timers table (like PhotoViewPage)
          if (data.timer_state === 'running') {
            setTimerState('running');
            setActiveItemId(parseInt(data.item_id));
            setLastLoadedCueId(parseInt(data.item_id)); // Track last loaded cue
            // Clear all loaded items and set only the current active one
            setLoadedItems({ [parseInt(data.item_id)]: true });
            console.log('✅ Green Room: Timer RUNNING - activeItemId set to:', data.item_id);
          } else if (data.timer_state === 'loaded') {
            setTimerState('loaded');
            setActiveItemId(parseInt(data.item_id));
            setLastLoadedCueId(parseInt(data.item_id)); // Track last loaded cue
            // Clear all loaded items and set only the current active one
            setLoadedItems({ [parseInt(data.item_id)]: true });
            console.log('✅ Green Room: Timer LOADED - activeItemId set to:', data.item_id);
          }
        }
      },
      onTimerStopped: (data: any) => {
        console.log('📡 Green Room: Timer stopped via WebSocket');
        // Clear timer state when stopped, but keep last loaded cue visible
        if (data && data.item_id) {
          setTimerState(null);
          // Keep the last loaded cue visible instead of clearing activeItemId
          if (lastLoadedCueId) {
            setActiveItemId(lastLoadedCueId);
            setLoadedItems({ [lastLoadedCueId]: true });
            console.log('📜 Green Room: Keeping last loaded cue visible:', lastLoadedCueId);
          } else {
            setActiveItemId(null);
            setLoadedItems({});
          }
          setTimerProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[data.item_id];
            return newProgress;
          });
        }
      },
      onTimersStopped: (data: any) => {
        console.log('📡 Green Room: All timers stopped via WebSocket');
        // Clear timer state but keep last loaded cue visible
        setTimerState(null);
        if (lastLoadedCueId) {
          setActiveItemId(lastLoadedCueId);
          setLoadedItems({ [lastLoadedCueId]: true });
          console.log('📜 Green Room: Keeping last loaded cue visible after all timers stopped:', lastLoadedCueId);
        } else {
          setActiveItemId(null);
          setLoadedItems({});
        }
        setTimerProgress({});
      },
      onTimerStarted: (data: any) => {
        console.log('📡 Green Room: Timer started via WebSocket');
        // Update active item when timer starts
        if (data && data.item_id) {
          setActiveItemId(data.item_id);
        }
      },
      onActiveTimersUpdated: (data: any) => {
        console.log('📡 Green Room: Active timers updated via WebSocket', data);
        // Handle active timers update from active_timers table
        if (data && data.item_id) {
          if (data.timer_state === 'running' || data.timer_state === 'loaded') {
            setActiveItemId(parseInt(data.item_id));
            setTimerState(data.timer_state);
            setLastLoadedCueId(parseInt(data.item_id)); // Track last loaded cue
            // Clear all loaded items and set only the current active one
            setLoadedItems({ [data.item_id]: true });
            console.log('🔄 Green Room: Updated active item and timer state:', {
              itemId: data.item_id,
              timerState: data.timer_state,
              activeItemId: data.item_id
            });
          } else {
            // Timer is stopped - keep last loaded cue visible
            setTimerState(null);
            if (lastLoadedCueId) {
              setActiveItemId(lastLoadedCueId);
              setLoadedItems({ [lastLoadedCueId]: true });
              console.log('📜 Green Room: Keeping last loaded cue visible after timer stopped:', lastLoadedCueId);
            } else {
              setActiveItemId(null);
              setLoadedItems({});
            }
            console.log('🔄 Green Room: Timer stopped, keeping last loaded cue visible');
          }
        }
      },
      onResetAllStates: (data: any) => {
        console.log('📡 Green Room: Reset all states triggered via WebSocket', data);
        // Clear all states when RunOfShowPage resets
        setActiveItemId(null);
        setTimerState(null);
        setLoadedItems({});
        setTimerProgress({});
        setLastLoadedCueId(null); // Clear last loaded cue on reset
        console.log('✅ Green Room: All states cleared via reset');
      },
      onScheduleUpdated: (data: any) => {
        console.log('📡 Green Room: Schedule updated via WebSocket - checking if reload needed');
        // Only reload if the update affects public items visibility
        if (data && (data.publicItemsChanged || data.isPublicChanged)) {
          console.log('📡 Green Room: Public items changed, reloading schedule');
          loadSchedule();
        } else {
          console.log('📡 Green Room: Schedule update does not affect public items, skipping reload');
        }
      },
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Green Room: Run of show data updated via WebSocket - checking if reload needed');
        // Only reload if the update affects public items visibility
        if (data && (data.publicItemsChanged || data.isPublicChanged)) {
          console.log('📡 Green Room: Public items changed, reloading schedule');
          loadSchedule();
        } else {
          console.log('📡 Green Room: Schedule update does not affect public items, skipping reload');
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log(`🔌 Green Room WebSocket connection ${connected ? 'established' : 'lost'} for event: ${event.id}`);
      },
      onInitialSync: async () => {
        console.log('🔄 Green Room: WebSocket initial sync triggered - loading current state');
        
        // Load current active timer
        try {
          const activeTimerResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/active-timers/${event?.id}`);
          if (activeTimerResponse.ok) {
            const activeTimers = await activeTimerResponse.json();
            console.log('🔄 Green Room initial sync: Loaded active timers:', activeTimers);
            
            if (activeTimers && activeTimers.length > 0) {
              const activeTimer = activeTimers[0]; // Green Room typically shows one active timer
              
              setActiveItemId(parseInt(activeTimer.item_id));
              setTimerState(activeTimer.timer_state);
              setLoadedItems({ [parseInt(activeTimer.item_id)]: true });
              
              // Update timer progress
              setTimerProgress({
                [parseInt(activeTimer.item_id)]: {
                  elapsed: activeTimer.elapsed_seconds || 0,
                  total: activeTimer.duration_seconds || 300,
                  startedAt: activeTimer.started_at ? new Date(activeTimer.started_at) : null
                }
              });
              
              console.log('🔄 Green Room: Initial sync completed - timer state restored');
            } else {
              // No active timer
              setActiveItemId(null);
              setTimerState(null);
              setLoadedItems({});
              setTimerProgress({});
              console.log('🔄 Green Room: Initial sync completed - no active timer');
            }
          }
        } catch (error) {
          console.error('❌ Green Room: Initial sync failed to load active timer:', error);
        }
      }
    };

    // Connect to WebSocket
    socketClient.connect(event.id, callbacks);
    
    // Show disconnect timer modal only on first connect
    if (!hasShownModalOnce) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }

    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ Green Room: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(event.id);
        // Timer keeps running in background
      } else if (!socketClient.isConnected()) {
        console.log('👁️ Green Room: Tab visible - silently reconnecting WebSocket (no modal)');
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
        // Modal won't show again - timer still running
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('🔄 Cleaning up Green Room WebSocket connection');
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (disconnectTimer) clearTimeout(disconnectTimer);
    };
  }, [event?.id]);

  // Always run local timer for smooth updates when timer is running
  useEffect(() => {
    if (!activeItemId || !timerProgress[activeItemId]) return;

    const progress = timerProgress[activeItemId];
    if (progress.startedAt && timerState === 'running') {
      const startedAt = progress.startedAt;
      const duration = progress.total;
      
      console.log(`🔄 Green Room: Starting continuous local timer for ${activeItemId} with duration ${duration}s, start time: ${startedAt.toISOString()}`);
      
      const continuousTimer = setInterval(() => {
        const syncedNow = new Date(Date.now() + clockOffset);
        const elapsed = Math.floor((syncedNow.getTime() - startedAt.getTime()) / 1000);
        
        // Always update timer progress for smooth counting
        setTimerProgress(prev => ({
          ...prev,
          [activeItemId]: {
            ...prev[activeItemId],
            elapsed: elapsed
          }
        }));
        
        // Drift detector removed - WebSocket handles all sync
        
        // Debug logging for first few seconds
        if (elapsed <= 10) {
          console.log(`🕐 Green Room Timer ${activeItemId}: Continuous elapsed=${elapsed}s, Start=${startedAt.toISOString()}, Now=${now.toISOString()}`);
        }
      }, 1000);

      return () => {
        console.log(`🔄 Green Room: Stopping continuous local timer for ${activeItemId}`);
        clearInterval(continuousTimer);
      };
    }
  }, [activeItemId, timerState]); // Removed timerProgress to prevent constant restarts

  // Cleanup on component unmount (drift detector removed)
  useEffect(() => {
    return () => {
      console.log('🔄 Green Room: Cleaning up on component unmount');
      // Drift detector removed - using WebSocket-only approach
      
      // Clear any remaining intervals
      if (localTimerInterval) {
        clearInterval(localTimerInterval);
      }
    };
  }, []);

  // Load schedule data
  const loadSchedule = async () => {
    console.log('🔄 Green Room loadSchedule called');
    console.log('🔄 Event object:', event);
    console.log('🔄 Event ID from URL params:', eventId);
    console.log('🔄 Event ID from event object:', event?.id);
    
    // Try to get event ID from event object or URL params
    const currentEventId = event?.id || eventId;
    
    if (!currentEventId) {
      console.log('❌ No event ID found in event object or URL params');
      setError('No event selected');
      setIsLoading(false);
      return;
    }
    
    console.log('🔄 Using event ID:', currentEventId);

    try {
      console.log('🔄 Loading schedule for Green Room...');
      console.log('🔄 Event details:', { id: currentEventId, name: event.name, location: event.location });
      const data = await DatabaseService.getRunOfShowData(currentEventId);
      console.log('🔄 Raw data received:', data);
      
      // Load master start time from API data (prioritize database over localStorage)
      let effectiveMasterStartTime = masterStartTime; // Default to current state
      
      if (data && data.settings && data.settings.masterStartTime) {
        console.log('📥 Found master start time in API data:', data.settings.masterStartTime);
        effectiveMasterStartTime = data.settings.masterStartTime;
        setMasterStartTime(data.settings.masterStartTime);
      } else if (data && data.settings && data.settings.dayStartTimes && data.settings.dayStartTimes['1']) {
        console.log('📥 Found day start time for Day 1 in API data:', data.settings.dayStartTimes['1']);
        effectiveMasterStartTime = data.settings.dayStartTimes['1'];
        setMasterStartTime(data.settings.dayStartTimes['1']);
        // Also update localStorage to keep it in sync
        localStorage.setItem(`masterStartTime_${currentEventId}`, data.settings.dayStartTimes['1']);
      } else {
        console.log('❌ No master start time found in API data, using localStorage value:', masterStartTime);
        // Keep the localStorage value if no database value found
      }
      
      // Load event timezone from API data
      if (data && data.settings && data.settings.timezone) {
        console.log('🌍 Loaded timezone from event data:', data.settings.timezone);
        setEventTimezone(data.settings.timezone);
      }
      
      // Load day start times from API data
      if (data && data.settings && data.settings.dayStartTimes) {
        console.log('📅 Loaded day start times from API data:', data.settings.dayStartTimes);
        setDayStartTimes(data.settings.dayStartTimes);
      }
      
      // Load overtime data from API
      if (data && data.overtime_minutes) {
        console.log('⏰ Loaded overtime minutes:', data.overtime_minutes);
        setOvertimeMinutes(data.overtime_minutes);
      }
      
      // Load show start overtime and start cue ID
      if (data && data.show_start_overtime !== undefined) {
        console.log('⭐ Loaded show start overtime:', data.show_start_overtime);
        setShowStartOvertime(data.show_start_overtime);
      }
      
      if (data && data.start_cue_id !== undefined) {
        console.log('🎯 Loaded start cue ID:', data.start_cue_id);
        setStartCueId(data.start_cue_id);
      }
      
      if (data?.schedule_items) {
        console.log('🔄 Total schedule items found:', data.schedule_items.length);
        
        // Determine number of days from schedule data OR dayStartTimes
        const days = data.schedule_items.map((item: any) => item.day || 1);
        console.log('🔍 All days in schedule:', days);
        const maxDayFromSchedule = Math.max(...days);
        console.log('🔍 Max day found in schedule:', maxDayFromSchedule);
        
        // Also check dayStartTimes to see if there are multiple day start times
        const dayStartTimesKeys = data.settings?.dayStartTimes ? Object.keys(data.settings.dayStartTimes).map(Number) : [];
        const maxDayFromSettings = dayStartTimesKeys.length > 0 ? Math.max(...dayStartTimesKeys) : 1;
        console.log('🔍 Day start times keys:', dayStartTimesKeys);
        console.log('🔍 Max day from settings:', maxDayFromSettings);
        
        // Use the higher of the two values
        const maxDay = Math.max(maxDayFromSchedule, maxDayFromSettings);
        console.log('🔍 Final max day:', maxDay);
        console.log('🔍 Schedule items with days:', data.schedule_items.map((item: any) => ({ id: item.id, name: item.segmentName, day: item.day })));
        
        // Update numberOfDays state
        setNumberOfDays(maxDay);
        if (maxDay > 1) {
          console.log('📅 Multiday event detected, numberOfDays set to:', maxDay);
        } else {
          console.log('📅 Single day event detected, numberOfDays set to:', maxDay);
        }
        
        // Set the schedule first so it's available for time calculations
        setSchedule(data.schedule_items);
        
        // First, calculate all start times for the complete schedule (not just public items)
        // This ensures all times are recalculated when any duration changes
        const allItemsWithTimes = data.schedule_items.map((item: any, index: number) => {
          // Add null check for item
          if (!item) {
            console.log(`❌ Item at index ${index} is null/undefined, skipping`);
            return null;
          }
          
          // Calculate duration in minutes with safe defaults
          const durationHours = item.durationHours || 0;
          const durationMinutes = item.durationMinutes || 0;
          const durationSeconds = item.durationSeconds || 0;
          const totalMinutes = (durationHours * 60) + durationMinutes + (durationSeconds / 60);
          const duration = totalMinutes > 0 ? `${Math.round(totalMinutes)} min` : '0 min';
          
          // Calculate start time using the same logic as RunOfShowPage (with overtime)
          const startTime = calculateStartTimeWithOvertime(index, data.schedule_items, effectiveMasterStartTime);
          let endTime = null;
          
          console.log(`🔄 Calculated start time for ${item.segmentName} (index ${index}):`, {
            index,
            startTime,
            masterStartTime,
            duration: totalMinutes,
            itemDurationHours: item.durationHours,
            itemDurationMinutes: item.durationMinutes,
            itemDurationSeconds: item.durationSeconds
          });
          
          // Calculate end time as the start time of the next row
          if (startTime && startTime !== '') {
            // Find the next non-indented item
            let nextItemIndex = index + 1;
            while (nextItemIndex < data.schedule_items.length) {
              const nextItem = data.schedule_items[nextItemIndex];
              if (nextItem && !nextItem.isIndented) {
                    const nextStartTime = calculateStartTimeWithOvertime(nextItemIndex, data.schedule_items, effectiveMasterStartTime);
                if (nextStartTime && nextStartTime !== '') {
                  endTime = nextStartTime;
                  break;
                }
              }
              nextItemIndex++;
            }
            
            // If no next item found, calculate based on duration
            if (!endTime && totalMinutes > 0) {
              // Parse the start time and add duration
              const startDate = new Date(`1970-01-01 ${startTime}`);
              const endDate = new Date(startDate.getTime() + totalMinutes * 60000);
              endTime = endDate.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                second: '2-digit',
                hour12: true 
              });
            } else if (!endTime) {
              endTime = 'TBD';
            }
          } else {
            // No start time available
            endTime = 'TBD';
          }
          
          return {
            ...item,
            startTime,
            endTime,
            duration,
            isPublic: item.isPublic || false
          };
        }).filter(item => item !== null); // Remove null items

        // Now filter to only show public items, but with correct times already calculated
        const formattedSchedule = allItemsWithTimes.filter((item: any) => item && item.isPublic === true);
        console.log('🔄 Public items found after time calculation:', formattedSchedule.length);

          // Sort by start time (handle empty/TBD values)
          formattedSchedule.sort((a, b) => {
            // If both have valid times, sort by time
            if (a.startTime && a.startTime !== 'TBD' && b.startTime && b.startTime !== 'TBD') {
              const timeA = new Date(`1970-01-01 ${a.startTime}`);
              const timeB = new Date(`1970-01-01 ${b.startTime}`);
              return timeA.getTime() - timeB.getTime();
            }
            // If one has no time, put it at the end
            if ((!a.startTime || a.startTime === 'TBD') && b.startTime && b.startTime !== 'TBD') return 1;
            if (a.startTime && a.startTime !== 'TBD' && (!b.startTime || b.startTime === 'TBD')) return -1;
            // If both have no time, maintain original order
            return 0;
          });

        // No need to mark items as current - we'll use activeItemId directly in rendering

        setSchedule(formattedSchedule);
        console.log('✅ Schedule loaded for Green Room:', formattedSchedule);
      } else {
        setError('No schedule data found');
      }
    } catch (err) {
      console.error('❌ Error loading schedule:', err);
      console.error('❌ Error details:', {
        message: err.message,
        stack: err.stack,
        eventId: event?.id,
        eventName: event?.name
      });
      setError(`Failed to load schedule data: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Load schedule data on mount
  useEffect(() => {
    loadSchedule();
  }, [event?.id]);

  // WebSocket connection for schedule changes
  useEffect(() => {
    if (!event?.id) return;

    console.log('🔌 Setting up WebSocket connection for Green Room schedule updates');
    
    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Green Room: Run of show data updated via WebSocket');
        // Update schedule data directly from WebSocket
        if (data && data.schedule_items) {
          setSchedule(data.schedule_items);
        }
        // Update master start time if provided
        if (data && data.settings && data.settings.masterStartTime) {
          setMasterStartTime(data.settings.masterStartTime);
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log(`🔌 Green Room schedule WebSocket connection ${connected ? 'established' : 'lost'} for event: ${event.id}`);
      },
      onInitialSync: async () => {
        console.log('🔄 Green Room: Schedule WebSocket initial sync triggered');
        
        // Load current schedule data
        try {
          const scheduleResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/run-of-show-data/${event?.id}`);
          if (scheduleResponse.ok) {
            const data = await scheduleResponse.json();
            console.log('🔄 Green Room schedule initial sync: Loaded schedule data');
            
            if (data && data.schedule_items) {
              setSchedule(data.schedule_items);
            }
            if (data && data.settings && data.settings.masterStartTime) {
              setMasterStartTime(data.settings.masterStartTime);
            }
            
            console.log('🔄 Green Room: Schedule initial sync completed');
          }
        } catch (error) {
          console.error('❌ Green Room: Schedule initial sync failed:', error);
        }
      }
    };

    // Connect to WebSocket for schedule updates
    socketClient.connect(event.id, callbacks);

    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleScheduleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ Green Room: Schedule tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(event.id);
      } else if (!socketClient.isConnected()) {
        console.log('👁️ Green Room: Schedule tab visible - reconnecting WebSocket');
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
      }
    };

    document.addEventListener('visibilitychange', handleScheduleVisibilityChange);

    return () => {
      console.log('🔄 Cleaning up Green Room schedule WebSocket connection');
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleScheduleVisibilityChange);
    };
  }, [event?.id]);

  // No need for scroll logic - we're filtering the data instead

  // Dynamically modify isPublic to hide items above the current one
  const publicSchedule = useMemo(() => {
    // First filter by selected day
    const dayFilteredSchedule = schedule.filter(item => item.day === selectedDay);
    
    // Find the current item index in the day-filtered schedule
    // Convert both to strings for comparison since activeItemId might be a string
    const currentIndex = activeItemId ? dayFilteredSchedule.findIndex(item => String(item.id) === String(activeItemId)) : -1;
    
    console.log('🔄 Modifying schedule visibility:', {
      totalScheduleItems: schedule.length,
      dayFilteredItems: dayFilteredSchedule.length,
      selectedDay,
      currentIndex,
      activeItemId,
      activeItemIdType: typeof activeItemId,
      scheduleItemIds: dayFilteredSchedule.map(item => ({ id: item.id, idType: typeof item.id, name: item.segmentName })),
      originalSchedule: dayFilteredSchedule.map(item => ({ id: item.id, name: item.segmentName, isPublic: item.isPublic }))
    });
    
    // If we have an active item, show only from that item onwards
    if (currentIndex >= 0) {
      const visibleItems = dayFilteredSchedule.slice(currentIndex).map(item => ({
        ...item,
        isPublic: true // Force all items from current onwards to be visible
      }));
      
      console.log('🔄 Showing items from current onwards:', {
        currentIndex,
        visibleItems: visibleItems.map(item => ({ id: item.id, name: item.segmentName }))
      });
      
      return visibleItems;
    }
    
    // If no active item, show all public items (fallback behavior)
    const visibleItems = dayFilteredSchedule.filter(item => item.isPublic === true);
    
    console.log('🔄 No active item, showing all public items:', {
      visibleItems: visibleItems.map(item => ({ id: item.id, name: item.segmentName }))
    });
    
    return visibleItems;
  }, [schedule, selectedDay, activeItemId]);

  // Calculate expected finish time from active timer
  const getExpectedFinishTime = () => {
    if (!activeItemId || !timerProgress[activeItemId]) return 'No Timer';
    
    const progress = timerProgress[activeItemId];
    
    // For loaded timers, show "Ready to Start"
    if (timerState === 'loaded') return 'Ready to Start';
    
    // For running timers, calculate finish time
    if (timerState !== 'running') return 'Timer Stopped';
    
    if (!progress.startedAt) return 'Not Started';
    
    const finishTime = new Date(progress.startedAt.getTime() + progress.total * 1000);
    return finishTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true 
    });
  };

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

  // Calculate remaining time from active timer (shows negative for overtime)
  const getRemainingTime = () => {
    if (!activeItemId || !timerProgress[activeItemId]) return '00:00';
    
    const progress = timerProgress[activeItemId];
    
    // If timer is loaded but not running, show full duration
    if (timerState === 'loaded') {
      return formatTime(progress.total);
    }
    
    // If timer is not running, show 00:00
    if (timerState !== 'running') return '00:00';

    const remaining = progress.total - progress.elapsed; // Allow negative values
    
    return formatTime(remaining);
  };

  // Check if timer is in overtime
  const isOvertime = () => {
    if (!activeItemId || !timerProgress[activeItemId]) return false;
    if (timerState !== 'running') return false; // Only show overtime when timer is running
    const progress = timerProgress[activeItemId];
    return progress.total - progress.elapsed < 0;
  };

  if (isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center relative" style={{ aspectRatio: '9/16' }}>
        {/* Video Background */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            objectFit: 'cover'
          }}
        >
          <source src="/pointed_crop_loop.webm" type="video/webm" />
          Your browser does not support the video tag.
        </video>
        <div className="text-white text-xl relative z-10 bg-black/50 px-4 py-2 rounded">Loading Green Room...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center relative" style={{ aspectRatio: '9/16' }}>
        {/* Video Background */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            objectFit: 'cover'
          }}
        >
          <source src="/pointed_crop_loop.webm" type="video/webm" />
          Your browser does not support the video tag.
        </video>
        <div className="text-red-400 text-xl relative z-10 bg-black/50 px-4 py-2 rounded">{error}</div>
      </div>
    );
  }

  // Handle disconnect timer confirmation
  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = (hours * 60) + minutes;
    
    if (totalMinutes === 0) {
      alert('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    
    // Clear any existing timer
    if (disconnectTimer) clearTimeout(disconnectTimer);
    
    // Start new disconnect timer
    const ms = totalMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      let timeText = '';
      if (hours > 0) timeText += `${hours}h `;
      if (minutes > 0) timeText += `${minutes}m`;
      
      console.log(`⏰ GreenRoomPage: Auto-disconnect timer expired (${timeText.trim()})`);
      console.log('📢 GreenRoomPage: Showing disconnect notification...');
      
      // Show notification and disconnect
      setDisconnectDuration(timeText.trim());
      setShowDisconnectNotification(true);
      console.log('✅ GreenRoomPage: Notification state set to true');
      
      setTimeout(() => {
        if (event?.id) {
          socketClient.disconnect(event.id);
          console.log('🔌 GreenRoomPage: WebSocket disconnected');
        }
      }, 100);
    }, ms);
    
    setDisconnectTimer(timer);
    setShowDisconnectModal(false);
    
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (minutes > 0) timeText += `${minutes}m`;
    console.log(`⏰ GreenRoomPage: Disconnect timer set to ${timeText.trim()}`);
  };
  
  // Handle never disconnect
  const handleNeverDisconnect = () => {
    if (disconnectTimer) clearTimeout(disconnectTimer);
    setDisconnectTimer(null);
    setShowDisconnectModal(false);
    console.log('⏰ GreenRoomPage: Disconnect timer set to Never');
  };
  
  // Handle reconnect from notification
  const handleReconnect = () => {
    setShowDisconnectNotification(false);
    if (event?.id) {
      // Reconnect with original callbacks
      const loadSchedule = async () => {
        try {
          const data = await DatabaseService.getRunOfShowData(event.id);
          if (data && data.schedule_items) {
            setSchedule(data.schedule_items);
          }
          if (data && data.settings && data.settings.masterStartTime) {
            setMasterStartTime(data.settings.masterStartTime);
          }
        } catch (error) {
          console.error('❌ Error loading schedule:', error);
        }
      };
      
      loadSchedule();
      
      // Show modal again after timed disconnect to set new timer
      setShowDisconnectModal(true);
    }
  };

  return (
    <>
      <div className="w-full h-screen text-white overflow-hidden relative" style={{ aspectRatio: '9/16' }}>
      {/* Video Background */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          objectFit: 'cover'
        }}
      >
        <source src="/pointed_crop_loop.webm" type="video/webm" />
        Your browser does not support the video tag.
      </video>
      
      {/* Content Overlay */}
      <div className="relative z-10">
        {/* Day Selector for Multiday Events */}
        {numberOfDays > 1 && (
          <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg p-3">
            <select
              value={selectedDay}
              onChange={(e) => {
                const day = parseInt(e.target.value);
                setSelectedDay(day);
                // Update master start time for selected day
                if (dayStartTimes[day]) {
                  setMasterStartTime(dayStartTimes[day]);
                }
              }}
              className="bg-gray-800 text-white px-3 py-2 rounded border border-gray-600 text-lg"
            >
              {Array.from({ length: numberOfDays }, (_, i) => i + 1).map(day => (
                <option key={day} value={day}>
                  Day {day}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Drift Status Indicator - Top Left Corner */}
        
        {/* Header - Event Name and Timer */}
        <div className="p-6 flex items-center">
          {/* Event Name - Centered in available space */}
          <div 
            className="text-white font-bold flex-1 text-center"
            style={{
              fontSize: 'clamp(2rem, 6vw, 4rem)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              lineHeight: '1.1',
              marginRight: '20px'
            }}
          >
            {event?.name || 'Current Event'}
          </div>
          
          {/* Timer */}
          <div className={`rounded-lg p-4 text-center flex-shrink-0 ${isOvertime() ? 'bg-red-800' : 'bg-red-600'}`}>
          <div className="text-white text-xl font-semibold mb-2">
            {isOvertime() ? 'OVER TIME' : 'Stage Timer'}
          </div>
          <div className={`text-5xl font-bold mb-2 ${isOvertime() ? 'text-red-200' : 'text-white'}`}>
            {getRemainingTime()}
          </div>
          <div className="text-white text-base">
            Expected Finish: {getExpectedFinishTime()}
          </div>
        </div>
      </div>

        {/* Schedule List - Shows only current and future items (max 8) */}
        <div className="flex-1 overflow-y-auto p-6 max-h-[calc(100vh-200px)] [&::-webkit-scrollbar]:hidden"
          style={{
            scrollbarWidth: 'none', /* Firefox */
            msOverflowStyle: 'none', /* Internet Explorer 10+ */
          }}
        >
        <div className="space-y-4">
        {publicSchedule.length === 0 ? (
          <div className="text-center text-gray-400 text-lg py-12">
            No public schedule items available
          </div>
        ) : (
          <>
            {publicSchedule.slice(0, 8).map((item, index) => {
              const isLoaded = loadedItems[item.id];
              const isRunning = timerState === 'running' && String(activeItemId) === String(item.id);
              const isActive = String(activeItemId) === String(item.id);
              
              console.log(`🔄 Item ${item.id} (${item.segmentName}):`, {
                isLoaded,
                isRunning,
                isActive,
                timerState,
                activeItemId,
                loadedItems
              });
              
              return (
            <div
              key={item.id}
              className={`p-4 rounded-lg transition-all duration-300 ${
                isLoaded
                  ? isRunning
                    ? 'bg-red-600 text-white'
                    : 'bg-green-600 text-white'
                  : 'bg-gray-300 text-gray-700'
              }`}
            >
              <div className="font-bold text-xl mb-2 uppercase">{item.segmentName}</div>
              <div className="text-sm space-y-1">
                <div>Start: {item.startTime}</div>
                <div>End: {item.endTime}</div>
              </div>
            </div>
              );
            })}
          </>
        )}
        </div>
      </div>
      </div>
      </div>
      
      {/* Disconnect Timer Modal */}
      {showDisconnectModal && <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />}
      
      {/* Disconnect Notification */}
      {showDisconnectNotification && <DisconnectNotification duration={disconnectDuration} onReconnect={handleReconnect} />}
      
    </>
  );
};

// Reuse the same components from ClockPage
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
    console.log('🔔 GreenRoom DisconnectNotification mounted:', duration);
    return () => console.log('🔔 GreenRoom DisconnectNotification unmounted');
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

export default GreenRoomPage;
