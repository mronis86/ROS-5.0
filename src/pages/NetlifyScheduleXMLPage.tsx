import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

interface ScheduleItem {
  id: string;
  segmentName: string;
  startTime: string;
}

const NetlifyScheduleXMLPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
  const [xmlData, setXmlData] = useState<string>('');
  const [csvData, setCsvData] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'xml' | 'csv' | 'instructions'>('xml');

  // Railway API URL (always use Railway for Netlify deployment)
  const RAILWAY_API_URL = 'https://ros-50-production.up.railway.app/api';

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy:', err);
    }
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
      <segment_name><![CDATA[${item.segmentName}]]></segment_name>
      <start_time><![CDATA[${item.startTime}]]></start_time>
    </item>`).join('')}
  </schedule>
</data>`;
    return xmlHeader + xmlContent;
  };

  const generateCSV = (data: ScheduleItem[]): string => {
    let csv = 'Row,Segment Name,Start Time\n';
    
    data.forEach((item, index) => {
      const escapeCsv = (str: string) => `"${str.replace(/"/g, '""')}"`;
      csv += `${index + 1},${escapeCsv(item.segmentName)},${escapeCsv(item.startTime)}\n`;
    });
    
    return csv;
  };

  const fetchData = async () => {
    if (!eventId) {
      setError('Event ID is required');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Fetch from Railway API
      const response = await fetch(`${RAILWAY_API_URL}/run-of-show-data/${eventId}`);
      if (!response.ok) throw new Error('Failed to fetch data from Railway');
      
      const runOfShowData = await response.json();
      
      if (!runOfShowData || !runOfShowData.schedule_items) {
        throw new Error('No schedule items found');
      }

      // Process all schedule items
      const scheduleItems = runOfShowData.schedule_items;
      const scheduleData: ScheduleItem[] = [];
      
      // Calculate start times - check multiple sources for master start time
      let masterStartTime = '';
      
      // Check for master start time in different locations (same as ReportsPage)
      if (runOfShowData.settings?.masterStartTime) {
        masterStartTime = runOfShowData.settings.masterStartTime;
      } else if (runOfShowData.settings?.dayStartTimes?.['1']) {
        masterStartTime = runOfShowData.settings.dayStartTimes['1'];
      } else if (runOfShowData.schedule_items && runOfShowData.schedule_items.length > 0) {
        // Check if the first item has a start time that might be the master start time
        const firstItem = runOfShowData.schedule_items[0];
        if (firstItem.startTime) {
          masterStartTime = firstItem.startTime;
        }
      }
      
      // Fallback to 09:00 if no master start time found
      if (!masterStartTime) {
        masterStartTime = '09:00';
        console.log('⚠️ NetlifyScheduleXML: No master start time found, using fallback 09:00');
      } else {
        console.log('✅ NetlifyScheduleXML: Master start time from API:', masterStartTime);
      }
      
      const [hours, minutes] = masterStartTime.split(':').map(Number);
      
      scheduleItems.forEach((item: any, index: number) => {
        // Calculate total minutes from start
        let totalMinutes = 0;
        for (let i = 0; i < index; i++) {
          const prevItem = scheduleItems[i];
          totalMinutes += (prevItem.durationHours || 0) * 60 + (prevItem.durationMinutes || 0);
        }
        
        const startDate = new Date();
        startDate.setHours(hours, minutes + totalMinutes, 0, 0);
        const startTime = startDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });

        scheduleData.push({
          id: String(item.id),
          segmentName: item.segmentName || 'Untitled Segment',
          startTime: startTime
        });
      });

      // Generate XML and CSV
      setXmlData(generateXML(scheduleData));
      setCsvData(generateCSV(scheduleData));
      setLastUpdated(new Date());
      setIsLoading(false);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 20 seconds
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, [eventId]);

  if (!eventId) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">⚠️ Event ID Required</h1>
          <p>Please provide an eventId parameter in the URL.</p>
          <p className="mt-2 text-gray-400">Example: ?eventId=your-event-id</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">📅 Schedule - Railway Edition</h1>
          <p className="text-gray-400">
            Event ID: <span className="text-blue-400">{eventId}</span>
          </p>
          {lastUpdated && (
            <p className="text-sm text-gray-500">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-2 mb-6">
          <button
            onClick={() => setActiveTab('xml')}
            className={`px-4 py-2 rounded-t ${
              activeTab === 'xml'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            XML Preview
          </button>
          <button
            onClick={() => setActiveTab('csv')}
            className={`px-4 py-2 rounded-t ${
              activeTab === 'csv'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            CSV Preview
          </button>
          <button
            onClick={() => setActiveTab('instructions')}
            className={`px-4 py-2 rounded-t ${
              activeTab === 'instructions'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            VMIX Instructions
          </button>
        </div>

        {/* Content */}
        <div className="bg-gray-800 rounded-lg p-6">
          {isLoading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              <p className="mt-4 text-gray-400">Loading data...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/50 border border-red-500 rounded p-4 mb-4">
              <p className="text-red-200">❌ Error: {error}</p>
            </div>
          )}

          {!isLoading && !error && (
            <>
              {activeTab === 'xml' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">XML Data</h2>
                    <button
                      onClick={() => copyToClipboard(xmlData)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                    >
                      Copy XML
                    </button>
                  </div>
                  <pre className="bg-gray-900 p-4 rounded overflow-auto max-h-96 text-sm">
                    <code className="text-green-400">{xmlData}</code>
                  </pre>
                  <p className="mt-2 text-sm text-gray-400">
                    Data length: {xmlData.length} characters
                  </p>
                </div>
              )}

              {activeTab === 'csv' && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">CSV Data</h2>
                    <button
                      onClick={() => copyToClipboard(csvData)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                    >
                      Copy CSV
                    </button>
                  </div>
                  <pre className="bg-gray-900 p-4 rounded overflow-auto max-h-96 text-sm">
                    <code className="text-green-400">{csvData}</code>
                  </pre>
                  <p className="mt-2 text-sm text-gray-400">
                    Data length: {csvData.length} characters
                  </p>
                </div>
              )}

              {activeTab === 'instructions' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold mb-4 text-blue-300">
                      🎬 VMIX Integration Instructions
                    </h2>
                    <p className="text-gray-300 mb-4">
                      Use these URLs in VMIX to display live schedule data from Railway API.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-orange-900/30 border border-orange-500/50 rounded p-4">
                      <h3 className="font-semibold text-orange-300 mb-2">🚧 Netlify Functions (IN DEVELOPMENT)</h3>
                      <p className="text-xs text-gray-400 mb-3">
                        These Netlify Function URLs are still being developed and may not work correctly yet.
                      </p>

                      <div className="space-y-3">
                        <div>
                          <h4 className="font-semibold text-purple-300 mb-2 text-sm">🎬 VMIX XML URL (Netlify Function):</h4>
                          <div className="bg-gray-900 p-3 rounded border border-purple-500 flex items-center justify-between">
                            <code className="text-purple-400 break-all flex-1 text-sm">
                              {window.location.origin}/.netlify/functions/vmix-schedule-xml?eventId=${eventId}
                            </code>
                            <button
                              onClick={() => copyToClipboard(`${window.location.origin}/.netlify/functions/vmix-schedule-xml?eventId=${eventId}`)}
                              className="ml-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                          <p className="text-xs text-orange-400 mt-1">
                            🚧 IN DEVELOPMENT: May not work correctly yet
                          </p>
                        </div>

                        <div>
                          <h4 className="font-semibold text-purple-300 mb-2 text-sm">🎬 VMIX CSV URL (Netlify Function):</h4>
                          <div className="bg-gray-900 p-3 rounded border border-purple-500 flex items-center justify-between">
                            <code className="text-purple-400 break-all flex-1 text-sm">
                              {window.location.origin}/.netlify/functions/vmix-schedule-csv?eventId=${eventId}
                            </code>
                            <button
                              onClick={() => copyToClipboard(`${window.location.origin}/.netlify/functions/vmix-schedule-csv?eventId=${eventId}`)}
                              className="ml-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                          <p className="text-xs text-orange-400 mt-1">
                            🚧 IN DEVELOPMENT: May not work correctly yet
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-green-900/30 border border-green-500/50 rounded p-4">
                      <h3 className="font-semibold text-green-300 mb-2">✅ Direct Railway API (WORKING NOW)</h3>
                      <p className="text-xs text-gray-400 mb-2">
                        These URLs work reliably! Use them while Netlify Functions are in development.
                      </p>

                      <div className="space-y-3 mt-3">
                        <div>
                          <h4 className="font-semibold text-blue-300 mb-2 text-sm">XML Data Source URL (Railway):</h4>
                          <div className="bg-gray-900 p-3 rounded border border-gray-700 flex items-center justify-between">
                            <code className="text-green-400 break-all flex-1 text-sm">
                              {RAILWAY_API_URL}/schedule.xml?eventId=${eventId}
                            </code>
                            <button
                              onClick={() => copyToClipboard(`${RAILWAY_API_URL}/schedule.xml?eventId=${eventId}`)}
                              className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            ✅ Works from anywhere • Always online • Production ready
                          </p>
                        </div>

                        <div>
                          <h4 className="font-semibold text-blue-300 mb-2 text-sm">CSV Data Source URL (Railway):</h4>
                          <div className="bg-gray-900 p-3 rounded border border-gray-700 flex items-center justify-between">
                            <code className="text-green-400 break-all flex-1 text-sm">
                              {RAILWAY_API_URL}/schedule.csv?eventId=${eventId}
                            </code>
                            <button
                              onClick={() => copyToClipboard(`${RAILWAY_API_URL}/schedule.csv?eventId=${eventId}`)}
                              className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Higher egress cost
                          </p>
                        </div>
                        
                        <div className="mt-6 pt-6 border-t border-purple-500/30">
                          <h4 className="font-semibold text-purple-300 mb-3 text-base flex items-center gap-2">
                            ⚡ Upstash Cached URLs (Recommended for vMix/Singular.Live)
                            <span className="text-xs font-normal text-purple-400">Zero database cost!</span>
                          </h4>
                          
                          <div className="space-y-3">
                            <div>
                              <h5 className="font-semibold text-purple-200 mb-2 text-sm">XML (Upstash Cache):</h5>
                              <div className="bg-gray-900 p-3 rounded border border-purple-500/30 flex items-center justify-between">
                                <code className="text-purple-300 break-all flex-1 text-sm">
                                  {RAILWAY_API_URL}/cache/schedule.xml?eventId=${eventId}
                                </code>
                                <button
                                  onClick={() => copyToClipboard(`${RAILWAY_API_URL}/cache/schedule.xml?eventId=${eventId}`)}
                                  className="ml-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded transition-colors"
                                >
                                  Copy
                                </button>
                              </div>
                              <p className="text-purple-400 text-xs mt-1">
                                ⚡ Ultra-fast • Zero Neon queries • Auto-updates on schedule save
                              </p>
                            </div>
                            
                            <div>
                              <h5 className="font-semibold text-purple-200 mb-2 text-sm">CSV (Upstash Cache):</h5>
                              <div className="bg-gray-900 p-3 rounded border border-purple-500/30 flex items-center justify-between">
                                <code className="text-purple-300 break-all flex-1 text-sm">
                                  {RAILWAY_API_URL}/cache/schedule.csv?eventId=${eventId}
                                </code>
                                <button
                                  onClick={() => copyToClipboard(`${RAILWAY_API_URL}/cache/schedule.csv?eventId=${eventId}`)}
                                  className="ml-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded transition-colors"
                                >
                                  Copy
                                </button>
                              </div>
                              <p className="text-purple-400 text-xs mt-1">
                                ⚡ Ultra-fast • Zero Neon queries • Auto-updates on schedule save
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-700/50 border border-gray-600 rounded p-4">
                      <h3 className="font-semibold text-gray-300 mb-2">Alternative: Local Development</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="text-gray-400 mb-1">XML:</p>
                          <code className="text-gray-500 text-xs">http://localhost:3002/api/schedule.xml?eventId=${eventId}</code>
                        </div>
                        <div>
                          <p className="text-gray-400 mb-1">CSV:</p>
                          <code className="text-gray-500 text-xs">http://localhost:3002/api/schedule.csv?eventId=${eventId}</code>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          (Only works when local server is running)
                        </p>
                      </div>
                    </div>

                    <div className="bg-blue-900/30 border border-blue-500/50 rounded p-4">
                      <h3 className="font-semibold text-blue-300 mb-2">📝 How to use in VMIX:</h3>
                      <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
                        <li>Open VMIX and go to <strong>Settings → Data Sources</strong></li>
                        <li>Click <strong>Add</strong> to create a new data source</li>
                        <li>Choose <strong>XML</strong> or <strong>CSV</strong> as the type</li>
                        <li>Paste one of the Railway API URLs above (yellow section)</li>
                        <li>Set refresh interval to <strong>20 seconds</strong></li>
                        <li>Click <strong>OK</strong> to save</li>
                        <li>Use the data fields in your VMIX titles/overlays</li>
                      </ol>
                    </div>

                    <div className="bg-blue-900/30 border border-blue-500/50 rounded p-4">
                      <h3 className="font-semibold text-blue-300 mb-2">ℹ️ Why Railway API?</h3>
                      <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
                        <li>Always running (not serverless)</li>
                        <li>Reliable and fast</li>
                        <li>Direct database connection</li>
                        <li>Real-time updates</li>
                        <li>Works from anywhere (not just localhost)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Refresh Button */}
        <div className="mt-6 text-center">
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-lg transition-colors"
          >
            {isLoading ? 'Refreshing...' : '🔄 Refresh Data'}
          </button>
          <p className="mt-2 text-sm text-gray-500">
            Data auto-refreshes every 20 seconds
          </p>
        </div>
      </div>
    </div>
  );
};

export default NetlifyScheduleXMLPage;
