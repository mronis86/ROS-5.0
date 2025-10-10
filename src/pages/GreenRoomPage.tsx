import React, { useState, useEffect, useRef } from 'react';
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
  const [timerProgress, setTimerProgress] = useState<{[key: number]: {elapsed: number, total: number, startedAt: Date | null}}>({});
  const [timerState, setTimerState] = useState<string | null>(null); // 'loaded' or 'running'
  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});
  const [masterStartTime, setMasterStartTime] = useState<string>('09:00');
  const [dayStartTimes, setDayStartTimes] = useState<{[key: number]: string}>({});
  const [localTimerInterval, setLocalTimerInterval] = useState<NodeJS.Timeout | null>(null);
  const [serverSyncedTimers, setServerSyncedTimers] = useState<Set<number>>(new Set());

  // Calculate start time function (same as RunOfShowPage)
  const calculateStartTime = (index: number) => {
    console.log(`🔄 calculateStartTime called for index ${index}:`, {
      masterStartTime,
      scheduleLength: schedule.length
    });
    
    if (!masterStartTime) {
      console.log('❌ No master start time, returning empty string');
      return '';
    }
    
    let totalMinutes = 0;
    for (let i = 0; i < index; i++) {
      const item = schedule[i];
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
    
    const [startHours, startMinutes] = masterStartTime.split(':').map(Number);
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
      masterStartTime,
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
        setLoadedItems({});
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
            setLoadedItems(prev => ({ ...prev, [parseInt(data.item_id)]: true }));
            console.log('✅ Green Room: Timer RUNNING - activeItemId set to:', data.item_id);
          } else if (data.timer_state === 'loaded') {
            setTimerState('loaded');
            setActiveItemId(parseInt(data.item_id));
            setLoadedItems(prev => ({ ...prev, [parseInt(data.item_id)]: true }));
            console.log('✅ Green Room: Timer LOADED - activeItemId set to:', data.item_id);
          }
        }
      },
      onTimerStopped: (data: any) => {
        console.log('📡 Green Room: Timer stopped via WebSocket');
        // Clear timer state when stopped
        if (data && data.item_id) {
          setActiveItemId(null);
          setTimerProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[data.item_id];
            return newProgress;
          });
        }
      },
      onTimersStopped: (data: any) => {
        console.log('📡 Green Room: All timers stopped via WebSocket');
        // Clear all timer states
        setActiveItemId(null);
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
            setLoadedItems(prev => ({
              ...prev,
              [data.item_id]: true
            }));
            console.log('🔄 Green Room: Updated active item and timer state:', {
              itemId: data.item_id,
              timerState: data.timer_state,
              activeItemId: data.item_id
            });
          } else {
            // Timer is stopped
            setLoadedItems(prev => {
              const newLoaded = { ...prev };
              delete newLoaded[data.item_id];
              return newLoaded;
            });
            if (String(activeItemId) === String(data.item_id)) {
              setActiveItemId(null);
              setTimerState(null);
            }
            console.log('🔄 Green Room: Cleared timer state for item:', data.item_id);
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
        console.log('✅ Green Room: All states cleared via reset');
      },
      onScheduleUpdated: (data: any) => {
        console.log('📡 Green Room: Schedule updated via WebSocket - reloading public items');
        // Reload schedule when public checkboxes change
        loadSchedule();
      },
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Green Room: Run of show data updated via WebSocket - reloading');
        // Reload schedule to get updated public items
        loadSchedule();
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

    // Handle tab visibility changes - resync when user returns to tab
    const handleVisibilityChange = () => {
      if (!document.hidden && socketClient.isConnected()) {
        console.log('🔄 Green Room: Tab became visible - triggering resync');
        // Trigger initial sync again
        callbacks.onInitialSync?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('🔄 Cleaning up Green Room WebSocket connection');
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
        
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
      
      // Try to get master start time from API data if not found in localStorage
      if (data && data.settings && data.settings.masterStartTime && masterStartTime === '09:00') {
        console.log('📥 Found master start time in API data:', data.settings.masterStartTime);
        setMasterStartTime(data.settings.masterStartTime);
      }
      
      if (data?.schedule_items) {
        console.log('🔄 Total schedule items found:', data.schedule_items.length);
        
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
          
          // Calculate start time using the same logic as RunOfShowPage
          const startTime = calculateStartTime(index);
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
          
          // If we have a start time, calculate end time
          if (startTime && totalMinutes > 0) {
            // Parse the start time and add duration
            const startDate = new Date(`1970-01-01 ${startTime}`);
            const endDate = new Date(startDate.getTime() + totalMinutes * 60000);
            endTime = endDate.toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit', 
              second: '2-digit',
              hour12: true 
            });
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

    // Handle tab visibility changes - resync when user returns to tab
    const handleScheduleVisibilityChange = () => {
      if (!document.hidden && socketClient.isConnected()) {
        console.log('🔄 Green Room: Schedule tab became visible - triggering resync');
        // Trigger initial sync again
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
  const publicSchedule = (() => {
    // Find the current item index in the original schedule
    // Convert both to strings for comparison since activeItemId might be a string
    const currentIndex = activeItemId ? schedule.findIndex(item => String(item.id) === String(activeItemId)) : -1;
    
    console.log('🔄 Modifying schedule visibility:', {
      totalScheduleItems: schedule.length,
      currentIndex,
      activeItemId,
      activeItemIdType: typeof activeItemId,
      scheduleItemIds: schedule.map(item => ({ id: item.id, idType: typeof item.id, name: item.segmentName })),
      originalSchedule: schedule.map(item => ({ id: item.id, name: item.segmentName, isPublic: item.isPublic }))
    });
    
    // Create a modified schedule where items above current are marked as not public
    const modifiedSchedule = schedule.map((item, index) => {
      // If we have a current item and this item is before the current one, make it not public
      if (currentIndex >= 0 && index < currentIndex) {
        return { ...item, isPublic: false };
      }
      // Otherwise, keep the original isPublic value
      return item;
    });
    
    // Filter to only show items that are now "public" (including the current item and after)
    const visibleItems = modifiedSchedule.filter(item => item.isPublic === true);
    
    console.log('🔄 Modified schedule:', {
      modifiedSchedule: modifiedSchedule.map(item => ({ id: item.id, name: item.segmentName, isPublic: item.isPublic })),
      visibleItems: visibleItems.map(item => ({ id: item.id, name: item.segmentName }))
    });
    
    return visibleItems;
  })();

  // Calculate expected finish time from active timer
  const getExpectedFinishTime = () => {
    if (!activeItemId || !timerProgress[activeItemId]) return 'No Timer';
    if (timerState !== 'running') return 'Timer Stopped';
    
    const progress = timerProgress[activeItemId];
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
    
    // If timer is not running, show 00:00
    if (timerState !== 'running') return '00:00';

    const progress = timerProgress[activeItemId];
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

  return (
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
  );
};

export default GreenRoomPage;
