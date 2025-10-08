import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';

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
      return 'http://localhost:3002';
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

      const { data, error: fetchError } = await supabase
        .from('run_of_show_data')
        .select('*')
        .eq('event_id', eventId)
        .single();

      if (fetchError) {
        throw new Error(`Database error: ${fetchError.message}`);
      }

      if (!data || !data.schedule_items) {
        setScheduleItems([]);
        setLastUpdated(new Date());
        return;
      }

      const scheduleItemsData: ScheduleItem[] = [];
      const items = data.schedule_items;
      const masterStartTime = data.settings?.masterStartTime || '';

      // Filter for public items only (like Python script)
      const publicItems = items.filter((item: any) => item.isPublic);

      publicItems.forEach((item: any, index: number) => {
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

      setScheduleItems(scheduleItemsData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching schedule data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchScheduleData();
    
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchScheduleData, 10000);
    return () => clearInterval(interval);
  }, [eventId]);

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
    // Generate CSV header - just Segment Name and Start Time like Python script
    let csv = 'Segment Name,Start Time\n';
    
    // Process each schedule item (one row per item)
    data.forEach((item) => {
      const segmentName = item.segmentName || '';
      const startTime = item.startTime || '';
      
      // Create CSV row
      const csvRow = [
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
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Schedule XML Feed</h1>
            <p className="text-gray-400">
              Live schedule data for VMIX integration
              {eventId && (
                <span className="ml-2 text-blue-400">
                  (Event: {eventId.slice(0, 8)}...)
                </span>
              )}
            </p>
            {lastUpdated && (
              <p className="text-sm text-gray-500 mt-1">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
              <p className="text-red-400">
                {error}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mb-8 flex flex-wrap gap-4">
            <button
              onClick={downloadXML}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              📄 Download XML
            </button>
            <button
              onClick={copyXML}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
            >
              📋 Copy XML
            </button>
            <button
              onClick={downloadCSV}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
            >
              📊 Download CSV
            </button>
            <button
              onClick={copyCSV}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition-colors"
            >
              📋 Copy CSV
            </button>
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
                          {getApiUrl()}/schedule-xml?eventId={eventId}
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${getApiUrl()}/schedule-xml?eventId=${eventId}`)}
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
                          {getApiUrl()}/schedule-csv?eventId={eventId}
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${getApiUrl()}/schedule-csv?eventId=${eventId}`)}
                          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-blue-300 mb-2">3. Alternative: Direct Links (Netlify Only):</h4>
                      <div className="space-y-2">
                        <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                          <code className="text-green-400 break-all flex-1">
                            {window.location.origin}/.netlify/functions/schedule-xml?eventId={eventId}
                          </code>
                          <button
                            onClick={() => copyToClipboard(`${window.location.origin}/.netlify/functions/schedule-xml?eventId=${eventId}`)}
                            className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                        <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                          <code className="text-green-400 break-all flex-1">
                            {window.location.origin}/.netlify/functions/schedule-csv?eventId={eventId}
                          </code>
                          <button
                            onClick={() => copyToClipboard(`${window.location.origin}/.netlify/functions/schedule-csv?eventId=${eventId}`)}
                            className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        💡 <strong>Tip:</strong> These direct Netlify Function URLs work immediately without any server setup!
                      </p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-blue-300 mb-2">4. VMIX Setup:</h4>
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
    </div>
  );
};

export default ScheduleXMLPage;
