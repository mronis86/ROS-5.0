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

  const eventId = event.queryStringParameters?.eventId;

  if (!eventId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>'
    };
  }

  try {
    // Fetch from run_of_show_data table using Neon database
    const { rows: runOfShowDataRows, error } = await pool.query(
      'SELECT * FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );

    if (error) {
      console.error('Database error:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><error>Database error</error>'
      };
    }

    const runOfShowData = runOfShowDataRows[0];

    if (!runOfShowData || !runOfShowData.schedule_items) {
      const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
      const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <custom_columns>
  </custom_columns>
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
    const customColumns = runOfShowData.custom_columns || [];
    
    // Filter for public items only
    const publicItems = scheduleItems.filter(item => item.isPublic);
    const customColumnsData = [];

    // Get custom column names
    const customColumnNames = customColumns
      .filter(col => col.name)
      .map(col => col.name);

    publicItems.forEach((item, index) => {
      const baseEntry = {
        id: `${item.id}-custom`,
        row: index + 1,
        cue: item.customFields?.cue || 'CUE##',
        customFields: item.customFields || {}
      };

      customColumnsData.push(baseEntry);
    });

    // Generate XML
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <custom_columns>
    ${customColumnsData.map(item => {
      const customFieldsXML = item.customFields ? Object.entries(item.customFields)
        .map(([key, value]) => `<${key}><![CDATA[${value || ''}]]></${key}>`)
        .join('') : '';
      
      return `
    <item>
      <id>${item.id}</id>
      <row>${item.row || customColumnsData.indexOf(item) + 1}</row>
      <cue><![CDATA[${item.cue || ''}]]></cue>
      ${customFieldsXML}
    </item>`;
    }).join('')}
  </custom_columns>
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
    console.error('Error in custom-columns-xml function:', error);
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
