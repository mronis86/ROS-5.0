const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
require('dotenv').config();

// Force Railway rebuild - 2025-10-08 - Build #3
// Auth is now handled via direct database connection
// Neon database with PostgreSQL pg library
// Ensuring Railway picks up latest changes

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3003", 
      "http://localhost:3000",
      "https://your-app.netlify.app", // Replace with your actual Netlify URL
      "https://your-app.vercel.app"   // Replace with your actual Vercel URL
    ],
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'healthy', 
      timestamp: result.rows[0].now,
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message 
    });
  }
});

// Note: Authentication is now handled by Neon Auth
// Users are automatically synced to neon_auth.users_sync table
// No custom authentication endpoints needed

// Calendar Events endpoints
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

// Update calendar event
app.put('/api/calendar-events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, schedule_data } = req.body;
    
    console.log('📝 Updating calendar event:', { id, name, date, schedule_data });
    
    const result = await pool.query(
      `UPDATE calendar_events 
       SET name = $1, date = $2, schedule_data = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [name, date, JSON.stringify(schedule_data), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calendar event not found' });
    }
    
    console.log('✅ Calendar event updated successfully:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error updating calendar event:', error);
    res.status(500).json({ error: 'Failed to update calendar event' });
  }
});

// Delete calendar event
app.delete('/api/calendar-events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Deleting calendar event:', id);
    
    const result = await pool.query(
      `DELETE FROM calendar_events WHERE id = $1 RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calendar event not found' });
    }
    
    console.log('✅ Calendar event deleted successfully');
    res.json({ message: 'Calendar event deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting calendar event:', error);
    res.status(500).json({ error: 'Failed to delete calendar event' });
  }
});

// Run of Show Data endpoints
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

// Lower Thirds XML endpoint
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
                photo: speaker.photoLink || ''
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
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.send(xmlHeader + xmlContent);
  } catch (error) {
    console.error('Error in lower-thirds.xml:', error);
    res.set('Content-Type', 'application/xml');
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>');
  }
});

// Lower Thirds CSV endpoint
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
    let csv = 'Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n';

    scheduleItems.forEach((item, index) => {
      const speakers = new Array(21).fill('');
      
      if (item.speakersText) {
        try {
          const speakersArray = typeof item.speakersText === 'string' 
            ? JSON.parse(item.speakersText) 
            : item.speakersText;
          
          if (Array.isArray(speakersArray)) {
            speakersArray.forEach((speaker, speakerIndex) => {
              if (speakerIndex < 7) {
                const baseIdx = speakerIndex * 3;
                speakers[baseIdx] = speaker.fullName || speaker.name || '';
                speakers[baseIdx + 1] = [speaker.title, speaker.org].filter(Boolean).join(', ');
                speakers[baseIdx + 2] = speaker.photoLink || '';
              }
            });
          }
        } catch (e) {
          console.error('Error parsing speakers:', e);
        }
      }

      const escapeCsv = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
      const cue = item.customFields?.cue || '';
      const program = item.programType || '';
      const segmentName = item.segmentName || '';
      
      csv += `${index + 1},${escapeCsv(cue)},${escapeCsv(program)},${escapeCsv(segmentName)}`;
      for (let i = 0; i < 21; i++) {
        csv += `,${escapeCsv(speakers[i])}`;
      }
      csv += '\n';
    });

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.send(csv);
  } catch (error) {
    console.error('Error in lower-thirds.csv:', error);
    res.set('Content-Type', 'text/csv');
    res.status(500).send('Error,Internal server error');
  }
});

