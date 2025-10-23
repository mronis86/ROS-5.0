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

    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ Graphics Links: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(event.id);
      } else if (!socketClient.isConnected()) {
        console.log('👁️ Graphics Links: Tab visible - reconnecting WebSocket');
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('🔄 Graphics Links: Cleaning up WebSocket connection');
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
    
    // Get master start time from API data (same as ReportsPage)
    let masterStartTime = '';
    try {
      if (event?.id) {
        const data = await DatabaseService.getRunOfShowData(event.id);
        
        // Check for master start time in different locations
        if (data?.settings?.masterStartTime) {
          masterStartTime = data.settings.masterStartTime;
        } else if (data?.settings?.dayStartTimes?.['1']) {
          masterStartTime = data.settings.dayStartTimes['1'];
        } else if (data?.schedule_items && data.schedule_items.length > 0) {
          // Check if the first item has a start time that might be the master start time
          const firstItem = data.schedule_items[0];
          if (firstItem.startTime) {
            masterStartTime = firstItem.startTime;
          }
        }
        
        console.log('📥 GraphicsLinks: Master start time from API:', masterStartTime);
      }
    } catch (error) {
      console.log('⚠️ GraphicsLinks: Error loading master start time from API, falling back to localStorage:', error);
      
      // Fallback to localStorage
      const keys = Object.keys(localStorage);
      const masterTimeKeys = keys.filter(key => key.startsWith('masterStartTime_'));
      
      if (masterTimeKeys.length > 0) {
        const latestMasterKey = masterTimeKeys[masterTimeKeys.length - 1];
        const savedMasterTime = localStorage.getItem(latestMasterKey);
        if (savedMasterTime) {
          masterStartTime = savedMasterTime;
        }
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

      {/* Downloads Section */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-2">📥 Downloads & Tools</h2>
          <p className="text-gray-400">Desktop applications and local server packages for offline use</p>
        </div>

        {/* Event ID Card */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-4 shadow-lg border border-blue-400 mb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1">
              <h3 className="text-lg font-bold text-white whitespace-nowrap">📋 Event ID:</h3>
              <div className="bg-gray-900 px-4 py-2 rounded border border-blue-400 flex-1">
                <code className="text-green-400 font-mono text-sm font-bold">{eventId || event?.id || 'No Event ID'}</code>
              </div>
            </div>
            <button
              onClick={() => {
                const id = eventId || event?.id;
                if (id) {
                  navigator.clipboard.writeText(id).then(() => {
                    alert('Event ID copied to clipboard!');
                  }).catch(() => {
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
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors font-semibold whitespace-nowrap text-sm"
            >
              📋 Copy
            </button>
          </div>
        </div>

        {/* Download Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Python Desktop App */}
          <div className="bg-green-800 rounded-lg p-5 shadow-lg border border-green-600 hover:shadow-xl transition-shadow">
            <h3 className="text-lg font-bold text-white mb-2">🐍 Python Desktop App</h3>
            <p className="text-green-200 text-xs mb-3">Standalone graphics generator with GUI server toggle</p>
            
            <div className="bg-green-900/30 rounded p-2 mb-3">
              <ul className="text-green-100 text-xs space-y-0.5">
                <li>• GUI toggle: Railway or Local</li>
                <li>• CSV files every 10 seconds</li>
                <li>• WebSocket real-time updates</li>
              </ul>
            </div>
            
            <a
              href="/OptimizedGraphicsGenerator-Python.zip"
              download="OptimizedGraphicsGenerator-Python.zip"
              className="block w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg transition-colors font-semibold text-center text-sm"
            >
              📥 Download Python App
            </a>
            <p className="text-green-300 text-xs text-center mt-2">~2 MB • Requires Python 3.8+</p>
          </div>

          {/* Local Server Package */}
          <div className="bg-purple-800 rounded-lg p-5 shadow-lg border border-purple-600 hover:shadow-xl transition-shadow">
            <h3 className="text-lg font-bold text-white mb-2">💻 Node.js Local Server</h3>
            <p className="text-purple-200 text-xs mb-3">Standalone API + WebSocket server for local use</p>
            
            <div className="bg-purple-900/30 rounded p-2 mb-3">
              <ul className="text-purple-100 text-xs space-y-0.5">
                <li>• API + WebSocket (port 3002)</li>
                <li>• All VMIX XML/CSV endpoints</li>
                <li>• One-click start • Node.js only</li>
              </ul>
            </div>
            
            <a
              href="/ROS-Local-Server-NodeJS.zip"
              download="ROS-Local-Server-NodeJS.zip"
              className="block w-full bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-lg transition-colors font-semibold text-center text-sm"
            >
              📥 Download Local Server
            </a>
            <p className="text-purple-300 text-xs text-center mt-2">~50 KB • Requires Node.js 18+</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                  onClick={() => {
                    const url = `/netlify-lower-thirds-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
                >
                  🌐 XML/CSV Feed Page (Railway) ✅
                </button>
                <button
                  onClick={() => {
                    const url = `/lower-thirds-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 XML/CSV Feed Page (Local)
                </button>
                <button
                  onClick={() => {
                    const url = `/google-sheets-vmix?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 Google Sheets VMIX Integration
                </button>
              </div>
            </div>

            {/* Schedule JSON */}
            <div className="bg-slate-700 rounded-lg p-6 flex flex-col">
              <h3 className="text-xl font-semibold text-white mb-4 text-center">Schedule</h3>
              <div className="space-y-3 mt-auto">
                <button
                  onClick={() => {
                    const url = `/netlify-schedule-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
                >
                  🌐 XML/CSV Feed Page (Railway) ✅
                </button>
                <button
                  onClick={() => {
                    const url = `/schedule-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 XML/CSV Feed Page (Local)
                </button>
                <button
                  onClick={() => {
                    const url = `/google-sheets-vmix?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 Google Sheets VMIX Integration
                </button>
              </div>
            </div>

            {/* Custom Graphics JSON */}
            <div className="bg-slate-700 rounded-lg p-6 flex flex-col">
              <h3 className="text-xl font-semibold text-white mb-4 text-center">Custom Graphics</h3>
              <div className="space-y-3 mt-auto">
                <button
                  onClick={() => {
                    const url = `/netlify-custom-columns-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors"
                >
                  🌐 XML/CSV Feed Page (Railway) ✅
                </button>
                <button
                  onClick={() => {
                    const url = `/custom-columns-xml?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 XML/CSV Feed Page (Local)
                </button>
                <button
                  onClick={() => {
                    const url = `/google-sheets-vmix?eventId=${event.id}`;
                    window.open(url, '_blank');
                  }}
                  className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                >
                  📊 Google Sheets VMIX Integration
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
