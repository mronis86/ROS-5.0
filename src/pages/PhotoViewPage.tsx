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
  const [subCueTimers, setSubCueTimers] = useState<{[key: number]: {remaining: number, intervalId: NodeJS.Timeout}}>({});
  const [activeTimers, setActiveTimers] = useState<{[key: number]: boolean}>({});
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
          // Find the schedule item to get cue and segment name
          const scheduleItem = schedule.find(item => item.id === parseInt(data.item_id));
          setSecondaryTimer({
            itemId: parseInt(data.item_id),
            duration: data.duration_seconds || 60,
            remaining: data.duration_seconds || 60,
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
        
        // Load current sub-cue timer
        try {
          const subCueTimerResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/sub-cue-timers/${event?.id}`);
          if (subCueTimerResponse.ok) {
            const subCueTimerData = await subCueTimerResponse.json();
            console.log('🔄 PhotoView initial sync: Loaded sub-cue timer:', subCueTimerData);
            
            if (subCueTimerData && subCueTimerData.item_id && subCueTimerData.is_running) {
              // Find the schedule item to get cue and segment name
              const scheduleItem = schedule.find(item => item.id === parseInt(subCueTimerData.item_id));
              setSecondaryTimer({
                itemId: parseInt(subCueTimerData.item_id),
                duration: subCueTimerData.duration_seconds || 60,
                remaining: subCueTimerData.duration_seconds || 60,
                isActive: true,
                startedAt: subCueTimerData.started_at ? new Date(subCueTimerData.started_at) : new Date(),
                timerState: 'running',
                cue: scheduleItem?.customFields?.cue || `CUE ${subCueTimerData.item_id}`,
                segmentName: scheduleItem?.segmentName || 'Segment'
              });
              
              console.log('🔄 PhotoView: Initial sync completed - sub-cue timer restored');
            } else {
              setSecondaryTimer(null);
              console.log('🔄 PhotoView: Initial sync completed - no active sub-cue timer');
            }
          }
        } catch (error) {
          console.error('❌ PhotoView: Initial sync failed to load sub-cue timer:', error);
        }
      }
    };

    // Connect to WebSocket
    socketClient.connect(event.id, callbacks);

    // Handle tab visibility changes - resync when user returns to tab
    const handleVisibilityChange = () => {
      if (!document.hidden && socketClient.isConnected()) {
        console.log('🔄 PhotoView: Tab became visible - triggering resync');
        // Trigger initial sync again
        callbacks.onInitialSync?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      console.log('🔄 Cleaning up PhotoView WebSocket connection');
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
          console.log(`🕐 PhotoView Timer ${activeItemId}: Continuous elapsed=${elapsed}s, Start=${startedAt.toISOString()}, Now=${now.toISOString()}`);
        }
      }, 1000);

      return () => {
        console.log(`🔄 PhotoView: Stopping continuous local timer for ${activeItemId}`);
        clearInterval(continuousTimer);
      };
    }
  }, [activeItemId, timerState]); // Removed timerProgress to prevent constant restarts

  // Cleanup on component unmount (drift detector removed)
  useEffect(() => {
    return () => {
      console.log('🔄 PhotoView: Cleaning up on component unmount');
      // Drift detector removed - using WebSocket-only approach
    };
  }, []);

  // Update secondaryTimer (sub cue timer) in real-time - matches Run of Show page
  useEffect(() => {
    if (!secondaryTimer) return;

    const interval = setInterval(() => {
      setSecondaryTimer(prev => {
        if (!prev) return null;
        
        // Calculate remaining time directly from start time
        const startTime = prev.startedAt?.getTime() || Date.now();
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
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

  return (
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
                  NO CUES
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
                    const isIndented = item.isIndented || false;
            
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
            
            return (
              <div key={item.id} className={`${
                isIndented ? 'border-4 border-orange-400' :
                isActive ? (isRunning ? 'border-4 border-green-400' : 'border-4 border-blue-400') : 
                'border border-slate-600'
              }`}>
                        {/* Main Data Row - Made taller for better portrait image display */}
                        <div className={`grid grid-cols-11 gap-0 ${
                          isIndented ? 'bg-amber-950' : 
                          isActive ? (isRunning ? 'bg-green-950' : 'bg-blue-950') : 
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
  );
};

export default PhotoViewPage;