app.post('/api/run-of-show-data', async (req, res) => {
  try {
    const {
      event_id,
      event_name,
      event_date,
      schedule_items,
      custom_columns,
      settings,
      last_modified_by,
      last_modified_by_name,
      last_modified_by_role
    } = req.body;

    const result = await pool.query(
      `INSERT INTO run_of_show_data 
       (event_id, event_name, event_date, schedule_items, custom_columns, settings,
        last_modified_by, last_modified_by_name, last_modified_by_role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       ON CONFLICT (event_id) 
       DO UPDATE SET 
         event_name = EXCLUDED.event_name,
         event_date = EXCLUDED.event_date,
         schedule_items = EXCLUDED.schedule_items,
         custom_columns = EXCLUDED.custom_columns,
         settings = EXCLUDED.settings,
         last_modified_by = EXCLUDED.last_modified_by,
         last_modified_by_name = EXCLUDED.last_modified_by_name,
         last_modified_by_role = EXCLUDED.last_modified_by_role,
         last_change_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        event_id,
        event_name,
        event_date,
        JSON.stringify(schedule_items),
        JSON.stringify(custom_columns),
        JSON.stringify(settings),
        last_modified_by,
        last_modified_by_name,
        last_modified_by_role
      ]
    );
    
    const savedData = result.rows[0];
    
    // Broadcast update via SSE
    broadcastUpdate(event_id, 'runOfShowDataUpdated', savedData);
    
    res.json(savedData);
  } catch (error) {
    console.error('Error saving run of show data:', error);
    res.status(500).json({ error: 'Failed to save run of show data' });
  }
});

// Completed Cues endpoints
app.get('/api/completed-cues/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM completed_cues WHERE event_id = $1',
      [eventId]
    );
    
    // Broadcast completed cues update via WebSocket for real-time sync
    broadcastUpdate(eventId, 'completedCuesUpdated', result.rows);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching completed cues:', error);
    res.status(500).json({ error: 'Failed to fetch completed cues' });
  }
});

app.post('/api/completed-cues', async (req, res) => {
  try {
    const { event_id, item_id, user_id, cue_id, user_name, user_role } = req.body;
    
    if (!event_id || !item_id || !user_id) {
      return res.status(400).json({ error: 'event_id, item_id, and user_id are required' });
    }
    
    const result = await pool.query(
      `INSERT INTO completed_cues (event_id, item_id, cue_id, user_id, user_name, user_role, completed_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [
        event_id, 
        item_id, 
        cue_id || `CUE ${item_id}`,
        user_id,
        user_name || 'Unknown User',
        user_role || 'VIEWER'
      ]
    );
    
    // Broadcast update via SSE
    broadcastUpdate(event_id, 'completedCuesUpdated', result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error marking cue as completed:', error);
    res.status(500).json({ error: 'Failed to mark cue as completed' });
  }
});

// Delete all completed cues for an event (MUST come first - more specific route)
app.delete('/api/completed-cues/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    console.log(`🗑️ Deleting all completed cues for event: ${eventId}`);
    
    const result = await pool.query(
      'DELETE FROM completed_cues WHERE event_id = $1 RETURNING *',
      [eventId]
    );
    
    console.log(`✅ Deleted ${result.rows.length} completed cues from Neon database for event: ${eventId}`);
    
    // Broadcast update via SSE
    broadcastUpdate(eventId, 'completedCuesUpdated', { cleared: true, count: result.rows.length });
    
    res.status(204).send();
  } catch (error) {
    console.error('❌ Error clearing all completed cues from Neon:', error);
    res.status(500).json({ error: 'Failed to clear all completed cues' });
  }
});

// Delete a single completed cue
app.delete('/api/completed-cues', async (req, res) => {
  try {
    const { event_id, item_id, user_id } = req.body;
    const result = await pool.query(
      'DELETE FROM completed_cues WHERE event_id = $1 AND item_id = $2 AND user_id = $3 RETURNING *',
      [event_id, item_id, user_id]
    );
    
    // Broadcast update via SSE
    broadcastUpdate(event_id, 'completedCuesUpdated', { removed: true, item_id, user_id });
    
    res.status(204).send();
  } catch (error) {
    console.error('Error unmarking cue as completed:', error);
    res.status(500).json({ error: 'Failed to unmark cue as completed' });
  }
});

// Indented Cues endpoints
app.get('/api/indented-cues/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM indented_cues WHERE event_id = $1',
      [eventId]
    );
    
    // Broadcast indented cues update via WebSocket for real-time sync
    broadcastUpdate(eventId, 'indentedCuesUpdated', result.rows);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching indented cues:', error);
    res.status(500).json({ error: 'Failed to fetch indented cues' });
  }
});

