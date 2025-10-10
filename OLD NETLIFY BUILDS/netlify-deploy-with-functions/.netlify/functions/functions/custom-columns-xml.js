exports.handler = async (event, context) => {
  const { createClient } = require('@supabase/supabase-js');
  
  // Supabase configuration
  const supabaseUrl = 'https://huqijhevmtgardkyeowa.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const eventId = event.queryStringParameters?.eventId;

  if (!eventId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>'
    };
  }

  try {
    // Fetch from run_of_show_data table
    const { data: runOfShowData, error } = await supabase
      .from('run_of_show_data')
      .select('*')
      .eq('event_id', eventId)
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><error>Database error</error>'
      };
    }

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
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>'
    };
  }
};
