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
        body: 'Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n'
      };
    }

    // Process schedule items
    const scheduleItems = runOfShowData.schedule_items;
    
    // Generate CSV header
    let csv = 'Row,Cue,Program,Segment Name,';
    csv += 'Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,';
    csv += 'Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,';
    csv += 'Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,';
    csv += 'Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,';
    csv += 'Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,';
    csv += 'Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,';
    csv += 'Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n';
    
    // Process each schedule item
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