app.post('/api/indented-cues', async (req, res) => {
  try {
    const { event_id, item_id, parent_item_id, user_id, user_name, user_role } = req.body;
    
    if (!event_id || !item_id || !parent_item_id || !user_id) {
      return res.status(400).json({ error: 'event_id, item_id, parent_item_id, and user_id are required' });
    }
    
    const result = await pool.query(
      `INSERT INTO indented_cues (event_id, item_id, parent_item_id, user_id, user_name, user_role, indented_at) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [
        event_id, 
        item_id, 
        parent_item_id,
        user_id,
        user_name || 'Unknown User',
        user_role || 'VIEWER'
      ]
    );
    
    // Broadcast update via SSE
    broadcastUpdate(event_id, 'indentedCuesUpdated', result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error marking cue as indented:', error);
    res.status(500).json({ error: 'Failed to mark cue as indented' });
  }
});

// Delete all indented cues for an event
app.delete('/api/indented-cues/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    console.log(`🗑️ Deleting all indented cues for event: ${eventId}`);
    
    const result = await pool.query(
      'DELETE FROM indented_cues WHERE event_id = $1 RETURNING *',
      [eventId]
    );
    
    console.log(`✅ Deleted ${result.rows.length} indented cues from Neon database for event: ${eventId}`);
    
    // Broadcast update via SSE
    broadcastUpdate(eventId, 'indentedCuesUpdated', { cleared: true, count: result.rows.length });
    
    res.status(204).send();
  } catch (error) {
    console.error('❌ Error clearing all indented cues from Neon:', error);
    res.status(500).json({ error: 'Failed to clear all indented cues' });
  }
});

// Delete a single indented cue
app.delete('/api/indented-cues/:eventId/:itemId', async (req, res) => {
  try {
    const { eventId, itemId } = req.params;
    const result = await pool.query(
      'DELETE FROM indented_cues WHERE event_id = $1 AND item_id = $2 RETURNING *',
      [eventId, itemId]
    );
    
    // Broadcast update via SSE
    broadcastUpdate(eventId, 'indentedCuesUpdated', { removed: true, itemId });
    
    res.status(204).send();
  } catch (error) {
    console.error('Error removing indented cue:', error);
    res.status(500).json({ error: 'Failed to remove indented cue' });
  }
});

// Active Timers endpoints
app.get('/api/active-timers/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [eventId]
    );
    
    // Broadcast active timers update via WebSocket for real-time sync
    broadcastUpdate(eventId, 'activeTimersUpdated', result.rows);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching active timers:', error);
    res.status(500).json({ error: 'Failed to fetch active timers' });
  }
});

app.post('/api/active-timers', async (req, res) => {
  try {
    const { event_id, item_id, user_id, timer_state, is_active, is_running, started_at, last_loaded_cue_id, cue_is, duration_seconds } = req.body;
    
    // Provide default values for required fields
    const user_name = 'Unknown User';
    const user_role = 'OPERATOR';
    // Handle started_at based on timer state
    let started_at_value;
    if (timer_state === 'running') {
      // For running timers, use provided started_at or current time
      started_at_value = (started_at && started_at !== 'null') ? started_at : new Date().toISOString();
    } else {
      // For loaded timers, use a placeholder timestamp (NOT NULL constraint requires a value)
      // We'll use a far future date to indicate "not started yet"
      started_at_value = (started_at && started_at !== 'null') ? started_at : '2099-12-31T23:59:59.999Z';
    }
    
    console.log('🔄 Processing active timer request:', {
      event_id, item_id, timer_state, is_active, is_running, 
      started_at_original: started_at, started_at_value, duration_seconds
    });
    
    // Use UPSERT to ensure only ONE active timer per event
    // If a record exists for this event, update it. Otherwise, insert a new one.
    const result = await pool.query(
      `INSERT INTO active_timers (event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at, last_loaded_cue_id, cue_is, duration_seconds, elapsed_seconds, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
       ON CONFLICT (event_id) 
       DO UPDATE SET 
         item_id = EXCLUDED.item_id,
         user_id = EXCLUDED.user_id,
         user_name = EXCLUDED.user_name,
         user_role = EXCLUDED.user_role,
         timer_state = EXCLUDED.timer_state,
         is_active = EXCLUDED.is_active,
         is_running = EXCLUDED.is_running,
         started_at = EXCLUDED.started_at,
         last_loaded_cue_id = EXCLUDED.last_loaded_cue_id,
         cue_is = EXCLUDED.cue_is,
         duration_seconds = EXCLUDED.duration_seconds,
         elapsed_seconds = EXCLUDED.elapsed_seconds,
         updated_at = NOW()
       RETURNING *`,
      [event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at_value, last_loaded_cue_id, cue_is, duration_seconds || 300, 0]
    );
    
    // Broadcast update via WebSocket
    broadcastUpdate(event_id, 'timerUpdated', result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error saving active timer:', error);
    res.status(500).json({ error: 'Failed to save active timer' });
  }
});

// Stop all timers for an event
app.put('/api/active-timers/stop-all', async (req, res) => {
  try {
    const { event_id, user_id, user_name, user_role } = req.body;
    
    // Stop the single active timer for the event
    const result = await pool.query(
      `UPDATE active_timers 
       SET is_running = false, is_active = false, timer_state = 'stopped',
           user_id = COALESCE($2, user_id), user_name = COALESCE($3, user_name), user_role = COALESCE($4, user_role),
           updated_at = NOW()
       WHERE event_id = $1
       RETURNING *`,
      [event_id, user_id, user_name, user_role]
    );
    
    // Broadcast update via WebSocket
    broadcastUpdate(event_id, 'timersStopped', { count: result.rows.length });
    
    res.json({ 
      success: true, 
      stoppedCount: result.rows.length,
      message: `Stopped ${result.rows.length} active timers`
    });
  } catch (error) {
    console.error('Error stopping all timers:', error);
    res.status(500).json({ error: 'Failed to stop all timers' });
  }
});

// Stop a specific timer
app.put('/api/active-timers/stop', async (req, res) => {
  try {
    const { event_id, item_id, user_id, user_name, user_role } = req.body;
    
    // Update the single active timer record for this event
    const result = await pool.query(
      `UPDATE active_timers 
       SET is_running = false, is_active = false, timer_state = 'stopped', 
           user_id = COALESCE($3, user_id), user_name = COALESCE($4, user_name), user_role = COALESCE($5, user_role),
           updated_at = NOW()
       WHERE event_id = $1 AND (item_id = $2 OR item_id IS NULL)
       RETURNING *`,
      [event_id, item_id, user_id, user_name, user_role]
    );
    
    // Broadcast update via WebSocket
    broadcastUpdate(event_id, 'timerStopped', result.rows[0]);
    
    res.json({ 
      success: true, 
      stopped: result.rows.length > 0,
      timer: result.rows[0] || null
    });
  } catch (error) {
    console.error('Error stopping timer:', error);
    res.status(500).json({ error: 'Failed to stop timer' });
  }
});

// Update timer duration
app.put('/api/active-timers/:eventId/:itemId/duration', async (req, res) => {
  try {
    const { eventId, itemId } = req.params;
    const { duration_seconds } = req.body;
    
    if (!duration_seconds || duration_seconds < 0) {
      return res.status(400).json({ error: 'duration_seconds must be a positive number' });
    }
    
    // Update the timer duration
    const result = await pool.query(
      'UPDATE active_timers SET duration_seconds = $1, updated_at = NOW() WHERE event_id = $2 AND item_id = $3',
      [duration_seconds, eventId, itemId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Active timer not found' });
    }
    
    // Get the updated timer data
    const timerResult = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 AND item_id = $2',
      [eventId, itemId]
    );
    
    // Broadcast update via WebSocket
    broadcastUpdate(eventId, 'timerUpdated', timerResult.rows[0]);
    
    res.json({ 
      success: true, 
      message: 'Timer duration updated',
      timer: timerResult.rows[0]
    });
  } catch (error) {
    console.error('Error updating timer duration:', error);
    res.status(500).json({ error: 'Failed to update timer duration' });
  }
});

// Sub Cue Timers endpoints
app.get('/api/sub-cue-timers/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM sub_cue_timers WHERE event_id = $1 AND is_running = true ORDER BY created_at DESC',
      [eventId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sub-cue timers:', error);
    res.status(500).json({ error: 'Failed to fetch sub-cue timers' });
  }
});

app.post('/api/sub-cue-timers', async (req, res) => {
  try {
    const { 
      event_id, 
      item_id, 
      user_id, 
      user_name,
      user_role,
      duration_seconds, 
      row_number, 
      cue_display, 
      timer_id,
      is_active,
      is_running,
      started_at
    } = req.body;
    
    // Use UPSERT to ensure only one sub-cue timer per event (like active_timers)
    const result = await pool.query(
      `INSERT INTO sub_cue_timers 
       (event_id, item_id, user_id, user_name, user_role, duration_seconds, row_number, cue_display, timer_id, 
        is_active, is_running, started_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (event_id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         user_id = EXCLUDED.user_id,
         user_name = EXCLUDED.user_name,
         user_role = EXCLUDED.user_role,
         duration_seconds = EXCLUDED.duration_seconds,
         row_number = EXCLUDED.row_number,
         cue_display = EXCLUDED.cue_display,
         timer_id = EXCLUDED.timer_id,
         is_active = EXCLUDED.is_active,
         is_running = EXCLUDED.is_running,
         started_at = EXCLUDED.started_at,
         updated_at = NOW()
       RETURNING *`,
      [
        event_id, 
        item_id, 
        user_id,
        user_name || 'Unknown User',
        user_role || 'VIEWER',
        duration_seconds, 
        row_number, 
        cue_display, 
        timer_id,
        is_active !== undefined ? is_active : true,
        is_running !== undefined ? is_running : true,
        started_at || new Date().toISOString()
      ]
    );
    
    // Broadcast update via WebSocket
    broadcastUpdate(event_id, 'subCueTimerStarted', result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error starting sub-cue timer:', error);
    res.status(500).json({ error: 'Failed to start sub-cue timer' });
  }
});

// Change Log endpoints
app.get('/api/change-log/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    
    // Try change_log_batches first, fallback to change_log
    const batchesResult = await pool.query(
      'SELECT * FROM change_log_batches WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2',
      [eventId, limit]
    );

    if (batchesResult.rows.length > 0) {
      // Flatten batches
      const allChanges = [];
      for (const batch of batchesResult.rows) {
        if (batch.changes && Array.isArray(batch.changes)) {
          for (const change of batch.changes) {
            allChanges.push({
              ...change,
              batch_id: batch.id,
              batch_created_at: batch.created_at
            });
          }
        }
      }
      return res.json(allChanges);
    }

    // Fallback to regular change_log
    const result = await pool.query(
      'SELECT * FROM change_log WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2',
      [eventId, limit]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching change log:', error);
    res.status(500).json({ error: 'Failed to fetch change log' });
  }
});

// Timer Messages endpoints
app.get('/api/timer-messages/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM timer_messages WHERE event_id = $1 ORDER BY created_at DESC',
      [eventId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching timer messages:', error);
    res.status(500).json({ error: 'Failed to fetch timer messages' });
  }
});

// Create a new timer message
app.post('/api/timer-messages', async (req, res) => {
  try {
    const { event_id, message, enabled, sent_by, sent_by_name, sent_by_role } = req.body;
    
    if (!event_id || !message) {
      return res.status(400).json({ error: 'event_id and message are required' });
    }
    
    // First, disable any existing active messages for this event
    await pool.query(
      'UPDATE timer_messages SET enabled = false WHERE event_id = $1 AND enabled = true',
      [event_id]
    );
    
    // Create the new message
    const result = await pool.query(
      `INSERT INTO timer_messages 
       (event_id, message, enabled, sent_by, sent_by_name, sent_by_role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [event_id, message, enabled !== undefined ? enabled : true, sent_by, sent_by_name, sent_by_role]
    );
    
    // Broadcast update via WebSocket
    broadcastUpdate(event_id, 'timerMessageUpdated', result.rows[0]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating timer message:', error);
    res.status(500).json({ error: 'Failed to create timer message' });
  }
});

// Stop sub-cue timers
app.put('/api/sub-cue-timers/stop', async (req, res) => {
  try {
    const { event_id, item_id } = req.body;
    
    if (!event_id) {
      return res.status(400).json({ error: 'event_id is required' });
    }
    
    // Stop sub-cue timers (all for event, or specific item if provided)
    const query = item_id 
      ? 'UPDATE sub_cue_timers SET is_running = false, is_active = false, updated_at = NOW() WHERE event_id = $1 AND item_id = $2 RETURNING *'
      : 'UPDATE sub_cue_timers SET is_running = false, is_active = false, updated_at = NOW() WHERE event_id = $1 RETURNING *';
    
    const params = item_id ? [event_id, item_id] : [event_id];
    const result = await pool.query(query, params);
    
    // Broadcast update via WebSocket
    broadcastUpdate(event_id, 'subCueTimerStopped', { event_id, item_id, stopped_count: result.rows.length });
    
    res.json({ 
      message: `Stopped ${result.rows.length} sub-cue timer(s)`,
      stopped_count: result.rows.length,
      timers: result.rows
    });
  } catch (error) {
    console.error('Error stopping sub-cue timers:', error);
    res.status(500).json({ error: 'Failed to stop sub-cue timers' });
  }
});

// Update a timer message
app.put('/api/timer-messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at') {
        updateFields.push(`${key} = $${paramCount}`);
        values.push(updates[key]);
        paramCount++;
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    updateFields.push(`updated_at = NOW()`);
    values.push(id);
    
    const query = `UPDATE timer_messages SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Timer message not found' });
    }
    
    // Broadcast update via WebSocket
    broadcastUpdate(result.rows[0].event_id, 'timerMessageUpdated', result.rows[0]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating timer message:', error);
    res.status(500).json({ error: 'Failed to update timer message' });
  }
});

// Server-Sent Events support
const SSEConnections = new Map(); // Store active SSE connections by eventId

// SSE endpoint for real-time updates
app.get('/api/events/:eventId/stream', (req, res) => {
  const { eventId } = req.params;
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', eventId, timestamp: new Date().toISOString() })}\n\n`);

  // Store connection
  SSEConnections.set(eventId, res);

  // Handle client disconnect
  req.on('close', () => {
    console.log(`🔌 SSE connection closed for event: ${eventId}`);
    SSEConnections.delete(eventId);
  });

  // Send heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    if (!SSEConnections.has(eventId)) {
      clearInterval(heartbeat);
      return;
    }
    res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
  }, 30000);

  console.log(`🔌 SSE connection established for event: ${eventId}`);
});

