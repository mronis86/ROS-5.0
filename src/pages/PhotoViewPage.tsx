import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { Event } from '../types/Event';
// import { supabase } from '../services/supabase'; // REMOVED: Using WebSocket-only approach
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
  isIndented?: boolean;
}

const PhotoViewPage: React.FC = () => {
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
  const [countdown, setCountdown] = useState<number>(20);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isUserEditing, setIsUserEditing] = useState<boolean>(false);
  const [clockOffset, setClockOffset] = useState<number>(0); // Offset between client and server clocks in ms
  const [subCueTimers, setSubCueTimers] = useState<{[key: number]: {remaining: number, intervalId: NodeJS.Timeout}}>({});
  const [subCueTimerProgress, setSubCueTimerProgress] = useState<Record<number, { elapsed: number; total: number; startedAt: Date | null }>>({});
  const [activeTimers, setActiveTimers] = useState<{[key: number]: boolean}>({});
  const [indentedCues, setIndentedCues] = useState<Record<number, { parentId: number; userId: string; userName: string }>>({});
  const [showNotes, setShowNotes] = useState<boolean>(true);
  const [secondaryTimer, setSecondaryTimer] = useState<{
    itemId: number;
    duration: number;
    remaining: number;
    isActive: boolean;
    startedAt: Date | null;
    timerState: 'loaded' | 'running' | 'stopped';
    cue: string;
    segmentName: string;
  } | null>(null);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [disconnectTimerState, setDisconnectTimerState] = useState<NodeJS.Timeout | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);

  // Reset all states function (called from WebSocket events)
  const resetAllStates = async () => {
    console.log('🔄 PhotoView: Resetting all states from RunOfShow reset...');
    
    // Clear all timer states and highlights
    setActiveItemId(null);
    setTimerState(null);
    setLoadedItems({});
    setTimerProgress({});
    setActiveTimers({});
    setSubCueTimers({});
    setSubCueTimerProgress({});
    setSecondaryTimer(null);
    
    // Clear indented state locally first
    setSchedule(prevSchedule => 
      prevSchedule.map(item => ({
        ...item,
        isIndented: false
      }))
    );
    
    // Reload schedule data from database to get the latest state
    if (event?.id) {
      try {
        console.log('🔄 PhotoView: Reloading schedule data after reset...');
        const data = await DatabaseService.getRunOfShowData(event.id);
        if (data?.schedule_items) {
          const formattedSchedule = data.schedule_items.map((item: any) => ({
            ...item,
            isPublic: item.isPublic || false,
            isIndented: false // Force clear indented state
          }));
          setSchedule(formattedSchedule);
          console.log('✅ PhotoView: Schedule data reloaded and indented state cleared');
        }
      } catch (error) {
        console.warn('⚠️ PhotoView: Failed to reload schedule data:', error);
        // Fallback: clear indented state locally (already done above)
        console.log('✅ PhotoView: Using local fallback to clear indented state');
      }
    }
    
    console.log('✅ PhotoView: All states and highlights reset successfully');
  };


  // Helper function to format cue display with proper spacing (matches Run of Show)
  const formatCueDisplay = (cue: string | undefined) => {
    if (!cue) return 'CUE';
    // If cue already has proper spacing, return as is
    if (cue.includes('CUE ')) return cue;
    // If cue is like "CUE2", convert to "CUE 2"
    return cue.replace(/^CUE(\d+)$/, 'CUE $1');
  };

  // Helper function to truncate text (matches ROS Show File)
  const truncateText = (text: string, maxLength: number) => {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Helper function to format names for two lines (matches ROS Show File)
  const formatNameForTwoLines = (fullName: string): { html: string, needsSmallText: boolean } => {
    if (!fullName || fullName.trim().length === 0) return { html: '', needsSmallText: false };
    
    const name = fullName.trim();
    const parts = name.split(/\s+/);
    
    if (parts.length <= 1) return { html: name, needsSmallText: false };
    
    // Define titles, suffixes, and party patterns
    const titles = ['Dr', 'Dr.', 'Prof', 'Prof.', 'Mr', 'Mr.', 'Mrs', 'Mrs.', 'Ms', 'Ms.', 'Hon', 'Hon.', 'Honorable', 'Sen', 'Sen.', 'Senator', 'Rep', 'Rep.', 'Representative', 'Gov', 'Gov.', 'Governor', 'Mayor', 'Judge', 'Ambassador', 'Amb', 'Amb.', 'General', 'Gen', 'Gen.', 'Admiral', 'Adm', 'Adm.', 'Colonel', 'Col', 'Col.', 'Major', 'Maj', 'Maj.', 'Captain', 'Capt', 'Capt.', 'Lieutenant', 'Lt', 'Lt.', 'Sergeant', 'Sgt', 'Sgt.', 'Chief', 'Commander', 'Comm'];
    const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'III', 'IV', 'V', 'Ph.D', 'PhD', 'MD', 'DDS', 'DVM', 'Esq', 'Esq.', 'CPA', 'PE', 'RN', 'LPN'];
    
    let title = '';
    let firstName = '';
    let lastName = '';
    let suffix = '';
    let party = '';
    
    // Extract title
    if (titles.includes(parts[0])) {
      title = parts[0];
      parts.shift();
    }
    
    // Extract party designation
    const partyMatch = name.match(/\([DR]\)/i);
    if (partyMatch) {
      party = partyMatch[0];
      const partyIndex = parts.findIndex(part => part.match(/\([DR]\)/i));
      if (partyIndex !== -1) {
        parts.splice(partyIndex, 1);
      }
    }
    
    // Extract suffix
    if (parts.length > 0 && suffixes.includes(parts[parts.length - 1])) {
      suffix = parts[parts.length - 1];
      parts.pop();
    }
    
    if (parts.length === 0) return { html: name, needsSmallText: false };
    
    if (parts.length === 1) {
      firstName = parts[0];
    } else {
      const lastNameIndex = parts.length - 1;
      lastName = parts[lastNameIndex];
      firstName = parts.slice(0, lastNameIndex).join(' ');
    }
    
    // Estimate max characters per line for PhotoView slots (wider than ROS Show File)
    const maxCharsPerLine = 12; // Adjusted for PhotoView's wider slots
    
    let line1 = [title, firstName].filter(Boolean).join(' ');
    let line2 = [lastName, suffix, party].filter(Boolean).join(' ');
    
    // If line1 is too long, try to redistribute
    if (line1.length > maxCharsPerLine && firstName.includes(' ')) {
      const firstNameParts = firstName.split(' ');
      if (firstNameParts.length > 1) {
        const lastFirstNamePart = firstNameParts.pop();
        const newFirstName = firstNameParts.join(' ');
        line1 = [title, newFirstName].filter(Boolean).join(' ');
        line2 = [lastFirstNamePart, lastName, suffix, party].filter(Boolean).join(' ');
      }
    }
    
    // If still too long, try moving more to line2
    if (line1.length > maxCharsPerLine && firstName.includes(' ')) {
      const firstNameParts = firstName.split(' ');
      if (firstNameParts.length > 2) {
        const lastTwoFirstNameParts = firstNameParts.splice(-2);
        const newFirstName = firstNameParts.join(' ');
        line1 = [title, newFirstName].filter(Boolean).join(' ');
        line2 = [lastTwoFirstNameParts.join(' '), lastName, suffix, party].filter(Boolean).join(' ');
      }
    }
    
    const needsSmallText = line1.length > maxCharsPerLine || line2.length > maxCharsPerLine;
    
    return {
      html: `${line1}<br/>${line2}`,
      needsSmallText: needsSmallText
    };
  };

  // Helper function to format time - handles negative values (matches Run of Show)
  const formatTime = (seconds: number) => {
    // Handle NaN, undefined, or invalid values
    if (isNaN(seconds) || seconds === undefined || seconds === null) {
      console.warn('⚠️ formatTime received invalid value:', seconds);
      return '00:00:00';
    }
    
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const secs = Math.floor(absSeconds % 60);
    const sign = isNegative ? '-' : '';
    return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get remaining time for active timer, sub-cue timer, or loaded CUE - allow negative values (matches Run of Show)
  const getRemainingTime = () => {
    // If timer state is stopped, return 0
    if (timerState === 'stopped') {
      return 0;
    }
    
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remaining = progress.total - progress.elapsed;
        return remaining;
      }
    }
    
    // Check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remaining = progress.total - progress.elapsed;
      return remaining;
    }
    
    return 0;
  };

  // Get remaining percentage for progress bar (matches FullScreenTimer)
  const getRemainingPercentage = () => {
    // If timer state is stopped, return 0
    if (timerState === 'stopped') {
      return 0;
    }
    
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
      }
    }
    
    // Check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remainingSeconds = progress.total - progress.elapsed;
      return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
    }
    
    return 0;
  };

  // Get progress bar color based on remaining time (matches FullScreenTimer)
  const getProgressBarColor = () => {
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        
        // Color based on remaining time
        if (remainingSeconds > 120) { // More than 2 minutes
          return '#10b981'; // Green
        } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
          return '#f59e0b'; // Yellow
        } else { // Less than 30 seconds
          return '#ef4444'; // Red
        }
      }
    }
    
    // Check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remainingSeconds = progress.total - progress.elapsed;
      
      // Color based on remaining time
      if (remainingSeconds > 120) { // More than 2 minutes
        return '#10b981'; // Green
      } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
        return '#f59e0b'; // Yellow
      } else { // Less than 30 seconds
        return '#ef4444'; // Red
      }
    }
    
    return '#10b981'; // Default green
  };

  // Get countdown color based on remaining time (matches progress bar colors)
  const getCountdownColor = () => {
    // If no cue is selected (no activeItemId or timerState is stopped), show white
    if (!activeItemId || timerState === 'stopped' || timerState === null) {
      return '#ffffff'; // White
    }
    
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        
        // Color based on remaining time (matches progress bar)
        if (remainingSeconds > 120) { // More than 2 minutes
          return '#10b981'; // Green
        } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
          return '#f59e0b'; // Yellow
        } else { // Less than 30 seconds
          return '#ef4444'; // Red
        }
      }
    }
    
    // Check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remainingSeconds = progress.total - progress.elapsed;
      
      // Color based on remaining time (matches progress bar)
      if (remainingSeconds > 120) { // More than 2 minutes
        return '#10b981'; // Green
      } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
        return '#f59e0b'; // Yellow
      } else { // Less than 30 seconds
        return '#ef4444'; // Red
      }
    }
    
    return '#10b981'; // Default green (matches progress bar)
  };

  // Debug logging for status display
  console.log('🔍 PhotoView Status Debug:', {
    activeTimersKeys: Object.keys(activeTimers),
    activeTimers,
    activeItemId,
    timerProgress: activeItemId ? timerProgress[activeItemId] : null,
    scheduleLength: schedule.length,
    runningItem: Object.keys(activeTimers).length > 0 ? schedule.find(item => activeTimers[item.id]) : null,
    loadedItem: activeItemId ? schedule.find(item => item.id === activeItemId) : null,
    loadedItemCue: activeItemId ? schedule.find(item => item.id === activeItemId)?.customFields?.cue : null,
    allItemsCues: schedule.map(item => ({ id: item.id, cue: item.customFields?.cue })),
    secondaryTimer: secondaryTimer,
    secondaryTimerActive: secondaryTimer?.isActive,
    secondaryTimerCue: secondaryTimer?.cue
  });

  // Helper function to format time for sub-cue timers
  const formatSubCueTime = (seconds: number) => {
    if (isNaN(seconds) || seconds === undefined || seconds === null) {
      return '00:00';
    }
    
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const secs = absSeconds % 60;
    
    const sign = isNegative ? '-' : '';
    if (hours > 0) {
      return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${sign}${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  };

  // Calculate start time function
  const calculateStartTime = (index: number) => {
    if (!masterStartTime) return '';
    
    let totalMinutes = 0;
    for (let i = 0; i < index; i++) {
      const item = schedule[i];
      const itemMinutes = (item.durationHours * 60) + item.durationMinutes;
      totalMinutes += itemMinutes;
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
    return result;
  };

  // Load master start time from localStorage
  useEffect(() => {
    if (event?.id) {
      const savedMasterTime = localStorage.getItem(`masterStartTime_${event.id}`);
      if (savedMasterTime) {
        setMasterStartTime(savedMasterTime);
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

  // Countdown timer logic
  useEffect(() => {
    if (isUserEditing || isSyncing) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          setIsSyncing(true);
          // Simulate sync for 3 seconds
          setTimeout(() => {
            setIsSyncing(false);
            setCountdown(20);
          }, 3000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isUserEditing, isSyncing]);




  // Load active timer state immediately on mount (fallback)
  useEffect(() => {
    if (!event?.id) return;
    
    const loadActiveTimerState = async () => {
      try {
        console.log('🔄 PhotoView: Loading active timer state on mount...');
        const activeTimerResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/active-timers/${event.id}`);
        
        if (activeTimerResponse.ok) {
          const activeTimerResponseData = await activeTimerResponse.json();
          console.log('🔄 PhotoView: Loaded active timer on mount:', activeTimerResponseData);
          
          // Handle the actual API response format - check if it's an array or object
          let activeTimerData;
          if (Array.isArray(activeTimerResponseData)) {
            // Direct array response
            activeTimerData = activeTimerResponseData.length > 0 ? activeTimerResponseData[0] : null;
          } else if (activeTimerResponseData.value && Array.isArray(activeTimerResponseData.value)) {
            // Wrapped in value property
            activeTimerData = activeTimerResponseData.value.length > 0 ? activeTimerResponseData.value[0] : null;
          } else {
            // Direct object response
            activeTimerData = activeTimerResponseData;
          }
          
          console.log('🔄 PhotoView: Processed active timer data:', activeTimerData);
          
          if (activeTimerData && activeTimerData.item_id) {
            setActiveItemId(parseInt(activeTimerData.item_id));
            setTimerState(activeTimerData.timer_state);
            setLoadedItems({ [parseInt(activeTimerData.item_id)]: true });
            
            setTimerProgress({
              [parseInt(activeTimerData.item_id)]: {
                elapsed: activeTimerData.elapsed_seconds || 0,
                total: activeTimerData.duration_seconds || 300,
                startedAt: activeTimerData.started_at ? new Date(activeTimerData.started_at) : null
              }
            });
            
            console.log('✅ PhotoView: Active timer state loaded on mount');
      } else {
            setActiveItemId(null);
            setTimerState(null);
            setLoadedItems({});
            setTimerProgress({});
            console.log('✅ PhotoView: No active timer found on mount');
          }
      }
    } catch (error) {
        console.error('❌ PhotoView: Error loading active timer on mount:', error);
      }
    };
    
    loadActiveTimerState();
  }, [event?.id]);

  // WebSocket connection for active timer changes
  useEffect(() => {
    if (!event?.id) return;

    console.log('🔌 Setting up WebSocket connection for PhotoView timer updates');
    
    const callbacks = {
      onServerTime: (data: any) => {
        // Sync client clock with server clock
        const serverTime = new Date(data.serverTime).getTime();
        const clientTime = new Date().getTime();
        const offset = serverTime - clientTime;
        setClockOffset(offset);
        console.log('🕐 PhotoView: Clock sync:', {
          serverTime: data.serverTime,
          clientTime: new Date().toISOString(),
          offsetMs: offset,
          offsetSeconds: Math.floor(offset / 1000)
        });
      },
      onTimerUpdated: (data: any) => {
        console.log('📡 PhotoView: Timer updated via WebSocket', data);
        // Update timer state directly from WebSocket data
        if (data && data.item_id) {
          setTimerProgress(prev => ({
            ...prev,
            [data.item_id]: {
              elapsed: data.elapsed_seconds || 0,
              total: data.duration_seconds || 300,
              startedAt: data.started_at ? new Date(data.started_at) : null
            }
          }));
          
          // Update timer state based on timer_state from active_timers table
          if (data.timer_state === 'running') {
            setTimerState('running');
            setActiveItemId(parseInt(data.item_id));
            setLoadedItems(prev => ({ ...prev, [parseInt(data.item_id)]: true }));
          } else if (data.timer_state === 'loaded') {
            setTimerState('loaded');
            setActiveItemId(parseInt(data.item_id));
            setLoadedItems(prev => ({ ...prev, [parseInt(data.item_id)]: true }));
          }
        }
      },
      onTimerStopped: (data: any) => {
        console.log('📡 PhotoView: Timer stopped via WebSocket', data);
        // Clear timer state when stopped
        if (data && data.item_id) {
          setActiveItemId(null);
          setTimerState(null);
          setLoadedItems(prev => {
            const newLoaded = { ...prev };
            delete newLoaded[parseInt(data.item_id)];
            return newLoaded;
          });
          setTimerProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[parseInt(data.item_id)];
            return newProgress;
          });
        }
      },
      onTimersStopped: (data: any) => {
        console.log('📡 PhotoView: All timers stopped via WebSocket', data);
        // Clear all timer states
        setActiveItemId(null);
        setTimerState(null);
        setLoadedItems({});
        setTimerProgress({});
      },
      onTimerStarted: (data: any) => {
        console.log('📡 PhotoView: Timer started via WebSocket', data);
        // Update active item and timer state when timer starts
        if (data && data.item_id) {
          setActiveItemId(parseInt(data.item_id));
          setTimerState('running');
          setLoadedItems(prev => ({ ...prev, [parseInt(data.item_id)]: true }));
          
          // Update timer progress with start time
                      setTimerProgress(prev => ({
                        ...prev,
            [parseInt(data.item_id)]: {
              elapsed: 0,
              total: data.duration_seconds || 300,
              startedAt: data.started_at ? new Date(data.started_at) : new Date()
                        }
                      }));
                    }
      },
      onSubCueTimerStarted: (data: any) => {
        console.log('📡 PhotoView: Sub-cue timer started via WebSocket', data);
        // Handle sub-cue timer start
        if (data && data.item_id) {
          const itemId = parseInt(data.item_id);
          // Find the schedule item to get cue and segment name
          const scheduleItem = schedule.find(item => item.id === itemId);
          
          // Set sub-cue timer progress
          setSubCueTimerProgress(prev => ({
            ...prev,
            [itemId]: {
              elapsed: data.elapsed_seconds || 0,
              total: data.duration_seconds || 60,
              startedAt: data.started_at ? new Date(data.started_at) : new Date()
            }
          }));
          
          setSecondaryTimer({
            itemId: itemId,
            duration: data.duration_seconds || 60,
            remaining: Math.max(0, (data.duration_seconds || 60) - (data.elapsed_seconds || 0)),
            isActive: true,
            startedAt: data.started_at ? new Date(data.started_at) : new Date(),
            timerState: 'running',
            cue: scheduleItem?.customFields?.cue || `CUE ${data.item_id}`,
            segmentName: scheduleItem?.segmentName || 'Segment'
          });
        }
      },
      onSubCueTimerStopped: (data: any) => {
        console.log('📡 PhotoView: Sub-cue timer stopped via WebSocket', data);
        // Clear sub-cue timer when stopped
        if (data && data.item_id) {
          const itemId = parseInt(data.item_id);
          setSubCueTimerProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[itemId];
            return newProgress;
          });
        }
        setSecondaryTimer(null);
      },
      onActiveTimersUpdated: (data: any) => {
        console.log('📡 PhotoView: Active timers updated via WebSocket', data);
        // Handle active timers update from active_timers table
        if (data && data.item_id) {
          if (data.timer_state === 'running' || data.timer_state === 'loaded') {
            setActiveItemId(parseInt(data.item_id));
            setTimerState(data.timer_state);
            setLoadedItems({ [parseInt(data.item_id)]: true });
            
            setTimerProgress({
              [parseInt(data.item_id)]: {
                elapsed: data.elapsed_seconds || 0,
                total: data.duration_seconds || 300,
                startedAt: data.started_at ? new Date(data.started_at) : null
              }
            });
          } else if (data.timer_state === 'stopped') {
            // Timer stopped - clear state
            setActiveItemId(null);
            setTimerState(null);
            setLoadedItems({});
            setTimerProgress({});
          }
        }
      },
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 PhotoView: Run of show data updated via WebSocket', data);
        // Handle schedule updates
        if (data && data.schedule_items) {
          const formattedSchedule = data.schedule_items.map((item: any) => ({
            ...item,
            startTime: item.start_time || '09:00',
            durationHours: Math.floor((item.duration_seconds || 300) / 3600),
            durationMinutes: Math.floor(((item.duration_seconds || 300) % 3600) / 60),
            durationSeconds: (item.duration_seconds || 300) % 60
          }));
          setSchedule(formattedSchedule);
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log(`🔌 PhotoView WebSocket connection ${connected ? 'established' : 'lost'} for event: ${event.id}`);
      },
      onResetAllStates: (data: any) => {
        console.log('📡 PhotoView: Reset all states triggered via WebSocket', data);
        console.log('🔄 PhotoView: About to call resetAllStates function');
        // Clear all states when RunOfShowPage resets
        resetAllStates();
        console.log('✅ PhotoView: resetAllStates function called');
      },
      onInitialSync: async () => {
        console.log('🔄 PhotoView: WebSocket initial sync triggered - loading current state');
        
        // Load current active timer
        try {
          const activeTimerResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/active-timers/${event?.id}`);
          if (activeTimerResponse.ok) {
            const activeTimerResponseData = await activeTimerResponse.json();
            console.log('🔄 PhotoView initial sync: Loaded active timer:', activeTimerResponseData);
            
            // Handle the actual API response format - check if it's an array or object
            let activeTimerData;
            if (Array.isArray(activeTimerResponseData)) {
              // Direct array response
              activeTimerData = activeTimerResponseData.length > 0 ? activeTimerResponseData[0] : null;
            } else if (activeTimerResponseData.value && Array.isArray(activeTimerResponseData.value)) {
              // Wrapped in value property
              activeTimerData = activeTimerResponseData.value.length > 0 ? activeTimerResponseData.value[0] : null;
            } else {
              // Direct object response
              activeTimerData = activeTimerResponseData;
            }
            
            console.log('🔄 PhotoView initial sync: Processed active timer data:', activeTimerData);
            
            if (activeTimerData && activeTimerData.item_id) {
              setActiveItemId(parseInt(activeTimerData.item_id));
              setTimerState(activeTimerData.timer_state);
              setLoadedItems({ [parseInt(activeTimerData.item_id)]: true });
              
              // Update timer progress
              setTimerProgress({
                [parseInt(activeTimerData.item_id)]: {
                  elapsed: activeTimerData.elapsed_seconds || 0,
                  total: activeTimerData.duration_seconds || 300,
                  startedAt: activeTimerData.started_at ? new Date(activeTimerData.started_at) : null
                }
              });
              
              console.log('🔄 PhotoView: Initial sync completed - timer state restored');
      } else {
              // No active timer
        setActiveItemId(null);
        setTimerState(null);
        setLoadedItems({});
        setTimerProgress({});
              console.log('🔄 PhotoView: Initial sync completed - no active timer');
            }
      }
    } catch (error) {
          console.error('❌ PhotoView: Initial sync failed to load active timer:', error);
        }
        
        // Load current sub-cue timers using DatabaseService (like RunOfShowPage)
        try {
          const { data: subCueTimers, error } = await DatabaseService.getActiveSubCueTimers(event?.id);
          
          if (error) {
            console.error('❌ PhotoView: Error loading sub-cue timers:', error);
            setSecondaryTimer(null);
            return;
          }

          if (subCueTimers && subCueTimers.length > 0) {
            console.log('🔄 PhotoView initial sync: Loaded sub-cue timers:', subCueTimers);
            console.log('🔄 PhotoView: Sub-cue timer data structure:', subCueTimers[0]);
            console.log('🔄 PhotoView: Available fields:', Object.keys(subCueTimers[0]));
            console.log('🔄 PhotoView: Looking for timer_state === "running"');
            console.log('🔄 PhotoView: All timer states:', subCueTimers.map(t => ({ id: t.item_id, state: t.timer_state, is_running: t.is_running })));
            
            // Find the first running sub-cue timer
            const runningTimer = subCueTimers.find(timer => timer.timer_state === 'running' || timer.is_running === true);
            console.log('🔄 PhotoView: Found running timer:', runningTimer);
            
            if (runningTimer) {
              const itemId = parseInt(runningTimer.item_id);
              const scheduleItem = schedule.find(item => item.id === itemId);
              
              // Set sub-cue timer progress
              setSubCueTimerProgress(prev => ({
                ...prev,
                [itemId]: {
                  elapsed: runningTimer.elapsed_seconds || 0,
                  total: runningTimer.duration_seconds || 60,
                  startedAt: runningTimer.started_at ? new Date(runningTimer.started_at) : new Date()
                }
              }));
              
              setSecondaryTimer({
                itemId: itemId,
                duration: runningTimer.duration_seconds || 60,
                remaining: Math.max(0, (runningTimer.duration_seconds || 60) - (runningTimer.elapsed_seconds || 0)),
                isActive: true,
                startedAt: runningTimer.started_at ? new Date(runningTimer.started_at) : new Date(),
                timerState: 'running',
                cue: scheduleItem?.customFields?.cue || `CUE ${runningTimer.item_id}`,
                segmentName: scheduleItem?.segmentName || 'Segment'
              });
              
              console.log('🔄 PhotoView: Initial sync completed - sub-cue timer restored');
            } else {
              setSecondaryTimer(null);
              console.log('🔄 PhotoView: Initial sync completed - no running sub-cue timer');
            }
          } else {
            setSecondaryTimer(null);
            console.log('🔄 PhotoView: Initial sync completed - no active sub-cue timers');
          }
        } catch (error) {
          console.error('❌ PhotoView: Initial sync failed to load sub-cue timers:', error);
          setSecondaryTimer(null);
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
        console.log('👁️ PhotoView: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(event.id);
        // Timer keeps running in background
      } else if (!socketClient.isConnected()) {
        console.log('👁️ PhotoView: Tab visible - silently reconnecting WebSocket (no modal)');
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
        // Modal won't show again - timer still running
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      console.log('🔄 Cleaning up PhotoView WebSocket connection');
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (disconnectTimerState) clearTimeout(disconnectTimerState);
    };
  }, [event?.id, schedule]);


  // Local timer updates for smooth countdown/progress bar (like GreenRoom/RunOfShow)
  useEffect(() => {
    if (!activeItemId || !timerProgress[activeItemId]) return;

    const progress = timerProgress[activeItemId];
    if (progress.startedAt && timerState === 'running') {
      const startedAt = progress.startedAt;
      const duration = progress.total;
      
      console.log(`🔄 PhotoView: Starting continuous local timer for ${activeItemId} with duration ${duration}s, start time: ${startedAt.toISOString()}`);
      
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
          console.log(`🕐 PhotoView Timer ${activeItemId}: Continuous elapsed=${elapsed}s, Start=${startedAt.toISOString()}, Now=${now.toISOString()}`);
        }
      }, 1000);

      return () => {
        console.log(`🔄 PhotoView: Stopping continuous local timer for ${activeItemId}`);
        clearInterval(continuousTimer);
      };
    }
  }, [activeItemId, timerState]); // Removed timerProgress to prevent constant restarts

  // Local timer updates for sub-cue timers
  useEffect(() => {
    const subCueTimerIds = Object.keys(subCueTimerProgress);
    if (subCueTimerIds.length === 0) return;

    const intervals: NodeJS.Timeout[] = [];

    subCueTimerIds.forEach(timerId => {
      const itemId = parseInt(timerId);
      const progress = subCueTimerProgress[itemId];
      
      if (progress && progress.startedAt) {
        const interval = setInterval(() => {
          setSubCueTimerProgress(prev => {
            if (prev[itemId] && prev[itemId].startedAt) {
              const startedAt = prev[itemId].startedAt;
              const syncedNow = new Date(Date.now() + clockOffset);
              const elapsed = Math.floor((syncedNow.getTime() - startedAt.getTime()) / 1000);
              
              return {
                ...prev,
                [itemId]: {
                  ...prev[itemId],
                  elapsed: elapsed
                }
              };
            }
            return prev;
          });
          
          // Update secondary timer remaining time
          setSecondaryTimer(prev => {
            if (prev && prev.itemId === itemId) {
              const currentProgress = subCueTimerProgress[itemId];
              if (currentProgress) {
                const remaining = Math.max(0, currentProgress.total - currentProgress.elapsed);
                return {
                  ...prev,
                  remaining: remaining
                };
              }
            }
            return prev;
          });
        }, 100);
        
        intervals.push(interval);
      }
    });

    return () => {
      intervals.forEach(interval => clearInterval(interval));
    };
  }, [subCueTimerProgress]);

  // Cleanup on component unmount (drift detector removed)
  useEffect(() => {
    return () => {
      console.log('🔄 PhotoView: Cleaning up on component unmount');
      // Drift detector removed - using WebSocket-only approach
    };
  }, []);

  // Load indented cues from database
  const loadIndentedCuesFromAPI = async () => {
    if (!event?.id) return;

    try {
      console.log('🟠 PhotoView: Loading indented cues from API for event:', event.id);
      const indentedCuesData = await DatabaseService.getIndentedCues(event.id);
      
      if (indentedCuesData && indentedCuesData.length > 0) {
        console.log('🟠 PhotoView: Found indented cues:', indentedCuesData);
        
        // Convert the database data to indentedCues state format
        const indentedCuesMap: Record<number, { parentId: number; userId: string; userName: string }> = {};
        indentedCuesData.forEach((cue: any) => {
          if (cue.item_id && cue.parent_item_id) {
            indentedCuesMap[cue.item_id] = {
              parentId: cue.parent_item_id,
              userId: cue.user_id || '',
              userName: cue.user_name || ''
            };
          }
        });
        
        setIndentedCues(indentedCuesMap);
        console.log('🟠 PhotoView: Set indentedCues state:', indentedCuesMap);
      } else {
        console.log('🟠 PhotoView: No indented cues found');
        setIndentedCues({});
      }
    } catch (error) {
      console.error('❌ PhotoView: Error loading indented cues from API:', error);
    }
  };

  // Load indented cues when event changes
  useEffect(() => {
    if (event?.id) {
      loadIndentedCuesFromAPI();
    }
  }, [event?.id]);

  // Update secondaryTimer (sub cue timer) in real-time - matches Run of Show page
  useEffect(() => {
    if (!secondaryTimer) return;

    const interval = setInterval(() => {
      setSecondaryTimer(prev => {
        if (!prev) return null;
        
        // Calculate remaining time directly from start time using synced clock
        const startTime = prev.startedAt?.getTime() || Date.now();
        const syncedNow = Date.now() + clockOffset;
        const elapsed = Math.floor((syncedNow - startTime) / 1000);
        const remaining = Math.max(0, prev.duration - elapsed);
        
        return {
          ...prev,
          remaining: remaining
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondaryTimer]);

  // Load schedule data
  useEffect(() => {
    const loadSchedule = async () => {
      console.log('=== PHOTO VIEW PAGE INITIALIZATION ===');
      
      if (!event?.id && !eventId) {
        setError('No event selected');
        setIsLoading(false);
        return;
      }

      try {
        // Try to load from Supabase first
        if (event?.id || eventId) {
          console.log('🔄 Loading from API for event:', event?.id || eventId);
          const data = await DatabaseService.getRunOfShowData(event?.id || eventId);
          if (data?.schedule_items) {
            console.log('✅ Loaded from API:', data);
            const formattedSchedule = data.schedule_items.map((item: any) => {
              return {
                ...item,
                isPublic: item.isPublic || false
              };
            });
            setSchedule(formattedSchedule);
            setIsLoading(false);
            return;
          }
        }
        
        // Fallback to localStorage
        console.log('📱 Falling back to localStorage...');
        let savedSchedule: string | null = null;
        
        if (event?.id || eventId) {
          const scheduleKey = `runOfShowSchedule_${event?.id || eventId}`;
          savedSchedule = localStorage.getItem(scheduleKey);
        }
        
        if (!savedSchedule) {
          const keys = Object.keys(localStorage);
          const scheduleKeys = keys.filter(key => key.startsWith('runOfShowSchedule_'));
          if (scheduleKeys.length > 0) {
            const latestKey = scheduleKeys[scheduleKeys.length - 1];
            savedSchedule = localStorage.getItem(latestKey);
          }
        }
        
        if (savedSchedule) {
          const parsedSchedule = JSON.parse(savedSchedule);
          console.log('📱 Loaded from localStorage:', parsedSchedule);
          setSchedule(parsedSchedule);
        } else {
          console.log('⚠️ No schedule data found, creating sample data for testing');
          // Create sample data for testing
          const sampleSchedule = [
            {
              id: 1,
              day: 1,
              programType: 'PreShow/End',
              shotType: 'Wide',
              segmentName: 'Welcome & Opening',
              durationHours: 0,
              durationMinutes: 5,
              durationSeconds: 0,
              notes: 'Welcome everyone to the event',
              assets: '',
              speakers: '',
              speakersText: '',
              hasPPT: true,
              hasQA: false,
              timerId: '',
              customFields: { cue: 'CUE1' },
              isPublic: true
            },
            {
              id: 2,
              day: 1,
              programType: 'Podium Transition',
              shotType: 'Medium',
              segmentName: 'Keynote Speaker',
              durationHours: 0,
              durationMinutes: 15,
              durationSeconds: 0,
              notes: 'Main keynote presentation',
              assets: '',
              speakers: '',
              speakersText: '',
              hasPPT: true,
              hasQA: true,
              timerId: '',
              customFields: { cue: 'CUE2' },
              isPublic: true
            },
            {
              id: 3,
              day: 1,
              programType: 'Panel Transition',
              shotType: 'Two Shot',
              segmentName: 'Panel Discussion',
              durationHours: 0,
              durationMinutes: 30,
              durationSeconds: 0,
              notes: 'Interactive panel discussion',
              assets: '',
              speakers: '',
              speakersText: '',
              hasPPT: false,
              hasQA: true,
              timerId: '',
              customFields: { cue: 'CUE3' },
              isPublic: true
            }
          ];
          setSchedule(sampleSchedule);
          console.log('✅ Using sample data for testing');
        }
      } catch (err) {
        console.error('❌ Error loading schedule:', err);
        setError('Failed to load schedule data');
      } finally {
        setIsLoading(false);
      }
    };

    loadSchedule();
  }, [event?.id, eventId]);


  // Get the current item and next 2 items (same logic as Green Room)
  const getPreviewItems = () => {
    console.log('🔍 getPreviewItems called');
    console.log('Schedule length:', schedule.length);
    console.log('Active item ID:', activeItemId);
    console.log('Active item ID type:', typeof activeItemId);
    
    if (schedule.length === 0) {
      console.log('No schedule items available');
      return [];
    }
    
    // Convert both to strings for comparison since activeItemId might be a string
    const currentIndex = activeItemId ? schedule.findIndex(item => String(item.id) === String(activeItemId)) : -1;
    console.log('Current index:', currentIndex);
    
    if (currentIndex === -1) {
      // If no active item or active item not found, show first 3 items
      console.log('No active item or not found, showing first 3 items');
      return schedule.slice(0, 3);
    }

    // Show current item and next 2 items (up to 3 total)
    const endIndex = Math.min(currentIndex + 3, schedule.length);
    const result = schedule.slice(currentIndex, endIndex);
    console.log('Showing items from index', currentIndex, 'to', endIndex - 1, ':', result.length, 'items');
    console.log('Items:', result.map(item => ({ id: item.id, name: item.segmentName })));
    return result;
  };

  const previewItems = getPreviewItems();
  console.log('Preview items:', previewItems);

  // Program type colors
  const programTypeColors: { [key: string]: string } = {
    'Podium Transition': '#8B4513',  // Dark Brown
    'Panel Transition': '#404040',   // Darker Grey
    'Sub Cue': '#F3F4F6',           // Light Grey
    'No Transition': '#059669',      // Bright Teal
    'Video': '#F59E0B',              // Bright Yellow/Orange
    'Panel+Remote': '#1E40AF',       // Darker Blue
    'Remote Only': '#60A5FA',        // Light Blue
    'Break': '#EC4899',              // Bright Pink
    'TBD': '#6B7280',                // Medium Gray
    'KILLED': '#DC2626',             // Bright Red
    'Podium': '#8B4513',             // Brown
    'Panel': '#404040',              // Dark Grey
    'PreShow/End': '#8B5CF6',        // Purple
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading PhotoView...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-red-400 text-xl">{error}</div>
      </div>
    );
  }

  // Determine current status
  const isActive = activeItemId !== null;
  const isRunning = timerState === 'running' && activeItemId;

  // Handle disconnect timer confirmation
  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = (hours * 60) + minutes;
    
    if (totalMinutes === 0) {
      alert('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    
    if (disconnectTimerState) clearTimeout(disconnectTimerState);
    
    const ms = totalMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      let timeText = '';
      if (hours > 0) timeText += `${hours}h `;
      if (minutes > 0) timeText += `${minutes}m`;
      
      console.log(`⏰ PhotoViewPage: Auto-disconnect timer expired (${timeText.trim()})`);
      console.log('📢 PhotoViewPage: Showing disconnect notification...');
      
      setDisconnectDuration(timeText.trim());
      setShowDisconnectNotification(true);
      console.log('✅ PhotoViewPage: Notification state set to true');
      
      setTimeout(() => {
        if (event?.id) {
          socketClient.disconnect(event.id);
          console.log('🔌 PhotoViewPage: WebSocket disconnected');
        }
      }, 100);
    }, ms);
    
    setDisconnectTimerState(timer);
    setShowDisconnectModal(false);
    
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (minutes > 0) timeText += `${minutes}m`;
    console.log(`⏰ PhotoViewPage: Disconnect timer set to ${timeText.trim()}`);
  };
  
  const handleNeverDisconnect = () => {
    if (disconnectTimerState) clearTimeout(disconnectTimerState);
    setDisconnectTimerState(null);
    setShowDisconnectModal(false);
    console.log('⏰ PhotoViewPage: Disconnect timer set to Never');
  };
  
  const handleReconnect = () => {
    setShowDisconnectNotification(false);
    if (event?.id) {
      setShowDisconnectModal(true);
    }
  };

  return (
    <>
    <div className="min-h-screen bg-slate-900 text-white p-6">
    {/* Progress Bar and Countdown */}
    <div className="mb-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold">{event?.name || 'Current Event'}</h1>
          <div className="text-sm text-gray-300 mt-1">
            {currentTime.toLocaleTimeString()}
          </div>
          {/* Notes Toggle Button */}
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`mt-2 px-2 py-1 text-xs rounded border transition-colors ${
              showNotes 
                ? 'bg-blue-600 border-blue-500 text-white' 
                : 'bg-slate-700 border-slate-600 text-gray-300 hover:bg-slate-600'
            }`}
          >
            {showNotes ? 'Hide Notes' : 'Show Notes'}
          </button>
        </div>
        <div className="flex items-center space-x-6">
            {/* Status Text Display */}
            <div className="text-center">
              {timerState === 'running' && activeItemId ? (
                <div className="text-lg text-green-400 font-bold">
                  RUNNING - {formatCueDisplay(schedule.find(item => item.id === activeItemId)?.customFields?.cue)}
                  {secondaryTimer && secondaryTimer.isActive && (
                    <div className="text-lg text-orange-400 mt-0.5 font-bold">
                      {formatCueDisplay(secondaryTimer.cue)} - {formatSubCueTime(secondaryTimer.remaining)}
                    </div>
                  )}
                </div>
              ) : timerState === 'loaded' && activeItemId ? (
                <div className="text-lg text-yellow-400 font-bold">
                  LOADED - {formatCueDisplay(schedule.find(item => item.id === activeItemId)?.customFields?.cue)}
                </div>
              ) : (
                <div className="text-lg text-slate-300 font-bold">
                  NO CUE SELECTED
                </div>
              )}
            </div>
          
          
          {/* Timer Display with Color */}
          <div className="relative">
            <div className="text-3xl font-mono bg-slate-800 px-6 py-3 rounded-lg border border-slate-600" style={{ color: getCountdownColor() }}>
              {formatTime(getRemainingTime())}
            </div>
            {/* Drift Status Indicator - positioned in bottom-right corner */}
          </div>
        </div>
      </div>
        
        {/* Progress Bar */}
        {activeItemId && timerProgress[activeItemId] && (
          <div className="w-full bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-2">
            <div 
              className="h-full transition-all duration-1000 absolute top-0 right-0"
              style={{ 
                width: `${getRemainingPercentage()}%`,
                background: getProgressBarColor()
              }}
            />
          </div>
        )}
      </div>

      {/* Report-style Table */}
      <div className="max-w-7xl mx-auto">
        {/* Table Header */}
        <div className="bg-slate-700 border border-slate-600">
          <div className="grid grid-cols-11 gap-0">
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              CUE
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              TIME
            </div>
            <div className="col-span-2 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SEGMENT INFO
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SLOT 1
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SLOT 2
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SLOT 3
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SLOT 4
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SLOT 5
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-3 text-center font-bold text-sm">
              SLOT 6
            </div>
            <div className="col-span-1 bg-slate-600 p-3 text-center font-bold text-sm">
              SLOT 7
            </div>
          </div>
        </div>

        {/* Table Rows */}
        {previewItems.length === 0 ? (
          <div className="text-center text-gray-400 text-xl py-12 bg-slate-800 border border-slate-600 border-t-0">
            No schedule items available
          </div>
        ) : (
          previewItems.map((item, index) => {
                    const isActive = String(activeItemId) === String(item.id);
                    const isLoaded = loadedItems[item.id];
                    const isRunning = timerState === 'running' && isActive;
                    const isIndented = indentedCues[item.id] || false;
                    
                    // Check if indented cue's parent is loaded/running
                    let shouldHighlightIndented = false;
                    if (isIndented) {
                      const parentId = indentedCues[item.id].parentId;
                      const parentIsLoaded = loadedItems[parentId] || false;
                      const parentIsRunning = activeTimers[parentId] || false;
                      shouldHighlightIndented = parentIsLoaded || parentIsRunning;
                    }
            
            // Calculate start time
            const itemIndex = schedule.findIndex(s => s.id === item.id);
            const startTime = calculateStartTime(itemIndex);
            
            // Format duration
            const duration = `${item.durationHours.toString().padStart(2, '0')}:${item.durationMinutes.toString().padStart(2, '0')}:${item.durationSeconds.toString().padStart(2, '0')}`;
            
            // Format PPT/QA info
            const pptQA = [];
            if (item.hasPPT) pptQA.push('PPT');
            if (item.hasQA) pptQA.push('Q&A');
            const pptQAString = pptQA.length > 0 ? pptQA.join('/') : 'None';
            
            // CSS class selection
            let cssClass = '';
            if (shouldHighlightIndented) {
              cssClass = 'border-4 border-orange-400';
            } else if (isActive) {
              cssClass = isRunning ? 'border-4 border-green-400' : 'border-4 border-blue-400';
            } else {
              cssClass = 'border border-slate-600';
            }
            
            return (
              <div key={item.id} className={cssClass}>
                        {/* Main Data Row - Made taller for better portrait image display */}
                        <div className={`grid grid-cols-11 gap-0 ${
                          shouldHighlightIndented ? 'bg-amber-950' : 
                          isActive ? (
                            isRunning ? 'bg-green-950' : 'bg-blue-950'
                          ) : 
                          'bg-slate-900'
                        }`} style={{ minHeight: '200px' }}>
                  {/* CUE Column - Enhanced for taller display */}
                  <div className="col-span-1 border-r border-slate-600 p-3 flex flex-col justify-center">
                    <div className="text-center">
                      <div className="text-lg font-bold mb-3 text-white">
                        {item.customFields?.cue || `CUE ${itemIndex + 1}`}
                      </div>
                      <div 
                        className="inline-block px-2 py-1 rounded text-xs font-medium text-white border shadow-lg"
                        style={{ 
                          backgroundColor: programTypeColors[item.programType] || '#6B7280',
                          color: item.programType === 'Sub Cue' ? 'black' : 'white',
                          borderColor: item.programType === 'Sub Cue' ? 'black' : 'transparent'
                        }}
                      >
                        {item.programType || 'Unknown'}
                      </div>
                    </div>
                  </div>

                  {/* TIME Column - Enhanced for taller display */}
                  <div className="col-span-1 border-r border-slate-600 p-3 flex flex-col justify-center">
                    <div className="text-center">
                      <div className="mb-4">
                        <div className="text-gray-400 text-xs mb-1">START TIME</div>
                        <div className="text-lg font-bold text-white">{startTime || 'No Time'}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs mb-1">DURATION</div>
                        <div className="text-base font-bold text-white">{duration}</div>
                      </div>
                    </div>
                  </div>

                  {/* SEGMENT INFO Column - Enhanced for taller display */}
                  <div className="col-span-2 border-r border-slate-600 p-3 flex flex-col justify-center">
                    <div className="space-y-3">
                      <div>
                        <div className="text-gray-400 text-xs mb-1">SEGMENT NAME</div>
                        <div className="text-lg font-bold text-white">{item.segmentName || 'Untitled Segment'}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs mb-1">SHOT TYPE</div>
                        <div className="text-sm font-bold text-white">{item.shotType || 'Not specified'}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-xs mb-1">PPT/Q&A</div>
                        <div className="text-sm font-bold text-white">{pptQAString}</div>
                      </div>
                    </div>
                  </div>

                  {/* SLOT Columns 1-7 - Show Speaker Info - Optimized for Portrait Images */}
                  {[1, 2, 3, 4, 5, 6, 7].map((slotNumber) => {
                    // Find speaker for this slot
                    let speakerForSlot = null;
                    if (item.speakersText) {
                      try {
                        const speakers = JSON.parse(item.speakersText);
                        if (Array.isArray(speakers)) {
                          speakerForSlot = speakers.find(speaker => speaker.slot === slotNumber);
                        }
                      } catch (e) {
                        console.log('Error parsing speakers:', e);
                      }
                    }

                    return (
                      <div key={slotNumber} className={`col-span-1 ${slotNumber < 7 ? 'border-r border-slate-600' : ''} p-3 flex flex-col justify-center`}>
                        {speakerForSlot ? (
                          <div className="text-center h-full flex flex-col justify-center">
                            {/* Speaker Photo - Larger and optimized for portrait */}
                            {speakerForSlot.photoLink && (
                              <div className="mb-3 flex justify-center">
                                <img 
                                  src={speakerForSlot.photoLink} 
                                  alt={speakerForSlot.fullName}
                                  className="w-24 h-32 rounded-lg object-cover border-2 border-slate-400 shadow-lg"
                                  style={{
                                    objectFit: 'cover',
                                    objectPosition: 'center top'
                                  }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              </div>
                            )}
                            {/* Speaker Name - 2-line format with dynamic sizing */}
                            {(() => {
                              const nameResult = formatNameForTwoLines(speakerForSlot.fullName || 'Unnamed');
                              return (
                                <div 
                                  className={`font-bold text-white mb-2 leading-tight ${
                                    nameResult.needsSmallText ? 'text-sm' : 'text-base'
                                  }`}
                                  dangerouslySetInnerHTML={{ __html: nameResult.html }}
                                />
                              );
                            })()}
                            {/* Speaker Title/Organization - Truncated with ellipsis */}
                            {(speakerForSlot.title || speakerForSlot.org) && (
                              <div className="text-xs text-gray-300 mb-1 leading-tight">
                                {(() => {
                                  const title = speakerForSlot.title || '';
                                  const org = speakerForSlot.org || '';
                                  const titleOrg = title && org ? `${title}, ${org}` : title || org;
                                  return truncateText(titleOrg, 20); // Truncate for PhotoView slots
                                })()}
                              </div>
                            )}
                            {/* Speaker Location - Enhanced styling */}
                            <div className="text-xs text-gray-300 font-medium bg-slate-700 px-2 py-1 rounded">
                              {speakerForSlot.location === 'Podium' ? 'Podium' : 
                               speakerForSlot.location === 'Seat' ? 'Seat' : 
                               speakerForSlot.location === 'Virtual' ? 'Virtual' : 
                               speakerForSlot.location === 'Moderator' ? 'Moderator' :
                               speakerForSlot.location || 'Unknown'}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center text-xs text-gray-500 h-full flex items-center justify-center">
                            {/* Empty slot */}
                            <div className="text-gray-600">Empty</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                        {/* NOTES Section Below - Only show if notes exist, have meaningful content, and showNotes is true */}
                        {showNotes && (() => {
                          // Remove HTML tags first, then check for meaningful content
                          const cleanNotes = item.notes ? item.notes.replace(/<[^>]*>/g, '').trim() : '';
                          
                          // Debug logging
                          console.log('Notes debug for item:', {
                            hasNotes: !!item.notes,
                            notesValue: item.notes,
                            cleanNotes: cleanNotes,
                            cleanLength: cleanNotes.length,
                            willShow: cleanNotes && cleanNotes.length > 0
                          });
                          
                          const hasValidNotes = cleanNotes && 
                                               cleanNotes.length > 0 && 
                                               cleanNotes !== 'None' && 
                                               cleanNotes !== 'null' && 
                                               cleanNotes !== 'undefined';
                          
                          return hasValidNotes;
                        })() && (
                          <div className={`border-t border-slate-600 p-4 ${
                            isIndented ? 'bg-amber-950' : 
                            isActive ? (isRunning ? 'bg-green-950' : 'bg-blue-950') : 
                            'bg-slate-800'
                          }`}>
                            <div className="text-gray-400 text-sm mb-2 font-bold">NOTES:</div>
                            <div 
                              className="text-sm text-white break-words leading-relaxed"
                              style={{ whiteSpace: 'pre-line' }}
                              dangerouslySetInnerHTML={{ 
                                __html: item.notes
                                  .replace(/\n/g, '<br>') // Convert line breaks to HTML breaks FIRST
                                  .replace(/\r\n/g, '<br>') // Handle Windows line breaks
                                  .replace(/\r/g, '<br>') // Handle Mac line breaks
                                  .replace(/<(?!\/?(?:br|b|strong|i|em|u|font|span|div|p|h[1-6])\b)[^>]*>/g, '') // Remove unwanted HTML but keep formatting tags
                              }}
                            />
                          </div>
                        )}

                {/* Separator line between rows */}
                {index < previewItems.length - 1 && (
                  <div className="border-t-2 border-slate-500"></div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
    
    {/* Disconnect Timer Modal */}
    {showDisconnectModal && <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />}
    
    {/* Disconnect Notification */}
    {showDisconnectNotification && <DisconnectNotification duration={disconnectDuration} onReconnect={handleReconnect} />}
    
    </>
  );
};

// Reuse the same components
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
    console.log('🔔 PhotoView DisconnectNotification mounted:', duration);
    return () => console.log('🔔 PhotoView DisconnectNotification unmounted');
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

export default PhotoViewPage;
