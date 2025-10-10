exports.handler = async (event, context) => {
  const { Pool } = require('pg');
  
  // Neon database configuration
  const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Database not configured</error>'
    };
  }

  const pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  let eventId = event.queryStringParameters?.eventId;

  if (!eventId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>'
    };
  }

  // Handle malformed event ID (JSON array instead of string)
  if (eventId.startsWith('[')) {
    try {
      const events = JSON.parse(eventId);
      if (Array.isArray(events) && events.length > 0 && events[0].id) {
        eventId = events[0].id;
      }
    } catch (e) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><error>Invalid event ID format</error>'
      };
    }
  }

  try {
    // Fetch from run_of_show_data table using Neon database
    const result = await pool.query(
      'SELECT * FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );

    const runOfShowData = result.rows[0];

    if (!runOfShowData || !runOfShowData.schedule_items) {
      const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
      const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <schedule>
  </schedule>
</data>`;
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/xml',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        body: xmlHeader + xmlContent
      };
    }

    // Process schedule items
    const scheduleItems = runOfShowData.schedule_items;
    const masterStartTime = runOfShowData.settings?.masterStartTime || '';
    
    // Helper function to calculate start time
    const calculateStartTime = (scheduleItems, currentItem, masterStartTime) => {
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

    // Filter for public items only
    const publicItems = scheduleItems.filter(item => item.isPublic);
    const scheduleData = [];

    publicItems.forEach((item) => {
      const startTime = calculateStartTime(scheduleItems, item, masterStartTime);
      
      const baseEntry = {
        id: `${item.id}-schedule`,
        segmentName: item.segmentName || 'Untitled Segment',
        startTime: startTime || 'No Start Time'
      };

      scheduleData.push(baseEntry);
    });

    // Generate XML
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <schedule>
    ${scheduleData.map(item => `
    <item>
      <id>${item.id}</id>
      <row>${scheduleData.indexOf(item) + 1}</row>
      <segment_name><![CDATA[${item.segmentName || ''}]]></segment_name>
      <start_time><![CDATA[${item.startTime || ''}]]></start_time>
    </item>`).join('')}
  </schedule>
</data>`;
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/xml',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: xmlHeader + xmlContent
    };
    
  } catch (error) {
    console.error('Error in schedule-xml function:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>'
    };
  } finally {
    // Close the database connection
    await pool.end();
  }
};
