import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { Event } from '../types/Event';
// import { driftDetector } from '../services/driftDetector'; // REMOVED: Using WebSocket-only approach
import { socketClient } from '../services/socket-client';
import { apiClient } from '../services/api-client';

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
  startTime?: string;
  endTime?: string;
  duration?: string;
}

const GreenRoomPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
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
  const [eventTimezone, setEventTimezone] = useState<string>('America/New_York'); // Default to EST
  const [timerProgress, setTimerProgress] = useState<{[key: number]: {elapsed: number, total: number, startedAt: Date | null}}>({});
  const [timerState, setTimerState] = useState<string | null>(null); // 'loaded' or 'running'
  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});
  
  // Track initial load to prevent flashing during page refresh
  const isInitialLoadRef = useRef(true);
  
  // Overtime data (same as RunOfShowPage)
  const [overtimeMinutes, setOvertimeMinutes] = useState<Record<number, number>>({});
  const [showStartOvertime, setShowStartOvertime] = useState<number>(0);
  const [startCueId, setStartCueId] = useState<number | null>(null);
  const [indentedCues, setIndentedCues] = useState<Record<number, { parentId: number; userId: string; userName: string }>>({});

  // Event list for selector (like PhotoViewPage)
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [showEventSelector, setShowEventSelector] = useState(false);

  // Fetch events list for the event selector dropdown
  useEffect(() => {
    const loadEvents = async () => {
      try {
        setEventsLoading(true);
        const calendarEvents = await DatabaseService.getCalendarEvents();
        const mapped: Event[] = (calendarEvents || []).map((calEvent: any) => {
          const dateObj = new Date(calEvent.date);
          const simpleDate = dateObj.toISOString().split('T')[0];
          return {
            id: calEvent.id || '',
            name: calEvent.name,
            date: simpleDate,
            location: calEvent.schedule_data?.location || '',
            numberOfDays: calEvent.schedule_data?.numberOfDays || 1,
            timezone: calEvent.schedule_data?.timezone,
            created_at: calEvent.created_at,
            updated_at: calEvent.updated_at
          };
        });
        mapped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setEvents(mapped.filter((e) => e.id));
      } catch (e) {
        console.warn('GreenRoom: Failed to load events for selector:', e);
        setEvents([]);
      } finally {
        setEventsLoading(false);
      }
    };
    loadEvents();
  }, []);

  // UTC utility functions with proper timezone conversion
  const getCurrentTimeUTC = (): Date => {
    return new Date(); // JavaScript Date objects are already UTC internally
  };

  // Convert a local time to UTC using the event timezone
  const convertLocalTimeToUTC = (localTime: Date, timezone: string): Date => {
    try {
      // Create a date that represents the local time in the event timezone
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const day = now.getDate();
      
      // Create a date object for the scheduled time in the event timezone
      const scheduledDate = new Date(year, month, day, localTime.getHours(), localTime.getMinutes(), 0);
      
      // Get the timezone offset for the event timezone
      const eventTime = new Date(scheduledDate.toLocaleString("en-US", { timeZone: timezone }));
      const utcTime = new Date(scheduledDate.toLocaleString("en-US", { timeZone: 'UTC' }));
      const offsetMs = eventTime.getTime() - utcTime.getTime();
      
      // Apply the offset to get the correct UTC time
      const result = new Date(scheduledDate.getTime() - offsetMs);
      
      return result;
    } catch (error) {
      console.warn('Error converting local time to UTC:', error);
      return localTime; // Fallback to original time
    }
  };

  // Get current time in the event timezone
  const getCurrentTimeInEventTimezone = (): Date => {
    if (!eventTimezone) return new Date();
    try {
      const now = new Date();
      const timeStr = now.toLocaleString("en-US", {
        timeZone: eventTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      return new Date(timeStr);
    } catch (error) {
      console.warn('Error getting current time in event timezone:', error);
      return new Date();
    }
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
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Calculate start time function (same as RunOfShowPage)
  const calculateStartTime = (index: number, scheduleData?: any[], masterStartTimeOverride?: string, indentedCuesData?: Record<number, any>) => {
    const currentSchedule = scheduleData || schedule;
    const currentItem = currentSchedule[index];
    if (!currentItem) {
      console.log(`❌ No current item at index ${index}`);
      return '';
    }
    
    // Get the appropriate start time for this day
    const itemDay = currentItem.day || 1;
    const effectiveMasterStartTime = masterStartTimeOverride || (dayStartTimes[itemDay] || masterStartTime);
    const currentIndentedCues = indentedCuesData || indentedCues;
    
    // Removed verbose logging to prevent console spam
    // console.log(`🔄 calculateStartTime called for index ${index} (day ${itemDay}):`, {
    //   masterStartTime: effectiveMasterStartTime,
    //   scheduleLength: currentSchedule.length,
    //   itemDay
    // });
    
    if (!effectiveMasterStartTime) {
      // console.log('❌ No master start time, returning empty string');
      return '';
    }
    
    // Calculate total minutes from the beginning of this day up to this item
    // Only count items from the same day and non-indented items
    let totalMinutes = 0;
    for (let i = 0; i < index; i++) {
      const item = currentSchedule[i];
      if (!item) {
        // console.log(`  Item ${i}: undefined/null item, skipping`);
        continue;
      }
      
      const itemItemDay = item.day || 1;
      // Only count items from the same day and non-indented items
      if (itemItemDay === itemDay && !currentIndentedCues[item.id]) {
        const durationHours = item.durationHours || 0;
        const durationMinutes = item.durationMinutes || 0;
        const itemMinutes = (durationHours * 60) + durationMinutes;
        totalMinutes += itemMinutes;
        // console.log(`  Item ${i} (${item.segmentName || 'Unknown'}, day ${itemItemDay}): ${durationHours}h ${durationMinutes}m = ${itemMinutes} total minutes`);
      } else {
        // console.log(`  Item ${i} (${item.segmentName || 'Unknown'}, day ${itemItemDay}): skipped (different day or indented)`);
      }
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
    
    // Removed verbose logging to prevent console spam
    
    return result;
  };

  // Calculate start time with automatic overtime adjustments (same as RunOfShowPage)
  const calculateStartTimeWithOvertime = (index: number, scheduleData?: any[], masterStartTimeOverride?: string, overtimeData?: Record<number, number>, showStartOvertimeData?: number | null, startCueIdData?: number | null, indentedCuesData?: Record<number, any>) => {
    const currentSchedule = scheduleData || schedule;
    const currentItem = currentSchedule[index];
    if (!currentItem) {
      console.log(`❌ No current item at index ${index}`);
      return '';
    }
    
    // Use passed parameters or fall back to state
    const currentOvertimeMinutes = overtimeData || overtimeMinutes;
    const currentShowStartOvertime = showStartOvertimeData !== undefined ? (showStartOvertimeData || 0) : showStartOvertime;
    const currentStartCueId = startCueIdData !== undefined ? startCueIdData : startCueId;
    const currentIndentedCues = indentedCuesData || indentedCues;
    
    // Get the base start time (pass indentedCuesData so it can filter correctly)
    const baseStartTime = calculateStartTime(index, scheduleData, masterStartTimeOverride, currentIndentedCues);
    if (!baseStartTime) {
      console.log(`❌ No base start time for index ${index}`);
      return '';
    }
    
    // Removed verbose logging to prevent console spam
    // Only log errors or significant issues
    
    // Calculate total overtime from previous cues, but ignore rows ABOVE the STAR
    let totalOvertimeMinutes = 0;
    
    // Find the START cue index to know where to start counting overtime
    const startCueIndex = currentStartCueId ? currentSchedule.findIndex(s => s.id === currentStartCueId) : -1;
    const startCountingFrom = startCueIndex !== -1 ? startCueIndex : 0;
    
    // Only count overtime from START cue onwards (ignore rows above STAR)
    for (let i = startCountingFrom; i < index; i++) {
      const item = currentSchedule[i];
      const itemDay = item.day || 1;
      const currentItemDay = currentItem.day || 1;
      
      // Only count overtime from the same day and non-indented items
      if (itemDay === currentItemDay && !currentIndentedCues[item.id]) {
        const itemOvertime = currentOvertimeMinutes[item.id] || 0;
        totalOvertimeMinutes += itemOvertime;
        // Removed verbose logging to prevent console spam
      }
    }
    
    // Add show start overtime for START cue and all rows after it
    if (currentShowStartOvertime !== 0 && currentStartCueId !== null && startCueIndex !== -1 && index >= startCueIndex) {
      totalOvertimeMinutes += currentShowStartOvertime;
      // Removed verbose logging to prevent console spam
    }
    
    // If no overtime, return the base start time
    if (totalOvertimeMinutes === 0) {
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
    
    // Removed verbose logging to prevent console spam
    return result;
  };

  // Load master start time and day start times from localStorage
  useEffect(() => {
    if (event?.id) {
      const savedMasterTime = localStorage.getItem(`masterStartTime_${event.id}`);
      const savedDayTimes = localStorage.getItem(`dayStartTimes_${event.id}`);
      
      if (savedMasterTime) {
        setMasterStartTime(savedMasterTime);
      } else {
        // Try to find any master start time in localStorage
        const allMasterTimes = Object.keys(localStorage)
          .filter(key => key.includes('masterStartTime'))
          .map(key => ({ key, value: localStorage.getItem(key) }));
        
        // Look for the most recent or most likely master start time
        // Priority: 1) Any time that's not 09:00, 2) Any time that looks like PM, 3) First available
        let selectedTime = null;
        
        // First, try to find a time that's not the default 09:00
        const nonDefaultTime = allMasterTimes.find(t => t.value && t.value !== '09:00');
        if (nonDefaultTime) {
          selectedTime = nonDefaultTime;
        } else {
          // If no non-default time, use the first available
          selectedTime = allMasterTimes.find(t => t.value);
        }
        
        if (selectedTime && selectedTime.value) {
          setMasterStartTime(selectedTime.value);
        }
      }
      
      if (savedDayTimes) {
        setDayStartTimes(JSON.parse(savedDayTimes));
      }
    }
  }, [event?.id]);

  // Lightweight periodic refresh for Green Room (similar to PhotoViewPage)
  useEffect(() => {
    if (!event?.id) {
      return;
    }

    // Removed verbose logging to prevent console spam
    
    // 20-second lightweight refresh to ensure data stays current
    const refreshInterval = setInterval(async () => {
      // Removed verbose logging to prevent console spam (runs every 20 seconds)

      try {
        // Reload schedule data and overtime adjustments
        const data = await DatabaseService.getRunOfShowData(event.id);
        if (data?.schedule_items) {
          // Removed verbose logging to prevent console spam

          // Update master start time if it changed
          const masterStartTimeFromDB = data.settings?.masterStartTime || data.settings?.dayStartTimes?.['1'] || '09:00';
          if (masterStartTimeFromDB !== masterStartTime) {
            // Removed verbose logging to prevent console spam
            setMasterStartTime(masterStartTimeFromDB);
          }
          
          // Reload overtime data
          try {
            const overtimeData = await DatabaseService.getOvertimeMinutes(event.id);
            const showStartOvertimeData = await DatabaseService.getShowStartOvertime(event.id);
            const indentedCuesData = await DatabaseService.getIndentedCues(event.id);
            
            if (overtimeData) {
              setOvertimeMinutes(overtimeData);
            }
            
            if (showStartOvertimeData !== null) {
              const overtimeValue = (showStartOvertimeData as any).show_start_overtime || showStartOvertimeData.overtimeMinutes || 0;
              const startCueIdValue = (showStartOvertimeData as any).item_id || showStartOvertimeData.startCueId;
              setShowStartOvertime(overtimeValue);
              if (startCueIdValue) {
                setStartCueId(startCueIdValue);
              }
            }
            
            if (indentedCuesData && indentedCuesData.length > 0) {
              const indentedCuesMap: Record<number, { parentId: number; userId: string; userName: string }> = {};
              indentedCuesData.forEach((cue: any) => {
                indentedCuesMap[cue.item_id] = {
                  parentId: cue.parent_id,
                  userId: cue.user_id,
                  userName: cue.user_name
                };
              });
              setIndentedCues(indentedCuesMap);
            }
            
            // Recalculate schedule with fresh overtime data
            const formattedSchedule = data.schedule_items.map((item: any) => ({
              ...item,
              isPublic: item.isPublic === true || item.isPublic === 'true',
              // Convert duration_seconds to separate fields
              durationHours: Math.floor((item.duration_seconds || 0) / 3600),
              durationMinutes: Math.floor(((item.duration_seconds || 0) % 3600) / 60),
              durationSeconds: (item.duration_seconds || 0) % 60
            }));
            
            // Recalculate times with overtime adjustments
            const recalculatedSchedule = formattedSchedule.map((item: any, index: number) => {
              if (!item) return null;
              
              const durationHours = item.durationHours || 0;
              const durationMinutes = item.durationMinutes || 0;
              const durationSeconds = item.durationSeconds || 0;
              const totalMinutes = (durationHours * 60) + durationMinutes + (durationSeconds / 60);
              const duration = totalMinutes > 0 ? `${Math.round(totalMinutes)} min` : '0 min';
              
              const startTime = calculateStartTimeWithOvertime(index, formattedSchedule, masterStartTimeFromDB, overtimeData, overtimeValue, startCueIdValue, indentedCuesMap);
              let endTime = null;
              
              if (startTime && startTime !== '') {
                let nextItemIndex = index + 1;
                while (nextItemIndex < formattedSchedule.length) {
                  const nextItem = formattedSchedule[nextItemIndex];
                  if (nextItem && !indentedCuesMap[nextItem.id]) {
                    const nextStartTime = calculateStartTimeWithOvertime(nextItemIndex, formattedSchedule, masterStartTimeFromDB, overtimeData, overtimeValue, startCueIdValue, indentedCuesMap);
                    if (nextStartTime && nextStartTime !== '') {
                      endTime = nextStartTime;
                      break;
                    }
                  }
                  nextItemIndex++;
                }
                
                if (!endTime && totalMinutes > 0) {
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
                endTime = 'TBD';
              }
              
              return {
                ...item,
                startTime,
                endTime,
                duration
              };
            });
            
            setSchedule(recalculatedSchedule);
            // Removed verbose logging to prevent console spam
          } catch (error) {
            console.error('❌ GreenRoom: 20s refresh - error loading overtime data:', error);
          }
        }
      } catch (error) {
        console.error('❌ GreenRoom: 20s refresh failed:', error);
      }
    }, 20000); // 20 seconds

    // Removed verbose logging to prevent console spam

    return () => {
      // Removed verbose logging to prevent console spam
      clearInterval(refreshInterval);
    };
  }, [event?.id, masterStartTime]);

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
      const activeTimer = await DatabaseService.getActiveTimer(event.id);
      
      if (activeTimer) {
        setActiveItemId(parseInt(activeTimer.item_id));
        setTimerState(activeTimer.timer_state); // 'loaded' or 'running'
        setLastLoadedCueId(parseInt(activeTimer.item_id)); // Track last loaded cue
        
        // Mark this item as loaded
        setLoadedItems({ [parseInt(activeTimer.item_id)]: true });
        
        // Use elapsed_seconds from database (already calculated)
        setTimerProgress({
          [parseInt(activeTimer.item_id)]: {
            elapsed: activeTimer.elapsed_seconds || 0,
            total: activeTimer.duration_seconds || 0,
            startedAt: activeTimer.started_at ? new Date(activeTimer.started_at) : null
          }
        });
      } else {
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
    
    // Removed verbose logging to prevent console spam
    
    const callbacks = {
      onServerTime: (data: any) => {
        // Sync client clock with server clock
        const serverTime = new Date(data.serverTime).getTime();
        const clientTime = new Date().getTime();
        const offset = serverTime - clientTime;
        setClockOffset(offset);
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
      },
      onTimerUpdated: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
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
            // Removed verbose logging to prevent console spam
          } else if (data.timer_state === 'loaded') {
            setTimerState('loaded');
            setActiveItemId(parseInt(data.item_id));
            setLastLoadedCueId(parseInt(data.item_id)); // Track last loaded cue
            // Clear all loaded items and set only the current active one
            setLoadedItems({ [parseInt(data.item_id)]: true });
            // Removed verbose logging to prevent console spam
          }
        }
      },
      onTimerStopped: (data: any) => {
        // Removed verbose logging to prevent console spam
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
        // Removed verbose logging to prevent console spam
        // Clear timer state but keep last loaded cue visible
        setTimerState(null);
        if (lastLoadedCueId) {
          setActiveItemId(lastLoadedCueId);
          setLoadedItems({ [lastLoadedCueId]: true });
          // Removed verbose logging to prevent console spam
        } else {
          setActiveItemId(null);
          setLoadedItems({});
        }
        setTimerProgress({});
      },
      onTimerStarted: (data: any) => {
        // Removed verbose logging to prevent console spam
        // Update active item when timer starts
        if (data && data.item_id) {
          setActiveItemId(data.item_id);
        }
      },
      onActiveTimersUpdated: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
        // Handle active timers update from active_timers table
        if (data && data.item_id) {
          if (data.timer_state === 'running' || data.timer_state === 'loaded') {
            setActiveItemId(parseInt(data.item_id));
            setTimerState(data.timer_state);
            setLastLoadedCueId(parseInt(data.item_id)); // Track last loaded cue
            // Clear all loaded items and set only the current active one
            setLoadedItems({ [data.item_id]: true });
            // Removed verbose logging to prevent console spam
          } else {
            // Timer is stopped - keep last loaded cue visible
            setTimerState(null);
            if (lastLoadedCueId) {
              setActiveItemId(lastLoadedCueId);
              setLoadedItems({ [lastLoadedCueId]: true });
              // Removed verbose logging to prevent console spam
            } else {
              setActiveItemId(null);
              setLoadedItems({});
            }
            // Removed verbose logging to prevent console spam
          }
        }
      },
      onResetAllStates: (data: any) => {
        // Removed verbose logging to prevent console spam
        // Clear all states when RunOfShowPage resets
        setActiveItemId(null);
        setTimerState(null);
        setLoadedItems({});
        setTimerProgress({});
        setLastLoadedCueId(null); // Clear last loaded cue on reset
        // Removed verbose logging to prevent console spam
      },
      onScheduleUpdated: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
        // Always reload on schedule updates to catch public status changes
        loadSchedule();
      },
      onRunOfShowDataUpdated: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
        // Always reload on schedule updates to catch public status changes
        loadSchedule();
      },
      onConnectionChange: (connected: boolean) => {
        // Removed verbose logging to prevent console spam
      },
      onInitialSync: async () => {
        // Removed verbose logging to prevent console spam
        
        // Load current active timer
        try {
          const activeTimerResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/active-timers/${event?.id}`);
          if (activeTimerResponse.ok) {
            const activeTimers = await activeTimerResponse.json();
            // Removed verbose logging to prevent console spam
            
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
              
              // Removed verbose logging to prevent console spam
            } else {
              // No active timer
              setActiveItemId(null);
              setTimerState(null);
              setLoadedItems({});
              setTimerProgress({});
              // Removed verbose logging to prevent console spam
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
        // Removed verbose logging to prevent console spam
        socketClient.disconnect(event.id);
        // Timer keeps running in background
      } else if (!socketClient.isConnected()) {
        // Removed verbose logging to prevent console spam
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
        // Modal won't show again - timer still running
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Removed verbose logging to prevent console spam
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
      
      // Removed verbose logging to prevent console spam
      
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
          // Removed verbose logging to prevent console spam (runs every second)
        }
      }, 1000);

      return () => {
        // Removed verbose logging to prevent console spam
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
    // Try to get event ID from event object or URL params
    const currentEventId = event?.id || eventId;
    
    if (!currentEventId) {
      setError('No event selected');
      setIsLoading(false);
      return;
    }

    try {
      // Clear cache to ensure fresh data
      apiClient.cache.delete(`runOfShowData_${currentEventId}`);
      console.log('🔄 Cleared cache for run of show data');
      
      const data = await DatabaseService.getRunOfShowData(currentEventId);
      
      // Load overtime data FIRST before processing schedule
      let freshOvertimeData: Record<number, number> = {};
      let freshShowStartOvertime = 0;
      let freshStartCueId: number | null = null;
      let freshIndentedCues: Record<number, any> = {};
      
      try {
        console.log('⏰ GreenRoom: Loading overtime data from dedicated endpoints...');
        const overtimeData = await DatabaseService.getOvertimeMinutes(currentEventId);
        const showStartOvertimeData = await DatabaseService.getShowStartOvertime(currentEventId);
        const indentedCuesData = await DatabaseService.getIndentedCues(currentEventId);
        
        if (overtimeData) {
          freshOvertimeData = overtimeData;
          setOvertimeMinutes(overtimeData);
          console.log('✅ GreenRoom: Loaded overtime data:', overtimeData);
        }
        
        if (showStartOvertimeData !== null) {
          const overtimeValue = (showStartOvertimeData as any).show_start_overtime || showStartOvertimeData.overtimeMinutes || 0;
          freshShowStartOvertime = overtimeValue;
          setShowStartOvertime(overtimeValue);
          if (overtimeValue !== 0) {
            console.log('✅ GreenRoom: Loaded show start overtime:', overtimeValue);
          }
        }
        
        if (indentedCuesData && indentedCuesData.length > 0) {
          const indentedCuesMap: Record<number, { parentId: number; userId: string; userName: string }> = {};
          indentedCuesData.forEach((cue: any) => {
            indentedCuesMap[cue.item_id] = {
              parentId: cue.parent_id,
              userId: cue.user_id,
              userName: cue.user_name
            };
          });
          freshIndentedCues = indentedCuesMap;
          setIndentedCues(indentedCuesMap);
          console.log('✅ GreenRoom: Loaded indented cues:', indentedCuesData.length);
        }
      } catch (error) {
        console.error('❌ Error loading overtime data from dedicated endpoints:', error);
      }
      
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
      
      // Load timezone from settings
      if (data.settings?.timezone) {
        setEventTimezone(data.settings.timezone);
        console.log('🌍 GreenRoom: Loaded timezone from settings:', data.settings.timezone);
      } else {
        console.log('🌍 GreenRoom: No timezone found in settings, using default:', eventTimezone);
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
      
      // Load indented cues data
      if (data && data.indented_cues) {
        console.log('🟠 Loaded indented cues:', data.indented_cues);
        setIndentedCues(data.indented_cues);
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
        
        // Load START CUE ID from schedule items (same as PhotoViewPage)
        const startCueItem = data.schedule_items.find((item: any) => item.isStartCue === true);
        if (startCueItem) {
          freshStartCueId = startCueItem.id;
          setStartCueId(startCueItem.id);
          // Removed verbose logging to prevent console spam
        } else {
          freshStartCueId = null;
          setStartCueId(null);
          // Removed verbose logging to prevent console spam
        }
        
        // Load last loaded cue from database (when no active timer)
        try {
          // Removed verbose logging to prevent console spam
          const lastLoadedCueData = await DatabaseService.getLastLoadedCue(currentEventId);
          if (lastLoadedCueData?.data && lastLoadedCueData.data.item_id) {
            setLastLoadedCueId(lastLoadedCueData.data.item_id);
            setActiveItemId(lastLoadedCueData.data.item_id);
            setLoadedItems({ [lastLoadedCueData.data.item_id]: true });
            // Removed verbose logging to prevent console spam
          } else {
            // Removed verbose logging to prevent console spam
          }
        } catch (error) {
          console.error('❌ GreenRoom: Error loading last loaded cue:', error);
        }
        
        // First, calculate all start times for the complete schedule (not just public items)
        // This ensures all times are recalculated when any duration changes
        const allItemsWithTimes = data.schedule_items.map((item: any, index: number) => {
          // Add null check for item
          if (!item) {
            // Removed verbose logging to prevent console spam
            return null;
          }
          
          // Calculate duration in minutes with safe defaults
          const durationHours = item.durationHours || 0;
          const durationMinutes = item.durationMinutes || 0;
          const durationSeconds = item.durationSeconds || 0;
          const totalMinutes = (durationHours * 60) + durationMinutes + (durationSeconds / 60);
          const duration = totalMinutes > 0 ? `${Math.round(totalMinutes)} min` : '0 min';
          
          // Calculate start time using the same logic as RunOfShowPage (with overtime)
          // Use the freshly loaded overtime data directly
          const startTime = calculateStartTimeWithOvertime(index, data.schedule_items, effectiveMasterStartTime, freshOvertimeData, freshShowStartOvertime, freshStartCueId, freshIndentedCues);
          let endTime = null;
          
          // Removed verbose logging to prevent console spam
          
          // Calculate end time as the start time of the next row
          if (startTime && startTime !== '') {
            // Find the next non-indented item
            let nextItemIndex = index + 1;
            while (nextItemIndex < data.schedule_items.length) {
              const nextItem = data.schedule_items[nextItemIndex];
              if (nextItem && !freshIndentedCues[nextItem.id]) {
                    const nextStartTime = calculateStartTimeWithOvertime(nextItemIndex, data.schedule_items, effectiveMasterStartTime, freshOvertimeData, freshShowStartOvertime, freshStartCueId, freshIndentedCues);
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
            isPublic: item.isPublic === true || item.isPublic === 'true'
          };
        }).filter(item => item !== null); // Remove null items

        
        // Store the FULL schedule (all items) with calculated times
        // This ensures we can calculate correct start times even when filtering to public items
        // The publicSchedule useMemo will filter to public items for display
        setSchedule(allItemsWithTimes);
        console.log('✅ Schedule loaded for Green Room (all items):', allItemsWithTimes.length, 'items');
        
        // Mark initial load as complete after a brief delay to allow all state to settle
        // This prevents flashing during the initial load sequence
        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 100);
      } else {
        setError('No schedule data found');
        isInitialLoadRef.current = false;
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
      isInitialLoadRef.current = false;
    } finally {
      setIsLoading(false);
    }
  };

  // Load schedule data on mount
  useEffect(() => {
    // Reset initial load flag when event changes
    isInitialLoadRef.current = true;
    loadSchedule();
  }, [event?.id]);

  // Recalculate schedule when overtime changes
  // Skip during initial load to prevent flashing
  useEffect(() => {
    if (schedule.length > 0 && !isInitialLoadRef.current) {
      // Removed verbose logging to prevent console spam
      
      // Recalculate all start and end times using the full schedule
      const recalculatedSchedule = schedule.map((item: any, index: number) => {
        if (!item) return null;
        
        // Calculate duration in minutes with safe defaults
        const durationHours = item.durationHours || 0;
        const durationMinutes = item.durationMinutes || 0;
        const durationSeconds = item.durationSeconds || 0;
        const totalMinutes = (durationHours * 60) + durationMinutes + (durationSeconds / 60);
        const duration = totalMinutes > 0 ? `${Math.round(totalMinutes)} min` : '0 min';
        
        // Get day-specific start time for this item
        const itemDay = item.day || 1;
        const daySpecificStartTime = dayStartTimes[itemDay] || masterStartTime;
        
        // Calculate start time using the same logic as RunOfShowPage (with overtime)
        // Pass all overtime parameters to ensure correct calculation
        const startTime = calculateStartTimeWithOvertime(
          index, 
          schedule, 
          daySpecificStartTime, 
          overtimeMinutes, 
          showStartOvertime, 
          startCueId, 
          indentedCues
        );
        let endTime = null;
        
        // Calculate end time as the start time of the next row
        if (startTime && startTime !== '') {
          // Find the next non-indented item
          let nextItemIndex = index + 1;
          while (nextItemIndex < schedule.length) {
            const nextItem = schedule[nextItemIndex];
            if (nextItem && !indentedCues[nextItem.id]) {
              const nextItemDay = nextItem.day || 1;
              const nextDaySpecificStartTime = dayStartTimes[nextItemDay] || masterStartTime;
              const nextStartTime = calculateStartTimeWithOvertime(
                nextItemIndex, 
                schedule, 
                nextDaySpecificStartTime, 
                overtimeMinutes, 
                showStartOvertime, 
                startCueId, 
                indentedCues
              );
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
          duration
        };
      }).filter(item => item !== null); // Remove null items
      
      setSchedule(recalculatedSchedule);
    }
  }, [overtimeMinutes, showStartOvertime, startCueId, indentedCues, masterStartTime, dayStartTimes]);

  // WebSocket connection for schedule changes
  useEffect(() => {
    if (!event?.id) return;

    // Removed verbose logging to prevent console spam
    
    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
        // Update schedule data directly from WebSocket
        if (data && data.schedule_items) {
          setSchedule(data.schedule_items);
        }
        // Update master start time if provided
        if (data && data.settings && data.settings.masterStartTime) {
          setMasterStartTime(data.settings.masterStartTime);
        }
        // Update overtime data if provided
        if (data && data.overtime_minutes) {
          // Removed verbose logging to prevent console spam
          setOvertimeMinutes(data.overtime_minutes);
        }
        if (data && data.indented_cues) {
          // Removed verbose logging to prevent console spam
          setIndentedCues(data.indented_cues);
        }
        if (data && data.show_start_overtime !== undefined) {
          // Removed verbose logging to prevent console spam
          setShowStartOvertime(data.show_start_overtime);
        }
        if (data && data.start_cue_id !== undefined) {
          // Removed verbose logging to prevent console spam
          setStartCueId(data.start_cue_id);
        }
        // Removed verbose logging to prevent console spam
      },
      onOvertimeUpdate: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
        if (data && data.item_id && data.overtimeMinutes !== undefined) {
          setOvertimeMinutes(prev => {
            const updated = {
              ...prev,
              [data.item_id]: data.overtimeMinutes
            };
            // Removed verbose logging to prevent console spam
            return updated;
          });
          // Removed verbose logging to prevent console spam
        }
      },
      onShowStartOvertimeUpdate: (data: any) => {
        // Removed verbose logging to prevent console spam (WebSocket callbacks fire frequently)
        if (data && data.showStartOvertime !== undefined) {
          setShowStartOvertime(data.showStartOvertime);
          // Removed verbose logging to prevent console spam
        }
        if (data && data.item_id) {
          setStartCueId(data.item_id);
          // Removed verbose logging to prevent console spam
        }
      },
      onConnectionChange: (connected: boolean) => {
        // Removed verbose logging to prevent console spam
      },
      onInitialSync: async () => {
        // Removed verbose logging to prevent console spam
        
        // Load current schedule data
        try {
          const scheduleResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/run-of-show-data/${event?.id}`);
          if (scheduleResponse.ok) {
            const data = await scheduleResponse.json();
            // Removed verbose logging to prevent console spam
            
            if (data && data.schedule_items) {
              setSchedule(data.schedule_items);
            }
            if (data && data.settings && data.settings.masterStartTime) {
              setMasterStartTime(data.settings.masterStartTime);
            }
            
            // Removed verbose logging to prevent console spam
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
        // Removed verbose logging to prevent console spam
        socketClient.disconnect(event.id);
      } else if (!socketClient.isConnected()) {
        // Removed verbose logging to prevent console spam
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
      }
    };

    document.addEventListener('visibilitychange', handleScheduleVisibilityChange);

    return () => {
      // Removed verbose logging to prevent console spam
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleScheduleVisibilityChange);
    };
  }, [event?.id]);

  // No need for scroll logic - we're filtering the data instead

  // Dynamically modify isPublic to hide items above the current one
  const publicSchedule = useMemo(() => {
    // Removed verbose logging to prevent console spam
    // First filter by selected day
    const dayFilteredSchedule = schedule.filter(item => item.day === selectedDay);
    
    // Find the current item index in the day-filtered schedule
    // Convert both to strings for comparison since activeItemId might be a string
    const currentIndex = activeItemId ? dayFilteredSchedule.findIndex(item => String(item.id) === String(activeItemId)) : -1;
    
    // Removed verbose logging to prevent console spam
    
    // If we have an active item, show only PUBLIC items from that item onwards
    if (currentIndex >= 0) {
      // First filter to only public items, then find the current item in that filtered list
      const publicItems = dayFilteredSchedule.filter(item => item.isPublic === true);
      const currentItemInPublicList = publicItems.findIndex(item => String(item.id) === String(activeItemId));
      
      // If current item is public, show from that item onwards. Otherwise, show all public items.
      // Use the startTime that's already calculated on each item (from loadSchedule or overtime recalculation)
      const visibleItems = (currentItemInPublicList >= 0 
        ? publicItems.slice(currentItemInPublicList)
        : publicItems
      );
      
      // Removed verbose logging to prevent console spam
      
      return visibleItems;
    }
    
    // If no active item, show all public items (fallback behavior)
    // Use the startTime that's already calculated on each item (from loadSchedule or overtime recalculation)
    const visibleItems = dayFilteredSchedule.filter(item => item.isPublic === true);
    
    // Removed verbose logging to prevent console spam
    
    return visibleItems;
  }, [schedule, selectedDay, activeItemId, overtimeMinutes, showStartOvertime, startCueId, dayStartTimes, masterStartTime, indentedCues]);

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

  const handleEventChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;
    const selected = events.find(ev => ev.id === id);
    if (!selected) return;
    setShowEventSelector(false);
    setError(null);
    setIsLoading(true);
    navigate(
      `/green-room?eventId=${encodeURIComponent(selected.id)}&eventName=${encodeURIComponent(selected.name || '')}&eventDate=${encodeURIComponent(selected.date || '')}&eventLocation=${encodeURIComponent(selected.location || '')}`,
      { replace: true, state: { event: selected } }
    );
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
        {/* Back to Event List, Event Selector, Fullscreen, Day - Hidden in Fullscreen */}
        {!isFullscreen && (
          <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg p-3 space-y-2 min-w-[180px]">
            {/* Event selector (like PhotoViewPage) */}
            {events.length > 1 && (
              <div className="space-y-1">
                {showEventSelector ? (
                  <>
                    <label className="text-xs text-gray-400 block">Event:</label>
                    <select
                      value={event?.id ?? ''}
                      onChange={handleEventChange}
                      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-500"
                      disabled={eventsLoading}
                      title="Select which event to view"
                    >
                      <option value="">{eventsLoading ? 'Loading…' : 'Select event…'}</option>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} {ev.date ? `(${ev.date})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowEventSelector(false)}
                      className="w-full px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600"
                      title="Hide event selector"
                    >
                      Hide
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowEventSelector(true)}
                    className="w-full px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600"
                    title="Change event"
                  >
                    Change event
                  </button>
                )}
              </div>
            )}

            {/* Fullscreen Button */}
            <button
              onClick={() => {
                document.documentElement.requestFullscreen();
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded border border-blue-500 text-lg transition-colors"
              title="Enter Fullscreen"
            >
              Fullscreen
            </button>

            {/* Day Selector for Multiday Events */}
            {numberOfDays > 1 && (
              <select
                value={selectedDay}
                onChange={(e) => {
                  const day = parseInt(e.target.value);
                  setSelectedDay(day);
                  if (dayStartTimes[day]) {
                    setMasterStartTime(dayStartTimes[day]);
                  }
                }}
                className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-600 text-lg"
              >
                {Array.from({ length: numberOfDays }, (_, i) => i + 1).map(day => (
                  <option key={day} value={day}>
                    Day {day}
                  </option>
                ))}
              </select>
            )}
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
              
              // Removed verbose logging to prevent console spam
              
              return (
            <div
              key={item.id}
              className={`p-4 rounded-lg transition-all duration-300 ${
                isRunning
                  ? 'bg-red-600 text-white' // Red for running items
                  : isLoaded
                  ? 'bg-green-600 text-white' // Green for loaded items (not running)
                  : 'bg-gray-300 text-gray-700' // Gray for items that are not loaded
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
