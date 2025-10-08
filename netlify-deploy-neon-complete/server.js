const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Helper function to calculate start time (like Python script)
function calculateStartTime(scheduleItems, currentItem, masterStartTime) {
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
}

// Neon database configuration
const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ Database connection string not found! Please set NEON_DATABASE_URL or DATABASE_URL environment variable.');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

console.log('✅ Connected to Neon database');
console.log('🌐 Database host:', connectionString.split('@')[1]?.split('/')[0] || 'unknown');

// Helper function to fetch run of show data
async function fetchRunOfShowData(eventId) {
    const result = await pool.query(
        'SELECT * FROM run_of_show_data WHERE event_id = $1',
        [eventId]
    );
    return result.rows[0] || null;
}

const server = http.createServer(async (req, res) => {
    // Handle API routes
    if (req.url.startsWith('/api/run-of-show-data/')) {
        const eventId = req.url.split('/api/run-of-show-data/')[1];
        
        try {
            console.log('🔄 API: Fetching run of show data for event:', eventId);
            
            const result = await pool.query(
                'SELECT * FROM run_of_show_data WHERE event_id = $1',
                [eventId]
            );
            
            if (result.rows.length === 0) {
                console.error('❌ Data not found for event:', eventId);
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Data not found' }));
                return;
            }
            
            const data = result.rows[0];
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        return;
    }
    
    // Handle Lower Thirds XML API
    if (req.url.startsWith('/api/lower-thirds.xml')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.searchParams.get('eventId');
        
        try {
            console.log('🔄 API: Fetching lower thirds XML for event:', eventId);
            
            if (!eventId) {
                res.writeHead(400, { 'Content-Type': 'application/xml' });
                res.end('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
                return;
            }
            
            console.log('📊 Server: Fetching lower thirds data for event:', eventId);
            
            // Fetch from run_of_show_data table using Neon database
            const runOfShowData = await fetchRunOfShowData(eventId);
            
            console.log('📊 Server: Fetched data:', {
                hasData: !!runOfShowData,
                scheduleItemsCount: runOfShowData?.schedule_items?.length || 0,
                eventId: runOfShowData?.event_id
            });

            if (!runOfShowData || !runOfShowData.schedule_items) {
                // Return empty data if no schedule items
                const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
                const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <lower_thirds>
  </lower_thirds>
</data>`;
                res.writeHead(200, { 
                    'Content-Type': 'application/xml',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(xmlHeader + xmlContent);
                return;
            }

            // Process schedule items to extract speaker information
            const scheduleItems = runOfShowData.schedule_items;
            const lowerThirdsData = [];

            scheduleItems.forEach((item) => {
                // ALWAYS create an entry for each schedule item, even without speakers
                // This ensures every ROW/CUE gets a CSV row
                const baseEntry = {
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
                        const speakersArray = JSON.parse(item.speakersText);
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

            const xmlData = lowerThirdsData;
            
            // Generate XML
            const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
            const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <lower_thirds>
    ${xmlData.map(item => {
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
      <row>${xmlData.indexOf(item) + 1}</row>
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
            
            res.writeHead(200, { 
                'Content-Type': 'application/xml',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(xmlHeader + xmlContent);
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'application/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>');
        }
        return;
    }
    
    // Handle Lower Thirds CSV API
    if (req.url.startsWith('/api/lower-thirds.csv')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.searchParams.get('eventId');
        
        try {
            console.log('📊 Server: Fetching lower thirds CSV for event:', eventId);
            
            if (!eventId) {
                res.writeHead(400, { 'Content-Type': 'text/csv' });
                res.end('Error,Event ID is required');
                return;
            }
            
            // Fetch from run_of_show_data table
            const { data: runOfShowData, error: fetchError } = await supabase
                .from('run_of_show_data')
                .select('*')
                .eq('event_id', eventId)
                .single();
            
            if (fetchError) {
                console.error('❌ Supabase error:', fetchError);
                res.writeHead(500, { 'Content-Type': 'text/csv' });
                res.end('Error,Database error');
                return;
            }

            if (!runOfShowData || !runOfShowData.schedule_items) {
                res.writeHead(200, { 
                    'Content-Type': 'text/csv',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end('Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n');
                return;
            }

            // Process schedule items - one row per schedule item (like Python version)
            const scheduleItems = runOfShowData.schedule_items;
            console.log(`📊 Processing ${scheduleItems.length} schedule items for CSV`);
            console.log(`📊 Schedule items:`, scheduleItems.map(item => ({ id: item.id, segmentName: item.segmentName, cue: item.customFields?.cue })));

            // Generate CSV header
            let csv = 'Row,Cue,Program,Segment Name,';
            csv += 'Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,';
            csv += 'Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,';
            csv += 'Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,';
            csv += 'Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,';
            csv += 'Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,';
            csv += 'Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,';
            csv += 'Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n';
            
            // Process each schedule item (one row per item) - include ALL items, even without speakers
            scheduleItems.forEach((item, index) => {
                const rowNumber = index + 1;
                const cue = item.customFields?.cue || '';
                const program = item.programType || '';
                const segmentName = item.segmentName || '';
                
                // Initialize speaker slots (7 speakers × 3 fields each = 21 fields)
                const speakers = new Array(21).fill('');
                
                // Parse speakers if available
                if (item.speakersText && item.speakersText.trim()) {
                    try {
                        const speakersData = JSON.parse(item.speakersText);
                        speakersData.forEach((speaker) => {
                            const slot = speaker.slot || 0;
                            if (slot >= 1 && slot <= 7) {
                                const baseIdx = (slot - 1) * 3;
                                speakers[baseIdx] = speaker.fullName || '';
                                const title = speaker.title || '';
                                const org = speaker.org || '';
                                speakers[baseIdx + 1] = title && org ? `${title}\n${org}` : title || org;
                                speakers[baseIdx + 2] = speaker.photoLink || '';
                            }
                        });
                    } catch (error) {
                        console.log('Error parsing speakers JSON for item:', item.id, error);
                    }
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
            
            res.writeHead(200, { 
                'Content-Type': 'text/csv',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(csv);
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'text/csv' });
            res.end('Error,Internal server error');
        }
        return;
    }
    
    // Handle Schedule XML API
    if (req.url.startsWith('/api/schedule.xml')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.searchParams.get('eventId');
        
        try {
            console.log('🔄 API: Fetching schedule XML for event:', eventId);
            
            if (!eventId) {
                res.writeHead(400, { 'Content-Type': 'application/xml' });
                res.end('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
                return;
            }
            
            console.log('📅 Server: Fetching schedule data for event:', eventId);
            
            // Fetch from run_of_show_data table using Neon database
            const runOfShowData = await fetchRunOfShowData(eventId);
            
            console.log('📅 Server: Fetched data:', {
                hasData: !!runOfShowData,
                scheduleItemsCount: runOfShowData?.schedule_items?.length || 0,
                eventId: runOfShowData?.event_id
            });

            if (!runOfShowData || !runOfShowData.schedule_items) {
                // Return empty data if no schedule items
                const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
                const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <schedule>
  </schedule>
</data>`;
                res.writeHead(200, { 
                    'Content-Type': 'application/xml',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(xmlHeader + xmlContent);
                return;
            }

            // Process schedule items to extract schedule information (like Python script)
            const scheduleItems = runOfShowData.schedule_items;
            const masterStartTime = runOfShowData.settings?.masterStartTime || '';
            const scheduleData = [];

            // Filter for public items only (like Python script)
            const publicItems = scheduleItems.filter(item => item.isPublic);

            publicItems.forEach((item) => {
                // Calculate start time like Python script
                const startTime = calculateStartTime(scheduleItems, item, masterStartTime);
                
                const baseEntry = {
                    id: `${item.id}-schedule`,
                    segmentName: item.segmentName || 'Untitled Segment',
                    startTime: startTime || 'No Start Time'
                    // No speakers, cue, program, endTime, duration for schedule
                };

                scheduleData.push(baseEntry);
            });

            const xmlData = scheduleData;
            const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
            const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <schedule>
    ${xmlData.map(item => `
    <item>
      <id>${item.id}</id>
      <row>${xmlData.indexOf(item) + 1}</row>
      <segment_name><![CDATA[${item.segmentName || ''}]]></segment_name>
      <start_time><![CDATA[${item.startTime || ''}]]></start_time>
    </item>`).join('')}
  </schedule>
</data>`;
            
            res.writeHead(200, { 
                'Content-Type': 'application/xml',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(xmlHeader + xmlContent);
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'application/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>');
        }
        return;
    }
    
    // Handle Schedule CSV API
    if (req.url.startsWith('/api/schedule.csv')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.searchParams.get('eventId');
        
        try {
            console.log('📅 Server: Fetching schedule CSV for event:', eventId);
            
            if (!eventId) {
                res.writeHead(400, { 'Content-Type': 'text/csv' });
                res.end('Error,Event ID is required');
                return;
            }
            
            // Fetch from run_of_show_data table
            const { data: runOfShowData, error: fetchError } = await supabase
                .from('run_of_show_data')
                .select('*')
                .eq('event_id', eventId)
                .single();
            
            if (fetchError) {
                console.error('❌ Supabase error:', fetchError);
                res.writeHead(500, { 'Content-Type': 'text/csv' });
                res.end('Error,Database error');
                return;
            }

            if (!runOfShowData || !runOfShowData.schedule_items) {
                res.writeHead(200, { 
                    'Content-Type': 'text/csv',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end('Segment Name,Start Time\n');
                return;
            }

            // Process schedule items - filter for public items only (like Python script)
            const scheduleItems = runOfShowData.schedule_items;
            const masterStartTime = runOfShowData.settings?.masterStartTime || '';
            const publicItems = scheduleItems.filter(item => item.isPublic);
            
            console.log(`📅 Processing ${publicItems.length} public schedule items for CSV`);

            // Generate CSV header - just Segment Name and Start Time like Python script
            let csv = 'Segment Name,Start Time\n';
            
            // Process each public schedule item
            publicItems.forEach((item) => {
                const segmentName = item.segmentName || 'Untitled Segment';
                const startTime = calculateStartTime(scheduleItems, item, masterStartTime) || 'No Start Time';
                
                // Create CSV row
                const csvRow = [
                    `"${segmentName.replace(/"/g, '""')}"`,
                    `"${startTime.replace(/"/g, '""')}"`
                ].join(',');
                csv += csvRow + '\n';
            });
            
            res.writeHead(200, { 
                'Content-Type': 'text/csv',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(csv);
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'text/csv' });
            res.end('Error,Internal server error');
        }
        return;
    }
    
    // Handle Custom Columns XML API
    if (req.url.startsWith('/api/custom-columns.xml')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.searchParams.get('eventId');
        
        try {
            console.log('🔄 API: Fetching custom columns XML for event:', eventId);
            
            if (!eventId) {
                res.writeHead(400, { 'Content-Type': 'application/xml' });
                res.end('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
                return;
            }
            
            console.log('📊 Server: Fetching custom columns data for event:', eventId);
            
            // Fetch from run_of_show_data table using Neon database
            const runOfShowData = await fetchRunOfShowData(eventId);
            
            console.log('📊 Server: Fetched data:', {
                hasData: !!runOfShowData,
                scheduleItemsCount: runOfShowData?.schedule_items?.length || 0,
                eventId: runOfShowData?.event_id
            });

            if (!runOfShowData || !runOfShowData.schedule_items) {
                // Return empty data if no schedule items
                const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
                const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <custom_columns>
  </custom_columns>
</data>`;
                res.writeHead(200, { 
                    'Content-Type': 'application/xml',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(xmlHeader + xmlContent);
                return;
            }

            // Process schedule items to extract custom columns information (like Python script)
            const scheduleItems = runOfShowData.schedule_items;
            const customColumns = runOfShowData.custom_columns || [];
            const customColumnsData = [];

            // Filter for public items only (like Python script)
            const publicItems = scheduleItems.filter(item => item.isPublic);

            // Get custom column names (like Python script)
            const customColumnNames = customColumns
                .filter(col => col.name)
                .map(col => col.name);

            publicItems.forEach((item, index) => {
                // Create an entry for each public item (like Python script)
                const baseEntry = {
                    id: `${item.id}-custom`,
                    row: index + 1, // Row number
                    cue: item.customFields?.cue || 'CUE##', // Cue field with default
                    customFields: item.customFields || {}
                    // No speakers, program, startTime, endTime, duration for custom columns
                };

                customColumnsData.push(baseEntry);
            });

            const xmlData = customColumnsData;
            const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
            const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <custom_columns>
    ${xmlData.map(item => {
      // Generate custom fields dynamically (like Python script)
      const customFieldsXML = item.customFields ? Object.entries(item.customFields)
        .map(([key, value]) => `<${key}><![CDATA[${value || ''}]]></${key}>`)
        .join('') : '';
      
      return `
    <item>
      <id>${item.id}</id>
      <row>${item.row || xmlData.indexOf(item) + 1}</row>
      <cue><![CDATA[${item.cue || ''}]]></cue>
      ${customFieldsXML}
    </item>`;
    }).join('')}
  </custom_columns>
</data>`;
            
            res.writeHead(200, { 
                'Content-Type': 'application/xml',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(xmlHeader + xmlContent);
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'application/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>');
        }
        return;
    }

    // Handle Custom Columns CSV API
    if (req.url.startsWith('/api/custom-columns.csv')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const eventId = url.searchParams.get('eventId');
        
        try {
            console.log('📊 Server: Fetching custom columns CSV for event:', eventId);
            
            if (!eventId) {
                res.writeHead(400, { 'Content-Type': 'text/csv' });
                res.end('Error,Event ID is required');
                return;
            }
            
            // Fetch from run_of_show_data table
            const { data: runOfShowData, error: fetchError } = await supabase
                .from('run_of_show_data')
                .select('*')
                .eq('event_id', eventId)
                .single();
            
            if (fetchError) {
                console.error('❌ Supabase error:', fetchError);
                res.writeHead(500, { 'Content-Type': 'text/csv' });
                res.end('Error,Database error');
                return;
            }

            if (!runOfShowData || !runOfShowData.schedule_items) {
                res.writeHead(200, { 
                    'Content-Type': 'text/csv',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end('Segment Name,Start Time\n');
                return;
            }

            // Process schedule items - filter for public items only (like Python script)
            const scheduleItems = runOfShowData.schedule_items;
            const customColumns = runOfShowData.custom_columns || [];
            const publicItems = scheduleItems.filter(item => item.isPublic);
            
            console.log(`📊 Processing ${publicItems.length} public schedule items for custom columns CSV`);

            // Get custom column names (like Python script)
            const customColumnNames = customColumns
                .filter(col => col.name)
                .map(col => col.name);

            // Generate CSV header - Row, Cue, then custom columns (like Python script)
            let csv = 'Row,Cue,';
            
            // Add custom fields to header
            customColumnNames.forEach(field => {
                csv += `${field},`;
            });
            
            // Remove trailing comma and add newline
            csv = csv.slice(0, -1) + '\n';
            
            // Process each public item (like Python script)
            publicItems.forEach((item, index) => {
                const rowNumber = index + 1;
                const cue = item.customFields?.cue || 'CUE##';
                
                // Create CSV row
                const csvRow = [
                    rowNumber,
                    `"${cue.replace(/"/g, '""')}"`,
                    // Add custom fields
                    ...customColumnNames.map(field => 
                        `"${(item.customFields?.[field] || '').replace(/"/g, '""')}"`
                    )
                ].join(',');
                csv += csvRow + '\n';
            });
            
            res.writeHead(200, { 
                'Content-Type': 'text/csv',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(csv);
            
        } catch (error) {
            console.error('❌ Server error:', error);
            res.writeHead(500, { 'Content-Type': 'text/csv' });
            res.end('Error,Internal server error');
        }
        return;
    }
    
    // Serve static files from public directory
    let filePath;
    if (req.url === '/' || req.url === '/index.html') {
        filePath = path.join(__dirname, 'index.html');
    } else {
        filePath = path.join(__dirname, 'public', req.url);
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
        // Fallback to index.html for SPA routes
        filePath = path.join(__dirname, 'index.html');
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end('Error loading file');
            return;
        }
        
        // Set appropriate content type
        const ext = path.extname(filePath);
        let contentType = 'text/html';
        
        if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.css') contentType = 'text/css';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.xml') contentType = 'application/xml';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

const PORT = 3002;
server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📱 Open your browser and navigate to http://localhost:${PORT}`);
});
