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
      headers: { 'Content-Type': 'text/csv' },
      body: 'Error,Event ID is required'
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
        headers: { 'Content-Type': 'text/csv' },
        body: 'Error,Database error'
      };
    }

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
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/csv' },
      body: 'Error,Internal server error'
    };
  }
};
