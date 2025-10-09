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

  // Handle eventId that might be a JSON array
  if (eventId) {
    try {
      const parsed = JSON.parse(eventId);
      if (Array.isArray(parsed) && parsed.length > 0) {
        eventId = parsed[0];
      }
    } catch (e) {
      // eventId is already a string, keep it as is
    }
  }

  if (!eventId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>'
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
      const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
      const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <lower_thirds>
  </lower_thirds>
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

    // Process schedule items to extract speaker information
    const scheduleItems = runOfShowData.schedule_items;
    const lowerThirdsData = [];

    scheduleItems.forEach((item) => {
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

    // Generate XML
    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <lower_thirds>
    ${lowerThirdsData.map(item => {
      const speakers = new Array(21).fill('');
      
      if (item.speakers && item.speakers.length > 0) {
        item.speakers.forEach((speaker, speakerIndex) => {
          if (speakerIndex < 7) {
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
      <row>${lowerThirdsData.indexOf(item) + 1}</row>
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
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/xml',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: xmlHeader + xmlContent
    };
    
  } catch (error) {
    console.error('Error in lower-thirds-xml function:', error);
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
