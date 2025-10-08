import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Event } from '../types/Event';
import { DatabaseService } from '../services/database';
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
  speakersText: string;
  participants: string;
  hasPPT: boolean;
  hasQA: boolean;
  timerId: string;
  customFields: Record<string, string>;
  isPublic?: boolean;
  isIndented?: boolean;
  start?: string;
}

const GraphicsLinksPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Get event data from URL parameters or location state
  const urlParams = new URLSearchParams(location.search);
  const eventId = urlParams.get('eventId');
  const eventName = urlParams.get('eventName');
  
  const event: Event = location.state?.event || {
    id: eventId || '',
    name: eventName || 'Current Event',
    date: '',
    location: '',
    schedule: []
  };
  
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [lastChangeAt, setLastChangeAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Initialize schedule data - optimized for minimal egress
  useEffect(() => {
    const loadInitialData = async () => {
      console.log('=== GRAPHICS LINKS PAGE INITIALIZATION ===');
      console.log('Event from location.state:', location.state?.event);
      console.log('Event from URL params:', { eventId, eventName });
      console.log('Final event object:', event);
      
      try {
        // Try localStorage first (fastest, no egress)
        console.log('📱 Loading from localStorage first...');
        let savedSchedule: string | null = null;
        
        // First try with event ID if available
        if (event?.id) {
          const scheduleKey = `runOfShowSchedule_${event.id}`;
          savedSchedule = localStorage.getItem(scheduleKey);
        }
        
        // If not found, try with the eventId from URL params
        if (!savedSchedule && eventId) {
          const urlScheduleKey = `runOfShowSchedule_${eventId}`;
          savedSchedule = localStorage.getItem(urlScheduleKey);
        }
        
        // If that doesn't work, try to find any schedule in localStorage
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
          setIsLoading(false);
          return;
        }
        
        // Only fallback to API if no localStorage data found
        if (event?.id) {
          console.log('🔄 No localStorage data, loading from API for event:', event.id);
          const data = await DatabaseService.getRunOfShowData(event.id);
          if (data) {
            console.log('✅ Loaded from API:', data);
            setSchedule(data.schedule_items || []);
            setLastChangeAt(data.updated_at || null);
          }
        }
      } catch (error) {
        console.error('❌ Error loading initial data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadInitialData();
  }, [event?.id, eventId]);

  // WebSocket-based real-time updates (replaces high-egress polling)
  useEffect(() => {
    if (!event?.id) {
      console.log('❌ No event ID, skipping WebSocket connection');
      return;
    }

    console.log('🔄 Setting up WebSocket connection for Graphics Links page');

    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Graphics Links: WebSocket data update received:', data);
        if (data && data.schedule_items) {
          setSchedule(data.schedule_items);
          setLastChangeAt(data.updated_at || null);
          setLastUpdated(new Date());
          console.log('✅ Graphics Links: Schedule updated via WebSocket');
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📡 Graphics Links: WebSocket connection status:', connected);
        if (connected) {
          // Reload data when reconnected
          const loadData = async () => {
            try {
              const data = await DatabaseService.getRunOfShowData(event.id);
              if (data) {
                setSchedule(data.schedule_items || []);
                setLastChangeAt(data.updated_at || null);
                console.log('✅ Graphics Links: Data reloaded on reconnection');
              }
            } catch (error) {
              console.error('❌ Graphics Links: Error reloading data on reconnection:', error);
            }
          };
          loadData();
        }
      }
    };

    socketClient.connect(event.id, callbacks);

    return () => {
      console.log('🔄 Graphics Links: Cleaning up WebSocket connection');
      socketClient.disconnect(event.id);
    };
  }, [event?.id]);

  // Note: localStorage polling removed - WebSocket handles real-time updates
  // Static JSON generation will load fresh data when needed

  // JSON sanitization function for VMIX compatibility
  const sanitizeJSONForVMIX = (obj: any): any => {
    if (typeof obj === 'string') {
      // Escape & characters as \u0026
      let sanitized = obj.replace(/&/g, '\\u0026');
      // Replace newlines with spaces
      sanitized = sanitized.replace(/\n/g, ' ').replace(/\r/g, ' ');
      // Remove any remaining control characters that could break JSON
      sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, ' ');
      return sanitized;
    } else if (Array.isArray(obj)) {
      return obj.map(item => sanitizeJSONForVMIX(item));
    } else if (obj !== null && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeJSONForVMIX(value);
      }
      return sanitized;
    }
    return obj;
  };

  const generateScheduleJSON = async () => {
    console.log('=== GRAPHICS LINKS JSON GENERATION ===');
    
    // Load fresh schedule data when generating JSON
    let currentSchedule = schedule;
    try {
      if (event?.id) {
        const data = await DatabaseService.getRunOfShowData(event.id);
        if (data?.schedule_items) {
          currentSchedule = data.schedule_items;
          console.log('✅ Loaded fresh schedule data for JSON generation');
        }
      }
    } catch (error) {
      console.log('⚠️ Using cached schedule data:', error);
    }
    
    console.log('Using schedule data:', currentSchedule);
    
    // Get master start time - try localStorage first (no egress)
    let masterStartTime = '';
    
    // Try localStorage first (fastest, no egress)
    const keys = Object.keys(localStorage);
    const masterTimeKeys = keys.filter(key => key.startsWith('masterStartTime_'));
    
    if (masterTimeKeys.length > 0) {
      const latestMasterKey = masterTimeKeys[masterTimeKeys.length - 1];
      const savedMasterTime = localStorage.getItem(latestMasterKey);
      if (savedMasterTime) {
        masterStartTime = savedMasterTime;
        console.log('Master start time from localStorage:', masterStartTime);
      }
    }
    
    // Only fallback to API if localStorage fails
    if (!masterStartTime && event?.id) {
      try {
        const data = await DatabaseService.getRunOfShowData(event.id);
        if (data?.settings?.masterStartTime) {
          masterStartTime = data.settings.masterStartTime;
          console.log('Master start time from API:', masterStartTime);
        }
      } catch (error) {
        console.log('Error getting master start time from API:', error);
      }
    }
    
    // Calculate start time function (same as RunOfShowPage)
    const calculateStartTime = (index: number) => {
      const currentItem = currentSchedule[index];
      if (!currentItem) return '';
      
      // If this item is indented, return empty string (no start time)
      if (currentItem.isIndented) {
        return '';
      }
      
      // If no start time is set, return blank
      if (!masterStartTime) return '';
      
      // Calculate total seconds from the beginning up to this item
      let totalSeconds = 0;
      for (let i = 0; i < index; i++) {
        const item = currentSchedule[i];
        // Only count non-indented items
        if (!item.isIndented) {
          totalSeconds += (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0);
        }
      }
      
      const [hours, minutes] = masterStartTime.split(':').map(Number);
      const startSeconds = hours * 3600 + minutes * 60;
      const totalStartSeconds = startSeconds + totalSeconds;
      
      const finalHours = Math.floor(totalStartSeconds / 3600) % 24;
      const finalMinutes = Math.floor((totalStartSeconds % 3600) / 60);
      
      // Convert to 12-hour format
      const date = new Date();
      date.setHours(finalHours, finalMinutes, 0, 0);
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    };
    
    console.log('=== FINAL DATA SUMMARY ===');
    console.log('Schedule data:', currentSchedule);
    console.log('Master start time:', masterStartTime);
    console.log('=== END FINAL DATA SUMMARY ===');
    
    // Filter for public items and create clean data
    const publicItems = currentSchedule
      .filter(item => item.isPublic === true)
      .map(item => {
        const itemIndex = currentSchedule.findIndex(s => s.id === item.id);
        const calculatedStartTime = calculateStartTime(itemIndex);
        
        return {
          segmentName: item.segmentName || 'Untitled Segment',
          startTime: calculatedStartTime || 'No Start Time'
        };
      });
    
    console.log('Public items found:', publicItems);
    
    const jsonData = {
      event: event?.name || 'Current Event',
      generated: new Date().toISOString(),
      schedule: publicItems
    };

    // Sanitize the JSON data for VMIX compatibility
    const sanitizedData = sanitizeJSONForVMIX(jsonData);
    const jsonString = JSON.stringify(sanitizedData, null, 2);

    // Create actual JSON file
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Open in new tab - JSON file will display in browser
    window.open(url, '_blank');
  };

  const generateLowerThirdsJSON = async () => {
    console.log('=== GENERATING LOWER THIRDS JSON ===');
    console.log('Event ID from URL:', eventId);
    console.log('Event object:', event);
    
    // Load fresh schedule data when generating JSON
    let currentSchedule = schedule;
    try {
      if (event?.id) {
        const data = await DatabaseService.getRunOfShowData(event.id);
        if (data?.schedule_items) {
          currentSchedule = data.schedule_items;
          console.log('✅ Loaded fresh schedule data for Lower Thirds JSON');
        }
      }
    } catch (error) {
      console.log('⚠️ Using cached schedule data for Lower Thirds:', error);
    }
    
    console.log('Using schedule data:', currentSchedule);
    console.log('Schedule length:', currentSchedule.length);
    console.log('First few items:', currentSchedule.slice(0, 3));
    
    // Debug: Check for speakers data in schedule
    const itemsWithSpeakers = currentSchedule.filter(item => item.speakersText && item.speakersText.trim());
    console.log('Items with speakers data:', itemsWithSpeakers.length);
    console.log('Items with speakers:', itemsWithSpeakers.map(item => ({
      segmentName: item.segmentName,
      speakersText: item.speakersText,
      speakersLength: item.speakersText?.length || 0
    })));
    
    // Check if we have the right event data
    if (currentSchedule.length === 0) {
      console.log('⚠️ NO SCHEDULE DATA FOUND!');
      console.log('Available localStorage keys:', Object.keys(localStorage));
      console.log('Looking for keys with event ID:', eventId);
    }
    
    // Get master start time from localStorage
    let masterStartTime = '';
    const keys = Object.keys(localStorage);
    const masterTimeKeys = keys.filter(key => key.startsWith('masterStartTime_'));
    
    if (masterTimeKeys.length > 0) {
      const latestMasterKey = masterTimeKeys[masterTimeKeys.length - 1];
      const savedMasterTime = localStorage.getItem(latestMasterKey);
      if (savedMasterTime) {
        masterStartTime = savedMasterTime;
      }
    }
    
    // Calculate start time function (same as RunOfShowPage)
    const calculateStartTime = (index: number) => {
      if (!masterStartTime) return '';
      
      let totalMinutes = 0;
      for (let i = 0; i < index; i++) {
        const item = currentSchedule[i];
        totalMinutes += (item.durationHours * 60) + item.durationMinutes;
      }
      
      const [hours, minutes] = masterStartTime.split(':').map(Number);
      const startDate = new Date();
      startDate.setHours(hours, minutes + totalMinutes, 0, 0);
      
      return startDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };
    
    // Create horizontal table structure - one row per CUE/segment with all speakers
    const cueRows: any[] = [];
    
    currentSchedule.forEach((item, itemIndex) => {
      console.log('Processing item:', item.segmentName, 'Speakers:', item.speakersText);
      console.log('Item details:', {
        id: item.id,
        segmentName: item.segmentName,
        speakersText: item.speakersText,
        speakersTextLength: item.speakersText?.length || 0,
        speakersTextType: typeof item.speakersText
      });
      
      // Initialize row with basic segment info and empty speaker slots
      const cueRow = {
        row: itemIndex + 1,
        cue: item.customFields.cue || '',
        program: item.programType || '',
        segmentName: item.segmentName || '',
        // Speaker 1 fields
        speaker1Name: '',
        speaker1TitleOrg: '',
        speaker1Photo: '',
        // Speaker 2 fields
        speaker2Name: '',
        speaker2TitleOrg: '',
        speaker2Photo: '',
        // Speaker 3 fields
        speaker3Name: '',
        speaker3TitleOrg: '',
        speaker3Photo: '',
        // Speaker 4 fields
        speaker4Name: '',
        speaker4TitleOrg: '',
        speaker4Photo: '',
        // Speaker 5 fields
        speaker5Name: '',
        speaker5TitleOrg: '',
        speaker5Photo: '',
        // Speaker 6 fields
        speaker6Name: '',
        speaker6TitleOrg: '',
        speaker6Photo: '',
        // Speaker 7 fields
        speaker7Name: '',
        speaker7TitleOrg: '',
        speaker7Photo: ''
      };
      
      if (item.speakersText && item.speakersText.trim()) {
        try {
          // Parse the speakers array from JSON string
          const speakersArray = JSON.parse(item.speakersText);
          console.log('Parsed speakers array:', speakersArray);
          console.log('Speakers array length:', speakersArray?.length || 0);
          
          // Sort speakers by their slot number
          const sortedSpeakers = speakersArray.sort((a, b) => a.slot - b.slot);
          console.log('Sorted speakers by slot:', sortedSpeakers);
          
          // Fill in speaker data for each slot
          sortedSpeakers.forEach((speaker) => {
            const speakerSlot = speaker.slot;
            
            if (speakerSlot >= 1 && speakerSlot <= 7) {
              const speakerName = speaker.fullName || '';
              const speakerTitleOrg = speaker.title && speaker.org 
                ? `${speaker.title}\n${speaker.org}`
                : speaker.title || speaker.org || '';
              const speakerPhoto = speaker.photoLink || '';
              
              // Set the appropriate speaker slot fields
              cueRow[`speaker${speakerSlot}Name`] = speakerName;
              cueRow[`speaker${speakerSlot}TitleOrg`] = speakerTitleOrg;
              cueRow[`speaker${speakerSlot}Photo`] = speakerPhoto;
              
              console.log(`Set speaker ${speakerSlot} (${speakerName}) in row ${itemIndex + 1}`);
            } else {
              console.log(`Speaker slot ${speakerSlot} (${speaker.fullName}) is outside range 1-7, skipping`);
            }
          });
        } catch (error) {
          console.log('Error parsing speakers JSON:', error);
          console.log('Raw speakers data:', item.speakersText);
        }
      } else {
        console.log('No speakers found in row:', item.segmentName);
      }
      
      cueRows.push(cueRow);
    });
    
    console.log('CUE rows with all speakers:', cueRows);
    
    const jsonData = {
      event: event?.name || 'Current Event',
      generated: new Date().toISOString(),
      lowerThirds: {
        cueRows: cueRows,
        totalRows: cueRows.length,
        totalSpeakers: cueRows.reduce((total, row) => {
          return total + [1,2,3,4,5,6,7].filter(slot => row[`speaker${slot}Name`].trim()).length;
        }, 0)
      }
    };

    // Sanitize the JSON data for VMIX compatibility
    const sanitizedData = sanitizeJSONForVMIX(jsonData);
    const jsonString = JSON.stringify(sanitizedData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    window.open(url, '_blank');
    console.log('=== END GENERATING LOWER THIRDS JSON ===');
  };

  const generateLiveLowerThirdsURL = () => {
    // Generate a URL that VMIX can poll for real-time updates
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/lower-thirds-live.html?eventId=${eventId || event?.id}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live JSON URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON/XML\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      // Fallback if clipboard fails
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live JSON URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON/XML\n\nThis URL will automatically update every 10 seconds!`);
    });
  };


  const generateLiveScheduleURL = () => {
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/schedule-live.html?eventId=${eventId || event?.id}`;
    
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live Schedule URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON/XML\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live Schedule URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON/XML\n\nThis URL will automatically update every 10 seconds!`);
    });
  };

  const generateLiveCustomGraphicsURL = () => {
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/custom-graphics-live.html?eventId=${eventId || event?.id}`;
    
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live Custom Graphics JSON URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live Custom Graphics JSON URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON\n\nThis URL will automatically update every 10 seconds!`);
    });
  };


  const generateLiveCustomGraphicsCSVURL = () => {
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/custom-graphics-live-csv.html?eventId=${eventId || event?.id}`;
    
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live Custom Graphics CSV URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → CSV\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live Custom Graphics CSV URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → CSV\n\nThis URL will automatically update every 10 seconds!`);
    });
  };

  const generateLiveLowerThirdsCSVURL = () => {
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/lower-thirds-live-csv.html?eventId=${eventId || event?.id}`;
    
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live CSV URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → CSV\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live CSV URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → CSV\n\nThis URL will automatically update every 10 seconds!`);
    });
  };

  const generateLiveScheduleXMLURL = () => {
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/schedule-live-xml.html?eventId=${eventId || event?.id}`;
    
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live Schedule XML URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON/XML\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live Schedule XML URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → JSON/XML\n\nThis URL will automatically update every 10 seconds!`);
    });
  };

  const generateLiveScheduleCSVURL = () => {
    const baseUrl = window.location.origin;
    const liveUrl = `${baseUrl}/schedule-live-csv.html?eventId=${eventId || event?.id}`;
    
    navigator.clipboard.writeText(liveUrl).then(() => {
      alert(`Live Schedule CSV URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → CSV\n\nThis URL will automatically update every 10 seconds!`);
    }).catch(() => {
      const textArea = document.createElement('textarea');
      textArea.value = liveUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert(`Live Schedule CSV URL copied to clipboard:\n${liveUrl}\n\nUse this URL in VMIX Data Sources → CSV\n\nThis URL will automatically update every 10 seconds!`);
    });
  };

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const generateCustomGraphicsJSON = async () => {
    console.log('🔍 Starting generateCustomGraphicsJSON');
    
    // Load fresh schedule data when generating JSON
    let currentSchedule = schedule;
    try {
      if (event?.id) {
        const data = await DatabaseService.getRunOfShowData(event.id);
        if (data?.schedule_items) {
          currentSchedule = data.schedule_items;
          console.log('✅ Loaded fresh schedule data for Custom Graphics JSON');
        }
      }
    } catch (error) {
      console.log('⚠️ Using cached schedule data for Custom Graphics:', error);
    }
    
    console.log('🔍 Current schedule data:', currentSchedule);
    console.log('🔍 Schedule length:', currentSchedule.length);
    
    // Get master start time from localStorage
    let masterStartTime = '';
    const keys = Object.keys(localStorage);
    const masterTimeKeys = keys.filter(key => key.startsWith('masterStartTime_'));
    
    if (masterTimeKeys.length > 0) {
      const latestMasterKey = masterTimeKeys[masterTimeKeys.length - 1];
      const savedMasterTime = localStorage.getItem(latestMasterKey);
      if (savedMasterTime) {
        masterStartTime = savedMasterTime;
      }
    }
    
    // Calculate start time function
    const calculateStartTime = (index: number) => {
      if (!masterStartTime) return '';
      
      let totalMinutes = 0;
      for (let i = 0; i < index; i++) {
        const item = currentSchedule[i];
        totalMinutes += (item.durationHours * 60) + item.durationMinutes;
      }
      
      const [hours, minutes] = masterStartTime.split(':').map(Number);
      const startDate = new Date();
      startDate.setHours(hours, minutes + totalMinutes, 0, 0);
      
      return startDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };

    // Get custom columns - try localStorage first (no egress)
    let customColumns: any[] = [];
    
    // Try localStorage first (fastest, no egress)
    if (event?.id) {
      const savedCustomColumns = localStorage.getItem(`customColumns_${event.id}`);
      if (savedCustomColumns) {
        customColumns = JSON.parse(savedCustomColumns);
        console.log('🔍 Custom columns from localStorage:', customColumns);
      }
    }
    
    // Only fallback to API if localStorage fails
    if (customColumns.length === 0 && event?.id) {
      try {
        const data = await DatabaseService.getRunOfShowData(event.id);
        customColumns = data?.custom_columns || [];
        console.log('🔍 Custom columns from API:', customColumns);
      } catch (error) {
        console.log('Error getting custom columns from API:', error);
      }
    }
    
    console.log('🔍 Final custom columns for graphics:', customColumns);
    console.log('🔍 Schedule data for graphics:', currentSchedule);
    console.log('🔍 Schedule length:', currentSchedule.length);
    console.log('🔍 Public items:', currentSchedule.filter(item => item.isPublic).length);

    // Generate custom graphics from schedule items with all custom columns
    const customGraphics = currentSchedule
      .filter(item => item.isPublic)
      .map(item => {
        // Create base object with standard fields
        const baseItem = {
          type: item.segmentName || 'Segment',
          text: item.segmentName || 'Custom Graphic',
          duration: `${item.durationHours.toString().padStart(2, '0')}:${item.durationMinutes.toString().padStart(2, '0')}:${item.durationSeconds.toString().padStart(2, '0')}`,
          cue: item.customFields.cue || 'CUE##',
          startTime: calculateStartTime(currentSchedule.findIndex(s => s.id === item.id)),
          notes: item.notes || ''
        };
        
        // Add only custom column values that have data
        const customFields: Record<string, string> = {};
        customColumns.forEach(column => {
          const value = item.customFields[column.name];
          if (value && value.trim() !== '') {
            customFields[column.name] = value;
          }
        });
        
        // Combine base fields with custom fields
        return { ...baseItem, ...customFields };
      });

    console.log('🔍 Generated custom graphics:', customGraphics);
    console.log('🔍 Custom graphics length:', customGraphics.length);

    const jsonData = {
      event: event?.name || 'Current Event',
      generated: new Date().toISOString(),
      customGraphics: customGraphics.length > 0 ? customGraphics : [
        { type: 'Title', text: 'Welcome to Event', duration: '00:00:10', cue: 'CUE01', startTime: '00:00:00', notes: 'Opening title' },
        { type: 'Break', text: 'Commercial Break', duration: '00:02:00', cue: 'CUE02', startTime: '00:15:00', notes: 'Commercial break' }
      ]
    };

    // Sanitize the JSON data for VMIX compatibility
    const sanitizedData = sanitizeJSONForVMIX(jsonData);
    const jsonString = JSON.stringify(sanitizedData, null, 2);

    // Create actual JSON file
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Open in new tab - JSON file will display in browser
    window.open(url, '_blank');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white pt-16">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => {
                  // Close the current tab/window
                  window.close();
                }}
                className="text-slate-300 hover:text-white transition-colors mr-6"
              >
                ← Back to Run of Show
              </button>
              <h1 className="text-xl font-semibold">Graphics Links</h1>
            </div>
            <div className="text-slate-400">
              {event?.name || 'Event'}
            </div>
          </div>
        </div>
      </div>

      {/* Event ID Section */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="bg-blue-900 rounded-xl p-6 shadow-2xl border border-blue-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">📋 Event ID for Desktop App</h2>
              <p className="text-blue-200 text-sm mt-1">Copy this Event ID to use in the Python desktop application</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="bg-slate-700 px-4 py-2 rounded-lg">
                <code className="text-green-400 font-mono text-lg">{eventId || event?.id || 'No Event ID'}</code>
              </div>
              <button
                onClick={() => {
                  const id = eventId || event?.id;
                  if (id) {
                    navigator.clipboard.writeText(id).then(() => {
                      alert('Event ID copied to clipboard!');
                    }).catch(() => {
                      // Fallback for older browsers
                      const textArea = document.createElement('textarea');
                      textArea.value = id;
                      document.body.appendChild(textArea);
                      textArea.select();
                      document.execCommand('copy');
                      document.body.removeChild(textArea);
                      alert('Event ID copied to clipboard!');
                    });
                  } else {
                    alert('No Event ID available');
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                📋 Copy Event ID
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Python Desktop App Section */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="bg-green-900 rounded-xl p-6 shadow-2xl border border-green-700">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">🐍 Python Desktop App</h2>
              <p className="text-green-200 text-sm mt-1">Download the Python application for generating live graphics files</p>
            </div>
            <div className="flex items-center space-x-4">
              <a
                href="/LiveGraphicsGenerator-Python.zip"
                download="LiveGraphicsGenerator-Python.zip"
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition-colors font-semibold"
              >
                📥 Download Python App
              </a>
            </div>
          </div>
          <div className="mt-4 text-green-200 text-sm">
            <p>• Generates CSV files every 10 seconds</p>
            <p>• No browser required - runs as desktop application</p>
            <p>• Easy setup with GUI interface</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-slate-800 rounded-xl p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Generate JSON Files</h2>
              {isLoading && (
                <p className="text-blue-400 text-sm mt-1">🔄 Loading data...</p>
              )}
              {lastUpdated && !isLoading && (
                <p className="text-green-400 text-sm mt-1">
                  ✅ Last updated: {lastUpdated.toLocaleTimeString()}
                </p>
              )}
              {isUpdating && (
                <p className="text-blue-400 text-sm mt-1">🔄 Updating data...</p>
              )}
            </div>
            <button
              onClick={async () => {
                console.log('🔄 Manual refresh triggered');
                setIsLoading(true);
                
                try {
                  // Try localStorage first (fastest, no egress)
                  let savedSchedule: string | null = null;
                  
                  if (event?.id) {
                    const scheduleKey = `runOfShowSchedule_${event.id}`;
                    savedSchedule = localStorage.getItem(scheduleKey);
                  }
                  
                  if (!savedSchedule && eventId) {
                    const urlScheduleKey = `runOfShowSchedule_${eventId}`;
                    savedSchedule = localStorage.getItem(urlScheduleKey);
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
                    const newSchedule = JSON.parse(savedSchedule);
                    console.log('📝 Refreshed from localStorage:', newSchedule);
                    setSchedule(newSchedule);
                    setLastUpdated(new Date());
                    alert('Data refreshed from local storage!');
                    return;
                  }
                  
                  // Only fallback to API if no localStorage data
                  if (event?.id) {
                    const data = await DatabaseService.getRunOfShowData(event.id);
                    if (data) {
                      setSchedule(data.schedule_items || []);
                      setLastChangeAt(data.updated_at || null);
                      setLastUpdated(new Date());
                      console.log('✅ Refreshed from API');
                      alert('Data refreshed from database!');
                    } else {
                      alert('No schedule data found');
                    }
                  } else {
                    alert('No schedule data found');
                  }
                } catch (error) {
                  console.error('❌ Error refreshing data:', error);
                  alert('Error refreshing data');
                } finally {
                  setIsLoading(false);
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
            >
              🔄 Refresh Data
            </button>
          </div>
          <p className="text-slate-300 mb-8">
            Click the buttons below to generate url links that VMIX can use as data sources for graphics.
            <span className="text-green-400 font-medium"> ✨ Live pages updates automatically when content changes! </span>
            <span className="text-blue-400 font-medium"> 🚀 Optimized for minimal data usage with WebSocket updates! </span>
            Use "Refresh Data" if changes don't appear automatically.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Lower Thirds JSON */}
            <div className="bg-slate-700 rounded-lg p-6 flex flex-col">
              <h3 className="text-xl font-semibold text-white mb-4 text-center">Lower Thirds</h3>
              <div className="space-y-3 mt-auto">
                <button
                  onClick={async () => {
                    try {
                      await generateLowerThirdsJSON();
                    } catch (error) {
                      console.error('Error generating lower thirds JSON:', error);
                      alert('Error generating lower thirds JSON');
                    }
                  }}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
                >
                  📄 Generate Static JSON
                </button>
                <button
                  onClick={generateLiveLowerThirdsURL}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  🔄 Generate Live JSON URL
                </button>
                <button
                  onClick={generateLiveLowerThirdsCSVURL}
                  className="w-full px-4 py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-medium rounded-lg transition-colors"
                >
                  🔄 Generate Live CSV URL
                </button>
                <button
                  onClick={() => {
                    const url = `/lower-thirds-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 Open XML Feed Page
                </button>
              </div>
            </div>

            {/* Schedule JSON */}
            <div className="bg-slate-700 rounded-lg p-6 flex flex-col">
              <h3 className="text-xl font-semibold text-white mb-4 text-center">Schedule</h3>
              <div className="space-y-3 mt-auto">
                <button
                  onClick={async () => {
                    try {
                      await generateScheduleJSON();
                    } catch (error) {
                      console.error('Error generating schedule JSON:', error);
                      alert('Error generating schedule JSON');
                    }
                  }}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
                >
                  📄 Generate Static JSON
                </button>
                <button
                  onClick={generateLiveScheduleURL}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  🔄 Generate Live JSON URL
                </button>
                <button
                  onClick={generateLiveScheduleCSVURL}
                  className="w-full px-4 py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-medium rounded-lg transition-colors"
                >
                  🔄 Generate Live CSV URL
                </button>
                <button
                  onClick={() => {
                    const url = `/schedule-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  📅 Open Schedule XML Feed
                </button>
              </div>
            </div>

            {/* Custom Graphics JSON */}
            <div className="bg-slate-700 rounded-lg p-6 flex flex-col">
              <h3 className="text-xl font-semibold text-white mb-4 text-center">Custom Graphics</h3>
              <div className="space-y-3 mt-auto">
                <button
                  onClick={async () => {
                    try {
                      await generateCustomGraphicsJSON();
                    } catch (error) {
                      console.error('Error generating custom graphics JSON:', error);
                      alert('Error generating custom graphics JSON');
                    }
                  }}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
                >
                  📄 Generate Static JSON
                </button>
                <button
                  onClick={generateLiveCustomGraphicsURL}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  🔄 Generate Live JSON URL
                </button>
                <button
                  onClick={generateLiveCustomGraphicsCSVURL}
                  className="w-full px-4 py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-medium rounded-lg transition-colors"
                >
                  🔄 Generate Live CSV URL
                </button>
                <button
                  onClick={() => {
                    const url = `/custom-columns-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 Open Custom Columns XML Feed
                </button>
              </div>
            </div>

          </div>

          {/* Info Section */}
          <div className="mt-8 p-4 bg-slate-600 rounded-lg">
            <h4 className="text-white font-semibold mb-2">VMIX Data Source Information</h4>
            <p className="text-slate-300 text-sm">
              These data sources are designed for VMIX and will include only items marked as "Public":
            </p>
            <ul className="text-slate-300 text-sm mt-2 ml-4 list-disc">
              <li><strong>Schedule:</strong> Segment Name, Start Time (sorted by time)</li>
              <li><strong>Lower Thirds:</strong> Speaker Names, Titles, Organizations, Segments, CUEs (up to 7 speakers per segment)</li>
              <li><strong>Custom Graphics:</strong> Type, Text, Duration, CUE, Start Time, Notes, plus custom columns (if data exists)</li>
              <li><strong>VMIX XML:</strong> Native VMIX XML format with auto-refresh every 10 seconds, includes segment details and timing</li>
            </ul>
            <div className="mt-4 p-3 bg-green-900 rounded-lg">
              <p className="text-green-200 text-sm">
                <strong>✨ Live Updates:</strong> Use the "Live" URLs for real-time data that automatically updates every 10 seconds in VMIX
              </p>
            </div>
            <div className="mt-4 p-3 bg-blue-900 rounded-lg">
              <p className="text-blue-200 text-sm">
                <strong>VMIX Setup:</strong> Copy the Live URLs and add them in VMIX Data Sources → JSON/XML/CSV. No need to save files manually!
              </p>
            </div>
            <div className="mt-2 p-3 bg-yellow-900 rounded-lg">
              <p className="text-yellow-200 text-sm">
                <strong>Format Options:</strong> JSON (recommended), XML, or CSV - choose what works best with your VMIX setup
              </p>
            </div>
            <div className="mt-2 p-3 bg-purple-900 rounded-lg">
              <p className="text-purple-200 text-sm">
                <strong>🚀 Performance Optimized:</strong> This page now uses WebSocket for real-time updates and localStorage caching to minimize data usage and improve performance
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GraphicsLinksPage;
