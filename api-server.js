const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
require('dotenv').config();

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
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching completed cues:', error);
    res.status(500).json({ error: 'Failed to fetch completed cues' });
  }
});

app.post('/api/completed-cues', async (req, res) => {
  try {
    const { event_id, item_id, user_id } = req.body;
    const result = await pool.query(
      'INSERT INTO completed_cues (event_id, item_id, user_id) VALUES ($1, $2, $3) RETURNING *',
      [event_id, item_id, user_id]
    );
    
    // Broadcast update via SSE
    broadcastUpdate(event_id, 'completedCuesUpdated', result.rows[0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error marking cue as completed:', error);
    res.status(500).json({ error: 'Failed to mark cue as completed' });
  }
});

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

// Active Timers endpoints
app.get('/api/active-timers/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [eventId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching active timers:', error);
    res.status(500).json({ error: 'Failed to fetch active timers' });
  }
});

app.post('/api/active-timers', async (req, res) => {
  try {
    const { event_id, item_id, user_id, timer_state, is_active, is_running, started_at, last_loaded_cue_id, cue_is } = req.body;
    
    // Provide default values for required fields
    const user_name = 'Unknown User';
    const user_role = 'OPERATOR';
    const started_at_value = started_at || new Date().toISOString();
    
    const result = await pool.query(
      `INSERT INTO active_timers (event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at, last_loaded_cue_id, cue_is)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at_value, last_loaded_cue_id, cue_is]
    );
    
    // Broadcast update via SSE
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
    const { event_id, user_id } = req.body;
    
    // Stop all active timers for the event
    const result = await pool.query(
      `UPDATE active_timers 
       SET is_running = false, is_active = false, updated_at = NOW()
       WHERE event_id = $1 AND is_running = true
       RETURNING *`,
      [event_id]
    );
    
    // Broadcast update via SSE
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
    const { event_id, item_id, user_id } = req.body;
    
    const result = await pool.query(
      `UPDATE active_timers 
       SET is_running = false, is_active = false, updated_at = NOW()
       WHERE event_id = $1 AND item_id = $2 AND is_running = true
       RETURNING *`,
      [event_id, item_id]
    );
    
    // Broadcast update via SSE
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
    io.to(eventId).emit('update', message);
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

// Socket.IO connection handling
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
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`🔌 Socket.IO client disconnected: ${socket.id}`);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Database: ${process.env.NEON_DATABASE_URL ? 'Connected to Neon' : 'Not configured'}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/api/events/:eventId/stream`);
  console.log(`🔌 Socket.IO endpoint: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down API server...');
  await pool.end();
  process.exit(0);
});

module.exports = app;
