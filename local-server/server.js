// Local API + WebSocket Server
// This is a complete local version of the Railway API server (api-server.js)
// It includes all endpoints needed for the React app to work offline

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

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

// Helper function to calculate start time
function calculateStartTime(scheduleItems, currentItem, masterStartTime) {
    if (!masterStartTime) return '';
    
    try {
        const itemIndex = scheduleItems.indexOf(currentItem);
        if (currentItem.isIndented) return '';
        
        let totalSeconds = 0;
        for (let i = 0; i < itemIndex; i++) {
            const item = scheduleItems[i];
            if (!item.isIndented) {
                totalSeconds += (item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds);
            }
        }
        
        const [startHours, startMinutes] = masterStartTime.split(':').map(Number);
        const startSeconds = startHours * 3600 + startMinutes * 60;
        const totalStartSeconds = startSeconds + totalSeconds;
        
        const finalHours = (totalStartSeconds / 3600) % 24;
        const finalMinutes = (totalStartSeconds % 3600) / 60;
        
        const date = new Date();
        date.setHours(finalHours, finalMinutes, 0, 0);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (error) {
        return '';
    }
}

// ========================================
// Health Check Endpoint
// ========================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Local server is running' });
});

// ========================================
// Calendar Events Endpoints
// ========================================

app.get('/api/calendar-events', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM calendar_events ORDER BY date DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

app.get('/api/calendar-events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM calendar_events WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching calendar event:', error);
    res.status(500).json({ error: 'Failed to fetch calendar event' });
  }
});