// Helper function to broadcast updates to SSE clients
function broadcastUpdate(eventId, updateType, data) {
  const message = {
    type: updateType,
    eventId,
    data,
    timestamp: new Date().toISOString()
  };
  
  // Send via SSE (if connection exists)
  const sseConnection = SSEConnections.get(eventId);
  if (sseConnection) {
    try {
      sseConnection.write(`data: ${JSON.stringify(message)}\n\n`);
      console.log(`📡 SSE broadcast sent for event ${eventId}: ${updateType}`);
    } catch (error) {
      console.error('SSE broadcast error:', error);
      SSEConnections.delete(eventId);
    }
  }
  
  // Send via WebSocket (Socket.IO) - PRIMARY method
  if (io) {
    io.to(`event:${eventId}`).emit('update', message);
    console.log(`🔌 WebSocket broadcast sent for event ${eventId}: ${updateType}`);
  }
}

// Helper function to broadcast to all connected clients for an event
function broadcastToAll(eventId, updateType, data) {
  const message = {
    type: updateType,
    eventId,
    data,
    timestamp: new Date().toISOString()
  };
  
  // Broadcast via SSE
  broadcastUpdate(eventId, updateType, data);
  
  // Broadcast via Socket.IO to all clients in the event room
  io.to(`event:${eventId}`).emit('update', message);
  console.log(`📡 Socket.IO broadcast sent to event:${eventId} - ${updateType}`);
}

