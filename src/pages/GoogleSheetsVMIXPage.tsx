import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../services/database';

interface VMIXLowerThird {
  id: string;
  cue: string;
  program: string;
  segmentName: string;
  speakers: Array<{
    name: string;
    title: string;
    photo: string;
  }>;
}

interface VMIXScheduleItem {
  id: string;
  segmentName: string;
  startTime: string;
}

interface VMIXCustomColumn {
  id: string;
  cue: string;
  customFields: Record<string, string>;
}

type DataType = 'lower-thirds' | 'schedule' | 'custom-columns';

const GoogleSheetsVMIXPage: React.FC = () => {
  const [dataType, setDataType] = useState<DataType>('lower-thirds');
  const [webAppUrl, setWebAppUrl] = useState('');
  const [targetSheetName, setTargetSheetName] = useState('Sheet1');
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [lowerThirds, setLowerThirds] = useState<VMIXLowerThird[]>([]);
  const [scheduleItems, setScheduleItems] = useState<VMIXScheduleItem[]>([]);
  const [customColumns, setCustomColumns] = useState<VMIXCustomColumn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [eventId, setEventId] = useState<string>('');
  const [showAllItems, setShowAllItems] = useState<boolean>(false);

  // Load event ID from URL or localStorage
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlEventId = urlParams.get('eventId');
    if (urlEventId) {
      setEventId(urlEventId);
    } else {
      const storedEvents = localStorage.getItem('events');
      if (storedEvents) {
        try {
          const events = JSON.parse(storedEvents);
          if (events.length > 0) {
            setEventId(events[0].id);
          }
        } catch (e) {
          console.error('Error parsing stored events:', e);
        }
      }
    }
  }, []);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefreshEnabled || !eventId || !webAppUrl) return;

    const loadAndPush = async () => {
      try {
        const runOfShowData = await DatabaseService.getRunOfShowData(eventId);
        if (!runOfShowData || !runOfShowData.schedule_items) return;

        // Filter items based on toggle setting
        const filteredItems = showAllItems 
          ? runOfShowData.schedule_items 
          : runOfShowData.schedule_items.filter((item: any) => item.isPublic === true);
        
        // Debug logging to help troubleshoot missing rows
        console.log('🔍 GoogleSheetsVMIX: Total schedule items:', runOfShowData.schedule_items.length);
        console.log('🔍 GoogleSheetsVMIX: Show all items toggle:', showAllItems);
        console.log('🔍 GoogleSheetsVMIX: Filtered items found:', filteredItems.length);
        
        if (!showAllItems) {
          console.log('🔍 GoogleSheetsVMIX: Public items found:', filteredItems.length);
          console.log('🔍 GoogleSheetsVMIX: Non-public items:', runOfShowData.schedule_items.filter((item: any) => item.isPublic !== true).length);
          
          // Log some examples of non-public items for debugging
          const nonPublicItems = runOfShowData.schedule_items.filter((item: any) => item.isPublic !== true);
          if (nonPublicItems.length > 0) {
            console.log('🔍 GoogleSheetsVMIX: Examples of non-public items:', nonPublicItems.slice(0, 3).map(item => ({
              id: item.id,
              segmentName: item.segmentName,
              isPublic: item.isPublic,
              cue: item.customFields?.cue
            })));
          }
        }
        
        let data: any[][] = [];
        let headers: string[] = [];

        if (dataType === 'lower-thirds') {
          const lowerThirdsData: VMIXLowerThird[] = [];
          
          filteredItems.forEach((item: any) => {
            const speakers: Array<{ name: string; title: string; photo: string }> = [];
            
            if (item.speakersText) {
              try {
                const speakersArray = typeof item.speakersText === 'string' 
                  ? JSON.parse(item.speakersText) 
                  : item.speakersText;
                
                if (Array.isArray(speakersArray)) {
                  speakersArray.forEach((speaker: any) => {
                    speakers.push({
                      name: speaker.fullName || speaker.name || '',
                      title: [speaker.title, speaker.org].filter(Boolean).join(', '),
                      photo: speaker.photoLink || ''
                    });
                  });
                }
              } catch (e) {
                console.error('Error parsing speakers:', e);
              }
            }

            lowerThirdsData.push({
              id: String(item.id),
              cue: item.customFields?.cue || '',
              program: item.programType || '',
              segmentName: item.segmentName || '',
              speakers
            });
          });

          setLowerThirds(lowerThirdsData);

          if (lowerThirdsData.length > 0) {
            data = lowerThirdsData.map((item, index) => {
              const speakers = new Array(21).fill('');
              if (item.speakers && item.speakers.length > 0) {
                item.speakers.forEach((speaker, speakerIndex) => {
                  if (speakerIndex < 7) {
                    const baseIdx = speakerIndex * 3;
                    speakers[baseIdx] = speaker.name || '';
                    speakers[baseIdx + 1] = speaker.title || '';
                    speakers[baseIdx + 2] = speaker.photo || '';
                  }
                });
              }
              return [
                String(index + 1),
                item.cue,
                item.program,
                item.segmentName,
                ...speakers
              ];
            });

            headers = [
              'Row', 'Cue', 'Program', 'Segment Name',
              'Speaker 1 Name', 'Speaker 1 Title/Org', 'Speaker 1 Photo',
              'Speaker 2 Name', 'Speaker 2 Title/Org', 'Speaker 2 Photo',
              'Speaker 3 Name', 'Speaker 3 Title/Org', 'Speaker 3 Photo',
              'Speaker 4 Name', 'Speaker 4 Title/Org', 'Speaker 4 Photo',
              'Speaker 5 Name', 'Speaker 5 Title/Org', 'Speaker 5 Photo',
              'Speaker 6 Name', 'Speaker 6 Title/Org', 'Speaker 6 Photo',
              'Speaker 7 Name', 'Speaker 7 Title/Org', 'Speaker 7 Photo'
            ];
          }
        } else if (dataType === 'schedule') {
          const scheduleData: VMIXScheduleItem[] = [];
          
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
            console.log('⚠️ GoogleSheetsVMIX: No master start time found, using fallback 09:00');
          } else {
            console.log('✅ GoogleSheetsVMIX: Master start time from API:', masterStartTime);
          }
          
          const [hours, minutes] = masterStartTime.split(':').map(Number);
          
          filteredItems.forEach((item: any, index: number) => {
            // Calculate total minutes from start
            let totalMinutes = 0;
            for (let i = 0; i < index; i++) {
              const prevItem = publicItems[i];
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

          setScheduleItems(scheduleData);

          if (scheduleData.length > 0) {
            data = scheduleData.map((item, index) => [
              String(index + 1),
              item.segmentName,
              item.startTime
            ]);

            headers = ['Row', 'Segment Name', 'Start Time'];
          }
        } else if (dataType === 'custom-columns') {
          const customColumnsData: VMIXCustomColumn[] = [];
          
          filteredItems.forEach((item: any, index: number) => {
            customColumnsData.push({
              id: String(item.id),
              cue: item.customFields?.cue || '',
              customFields: item.customFields || {}
            });
          });

          setCustomColumns(customColumnsData);

          if (customColumnsData.length > 0) {
            // Get all unique custom field keys
            const allCustomKeys = new Set<string>();
            customColumnsData.forEach(item => {
              Object.keys(item.customFields || {}).forEach(key => allCustomKeys.add(key));
            });

            data = customColumnsData.map((item, index) => {
              const row = [String(index + 1), item.cue];
              allCustomKeys.forEach(key => {
                row.push(item.customFields?.[key] || '');
              });
              return row;
            });

            headers = ['Row', 'Cue', ...Array.from(allCustomKeys)];
          }
        }

        // Push to Google Sheets
        if (data.length > 0) {
          await fetch(webAppUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
              data: [headers, ...data],
              sheetName: targetSheetName 
            })
          });

          setLastUpdated(new Date());
        }
      } catch (error) {
        console.error('Auto-refresh error:', error);
      }
    };

    // Initial load and push
    loadAndPush();

    // Set up interval
    const intervalId = setInterval(loadAndPush, refreshInterval * 1000);

    return () => clearInterval(intervalId);
  }, [autoRefreshEnabled, eventId, webAppUrl, refreshInterval, targetSheetName, dataType]);

  // Load data based on selected type
  const loadData = async () => {
    if (!eventId) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      const runOfShowData = await DatabaseService.getRunOfShowData(eventId);
      if (!runOfShowData || !runOfShowData.schedule_items) {
        throw new Error('No schedule items found');
      }

      // Filter items based on toggle setting
      const filteredItems = showAllItems 
        ? runOfShowData.schedule_items 
        : runOfShowData.schedule_items.filter((item: any) => item.isPublic === true);
      
      // Debug logging to help troubleshoot missing rows
      console.log('🔍 GoogleSheetsVMIX (Manual Load): Total schedule items:', runOfShowData.schedule_items.length);
      console.log('🔍 GoogleSheetsVMIX (Manual Load): Show all items toggle:', showAllItems);
      console.log('🔍 GoogleSheetsVMIX (Manual Load): Filtered items found:', filteredItems.length);
      
      if (!showAllItems) {
        console.log('🔍 GoogleSheetsVMIX (Manual Load): Public items found:', filteredItems.length);
        console.log('🔍 GoogleSheetsVMIX (Manual Load): Non-public items:', runOfShowData.schedule_items.filter((item: any) => item.isPublic !== true).length);
        
        // Log some examples of non-public items for debugging
        const nonPublicItems = runOfShowData.schedule_items.filter((item: any) => item.isPublic !== true);
        if (nonPublicItems.length > 0) {
          console.log('🔍 GoogleSheetsVMIX (Manual Load): Examples of non-public items:', nonPublicItems.slice(0, 3).map(item => ({
            id: item.id,
            segmentName: item.segmentName,
            isPublic: item.isPublic,
            cue: item.customFields?.cue
          })));
        }
      }

      if (dataType === 'lower-thirds') {
        const lowerThirdsData: VMIXLowerThird[] = [];
        
        filteredItems.forEach((item: any) => {
          const speakers: Array<{ name: string; title: string; photo: string }> = [];
          
          if (item.speakersText) {
            try {
              const speakersArray = typeof item.speakersText === 'string' 
                ? JSON.parse(item.speakersText) 
                : item.speakersText;
              
              if (Array.isArray(speakersArray)) {
                speakersArray.forEach((speaker: any) => {
                  speakers.push({
                    name: speaker.fullName || speaker.name || '',
                    title: [speaker.title, speaker.org].filter(Boolean).join(', '),
                    photo: speaker.photoLink || ''
                  });
                });
              }
            } catch (e) {
              console.error('Error parsing speakers:', e);
            }
          }

          lowerThirdsData.push({
            id: String(item.id),
            cue: item.customFields?.cue || '',
            program: item.programType || '',
            segmentName: item.segmentName || '',
            speakers
          });
        });

        setLowerThirds(lowerThirdsData);
      } else if (dataType === 'schedule') {
        const scheduleData: VMIXScheduleItem[] = [];
        
        // Calculate start times
        const masterStartTime = runOfShowData.settings?.masterStartTime || '09:00';
        const [hours, minutes] = masterStartTime.split(':').map(Number);
        
        filteredItems.forEach((item: any, index: number) => {
          // Calculate total minutes from start
          let totalMinutes = 0;
          for (let i = 0; i < index; i++) {
            const prevItem = publicItems[i];
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

        setScheduleItems(scheduleData);
      } else if (dataType === 'custom-columns') {
        const customColumnsData: VMIXCustomColumn[] = [];
        
        filteredItems.forEach((item: any) => {
          customColumnsData.push({
            id: String(item.id),
            cue: item.customFields?.cue || '',
            customFields: item.customFields || {}
          });
        });

        setCustomColumns(customColumnsData);
      }

      setIsLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data');
      setIsLoading(false);
    }
  };

  // Generate CSV data based on data type
  const generateCSV = (): string[][] => {
    if (dataType === 'lower-thirds') {
      const headers = [
        'Row', 'Cue', 'Program', 'Segment Name',
        'Speaker 1 Name', 'Speaker 1 Title/Org', 'Speaker 1 Photo',
        'Speaker 2 Name', 'Speaker 2 Title/Org', 'Speaker 2 Photo',
        'Speaker 3 Name', 'Speaker 3 Title/Org', 'Speaker 3 Photo',
        'Speaker 4 Name', 'Speaker 4 Title/Org', 'Speaker 4 Photo',
        'Speaker 5 Name', 'Speaker 5 Title/Org', 'Speaker 5 Photo',
        'Speaker 6 Name', 'Speaker 6 Title/Org', 'Speaker 6 Photo',
        'Speaker 7 Name', 'Speaker 7 Title/Org', 'Speaker 7 Photo'
      ];

      const rows = lowerThirds.map((item, index) => {
        const speakers = new Array(21).fill('');
        if (item.speakers && item.speakers.length > 0) {
          item.speakers.forEach((speaker, speakerIndex) => {
            if (speakerIndex < 7) {
              const baseIdx = speakerIndex * 3;
              speakers[baseIdx] = speaker.name || '';
              speakers[baseIdx + 1] = speaker.title || '';
              speakers[baseIdx + 2] = speaker.photo || '';
            }
          });
        }

        return [
          String(index + 1),
          item.cue,
          item.program,
          item.segmentName,
          ...speakers
        ];
      });

      return [headers, ...rows];
    } else if (dataType === 'schedule') {
      const headers = ['Row', 'Segment Name', 'Start Time'];
      const rows = scheduleItems.map((item, index) => [
        String(index + 1),
        item.segmentName,
        item.startTime
      ]);
      return [headers, ...rows];
    } else if (dataType === 'custom-columns') {
      // Get all unique custom field keys
      const allCustomKeys = new Set<string>();
      customColumns.forEach(item => {
        Object.keys(item.customFields || {}).forEach(key => allCustomKeys.add(key));
      });

      const headers = ['Row', 'Cue', ...Array.from(allCustomKeys)];
      const rows = customColumns.map((item, index) => {
        const row = [String(index + 1), item.cue];
        allCustomKeys.forEach(key => {
          row.push(item.customFields?.[key] || '');
        });
        return row;
      });

      return [headers, ...rows];
    }

    return [];
  };

  // Push to Google Sheets via Apps Script
  const pushToGoogleSheets = async (silent = false) => {
    if (!webAppUrl) {
      if (!silent) setError('Please enter your Google Apps Script Web App URL');
      return;
    }

    // Check if we have data for the selected type
    const hasData = (dataType === 'lower-thirds' && lowerThirds.length > 0) ||
                    (dataType === 'schedule' && scheduleItems.length > 0) ||
                    (dataType === 'custom-columns' && customColumns.length > 0);

    if (!hasData) {
      if (!silent) setError('No data available. Please load data first.');
      return;
    }

    try {
      if (!silent) setIsLoading(true);
      setError(null);
      
      const data = generateCSV();
      
      const response = await fetch(webAppUrl, {
        method: 'POST',
        mode: 'no-cors', // Google Apps Script requires this
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          data,
          sheetName: targetSheetName 
        })
      });

      // Note: With no-cors mode, we can't read the response
      // Assume success if no error was thrown
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error pushing to Google Sheets:', err);
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to push to Google Sheets');
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const appsScriptCode = `function doPost(e) {
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    
    // Get target sheet name (default to active sheet)
    var sheetName = data.sheetName || 'Sheet1';
    var sheet = spreadsheet.getSheetByName(sheetName);
    
    // If sheet doesn't exist, create it
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }
    
    // Clear existing data
    sheet.clear();
    
    // Write new data
    if (data.data && data.data.length > 0) {
      sheet.getRange(1, 1, data.data.length, data.data[0].length).setValues(data.data);
      
      // Format header row
      var headerRange = sheet.getRange(1, 1, 1, data.data[0].length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285f4');
      headerRange.setFontColor('#ffffff');
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      rows: data.data.length,
      sheet: sheetName
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Export to Google Sheets</h1>
          <p className="text-gray-400">
            Push Lower Thirds, Schedule, or Custom Columns data directly to a Google Sheet
          </p>
        </div>

        {/* Setup Instructions */}
        <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-6 mb-6">
          <h3 className="font-semibold text-blue-300 mb-3">📋 One-Time Setup (5 minutes):</h3>
          <ol className="text-sm text-gray-300 space-y-3">
            <li className="flex gap-3">
              <span className="font-bold text-blue-400 min-w-[24px]">1.</span>
              <div>
                <strong>Create a Google Sheet</strong>
                <br/>Go to <a href="https://sheets.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">sheets.google.com</a> and create a new spreadsheet
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-400 min-w-[24px]">2.</span>
              <div>
                <strong>Open Apps Script Editor</strong>
                <br/>In your Google Sheet, click <strong>Extensions → Apps Script</strong>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-400 min-w-[24px]">3.</span>
              <div>
                <strong>Paste the Script</strong>
                <br/>Copy the script below and paste it into the Apps Script editor:
                <div className="bg-gray-900 p-3 rounded mt-2 relative">
                  <pre className="text-xs text-green-400 overflow-x-auto">{appsScriptCode}</pre>
                  <button
                    onClick={() => copyToClipboard(appsScriptCode)}
                    className="absolute top-2 right-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                  >
                    Copy Script
                  </button>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-400 min-w-[24px]">4.</span>
              <div>
                <strong>Deploy as Web App</strong>
                <br/>Click <strong>Deploy → New deployment</strong>
                <br/>• Select type: <strong>Web app</strong>
                <br/>• Execute as: <strong>Me</strong>
                <br/>• Who has access: <strong>Anyone</strong>
                <br/>• Click <strong>Deploy</strong>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-blue-400 min-w-[24px]">5.</span>
              <div>
                <strong>Copy the Web App URL</strong>
                <br/>After deployment, copy the Web App URL and paste it below
                <br/><span className="text-yellow-400">It should look like: https://script.google.com/macros/s/ABC123.../exec</span>
              </div>
            </li>
          </ol>
        </div>

        {/* Configuration */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Configuration</h2>
          
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Data Type</label>
              <select
                value={dataType}
                onChange={(e) => setDataType(e.target.value as DataType)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="lower-thirds">Lower Thirds (Speaker Data)</option>
                <option value="schedule">Schedule (Segment Times)</option>
                <option value="custom-columns">Custom Columns (Custom Fields)</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                📊 Select which type of data to export to Google Sheets
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Google Apps Script Web App URL</label>
              <input
                type="text"
                value={webAppUrl}
                onChange={(e) => setWebAppUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/ABC123.../exec"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                ⚠️ Paste the complete URL from your Apps Script deployment
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Target Sheet Name</label>
              <input
                type="text"
                value={targetSheetName}
                onChange={(e) => setTargetSheetName(e.target.value)}
                placeholder="Sheet1"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                📝 Name of the sheet to write data to (will be created if it doesn't exist)
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Show All Items</label>
                  <p className="text-xs text-gray-400">Include all schedule items, not just public ones</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllItems}
                    onChange={(e) => setShowAllItems(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <p className="text-xs text-gray-400">
                {showAllItems 
                  ? '✅ Will export ALL schedule items (public and private)' 
                  : '🔒 Will export only PUBLIC items (default behavior)'
                }
              </p>
            </div>

            <div className="border-t border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Auto-Refresh</label>
                  <p className="text-xs text-gray-400">Automatically update Google Sheets at regular intervals</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRefreshEnabled}
                    onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {autoRefreshEnabled && (
                <div>
                  <label className="block text-sm font-medium mb-2">Refresh Interval (seconds)</label>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    ⏱️ Data will be pushed every {refreshInterval} seconds
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={loadData}
              disabled={!eventId || isLoading}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded-md transition-colors font-semibold"
            >
              {isLoading ? 'Loading...' : `1. Load ${dataType === 'lower-thirds' ? 'Lower Thirds' : dataType === 'schedule' ? 'Schedule' : 'Custom Columns'} Data`}
            </button>
            
            <button
              onClick={pushToGoogleSheets}
              disabled={!webAppUrl || isLoading || 
                (dataType === 'lower-thirds' && lowerThirds.length === 0) ||
                (dataType === 'schedule' && scheduleItems.length === 0) ||
                (dataType === 'custom-columns' && customColumns.length === 0)}
              className="px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-md transition-colors font-semibold"
            >
              {isLoading ? 'Pushing...' : '2. Push to Google Sheets'}
            </button>
          </div>
        </div>

        {/* Status */}
        {error && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-300 font-semibold mb-2">❌ Error:</p>
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}

        {lastUpdated && (
          <div className="bg-green-900/30 border border-green-500/50 rounded-lg p-4 mb-6">
            <p className="text-green-300">
              ✅ Data pushed to Google Sheets at {lastUpdated.toLocaleTimeString()}
              {autoRefreshEnabled && ` (Auto-refresh: every ${refreshInterval}s)`}
            </p>
            <p className="text-green-200 text-sm mt-1">
              {autoRefreshEnabled 
                ? `Auto-refresh is active. Data will be updated automatically every ${refreshInterval} seconds.`
                : 'Check your Google Sheet to verify the data was written correctly.'
              }
            </p>
          </div>
        )}

        {/* Data Preview */}
        {((dataType === 'lower-thirds' && lowerThirds.length > 0) ||
          (dataType === 'schedule' && scheduleItems.length > 0) ||
          (dataType === 'custom-columns' && customColumns.length > 0)) && (
          <div className="bg-gray-800 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">
              {dataType === 'lower-thirds' ? 'Lower Thirds' : dataType === 'schedule' ? 'Schedule' : 'Custom Columns'} Data Preview
            </h2>
            <p className="text-gray-400 mb-4">
              {dataType === 'lower-thirds' ? lowerThirds.length : dataType === 'schedule' ? scheduleItems.length : customColumns.length} rows ready to push to Google Sheets
            </p>
            <div className="bg-gray-900 rounded p-4 max-h-64 overflow-y-auto">
              {dataType === 'lower-thirds' && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pb-2">Row</th>
                        <th className="pb-2">Cue</th>
                        <th className="pb-2">Program</th>
                        <th className="pb-2">Segment</th>
                        <th className="pb-2">Speakers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowerThirds.slice(0, 10).map((item, index) => (
                        <tr key={item.id} className="border-t border-gray-700">
                          <td className="py-2">{index + 1}</td>
                          <td className="py-2">{item.cue}</td>
                          <td className="py-2">{item.program}</td>
                          <td className="py-2">{item.segmentName}</td>
                          <td className="py-2">{item.speakers.length} speaker(s)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lowerThirds.length > 10 && (
                    <p className="text-gray-500 text-xs mt-2">
                      Showing 10 of {lowerThirds.length} rows
                    </p>
                  )}
                </>
              )}
              
              {dataType === 'schedule' && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pb-2">Row</th>
                        <th className="pb-2">Segment Name</th>
                        <th className="pb-2">Start Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleItems.slice(0, 10).map((item, index) => (
                        <tr key={item.id} className="border-t border-gray-700">
                          <td className="py-2">{index + 1}</td>
                          <td className="py-2">{item.segmentName}</td>
                          <td className="py-2">{item.startTime}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {scheduleItems.length > 10 && (
                    <p className="text-gray-500 text-xs mt-2">
                      Showing 10 of {scheduleItems.length} rows
                    </p>
                  )}
                </>
              )}
              
              {dataType === 'custom-columns' && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="pb-2">Row</th>
                        <th className="pb-2">Cue</th>
                        <th className="pb-2">Custom Fields</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customColumns.slice(0, 10).map((item, index) => (
                        <tr key={item.id} className="border-t border-gray-700">
                          <td className="py-2">{index + 1}</td>
                          <td className="py-2">{item.cue}</td>
                          <td className="py-2">{Object.keys(item.customFields || {}).length} field(s)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {customColumns.length > 10 && (
                    <p className="text-gray-500 text-xs mt-2">
                      Showing 10 of {customColumns.length} rows
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GoogleSheetsVMIXPage;