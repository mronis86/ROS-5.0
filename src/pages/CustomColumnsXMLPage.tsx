import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

interface CustomColumnItem {
  id: string;
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
}

interface Speaker {
  fullName: string;
  title: string;
  org: string;
  photoLink: string;
  slot: number;
}

interface CustomColumnEntry {
  id: string;
  segmentName: string;
  cue?: string;
  program?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  customFields?: Record<string, string>;
  speakers?: Array<{
    title: string;
    subtitle: string;
    photo: string;
  }>;
}

const isNetlify = () => {
  return window.location.hostname.includes('netlify.app') || 
         window.location.hostname.includes('netlify.com') ||
         window.location.hostname !== 'localhost';
};

const getApiUrl = () => {
  if (isNetlify()) {
    return `${window.location.origin}/.netlify/functions`;
  } else {
    return 'http://localhost:3002/api';
  }
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    console.log('Copied to clipboard:', text);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
};

const CustomColumnsXMLPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
  const [customColumns, setCustomColumns] = useState<CustomColumnEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'instructions'>('preview');
  const [refreshInterval, setRefreshInterval] = useState(10); // seconds

  const fetchCustomColumns = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!eventId) {
        throw new Error('Event ID is required');
      }

      console.log('📊 Fetching custom columns data for event:', eventId);

      // Use DatabaseService instead of direct Supabase calls
      const data = await DatabaseService.getRunOfShowData(eventId);

      if (!data || !data.schedule_items) {
        setCustomColumns([]);
        setLastUpdated(new Date());
        return;
      }

      const scheduleItems: CustomColumnItem[] = data.schedule_items;
      const customColumns = data.custom_columns || [];
      const customColumnsData: CustomColumnEntry[] = [];

      console.log('📊 Total custom column items:', scheduleItems.length);

      // Process all items (like Lower Thirds page does)
      // Get custom column names
      const customColumnNames = customColumns
        .filter(col => col.name)
        .map(col => col.name);

      scheduleItems.forEach((item, index) => {
        // Create a base entry for each item
        const baseEntry: CustomColumnEntry = {
          id: `${item.id}-custom`,
          row: index + 1, // Row number
          cue: item.customFields?.cue || 'CUE##', // Cue field with default
          customFields: item.customFields || {}
          // No speakers, program, startTime, endTime, duration for custom columns
        };
        
        customColumnsData.push(baseEntry);
      });

      console.log('📊 Processed custom column items:', customColumnsData.length);

      setCustomColumns(customColumnsData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching custom columns:', err);
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

    console.log('🔄 Setting up WebSocket connection for Custom Columns XML page');

    // Load initial data
    fetchCustomColumns();

    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Custom Columns XML: WebSocket data update received:', data);
        if (data && data.schedule_items) {
          // Process the updated data
          const scheduleItems: CustomColumnItem[] = data.schedule_items;
          const customColumns = data.custom_columns || [];
          const customColumnsData: CustomColumnEntry[] = [];

          // Process all items (like Lower Thirds page does)
          // Get custom column names
          const customColumnNames = customColumns
            .filter(col => col.name)
            .map(col => col.name);

          scheduleItems.forEach((item, index) => {
            const baseEntry: CustomColumnEntry = {
              id: `${item.id}-custom`,
              row: index + 1,
              cue: item.customFields?.cue || 'CUE##',
              customFields: item.customFields || {}
            };
            
            customColumnsData.push(baseEntry);
          });

          setCustomColumns(customColumnsData);
          setLastUpdated(new Date());
          console.log('✅ Custom Columns XML: Data updated via WebSocket');
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📡 Custom Columns XML: WebSocket connection status:', connected);
        if (connected) {
          // Reload data when reconnected
          fetchCustomColumns();
        }
      }
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      console.log('🔄 Custom Columns XML: Cleaning up WebSocket connection');
      socketClient.disconnect(eventId);
    };
  }, [eventId]);

  // Handle manual refresh
  const handleRefresh = () => {
    fetchCustomColumns();
  };

  const generateXML = (data: CustomColumnEntry[]): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId || 'unknown'}</event_id>
  <custom_columns>
    ${data.map(item => {
      // Generate custom fields dynamically (like Python script)
      const customFieldsXML = item.customFields ? Object.entries(item.customFields)
        .map(([key, value]) => `<${key}><![CDATA[${value || ''}]]></${key}>`)
        .join('') : '';
      
      return `
    <item>
      <id>${item.id}</id>
      <row>${item.row || data.indexOf(item) + 1}</row>
      <cue><![CDATA[${item.cue || ''}]]></cue>
      ${customFieldsXML}
    </item>`;
    }).join('')}
  </custom_columns>
