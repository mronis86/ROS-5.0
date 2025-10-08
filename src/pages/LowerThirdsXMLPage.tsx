import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

interface Speaker {
  slot: number;
  fullName: string;
  title?: string;
  org?: string;
  photoLink?: string;
}

interface ScheduleItem {
  id: number;
  segmentName: string;
  programType: string;
  speakersText?: string;
  customFields?: {
    cue?: string;
  };
}

interface LowerThird {
  id: string;
  title: string;
  subtitle: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  segmentName: string;
  cue?: string;
  program?: string; // Added program field
  speakers?: Array<{
    title: string;
    subtitle: string;
    photo: string;
  }>; // Added speakers array for internal processing
}

const LowerThirdsXMLPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId');
  const [lowerThirds, setLowerThirds] = useState<LowerThird[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'instructions'>('preview');

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
      // You could add a toast notification here if desired
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
  const [refreshInterval, setRefreshInterval] = useState(10); // seconds

  // Generate XML content for VMIX
  const generateXML = (data: LowerThird[]): string => {
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId || 'unknown'}</event_id>
  <lower_thirds>
    ${data.map(item => {
      // Initialize speaker slots (7 speakers × 3 fields each = 21 fields)
      const speakers = new Array(21).fill('');
      
      // Parse speakers if available
      if (item.speakers && item.speakers.length > 0) {
        item.speakers.forEach((speaker, speakerIndex) => {
          if (speakerIndex < 7) { // Only first 7 speakers
            const baseIdx = speakerIndex * 3;
            speakers[baseIdx] = speaker.title || '';
            speakers[baseIdx + 1] = speaker.subtitle || '';
            speakers[baseIdx + 2] = speaker.photo || '';
          }
        });
      }
      
      return `
    <item>
      <id>${item.id}</id>
      <row>${data.indexOf(item) + 1}</row>
      <cue><![CDATA[${item.cue || ''}]]></cue>
      <program><![CDATA[${item.program || ''}]]></program>
      <segment_name><![CDATA[${item.segmentName || ''}]]></segment_name>
      <speaker_1_name><![CDATA[${speakers[0]}]]></speaker_1_name>
      <speaker_1_title_org><![CDATA[${speakers[1]}]]></speaker_1_title_org>
      <speaker_1_photo><![CDATA[${speakers[2]}]]></speaker_1_photo>
      <speaker_2_name><![CDATA[${speakers[3]}]]></speaker_2_name>
      <speaker_2_title_org><![CDATA[${speakers[4]}]]></speaker_2_title_org>
      <speaker_2_photo><![CDATA[${speakers[5]}]]></speaker_2_photo>
      <speaker_3_name><![CDATA[${speakers[6]}]]></speaker_3_name>
      <speaker_3_title_org><![CDATA[${speakers[7]}]]></speaker_3_title_org>
      <speaker_3_photo><![CDATA[${speakers[8]}]]></speaker_3_photo>
      <speaker_4_name><![CDATA[${speakers[9]}]]></speaker_4_name>
      <speaker_4_title_org><![CDATA[${speakers[10]}]]></speaker_4_title_org>
      <speaker_4_photo><![CDATA[${speakers[11]}]]></speaker_4_photo>
      <speaker_5_name><![CDATA[${speakers[12]}]]></speaker_5_name>
      <speaker_5_title_org><![CDATA[${speakers[13]}]]></speaker_5_title_org>
      <speaker_5_photo><![CDATA[${speakers[14]}]]></speaker_5_photo>
      <speaker_6_name><![CDATA[${speakers[15]}]]></speaker_6_name>
      <speaker_6_title_org><![CDATA[${speakers[16]}]]></speaker_6_title_org>
      <speaker_6_photo><![CDATA[${speakers[17]}]]></speaker_6_photo>
      <speaker_7_name><![CDATA[${speakers[18]}]]></speaker_7_name>
      <speaker_7_title_org><![CDATA[${speakers[19]}]]></speaker_7_title_org>
      <speaker_7_photo><![CDATA[${speakers[20]}]]></speaker_7_photo>
    </item>`;
    }).join('')}
  </lower_thirds>
</data>`;
    
    return xmlHeader + xmlContent;
  };

  // Fetch data using DatabaseService (replaces direct Supabase calls)
  const fetchLowerThirds = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (!eventId) {
        throw new Error('Event ID is required');
      }

      console.log('📊 Fetching lower thirds data for event:', eventId);

      // Use DatabaseService instead of direct Supabase calls
      const data = await DatabaseService.getRunOfShowData(eventId);

      if (!data || !data.schedule_items) {
        setLowerThirds([]);
        setLastUpdated(new Date());
        return;
      }

      // Process schedule items to extract speaker information
      const scheduleItems: ScheduleItem[] = data.schedule_items;
      const lowerThirdsData: LowerThird[] = [];

      scheduleItems.forEach((item, index) => {
        // Create a base entry for each schedule item (like server does)
        const baseEntry: LowerThird = {
          id: `${item.id}-row`,
          title: '',
          subtitle: '',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          segmentName: item.segmentName || '',
          cue: item.customFields?.cue || '',
          program: item.programType || '', // Program field
          speakers: [] // This property is added for internal processing, not directly in LowerThird interface
        };

        // Add speakers if available
        if (item.speakersText && item.speakersText.trim()) {
          try {
            const speakersArray: Speaker[] = JSON.parse(item.speakersText);
            const sortedSpeakers = speakersArray.sort((a, b) => a.slot - b.slot);

            baseEntry.speakers = sortedSpeakers.map(speaker => ({
              title: speaker.fullName || '',
              subtitle: speaker.title && speaker.org ? `${speaker.title}\n${speaker.org}` : speaker.title || speaker.org || '',
              photo: speaker.photoLink || ''
            }));
          } catch (error) {
            console.log('Error parsing speakers JSON for item:', item.id, error);
          }
        }
        
        lowerThirdsData.push(baseEntry);
      });

      setLowerThirds(lowerThirdsData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching lower thirds:', err);
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

    console.log('🔄 Setting up WebSocket connection for Lower Thirds XML page');

    // Load initial data
    fetchLowerThirds();

    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        console.log('📡 Lower Thirds XML: WebSocket data update received:', data);
        if (data && data.schedule_items) {
          // Process the updated data
          const scheduleItems: ScheduleItem[] = data.schedule_items;
          const lowerThirdsData: LowerThird[] = [];

          scheduleItems.forEach((item, index) => {
            const baseEntry: LowerThird = {
              id: `${item.id}-row`,
              title: '',
              subtitle: '',
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              segmentName: item.segmentName || '',
              cue: item.customFields?.cue || '',
              program: item.programType || '',
              speakers: []
            };

            // Add speakers if available
            if (item.speakersText && item.speakersText.trim()) {
              try {
                const speakersArray: Speaker[] = JSON.parse(item.speakersText);
                const sortedSpeakers = speakersArray.sort((a, b) => a.slot - b.slot);

                baseEntry.speakers = sortedSpeakers.map(speaker => ({
                  title: speaker.fullName || '',
                  subtitle: speaker.title && speaker.org ? `${speaker.title}\n${speaker.org}` : speaker.title || speaker.org || '',
                  photo: speaker.photoLink || ''
                }));
              } catch (error) {
                console.log('Error parsing speakers JSON for item:', item.id, error);
              }
            }
            
            lowerThirdsData.push(baseEntry);
          });

          setLowerThirds(lowerThirdsData);
          setLastUpdated(new Date());
          console.log('✅ Lower Thirds XML: Data updated via WebSocket');
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📡 Lower Thirds XML: WebSocket connection status:', connected);
        if (connected) {
          // Reload data when reconnected
          fetchLowerThirds();
        }
      }
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      console.log('🔄 Lower Thirds XML: Cleaning up WebSocket connection');
      socketClient.disconnect(eventId);
    };
  }, [eventId]);

  // Handle manual refresh
  const handleRefresh = () => {
    fetchLowerThirds();
  };

  // Download XML file
  const downloadXML = () => {
    const xmlContent = generateXML(lowerThirds);
    const blob = new Blob([xmlContent], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lower_thirds_${eventId || 'unknown'}_${Date.now()}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Copy XML to clipboard
  const copyXMLToClipboard = () => {
    const xmlContent = generateXML(lowerThirds);
    navigator.clipboard.writeText(xmlContent).then(() => {
      alert('XML content copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
      alert('Failed to copy to clipboard');
    });
  };

  // Generate CSV content matching the server version (one row per schedule item)
  const generateCSV = (data: LowerThird[]): string => {
    // Generate CSV header
    let csv = 'Row,Cue,Program,Segment Name,';
    csv += 'Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,';
    csv += 'Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,';
    csv += 'Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,';
    csv += 'Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,';
    csv += 'Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,';
    csv += 'Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,';
    csv += 'Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n';
    
    // Process each lower third item (one row per item) - include ALL items, even without speakers
    data.forEach((item, index) => {
      const rowNumber = index + 1;
      const cue = item.cue || '';
      const program = item.program || ''; // Program field
      const segmentName = item.segmentName || '';
      
      // Initialize speaker slots (7 speakers × 3 fields each = 21 fields)
      const speakers = new Array(21).fill('');
      
      // Parse speakers if available
      if (item.speakers && item.speakers.length > 0) {
        item.speakers.forEach((speaker, speakerIndex) => {
          if (speakerIndex < 7) { // Only first 7 speakers
            const baseIdx = speakerIndex * 3;
            speakers[baseIdx] = speaker.title || '';
            speakers[baseIdx + 1] = speaker.subtitle || '';
            speakers[baseIdx + 2] = speaker.photo || '';
          }
        });
      }
      
      // Create CSV row
      const csvRow = [
        rowNumber,
        `"${cue.replace(/"/g, '""')}"`,
        `"${program.replace(/"/g, '""')}"`,
        `"${segmentName.replace(/"/g, '""')}"`,
        `"${speakers[0].replace(/"/g, '""')}"`,   // Speaker 1 Name
        `"${speakers[1].replace(/"/g, '""')}"`,   // Speaker 1 Title/Org
        `"${speakers[2].replace(/"/g, '""')}"`,   // Speaker 1 Photo
        `"${speakers[3].replace(/"/g, '""')}"`,   // Speaker 2 Name
        `"${speakers[4].replace(/"/g, '""')}"`,   // Speaker 2 Title/Org
        `"${speakers[5].replace(/"/g, '""')}"`,   // Speaker 2 Photo
        `"${speakers[6].replace(/"/g, '""')}"`,   // Speaker 3 Name
        `"${speakers[7].replace(/"/g, '""')}"`,   // Speaker 3 Title/Org
        `"${speakers[8].replace(/"/g, '""')}"`,   // Speaker 3 Photo
        `"${speakers[9].replace(/"/g, '""')}"`,   // Speaker 4 Name
        `"${speakers[10].replace(/"/g, '""')}"`,  // Speaker 4 Title/Org
        `"${speakers[11].replace(/"/g, '""')}"`,  // Speaker 4 Photo
        `"${speakers[12].replace(/"/g, '""')}"`, // Speaker 5 Name
        `"${speakers[13].replace(/"/g, '""')}"`, // Speaker 5 Title/Org
        `"${speakers[14].replace(/"/g, '""')}"`, // Speaker 5 Photo
        `"${speakers[15].replace(/"/g, '""')}"`, // Speaker 6 Name
        `"${speakers[16].replace(/"/g, '""')}"`, // Speaker 6 Title/Org
        `"${speakers[17].replace(/"/g, '""')}"`, // Speaker 6 Photo
        `"${speakers[18].replace(/"/g, '""')}"`, // Speaker 7 Name
        `"${speakers[19].replace(/"/g, '""')}"`, // Speaker 7 Title/Org
        `"${speakers[20].replace(/"/g, '""')}"`  // Speaker 7 Photo
      ].join(',');
      csv += csvRow + '\n';
    });
    
    return csv;
  };

  // Download CSV file
  const downloadCSV = () => {
    const csvContent = generateCSV(lowerThirds);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lower_thirds_${eventId || 'unknown'}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Copy CSV to clipboard
  const copyCSVToClipboard = () => {
    const csvContent = generateCSV(lowerThirds);
    navigator.clipboard.writeText(csvContent).then(() => {
      alert('CSV content copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
      alert('Failed to copy to clipboard');
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Lower Thirds XML Feed</h1>
          <p className="text-gray-400">
            Live XML data feed for VMIX integration with Supabase backend
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
                onClick={copyXMLToClipboard}
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
                onClick={copyCSVToClipboard}
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
                    {generateXML(lowerThirds)}
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
                        {getApiUrl()}/lower-thirds.xml?eventId={eventId}
                      </code>
                      <button
                        onClick={() => copyToClipboard(`${getApiUrl()}/lower-thirds.xml?eventId=${eventId}`)}
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
                        {getApiUrl()}/lower-thirds.csv?eventId={eventId}
                      </code>
                      <button
                        onClick={() => copyToClipboard(`${getApiUrl()}/lower-thirds.csv?eventId=${eventId}`)}
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
                          {window.location.origin}/.netlify/functions/lower-thirds-xml?eventId={eventId}
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${window.location.origin}/.netlify/functions/lower-thirds-xml?eventId=${eventId}`)}
                          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                      <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                        <code className="text-green-400 break-all flex-1">
                          {window.location.origin}/.netlify/functions/lower-thirds-csv?eventId={eventId}
                        </code>
                        <button
                          onClick={() => copyToClipboard(`${window.location.origin}/.netlify/functions/lower-thirds-csv?eventId=${eventId}`)}
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
                      <li>Paste one of the URLs above</li>
                      <li>Set refresh interval to 10 seconds</li>
                      <li>Click "Add" to create the data source</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-blue-300 mb-2">5. XPath for XML (if needed):</h4>
                    <div className="bg-gray-800 p-3 rounded border flex items-center justify-between">
                      <code className="text-green-400">/data/lower_thirds/item</code>
                      <button
                        onClick={() => copyToClipboard('/data/lower_thirds/item')}
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

export default LowerThirdsXMLPage;
