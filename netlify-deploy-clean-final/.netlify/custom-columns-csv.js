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
    const customColumns = runOfShowData.custom_columns || [];
    
    // Filter for public items only
    const publicItems = scheduleItems.filter(item => item.isPublic);
    
    // Get custom column names
    const customColumnNames = customColumns
      .filter(col => col.name)
      .map(col => col.name);

    // Generate CSV header - Row, Cue, then custom columns
    let csv = 'Row,Cue,';
    
    // Add custom fields to header
    customColumnNames.forEach(field => {
      csv += `${field},`;
    });
    
    // Remove trailing comma and add newline
    csv = csv.slice(0, -1) + '\n';
    
    // Process each public item
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
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'text/csv',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: csv
    };
    
  } catch (error) {
    console.error('Error in custom-columns-csv function:', error);
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
