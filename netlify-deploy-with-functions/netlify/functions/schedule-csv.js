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
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/csv' },
      body: 'Error,Internal server error'
    };
  }
};
