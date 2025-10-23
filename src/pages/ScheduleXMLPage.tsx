import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

interface ScheduleItem {
  id: string;
  title: string;
  subtitle: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  segmentName: string;
  cue?: string;
  program?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  speakers?: Array<{
    title: string;
    subtitle: string;
    photo: string;
  }>;
}

interface Speaker {
  slot: number;
  fullName: string;
  title?: string;
  org?: string;
  photoLink?: string;
}

const ScheduleXMLPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'instructions'>('preview');
  const [refreshInterval, setRefreshInterval] = useState(10); // seconds

  const calculateStartTime = (scheduleItems: any[], currentItem: any, masterStartTime: string): string => {
    if (!masterStartTime) return '';
    
    try {
      const itemIndex = scheduleItems.indexOf(currentItem);
      
      // If indented, no start time
      if (currentItem.isIndented) return '';
      
      // Calculate total seconds up to this item
      let totalSeconds = 0;
      for (let i = 0; i < itemIndex; i++) {
        const item = scheduleItems[i];
        if (!item.isIndented) {
          totalSeconds += (item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds);
        }
      }
      
      // Add to master start time
      const [startHours, startMinutes] = masterStartTime.split(':').map(Number);
      const startSeconds = startHours * 3600 + startMinutes * 60;
      const totalStartSeconds = startSeconds + totalSeconds;
      
      const finalHours = (totalStartSeconds / 3600) % 24;
      const finalMinutes = (totalStartSeconds % 3600) / 60;
      
      // Convert to 12-hour format
      const date = new Date();
      date.setHours(finalHours, finalMinutes, 0, 0);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (error) {
      return '';
    }
  };

  // Helper functions for URL detection and copying
  const isNetlify = () => {
    return window.location.hostname.includes('netlify.app') || 
           window.location.hostname.includes('netlify.com') ||
           window.location.hostname !== 'localhost';
  };

  const getApiUrl = () => {
    if (isNetlify()) {
      // For Netlify, use Netlify Functions
      return `${window.location.origin}/.netlify/functions`;
    } else {
      // For local development, use the Node.js server
      return 'http://localhost:3002/api';
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      console.log('Copied to clipboard:', text);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const fetchScheduleData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!eventId) {
        throw new Error('Event ID is required');
      }

      console.log('📅 Fetching schedule data for event:', eventId);

      // Use DatabaseService instead of direct Supabase calls
      const data = await DatabaseService.getRunOfShowData(eventId);

      if (!data || !data.schedule_items) {
        setScheduleItems([]);
        setLastUpdated(new Date());
        return;
      }

      const scheduleItemsData: ScheduleItem[] = [];
      const items = data.schedule_items;
      
      // Check for master start time in different locations (same as ReportsPage)
      let masterStartTime = '';
      if (data.settings?.masterStartTime) {
        masterStartTime = data.settings.masterStartTime;
      } else if (data.settings?.dayStartTimes?.['1']) {
        masterStartTime = data.settings.dayStartTimes['1'];
      } else if (data.schedule_items && data.schedule_items.length > 0) {
        // Check if the first item has a start time that might be the master start time
        const firstItem = data.schedule_items[0];
        if (firstItem.startTime) {
          masterStartTime = firstItem.startTime;
        }
      }
      
      console.log('📊 Total schedule items:', items.length);
      console.log('✅ ScheduleXML: Master start time from API:', masterStartTime);

      // Process all items (like Lower Thirds page does)
      items.forEach((item: any, index: number) => {
        // Calculate start time like Python script
        const startTime = calculateStartTime(items, item, masterStartTime);
        
        const baseEntry: ScheduleItem = {
          id: `${item.id}-schedule`,
          title: item.segmentName || 'Untitled Segment',
          subtitle: '',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          segmentName: item.segmentName || 'Untitled Segment',
          startTime: startTime || 'No Start Time',
          // No speakers, cue, program, endTime, duration for schedule
          speakers: []
        };
        
        scheduleItemsData.push(baseEntry);
      });

      console.log('📊 Processed schedule items:', scheduleItemsData.length);

      setScheduleItems(scheduleItemsData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching schedule data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // WebSocket-based real-time updates (replaces high-egress polling)
  useEffect(() => {
    if (!eventId) {
      console.log('❌ No event ID, skipping WebSocket connection');
      return;
    }

    console.log('🔄 Setting up WebSocket connection for Schedule XML page');

    // Load initial data
    fetchScheduleData();

    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Schedule XML: WebSocket data update received:', data);
        if (data && data.schedule_items) {
          // Process the updated data
          const scheduleItemsData: ScheduleItem[] = [];
          const items = data.schedule_items;
          
          // Check for master start time in different locations (same as ReportsPage)
          let masterStartTime = '';
          if (data.settings?.masterStartTime) {
            masterStartTime = data.settings.masterStartTime;
          } else if (data.settings?.dayStartTimes?.['1']) {
            masterStartTime = data.settings.dayStartTimes['1'];
          } else if (data.schedule_items && data.schedule_items.length > 0) {
            // Check if the first item has a start time that might be the master start time
            const firstItem = data.schedule_items[0];
            if (firstItem.startTime) {
              masterStartTime = firstItem.startTime;
            }
          }

          // Process all items (like Lower Thirds page does)
          items.forEach((item: any, index: number) => {
            const startTime = calculateStartTime(items, item, masterStartTime);
            
            const baseEntry: ScheduleItem = {
              id: `${item.id}-schedule`,
              title: item.segmentName || 'Untitled Segment',
              subtitle: '',
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              segmentName: item.segmentName || 'Untitled Segment',
              startTime: startTime || 'No Start Time',
              speakers: []
            };
            
            scheduleItemsData.push(baseEntry);
          });

          setScheduleItems(scheduleItemsData);
          setLastUpdated(new Date());
          console.log('✅ Schedule XML: Data updated via WebSocket');
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📡 Schedule XML: WebSocket connection status:', connected);
        if (connected) {
          // Reload data when reconnected
          fetchScheduleData();
        }
      }
    };

    socketClient.connect(eventId, callbacks);

    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ Schedule XML: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(eventId);
      } else if (!socketClient.isConnected()) {
        console.log('👁️ Schedule XML: Tab visible - reconnecting WebSocket');
        socketClient.connect(eventId, callbacks);
        fetchScheduleData(); // Reload data on reconnect
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('🔄 Schedule XML: Cleaning up WebSocket connection');
      socketClient.disconnect(eventId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [eventId]);

  // Handle manual refresh
  const handleRefresh = () => {
    fetchScheduleData();
  };

  const generateXML = (data: ScheduleItem[]): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId || 'unknown'}</event_id>
  <schedule>
    ${data.map(item => `
    <item>
      <id>${item.id}</id>
      <row>${data.indexOf(item) + 1}</row>
      <segment_name><![CDATA[${item.segmentName || ''}]]></segment_name>
      <start_time><![CDATA[${item.startTime || ''}]]></start_time>
    </item>`).join('')}
  </schedule>
</data>`;
    
    return xmlHeader + xmlContent;
  };

  const generateCSV = (data: ScheduleItem[]): string => {
    // Generate CSV header - Row, Segment Name, and Start Time
    let csv = 'Row,Segment Name,Start Time\n';
    
    // Process each schedule item (one row per item)
    data.forEach((item, index) => {
      const rowNumber = index + 1;
      const segmentName = item.segmentName || '';
      const startTime = item.startTime || '';
      
      // Create CSV row
      const csvRow = [
        rowNumber,
        `"${segmentName.replace(/"/g, '""')}"`,
        `"${startTime.replace(/"/g, '""')}"`
      ].join(',');
      csv += csvRow + '\n';
    });
    
    return csv;
  };

  const downloadXML = () => {
    const xmlContent = generateXML(scheduleItems);
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${eventId || 'data'}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    const csvContent = generateCSV(scheduleItems);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${eventId || 'data'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyXML = () => {
    const xmlContent = generateXML(scheduleItems);
    copyToClipboard(xmlContent);
  };

  const copyCSV = () => {
    const csvContent = generateCSV(scheduleItems);
    copyToClipboard(csvContent);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading schedule data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Schedule XML Feed</h1>
          <p className="text-gray-400">
            Live XML data feed for VMIX integration with WebSocket updates
          </p>
          {eventId && (
            <p className="text-sm text-blue-400 mt-2">
              Event ID: {eventId}
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Refresh Interval (seconds)
              </label>
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2"
              >
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
              </select>
              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded font-medium"
              >
                {isLoading ? 'Loading...' : 'Refresh Now'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={downloadXML}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded font-medium"
              >
                Download XML
              </button>
              <button
                onClick={copyXML}
                className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded font-medium"
              >
                Copy XML
              </button>
              <button
                onClick={downloadCSV}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium"
              >
                Download CSV
              </button>
              <button
                onClick={copyCSV}
                className="bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded font-medium"
              >
                Copy CSV
              </button>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-3 h-3 rounded-full ${isLoading ? 'bg-yellow-500' : error ? 'bg-red-500' : 'bg-green-500'}`}></div>
              <span className="font-medium">
                {isLoading ? 'Loading...' : error ? 'Error' : 'Connected'}
              </span>
              {lastUpdated && (
                <span className="text-sm text-gray-400">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-400">
              Auto-refresh: {refreshInterval}s
            </div>
          </div>
          {error && (
            <div className="mt-2 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Tab Navigation */}
          <div className="bg-gray-800 rounded-lg">
            <div className="flex border-b border-gray-600">
              <button
                onClick={() => setActiveTab('preview')}
                className={`px-6 py-3 font-medium text-sm transition-colors ${
                  activeTab === 'preview'
                    ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-700'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                📄 XML Preview
              </button>
              <button
                onClick={() => setActiveTab('instructions')}
                className={`px-6 py-3 font-medium text-sm transition-colors ${
                  activeTab === 'instructions'
                    ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-700'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                🔧 VMIX Instructions
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-6">
              {activeTab === 'preview' && (
                <div>
                  <h2 className="text-xl font-bold mb-4">XML Preview</h2>
                  <div className="bg-gray-900 rounded p-4 overflow-auto max-h-96">
                    <pre className="text-sm text-green-400 whitespace-pre-wrap">
                      {generateXML(scheduleItems)}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === 'instructions' && (
                <div>
                  <h3 className="text-lg font-bold mb-4 text-blue-400">VMIX Integration Instructions</h3>
                  <div className="space-y-4 text-sm">
                    <div>
                      <h4 className="font-semibold text-blue-300 mb-2">1. XML Data Source URL:</h4>
                      <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                        <code className="text-green-400 break-all flex-1">
                          {getApiUrl()}/schedule.xml?eventId={eventId}
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${getApiUrl()}/schedule.xml?eventId=${eventId}`)}
                          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-blue-300 mb-2">2. CSV Data Source URL:</h4>
                      <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                        <code className="text-green-400 break-all flex-1">
                          {getApiUrl()}/schedule.csv?eventId={eventId}
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${getApiUrl()}/schedule.csv?eventId=${eventId}`)}
                          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-blue-300 mb-2">3. VMIX Setup:</h4>
                      <ul className="list-disc list-inside space-y-1 text-gray-300">
                        <li>Open VMIX and go to Data Sources</li>
                        <li>Add a new Data Source</li>
                        <li>Choose "XML" or "CSV" as the data type</li>
                        <li>Paste the URL above</li>
                        <li>Set refresh interval to 10 seconds</li>
                        <li>Click "Add" to create the data source</li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="font-semibold text-blue-300 mb-2">4. XPath for XML (if needed):</h4>
                      <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                        <code className="text-green-400">/data/schedule/item</code>
                        <button
                          onClick={() => copyToClipboard('/data/schedule/item')}
                          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded">
                      <p className="text-yellow-300 text-xs">
                        <strong>Environment:</strong> {isNetlify() ? 'Netlify (Production)' : 'Local Development'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
      </div>
    </div>
  );
};

export default ScheduleXMLPage;