// ========================================
// OSC Control Endpoints
// ========================================

app.post('/api/cues/load', async (req, res) => {
  try {
    const { event_id, item_id, user_id, duration_seconds, row_is, cue_is, timer_id } = req.body;
    
    console.log(`🎯 OSC: Loading cue - Event: ${event_id}, Item: ${item_id}, Cue: ${cue_is}`);
    
    // ONLY write to active_timers table (like Supabase RPC did)
    // Match the EXACT same fields as React app's /api/active-timers endpoint
    // Use far future date for started_at to indicate "not started yet" (NOT NULL constraint)
    await pool.query(`
      INSERT INTO active_timers (
        event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running,
        started_at, last_loaded_cue_id, cue_is, duration_seconds, elapsed_seconds, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'loaded', true, false, '2099-12-31T23:59:59.999Z', $2, $6, $7, 0, NOW(), NOW())
      ON CONFLICT (event_id) 
      DO UPDATE SET 
        item_id = $2,
        user_id = $3,
        user_name = $4,
        user_role = $5,
        timer_state = 'loaded',
        is_active = true,
        is_running = false,
        started_at = '2099-12-31T23:59:59.999Z',
        last_loaded_cue_id = $2,
        cue_is = $6,
        duration_seconds = $7,
        elapsed_seconds = 0,
        updated_at = NOW()
    `, [
      event_id, 
      parseInt(item_id), 
      user_id || 'python-osc-server',
      'OSC User',
      'OPERATOR',
      cue_is || `CUE ${item_id}`, 
      duration_seconds || 300
    ]);
    
    console.log(`✅ OSC: Cue loaded - Item ${item_id} written to active_timers table`);
    
    // Fetch the complete timer record to send via Socket.IO
    const timerResult = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [event_id]
    );
    const timerData = timerResult.rows[0];
    
    res.json({ 
      success: true, 
      message: 'Cue loaded in active_timers',
      event_id,
      item_id
    });
    
    // Broadcast via Socket.IO to event room with FULL timer data (match /api/active-timers)
    io.to(`event:${event_id}`).emit('update', {
      type: 'timerUpdated',  // Match Browser A's event type
      data: timerData
    });
    console.log(`📡 Socket.IO: timerUpdated broadcast to event:${event_id}`, timerData);
    
  } catch (error) {
    console.error('Error loading cue:', error);
    res.status(500).json({ error: 'Failed to load cue', details: error.message });
  }
});