app.post('/api/calendar-events', async (req, res) => {
  try {
    const { name, date, schedule_data } = req.body;
    const result = await pool.query(
      `INSERT INTO calendar_events (name, date, schedule_data, created_at, updated_at) 
       VALUES ($1, $2, $3, NOW(), NOW()) 
       RETURNING *`,
      [name, date, JSON.stringify(schedule_data)]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

app.put('/api/calendar-events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, schedule_data } = req.body;
    const result = await pool.query(
      `UPDATE calendar_events 
       SET name = $1, date = $2, schedule_data = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [name, date, JSON.stringify(schedule_data), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating calendar event:', error);
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

app.delete('/api/calendar-events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM calendar_events WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

// ========================================
// Run of Show Data Endpoints
// ========================================

app.get('/api/run-of-show-data/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching run of show data:', error);
    res.status(500).json({ error: 'Failed to fetch run of show data' });
  }
});

app.post('/api/run-of-show-data', async (req, res) => {
  try {
    const { event_id, event_name, event_date, schedule_items, custom_columns, settings } = req.body;
    const result = await pool.query(
      `INSERT INTO run_of_show_data (event_id, event_name, event_date, schedule_items, custom_columns, settings, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) 
       RETURNING *`,
      [event_id, event_name, event_date, JSON.stringify(schedule_items), JSON.stringify(custom_columns), JSON.stringify(settings)]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating run of show data:', error);
    res.status(500).json({ error: 'Failed to create run of show data' });
  }
});

app.put('/api/run-of-show-data/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { event_name, event_date, schedule_items, custom_columns, settings, last_modified_by, last_modified_by_name, last_modified_by_role } = req.body;
    
    const result = await pool.query(
      `UPDATE run_of_show_data 
       SET event_name = $1, event_date = $2, schedule_items = $3, custom_columns = $4, settings = $5, 
           last_modified_by = $6, last_modified_by_name = $7, last_modified_by_role = $8, 
           updated_at = NOW(), last_change_at = NOW() 
       WHERE event_id = $9 
       RETURNING *`,
      [event_name, event_date, JSON.stringify(schedule_items), JSON.stringify(custom_columns), JSON.stringify(settings), 
       last_modified_by, last_modified_by_name, last_modified_by_role, eventId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Emit WebSocket event
    io.emit('message', JSON.stringify({
      type: 'runOfShowDataUpdated',
      eventId: eventId
    }));
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating run of show data:', error);
    res.status(500).json({ error: 'Failed to update run of show data' });
  }
});

// ========================================
// Completed Cues Endpoints
// ========================================

app.get('/api/completed-cues', async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM completed_cues WHERE event_id = $1 ORDER BY completed_at DESC',
      [eventId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching completed cues:', error);
    res.status(500).json({ error: 'Failed to fetch completed cues' });
  }
});

app.post('/api/completed-cues', async (req, res) => {
  try {
    const { event_id, cue_id, cue_number, segment_name, completed_by, completed_by_name, completed_by_role } = req.body;
    const result = await pool.query(
      `INSERT INTO completed_cues (event_id, cue_id, cue_number, segment_name, completed_by, completed_by_name, completed_by_role, completed_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
       RETURNING *`,
      [event_id, cue_id, cue_number, segment_name, completed_by, completed_by_name, completed_by_role]
    );
    
    // Emit WebSocket event
    io.emit('message', JSON.stringify({
      type: 'completedCuesUpdated',
      eventId: event_id
    }));
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating completed cue:', error);
    res.status(500).json({ error: 'Failed to create completed cue' });
  }
});

// ========================================
// VMIX XML/CSV Endpoints
// ========================================

app.get('/api/lower-thirds.xml', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    
    if (!eventId) {
      res.set('Content-Type', 'application/xml');
      return res.status(400).send('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
    }

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
      res.set('Content-Type', 'application/xml');
      return res.send(xmlHeader + xmlContent);
    }

    const scheduleItems = runOfShowData.schedule_items;
    const lowerThirdsData = [];

    scheduleItems.forEach((item) => {
      const speakers = [];
      
      if (item.speakersText) {
        try {
          const speakersArray = typeof item.speakersText === 'string' 
            ? JSON.parse(item.speakersText) 
            : item.speakersText;
          
          if (Array.isArray(speakersArray)) {
            speakersArray.forEach((speaker) => {
              speakers.push({
                title: speaker.fullName || speaker.name || '',
                subtitle: [speaker.title, speaker.org].filter(Boolean).join(', '),
                photo: speaker.photoLink || '',
                slot: speaker.slot || 1
              });
            });
          }
        } catch (e) {
          console.error('Error parsing speakers:', e);
        }
      }

      lowerThirdsData.push({
        id: String(item.id),
        cue: item.customFields?.cue || '',
        program: item.programType || '',
        segmentName: item.segmentName || '',
        speakers
      });
    });

    const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
    const xmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <lower_thirds>
    ${lowerThirdsData.map(item => {
      const speakers = new Array(21).fill('');
      if (item.speakers && item.speakers.length > 0) {
        item.speakers.forEach((speaker) => {
          const slot = speaker.slot || 1;
          if (slot >= 1 && slot <= 7) {
            const baseIdx = (slot - 1) * 3;
            speakers[baseIdx] = speaker.title || '';
            speakers[baseIdx + 1] = speaker.subtitle || '';
            speakers[baseIdx + 2] = speaker.photo || '';
          }
        });
      }
      return `
    <item>
      <id>${item.id}</id>
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

    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.send(xmlHeader + xmlContent);
  } catch (error) {
    console.error('Error in lower-thirds.xml:', error);
    res.set('Content-Type', 'application/xml');
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>');
  }
});

app.get('/api/lower-thirds.csv', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    
    if (!eventId) {
      res.set('Content-Type', 'text/csv');
      return res.status(400).send('Error,Event ID is required');
    }
    
    const result = await pool.query(
      'SELECT * FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );

    const runOfShowData = result.rows[0];

    if (!runOfShowData || !runOfShowData.schedule_items) {
      res.set('Content-Type', 'text/csv');
      return res.send('Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n');
    }

    const scheduleItems = runOfShowData.schedule_items;

    let csv = 'Row,Cue,Program,Segment Name,';
    csv += 'Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,';
    csv += 'Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,';
    csv += 'Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,';
    csv += 'Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,';
    csv += 'Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,';
    csv += 'Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,';
    csv += 'Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n';
    
    scheduleItems.forEach((item, index) => {
      const rowNumber = index + 1;
      const cue = item.customFields?.cue || '';
      const program = item.programType || '';
      const segmentName = item.segmentName || '';
      
      const speakers = new Array(21).fill('');
      
      if (item.speakersText && item.speakersText.trim()) {
        try {
          const speakersData = typeof item.speakersText === 'string'
            ? JSON.parse(item.speakersText)
            : item.speakersText;
          
          if (Array.isArray(speakersData)) {
            speakersData.forEach((speaker) => {
              const slot = speaker.slot || 0;
              if (slot >= 1 && slot <= 7) {
                const baseIdx = (slot - 1) * 3;
                speakers[baseIdx] = speaker.fullName || '';
                const title = speaker.title || '';
                const org = speaker.org || '';
                speakers[baseIdx + 1] = title && org ? `${title}, ${org}` : title || org;
                speakers[baseIdx + 2] = speaker.photoLink || '';
              }
            });
          }
        } catch (error) {
          console.log('Error parsing speakers JSON for item:', item.id, error);
        }
      }
      
      const csvRow = [
        rowNumber,
        `"${cue.replace(/"/g, '""')}"`,
        `"${program.replace(/"/g, '""')}"`,
        `"${segmentName.replace(/"/g, '""')}"`,
        ...speakers.map(s => `"${s.replace(/"/g, '""')}"`)
      ].join(',');
      csv += csvRow + '\n';
    });
    
    res.set({
      'Content-Type': 'text/csv',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.send(csv);
  } catch (error) {
    console.error('Error in lower-thirds.csv:', error);
    res.set('Content-Type', 'text/csv');
    res.status(500).send('Error,Internal server error');
  }
});

// ========================================
// OSC Control Endpoints
// ========================================

app.post('/api/cues/load', async (req, res) => {
  try {
    const { event_id, item_id, user_id, duration_seconds, row_is, cue_is, timer_id } = req.body;
    
    console.log(`🎯 OSC: Loading cue - Event: ${event_id}, Item: ${item_id}, Cue: ${cue_is}`);
    
    // 1. Update schedule_items JSON to set is_active flag
    const dataResult = await pool.query(
      'SELECT * FROM run_of_show_data WHERE event_id = $1',
      [event_id]
    );
    
    if (dataResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    const runOfShowData = dataResult.rows[0];
    const scheduleItems = runOfShowData.schedule_items || [];
    
    // Update all items to set is_active = false except the loaded one
    const updatedSchedule = scheduleItems.map(item => ({
      ...item,
      is_active: item.id === parseInt(item_id)
    }));
    
    await pool.query(
      'UPDATE run_of_show_data SET schedule_items = $1, updated_at = NOW() WHERE event_id = $2',
      [JSON.stringify(updatedSchedule), event_id]
    );
    
    // 2. Update/Insert into active_timers table (like Supabase RPC did)
    await pool.query(`
      INSERT INTO active_timers (
        event_id, item_id, user_id, timer_state, is_active, is_running,
        started_at, last_loaded_cue_id, cue_is, duration_seconds
      ) VALUES ($1, $2, $3, 'loaded', true, false, NOW(), $2, $4, $5)
      ON CONFLICT (event_id) 
      DO UPDATE SET 
        item_id = $2,
        user_id = $3,
        timer_state = 'loaded',
        is_active = true,
        is_running = false,
        started_at = NOW(),
        last_loaded_cue_id = $2,
        cue_is = $4,
        duration_seconds = $5,
        elapsed_seconds = 0,
        updated_at = NOW()
    `, [event_id, parseInt(item_id), user_id || 'python-osc-server', cue_is || `CUE ${item_id}`, duration_seconds || 300]);
    
    console.log(`✅ OSC: Cue loaded - Item ${item_id} set as active in both schedule_items and active_timers`);
    
    res.json({ 
      success: true, 
      message: 'Cue loaded and database updated',
      event_id,
      item_id
    });
    
    // Emit Socket.IO event for real-time updates
    io.emit('message', JSON.stringify({
      type: 'runOfShowDataUpdated',
      eventId: event_id
    }));
    
  } catch (error) {
    console.error('Error loading cue:', error);
    res.status(500).json({ error: 'Failed to load cue', details: error.message });
  }
});

app.post('/api/timers/start', async (req, res) => {
  try {
    const { event_id, item_id, user_id } = req.body;
    
    console.log(`⏱️ OSC: Starting timer - Event: ${event_id}, Item: ${item_id}`);
    
    // Update active_timers table
    await pool.query(`
      UPDATE active_timers 
      SET 
        is_running = true,
        timer_state = 'running',
        started_at = NOW(),
        updated_at = NOW()
      WHERE event_id = $1 AND item_id = $2
    `, [event_id, parseInt(item_id)]);
    
    console.log(`✅ OSC: Timer started for item ${item_id} in active_timers table`);
    
    res.json({ 
      success: true, 
      message: 'Timer started',
      event_id,
      item_id
    });
    
    // Emit Socket.IO event
    io.emit('message', JSON.stringify({
      type: 'runOfShowDataUpdated',
      eventId: event_id
    }));
    
  } catch (error) {
    console.error('Error starting timer:', error);
    res.status(500).json({ error: 'Failed to start timer', details: error.message });
  }
});

app.post('/api/timers/stop', async (req, res) => {
  try {
    const { event_id, item_id } = req.body;
    
    console.log(`⏹️ OSC: Stopping timer - Event: ${event_id}, Item: ${item_id}`);
    
    // Update active_timers table
    await pool.query(`
      UPDATE active_timers 
      SET 
        is_running = false,
        is_active = false,
        timer_state = 'stopped',
        updated_at = NOW()
      WHERE event_id = $1 AND item_id = $2
    `, [event_id, parseInt(item_id)]);
    
    console.log(`✅ OSC: Timer stopped for item ${item_id} in active_timers table`);
    
    res.json({ 
      success: true, 
      message: 'Timer stopped',
      event_id,
      item_id
    });
    
    // Emit Socket.IO event
    io.emit('message', JSON.stringify({
      type: 'runOfShowDataUpdated',
      eventId: event_id
    }));
    
  } catch (error) {
    console.error('Error stopping timer:', error);
    res.status(500).json({ error: 'Failed to stop timer', details: error.message });
  }
});

app.post('/api/timers/reset', async (req, res) => {
  try {
    const { event_id, item_id } = req.body;
    
    console.log(`🔄 OSC: Resetting timer - Event: ${event_id}`);
    
    // Clear all timer tables (like old Supabase reset did)
    // 1. Clear active_timers
    await pool.query(`DELETE FROM active_timers WHERE event_id = $1`, [event_id]);
    
    // 2. Clear completed_cues (if table exists)
    try {
      await pool.query(`DELETE FROM completed_cues WHERE event_id = $1`, [event_id]);
    } catch (e) {
      console.log('completed_cues table may not exist:', e.message);
    }
    
    // 3. Clear sub_cue_timers (if table exists)
    try {
      await pool.query(`DELETE FROM sub_cue_timers WHERE event_id = $1`, [event_id]);
    } catch (e) {
      console.log('sub_cue_timers table may not exist:', e.message);
    }
    
    console.log(`✅ OSC: Timer reset complete - all timer tables cleared for event ${event_id}`);
    
    res.json({ 
      success: true, 
      message: 'Timer reset - all timer tables cleared',
      event_id,
      item_id
    });
    
    // Emit Socket.IO event
    io.emit('message', JSON.stringify({
      type: 'runOfShowDataUpdated',
      eventId: event_id
    }));
    
  } catch (error) {
    console.error('Error resetting timer:', error);
    res.status(500).json({ error: 'Failed to reset timer', details: error.message });
  }
});

// Root endpoint
app.get('/api', (req, res) => {
  res.send(`Local API Server Running

Available endpoints:
- /api/calendar-events
- /api/calendar-events/:id
- /api/run-of-show-data/:eventId
- /api/completed-cues
- /api/cues/load (POST)
- /api/timers/start (POST)
- /api/timers/stop (POST)
- /api/timers/reset (POST)
- /api/lower-thirds.xml?eventId=xxx
- /api/lower-thirds.csv?eventId=xxx
- /api/schedule.xml?eventId=xxx
- /api/schedule.csv?eventId=xxx
- /api/custom-columns.xml?eventId=xxx
- /api/custom-columns.csv?eventId=xxx`);
});

// ========================================
// WebSocket Setup
// ========================================

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

io.on('connection', (socket) => {
    console.log('🔌 WebSocket client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('🔌 WebSocket client disconnected:', socket.id);
    });
});

// ========================================
// Start Server
// ========================================

const PORT = 3002;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log('\n🚀 ========================================');
    console.log('🚀 Local API + WebSocket Server Started!');
    console.log('🚀 ========================================\n');
    console.log(`📍 Local:   http://localhost:${PORT}`);
    console.log(`📍 Network: http://192.168.1.232:${PORT}`);
    console.log(`\n📡 WebSocket: ws://localhost:${PORT}`);
    console.log(`📡 Network:   ws://192.168.1.232:${PORT}\n`);
    console.log('✅ Database: Connected to Neon');
    console.log('✅ CORS: Enabled for all origins');
    console.log('✅ Endpoints: Calendar Events, Run of Show, XML/CSV for VMIX\n');
});
