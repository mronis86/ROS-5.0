exports.handler = async (event, context) => {
  const { Pool } = require('pg');
  
  // Neon database configuration
  const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/csv' },
      body: 'Error,Database not configured'
    };
  }

  const pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  const eventId = event.queryStringParameters?.eventId;

  if (!eventId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/csv' },
      body: 'Error,Event ID is required'
    };
  }

  try {
    // Fetch from run_of_show_data table using Neon database
    const result = await pool.query(
      'SELECT * FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );

    const runOfShowData = result.rows[0];

    if (!runOfShowData || !runOfShowData.schedule_items) {
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'text/csv',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        },
        body: 'Segment Name,Start Time\n'
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
    
    // Generate CSV header
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
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'text/csv',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: csv
    };
    
  } catch (error) {
    console.error('Error in schedule-csv function:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/csv' },
      body: 'Error,Internal server error'
    };
  } finally {
    // Close the database connection
    await pool.end();
  }
};