app.post('/api/timers/start', async (req, res) => {
  try {
    const { event_id, item_id, user_id } = req.body;
    
    console.log(`⏱️ OSC: Starting timer - Event: ${event_id}, Item: ${item_id}`);
    
    // ONLY update active_timers table (like Supabase RPC did)
    await pool.query(`
      UPDATE active_timers 
      SET 
        is_active = true,
        is_running = true,
        timer_state = 'running',
        started_at = NOW(),
        updated_at = NOW()
      WHERE event_id = $1 AND item_id = $2
    `, [event_id, parseInt(item_id)]);
    
    console.log(`✅ OSC: Timer started for item ${item_id} in active_timers table`);
    
    // Fetch the complete timer record to send via Socket.IO
    const timerResult = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [event_id]
    );
    const timerData = timerResult.rows[0];
    
    res.json({ 
      success: true, 
      message: 'Timer started',
      event_id,
      item_id
    });
    
    // Broadcast via Socket.IO to event room with FULL timer data (match /api/active-timers)
    io.to(`event:${event_id}`).emit('update', {
      type: 'timerUpdated',  // Match Browser A's event type
      data: timerData
    });
    console.log(`📡 Socket.IO: timerUpdated broadcast to event:${event_id}`);
    
  } catch (error) {
    console.error('Error starting timer:', error);
    res.status(500).json({ error: 'Failed to start timer', details: error.message });
  }
});