</data>`;
    
    return xmlHeader + xmlContent;
  };

  const generateCSV = (data: CustomColumnEntry[]): string => {
    // Generate CSV header - Row, Cue, then custom columns (like Python script)
    let csv = 'Row,Cue,';
    
    // Add custom fields to header
    const allCustomFields = new Set<string>();
    data.forEach(item => {
      if (item.customFields) {
        Object.keys(item.customFields).forEach(key => allCustomFields.add(key));
      }
    });
    
    allCustomFields.forEach(field => {
      csv += `${field},`;
    });
    
    // Remove trailing comma and add newline
    csv = csv.slice(0, -1) + '\n';
    
    // Process each item
    data.forEach((item) => {
      const rowNumber = item.row || data.indexOf(item) + 1;
      const cue = item.cue || '';
      
      const csvRow = [
        rowNumber,
        `"${cue.replace(/"/g, '""')}"`,
        // Add custom fields
        ...Array.from(allCustomFields).map(field => 
          `"${(item.customFields?.[field] || '').replace(/"/g, '""')}"`
        )
      ].join(',');
      csv += csvRow + '\n';
    });
    
    return csv;
  };

  const downloadXML = () => {
    const xmlContent = generateXML(customColumns);
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-columns-${eventId || 'data'}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyXML = () => {
    const xmlContent = generateXML(customColumns);
    copyToClipboard(xmlContent);
  };

  const downloadCSV = () => {
    const csvContent = generateCSV(customColumns);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-columns-${eventId || 'data'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyCSV = () => {
    const csvContent = generateCSV(customColumns);
    copyToClipboard(csvContent);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg">Loading Custom Columns Data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4">Error Loading Data</h1>
          <p className="text-gray-300 mb-6">{error}</p>
          <button
            onClick={fetchCustomColumns}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Custom Columns XML Feed</h1>
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
                  Last updated: {lastUpdated.toLocaleString()}
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

        <div className="flex space-x-4 mb-6">
            <button
              className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                activeTab === 'preview'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              onClick={() => setActiveTab('preview')}
            >
              📄 XML Preview
            </button>
            <button
              className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                activeTab === 'instructions'
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              onClick={() => setActiveTab('instructions')}
            >
              🔧 VMIX Instructions
            </button>
        </div>

        {activeTab === 'preview' && (
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">XML Preview</h2>
              <div className="bg-gray-900 rounded p-4 overflow-auto max-h-96">
                <pre className="text-sm text-green-400 whitespace-pre-wrap">
                  {generateXML(customColumns)}
                </pre>
              </div>
              
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">XML Actions</h3>
                  <button
                    onClick={downloadXML}
                    className="w-full px-4 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                  >
                    📥 Download XML
                  </button>
                  <button
                    onClick={copyXML}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
                  >
                    📋 Copy XML
                  </button>
                </div>
                
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">CSV Actions</h3>
                  <button
                    onClick={downloadCSV}
                    className="w-full px-4 py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-medium rounded-lg transition-colors"
                  >
                    📥 Download CSV
                  </button>
                  <button
                    onClick={copyCSV}
                    className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-colors"
                  >
                    📋 Copy CSV
                  </button>
                </div>
              </div>
            </div>
        )}

        {activeTab === 'instructions' && (
            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-6">
              <h3 className="text-lg font-bold mb-4 text-blue-400">VMIX Integration Instructions</h3>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-md font-semibold mb-2 text-blue-300">XML Data Source URL:</h4>
                  <div className="bg-gray-800 rounded p-3 flex items-center space-x-2">
                    <code className="text-green-400 flex-1 text-sm">
                      {getApiUrl()}/custom-columns.xml?eventId={eventId || 'YOUR_EVENT_ID'}
                    </code>
                    <button
                      onClick={() => copyToClipboard(`${getApiUrl()}/custom-columns.xml?eventId=${eventId || 'YOUR_EVENT_ID'}`)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-md font-semibold mb-2 text-blue-300">CSV Data Source URL:</h4>
                  <div className="bg-gray-800 rounded p-3 flex items-center space-x-2">
                    <code className="text-green-400 flex-1 text-sm">
                      {getApiUrl()}/custom-columns.csv?eventId={eventId || 'YOUR_EVENT_ID'}
                    </code>
                    <button
                      onClick={() => copyToClipboard(`${getApiUrl()}/custom-columns.csv?eventId=${eventId || 'YOUR_EVENT_ID'}`)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                </div>


                <div className="bg-yellow-900/20 border border-yellow-500/30 rounded p-4">
                  <h4 className="text-md font-semibold mb-2 text-yellow-300">Environment:</h4>
                  <p className="text-yellow-200 text-sm">
                    {isNetlify() ? '🌐 Netlify Hosted' : '🏠 Local Development'}
                  </p>
                </div>

                <div className="bg-gray-800 rounded p-4">
                  <h4 className="text-md font-semibold mb-2 text-gray-300">VMIX Setup Steps:</h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
                    <li>Open VMIX and go to Data Sources</li>
                    <li>Click "Add Data Source" and select "XML" or "CSV"</li>
                    <li>Paste the URL above into the "URL" field</li>
                    <li>Set refresh interval to 10 seconds for live updates</li>
                    <li>Configure your graphics to use the data fields</li>
                    <li>Custom fields will be available as separate columns</li>
                  </ol>
                </div>
              </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default CustomColumnsXMLPage;