app.post('/api/timers/stop', async (req, res) => {
  try {
    const { event_id, item_id } = req.body;
    
    console.log(`⏹️ OSC: Stopping timer - Event: ${event_id}, Item: ${item_id}`);
    
    // ONLY update active_timers table (like Supabase RPC did)
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
    
    // Fetch the complete timer record to send via Socket.IO
    const timerResult = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [event_id]
    );
    const timerData = timerResult.rows[0];
    
    res.json({ 
      success: true, 
      message: 'Timer stopped',
      event_id,
      item_id
    });
    
    // Broadcast via Socket.IO to event room with FULL timer data (match /api/active-timers)
    io.to(`event:${event_id}`).emit('update', {
      type: 'timerStopped',  // Match Browser A's event type for stop
      data: timerData
    });
    console.log(`📡 Socket.IO: timerStopped broadcast to event:${event_id}`);
    
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
    // DO NOT touch run_of_show_data table
    
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
    
    // Broadcast via Socket.IO to event room
    io.to(`event:${event_id}`).emit('update', {
      type: 'resetAllStates',
      data: { event_id }
    });
    console.log(`📡 Socket.IO: resetAllStates broadcast to event:${event_id}`);
    
  } catch (error) {
    console.error('Error resetting timer:', error);
    res.status(500).json({ error: 'Failed to reset timer', details: error.message });
  }
});

// ========================================
// Socket.IO connection handling
// ========================================

io.on('connection', (socket) => {
  console.log(`🔌 Socket.IO client connected: ${socket.id}`);
  
  // Join event room
  socket.on('joinEvent', (eventId) => {
    socket.join(`event:${eventId}`);
    console.log(`🔌 Socket.IO client ${socket.id} joined event:${eventId}`);
  });
  
  // Leave event room
  socket.on('leaveEvent', (eventId) => {
    socket.leave(`event:${eventId}`);
    console.log(`🔌 Socket.IO client ${socket.id} left event:${eventId}`);
  });
  
  // Handle reset all states event
  socket.on('resetAllStates', (data) => {
    console.log(`🔄 Reset all states requested for event: ${data.eventId}`);
    // Broadcast reset event to all clients in the event room
    io.to(`event:${data.eventId}`).emit('update', {
      type: 'resetAllStates',
      data: { eventId: data.eventId }
    });
    
    // Also broadcast completed cues cleared event
    io.to(`event:${data.eventId}`).emit('update', {
      type: 'completedCuesUpdated',
      data: { cleared: true, eventId: data.eventId }
    });
    
    console.log(`📡 Reset all states and completed cues cleared broadcasted to event:${data.eventId}`);
  });

  // Handle sync request event
  socket.on('requestSync', async (data) => {
    console.log(`🔄 Sync request received for event: ${data.eventId}`);
    
    try {
      // Get fresh data from database
      const runOfShowData = await pool.query(
        'SELECT * FROM run_of_show_data WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [data.eventId]
      );
      
      if (runOfShowData.rows.length > 0) {
        const freshData = runOfShowData.rows[0];
        console.log(`📡 Sync: Broadcasting fresh data for event: ${data.eventId}`);
        
        // Broadcast fresh data to all clients in the event room
        io.to(`event:${data.eventId}`).emit('update', {
          type: 'runOfShowDataUpdated',
          data: freshData
        });
        
        console.log(`✅ Sync: Fresh data broadcasted to event:${data.eventId}`);
      } else {
        console.log(`⚠️ Sync: No data found for event: ${data.eventId}`);
      }
    } catch (error) {
      console.error('❌ Sync request error:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Socket.IO client disconnected: ${socket.id}`);
  });
});

// ===========================================
// BACKUP API ENDPOINTS
// ===========================================

// Test backup table access
app.get('/api/backups/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 FROM run_of_show_backups LIMIT 1');
    res.json({ status: 'success', message: 'Backup table accessible' });
  } catch (error) {
    console.error('❌ Backup table test failed:', error);
    res.status(500).json({ error: 'Backup table not accessible' });
  }
});

// Create or update backup
app.post('/api/backups', async (req, res) => {
  try {
    const {
      event_id,
      event_name,
      event_date,
      event_location,
      backup_name,
      backup_type,
      schedule_data,
      custom_columns_data,
      event_data,
      schedule_items_count,
      custom_columns_count,
      created_by,
      created_by_name,
      created_by_role
    } = req.body;

    console.log(`🔄 Creating/updating ${backup_type} backup for event: ${event_id}`);

    // Check if backup already exists for this event and date
    const existingBackup = await pool.query(
      'SELECT id FROM run_of_show_backups WHERE event_id = $1 AND event_date = $2',
      [event_id, event_date]
    );

    let result;

    if (existingBackup.rows.length > 0) {
      // Update existing backup
      console.log(`🔄 Updating existing backup for ${event_name} on ${event_date}`);
      
      const updateResult = await pool.query(`
        UPDATE run_of_show_backups 
        SET 
          backup_name = $1,
          schedule_data = $2,
          custom_columns_data = $3,
          event_data = $4,
          backup_type = $5,
          event_name = $6,
          event_location = $7,
          schedule_items_count = $8,
          custom_columns_count = $9,
          created_by = $10,
          created_by_name = $11,
          created_by_role = $12,
          updated_at = NOW()
        WHERE id = $13
        RETURNING *
      `, [
        backup_name,
        JSON.stringify(schedule_data),
        JSON.stringify(custom_columns_data),
        JSON.stringify(event_data),
        backup_type,
        event_name,
        event_location,
        schedule_items_count,
        custom_columns_count,
        created_by,
        created_by_name,
        created_by_role,
        existingBackup.rows[0].id
      ]);

      result = updateResult.rows[0];
      console.log(`✅ Backup updated successfully: ${result.backup_name}`);
    } else {
      // Create new backup
      console.log(`🔄 Creating new backup for ${event_name} on ${event_date}`);
      
      const insertResult = await pool.query(`
        INSERT INTO run_of_show_backups (
          event_id, event_name, event_date, event_location,
          backup_name, backup_type, schedule_data, custom_columns_data,
          event_data, schedule_items_count, custom_columns_count,
          created_by, created_by_name, created_by_role
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
      `, [
        event_id, event_name, event_date, event_location,
        backup_name, backup_type, JSON.stringify(schedule_data),
        JSON.stringify(custom_columns_data), JSON.stringify(event_data),
        schedule_items_count, custom_columns_count,
        created_by, created_by_name, created_by_role
      ]);

      result = insertResult.rows[0];
      console.log(`✅ Backup created successfully: ${result.backup_name}`);
    }

    res.json(result);
  } catch (error) {
    console.error('❌ Error creating/updating backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get backups for specific event
app.get('/api/backups/event/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    console.log(`🔄 Fetching backups for event: ${eventId}`);

    const result = await pool.query(`
      SELECT * FROM run_of_show_backups 
      WHERE event_id = $1 
      ORDER BY backup_timestamp DESC
    `, [eventId]);

    console.log(`✅ Found ${result.rows.length} backups for event: ${eventId}`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching backups:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get backups with filters
app.get('/api/backups', async (req, res) => {
  try {
    const { eventId, eventName, eventDate, backupType, sortBy, limit } = req.query;
    console.log('🔄 Fetching backups with filters:', req.query);

    let query = 'SELECT * FROM run_of_show_backups WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (eventId) {
      query += ` AND event_id = $${++paramCount}`;
      params.push(eventId);
    }
    if (eventName) {
      query += ` AND event_name ILIKE $${++paramCount}`;
      params.push(`%${eventName}%`);
    }
    if (eventDate) {
      query += ` AND event_date = $${++paramCount}`;
      params.push(eventDate);
    }
    if (backupType) {
      query += ` AND backup_type = $${++paramCount}`;
      params.push(backupType);
    }

    // Apply sorting
    switch (sortBy) {
      case 'oldest':
        query += ' ORDER BY backup_timestamp ASC';
        break;
      case 'event':
        query += ' ORDER BY event_name ASC';
        break;
      case 'type':
        query += ' ORDER BY backup_type ASC';
        break;
      case 'newest':
      default:
        query += ' ORDER BY backup_timestamp DESC';
        break;
    }

    if (limit) {
      query += ` LIMIT $${++paramCount}`;
      params.push(parseInt(limit));
    }

    const result = await pool.query(query, params);
    console.log(`✅ Found ${result.rows.length} backups with filters`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching backups with filters:', error);
    res.status(500).json({ error: error.message });
  }
});

// Restore from backup
app.get('/api/backups/:backupId/restore', async (req, res) => {
  try {
    const { backupId } = req.params;
    console.log(`🔄 Restoring from backup: ${backupId}`);

    const result = await pool.query(
      'SELECT * FROM run_of_show_backups WHERE id = $1',
      [backupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    const backup = result.rows[0];
    console.log(`✅ Restored from backup: ${backup.backup_name}`);
    
    res.json({
      schedule_data: backup.schedule_data,
      custom_columns_data: backup.custom_columns_data,
      event_data: backup.event_data,
      backup_name: backup.backup_name,
      backup_timestamp: backup.backup_timestamp
    });
  } catch (error) {
    console.error('❌ Error restoring from backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete backup
app.delete('/api/backups/:backupId', async (req, res) => {
  try {
    const { backupId } = req.params;
    console.log(`🔄 Deleting backup: ${backupId}`);

    const result = await pool.query(
      'DELETE FROM run_of_show_backups WHERE id = $1 RETURNING backup_name',
      [backupId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    console.log(`✅ Backup deleted successfully: ${result.rows[0].backup_name}`);
    res.json({ success: true, message: 'Backup deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting backup:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auth is now handled via direct database connection


// Start server
server.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Database: ${process.env.NEON_DATABASE_URL ? 'Connected to Neon' : 'Not configured'}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/api/events/:eventId/stream`);
  console.log(`🔌 Socket.IO endpoint: ws://localhost:${PORT}`);
  console.log(`🔐 Auth: Using direct database connection`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down API server...');
  await pool.end();
  process.exit(0);
});

module.exports = app;
