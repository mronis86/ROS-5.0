// API Server for ROS-5.0
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const multer = require('multer');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { parseAgenda, findFirstTimeLineIndex } = require('./lib/agenda-parser');
require('dotenv').config();

// Force Railway rebuild - 2025-02-05 - Backup error details + redeploy
// Auth is now handled via direct database connection
// Neon database with PostgreSQL pg library
// Ensuring Railway picks up latest changes

// Server time sync - clients can sync their clocks once
// No interval needed - just provide server time on request

const app = express();
const server = createServer(app);
// In development, allow any origin (so LAN access e.g. http://192.168.1.233:3003 works)
const isProduction = process.env.NODE_ENV === 'production';
const io = new Server(server, {
  cors: {
    origin: isProduction
      ? [
          "http://localhost:3003",
          "http://localhost:3000",
          "https://your-app.netlify.app",
          "https://your-app.vercel.app"
        ]
      : true, // allow any origin when not in production (local + other computers on LAN)
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3001;

// Database connection with optimized pooling to reduce Neon compute hours
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Reduce max connections (Railway default is 10, we only need 2-3)
  max: 3,
  // Close idle connections after 30 seconds to allow Neon auto-suspend
  idleTimeoutMillis: 30000,
  // Timeout for acquiring a connection from the pool
  connectionTimeoutMillis: 10000,
  // Allow Neon to reclaim resources faster
  allowExitOnIdle: true
});

// Upstash Redis REST API helper - for caching graphics data
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function setUpstashCache(key, value, expirySeconds = 3600) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.log('⚠️ Upstash not configured, skipping cache update');
    return false;
  }
  
  try {
    const response = await fetch(`${UPSTASH_URL}/set/${key}/${value}?EX=${expirySeconds}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`
      }
    });
    
    if (response.ok) {
      console.log(`✅ Upstash cache updated: ${key}`);
      return true;
    } else {
      console.error(`❌ Upstash cache update failed for ${key}:`, response.status);
      return false;
    }
  } catch (error) {
    console.error(`❌ Upstash error for ${key}:`, error.message);
    return false;
  }
}

// Regenerate all Upstash cache formats when schedule updates
async function regenerateUpstashCache(eventId, runOfShowData) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    console.log('⚠️ Upstash not configured, skipping cache regeneration');
    return;
  }
  
  try {
    const scheduleItems = runOfShowData.schedule_items || [];
    
    // Generate Lower Thirds XML
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
                subtitle: [speaker.title, speaker.org].filter(Boolean).join('\n'),
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
      <cue>${item.cue}</cue>
      <program>${item.program}</program>
      <segment>${item.segmentName}</segment>
      ${speakers.map((speaker, idx) => `<speaker${Math.floor(idx/3) + 1}_${['name', 'title', 'photo'][idx % 3]}>${speaker}</speaker${Math.floor(idx/3) + 1}_${['name', 'title', 'photo'][idx % 3]}>`).join('\n      ')}
    </item>`;
    }).join('')}
  </lower_thirds>
</data>`;
    
    const fullXML = xmlHeader + xmlContent;
    
    // Generate CSV
    let csv = 'Row,Cue,Program,Segment Name,Speaker 1 Name,Speaker 1 Title/Org,Speaker 1 Photo,Speaker 2 Name,Speaker 2 Title/Org,Speaker 2 Photo,Speaker 3 Name,Speaker 3 Title/Org,Speaker 3 Photo,Speaker 4 Name,Speaker 4 Title/Org,Speaker 4 Photo,Speaker 5 Name,Speaker 5 Title/Org,Speaker 5 Photo,Speaker 6 Name,Speaker 6 Title/Org,Speaker 6 Photo,Speaker 7 Name,Speaker 7 Title/Org,Speaker 7 Photo\n';
    
    scheduleItems.forEach((item, index) => {
      const speakers = new Array(21).fill('');
      if (item.speakersText) {
        try {
          const speakersArray = typeof item.speakersText === 'string' 
            ? JSON.parse(item.speakersText) 
            : item.speakersText;
          if (Array.isArray(speakersArray)) {
            speakersArray.forEach((speaker) => {
              const slot = speaker.slot || 1;
              if (slot >= 1 && slot <= 7) {
                const baseIdx = (slot - 1) * 3;
                speakers[baseIdx] = speaker.fullName || speaker.name || '';
                speakers[baseIdx + 1] = [speaker.title, speaker.org].filter(Boolean).join('\n');
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
    
    // Update Lower Thirds in Upstash
    await setUpstashCache(`lower-thirds-xml-${eventId}`, encodeURIComponent(fullXML), 3600);
    await setUpstashCache(`lower-thirds-csv-${eventId}`, encodeURIComponent(csv), 3600);
    
    // ========================================
    // Generate Schedule XML & CSV
    // ========================================
    const scheduleXmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <schedule>
    ${scheduleItems.map((item, index) => `
    <item>
      <row>${index + 1}</row>
      <cue>${item.customFields?.cue || ''}</cue>
      <program>${item.programType || ''}</program>
      <segment>${item.segmentName || ''}</segment>
      <duration_hours>${item.durationHours || 0}</duration_hours>
      <duration_minutes>${item.durationMinutes || 0}</duration_minutes>
      <duration_seconds>${item.durationSeconds || 0}</duration_seconds>
      <notes>${item.notes || ''}</notes>
      <has_ppt>${item.hasPPT ? 'true' : 'false'}</has_ppt>
      <has_qa>${item.hasQA ? 'true' : 'false'}</has_qa>
    </item>`).join('')}
  </schedule>
</data>`;
    
    const scheduleXml = xmlHeader + scheduleXmlContent;
    
    let scheduleCsv = 'Row,Cue,Program,Segment Name,Duration Hours,Duration Minutes,Duration Seconds,Notes,Has PPT,Has QA\n';
    scheduleItems.forEach((item, index) => {
      const escapeCsv = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
      scheduleCsv += `${index + 1},${escapeCsv(item.customFields?.cue || '')},${escapeCsv(item.programType || '')},${escapeCsv(item.segmentName || '')},${item.durationHours || 0},${item.durationMinutes || 0},${item.durationSeconds || 0},${escapeCsv(item.notes || '')},${item.hasPPT ? 'Yes' : 'No'},${item.hasQA ? 'Yes' : 'No'}\n`;
    });
    
    await setUpstashCache(`schedule-xml-${eventId}`, encodeURIComponent(scheduleXml), 3600);
    await setUpstashCache(`schedule-csv-${eventId}`, encodeURIComponent(scheduleCsv), 3600);
    
    // ========================================
    // Generate Custom Columns XML & CSV
    // ========================================
    const customColumns = runOfShowData.custom_columns || {};
    const columnKeys = Object.keys(customColumns);
    
    if (columnKeys.length > 0) {
      const customColumnsXmlContent = `
<data>
  <timestamp>${new Date().toISOString()}</timestamp>
  <event_id>${eventId}</event_id>
  <custom_columns>
    ${scheduleItems.map((item, index) => {
      const customFields = item.customFields || {};
      return `
    <item>
      <row>${index + 1}</row>
      ${columnKeys.map(key => `<${key}>${customFields[key] || ''}</${key}>`).join('\n      ')}
    </item>`;
    }).join('')}
  </custom_columns>
</data>`;
      
      const customColumnsXml = xmlHeader + customColumnsXmlContent;
      
      // CSV header with all custom column names
      let customColumnsCsv = 'Row,' + columnKeys.map(key => `"${key}"`).join(',') + '\n';
      scheduleItems.forEach((item, index) => {
        const customFields = item.customFields || {};
        const escapeCsv = (str) => `"${String(str || '').replace(/"/g, '""')}"`;
        customColumnsCsv += `${index + 1}`;
        columnKeys.forEach(key => {
          customColumnsCsv += `,${escapeCsv(customFields[key] || '')}`;
        });
        customColumnsCsv += '\n';
      });
      
      await setUpstashCache(`custom-columns-xml-${eventId}`, encodeURIComponent(customColumnsXml), 3600);
      await setUpstashCache(`custom-columns-csv-${eventId}`, encodeURIComponent(customColumnsCsv), 3600);
    }
    
    console.log('✅ Upstash cache regenerated for event (Lower Thirds + Schedule + Custom Columns):', eventId);
  } catch (error) {
    console.error('❌ Error regenerating Upstash cache:', error);
  }
}

// Middleware
app.use(helmet());
// In development allow any origin (so other computers on LAN can POST e.g. to /api/auth/check-domain)
const corsOptions = process.env.NODE_ENV === 'production'
  ? {}
  : { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] };
app.use(cors(corsOptions));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Multer for agenda file upload (PDF / Word)
const agendaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(pdf|docx)$/i.test(file.originalname) ||
      ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Only PDF and Word (.docx) files are allowed'));
  }
});

// Health check endpoint - lightweight version to reduce Neon queries
app.get('/health', async (req, res) => {
  const upstashConfigured = !!(UPSTASH_URL && UPSTASH_TOKEN);
  const timestamp = new Date().toISOString();
  const railwayMeta = {
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    env: process.env.NODE_ENV || 'development'
  };
  try {
    const result = await pool.query('SELECT 1 AS health, current_database() AS name');
    const neonConnected = result.rows[0].health === 1;
    const dbName = result.rows[0].name || null;
    res.json({
      status: 'healthy',
      timestamp,
      dbConnected: neonConnected,
      database: 'connected',
      upstashConfigured,
      services: {
        neon: { connected: neonConnected, label: 'Neon', dbName },
        railway: { connected: true, label: 'Railway', ...railwayMeta },
        upstash: { configured: upstashConfigured, label: 'Upstash' }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp,
      dbConnected: false,
      upstashConfigured,
      services: {
        neon: { connected: false, label: 'Neon', dbName: null },
        railway: { connected: true, label: 'Railway', ...railwayMeta },
        upstash: { configured: upstashConfigured, label: 'Upstash' }
      }
    });
  }
});

// Admin presence: active events and viewers (protected by ?key=1615)
// Registered early with other /api routes. Handler uses presenceByEvent (defined in Socket section).
app.get('/api/admin/presence', async (req, res) => {
  if (req.query.key !== '1615') {
    console.log('[admin presence] 401 Unauthorized (missing or wrong key)');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const eventIds = Array.from(presenceByEvent.keys());
    console.log('[admin presence] eventIds:', eventIds.length, eventIds.slice(0, 5));
    if (eventIds.length === 0) {
      return res.json({ events: [] });
    }
    const ids = eventIds.map(String);
    const r = await pool.query(
      'SELECT id, name FROM calendar_events WHERE id::text = ANY($1)',
      [ids]
    );
    const idToName = new Map(r.rows.map((row) => [String(row.id), row.name || 'Unknown']));
    const events = eventIds.map((origId) => {
      const eid = String(origId);
      const m = presenceByEvent.get(origId);
      const viewers = m ? Array.from(m.values()).map((v) => ({
        userId: v.userId,
        userName: v.userName || '',
        userEmail: v.userEmail || '',
        userRole: v.userRole || 'VIEWER'
      })) : [];
      return {
        eventId: eid,
        eventName: idToName.get(eid) || `Event ${eid}`,
        viewers
      };
    });
    res.json({ events });
  } catch (err) {
    console.error('[admin presence] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin puzzle (2nd gate): config and verify. Set ADMIN_PUZZLE_COLORS=red,green,blue in env to enable.
const ADMIN_PUZZLE_COLORS_RAW = process.env.ADMIN_PUZZLE_COLORS || '';
const ADMIN_PUZZLE_COLORS = ADMIN_PUZZLE_COLORS_RAW
  ? ADMIN_PUZZLE_COLORS_RAW.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : [];

app.get('/api/admin/puzzle-config', (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (ADMIN_PUZZLE_COLORS.length === 0) {
    return res.json({ enabled: false });
  }
  res.json({ enabled: true, count: ADMIN_PUZZLE_COLORS.length });
});

app.post('/api/admin/puzzle-verify', express.json(), (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (ADMIN_PUZZLE_COLORS.length === 0) {
    return res.json({ ok: true });
  }
  const submitted = (req.body.colors || [])
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean);
  const expected = [...ADMIN_PUZZLE_COLORS].sort();
  const got = [...submitted].sort();
  if (got.length !== expected.length || expected.some((c, i) => c !== got[i])) {
    return res.status(401).json({ error: 'Puzzle incorrect' });
  }
  res.json({ ok: true });
});

// Admin running timers: list events with running timers (protected by ?key=1615)
app.get('/api/admin/running-timers', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await pool.query(
      `SELECT at.event_id, at.item_id, at.cue_is, at.duration_seconds, at.started_at, at.timer_state,
              at.is_active, at.is_running, ce.name AS event_name
       FROM active_timers at
       LEFT JOIN calendar_events ce ON ce.id::text = at.event_id::text
       WHERE at.timer_state = 'running' OR (at.is_active = true AND at.is_running = true)
       ORDER BY at.updated_at DESC`
    );
    const timers = (r.rows || []).map((row) => ({
      eventId: String(row.event_id),
      eventName: row.event_name || `Event ${row.event_id}`,
      itemId: row.item_id,
      cueIs: row.cue_is || `CUE ${row.item_id}`,
      durationSeconds: row.duration_seconds,
      startedAt: row.started_at,
      timerState: row.timer_state,
    }));
    res.json({ timers });
  } catch (err) {
    console.error('[admin running-timers] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin stop timer: stop all timers for an event (protected by ?key=1615)
app.post('/api/admin/stop-timer', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { event_id } = req.body || {};
  if (!event_id) {
    return res.status(400).json({ error: 'event_id required' });
  }
  try {
    const result = await pool.query(
      `UPDATE active_timers
       SET is_running = false, is_active = false, timer_state = 'stopped',
           user_name = COALESCE(user_name, 'Admin'), updated_at = NOW()
       WHERE event_id = $1
       RETURNING *`,
      [event_id]
    );
    const eventId = String(event_id);
    broadcastUpdate(eventId, 'timersStopped', { count: result.rows.length, event_id: eventId });
    res.json({
      success: true,
      stoppedCount: result.rows.length,
      message: `Stopped ${result.rows.length} timer(s) for event ${eventId}`,
    });
  } catch (err) {
    console.error('[admin stop-timer] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin force-disconnect a user (protected by ?key=1615)
// Requires presenceByEvent and socketToEvent from Socket section (defined later in file)
app.post('/api/admin/disconnect-user', (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { eventId, userId } = req.body || {};
  if (!eventId || !userId) {
    return res.status(400).json({ error: 'eventId and userId required' });
  }
  try {
    const m = presenceByEvent.get(String(eventId));
    if (!m) {
      return res.json({ ok: true, disconnected: 0, message: 'No viewers for this event' });
    }
    const toDisconnect = [];
    for (const [sid, v] of m.entries()) {
      if (String(v.userId) === String(userId)) toDisconnect.push(sid);
    }
    for (const sid of toDisconnect) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) {
        sock.emit('forceDisconnect', { reason: 'admin' });
        sock.disconnect(true);
        m.delete(sid);
        socketToEvent.delete(sid);
      }
    }
    if (toDisconnect.length > 0) {
      broadcastPresence(String(eventId));
    }
    console.log(`[admin disconnect-user] eventId=${eventId} userId=${userId} disconnected=${toDisconnect.length}`);
    res.json({ ok: true, disconnected: toDisconnect.length });
  } catch (err) {
    console.error('[admin disconnect-user] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Approved Email Domains (User Domain Admin Auth) ---

// Public: check if email domain is allowed (no auth required)
app.post('/api/auth/check-domain', async (req, res) => {
  try {
    const { email } = req.body || {};
    const domain = typeof email === 'string' ? email.split('@')[1]?.trim().toLowerCase() : null;
    if (!domain || !email.includes('@') || email.includes(' ')) {
      return res.json({ allowed: false, message: 'Invalid email' });
    }
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM public.admin_approved_domains');
    const total = count.rows[0]?.n ?? 0;
    if (total === 0) {
      return res.json({ allowed: true });
    }
    const r = await pool.query(
      'SELECT 1 FROM public.admin_approved_domains WHERE LOWER(domain) = $1',
      [domain]
    );
    if (r.rows.length > 0) {
      return res.json({ allowed: true });
    }
    return res.json({
      allowed: false,
      message: 'Your email domain is not on the approved list. Contact an administrator.'
    });
  } catch (err) {
    console.error('[auth check-domain] error:', err);
    res.status(500).json({ allowed: false, message: 'Unable to verify domain. Please try again.' });
  }
});

// Admin: list approved domains
app.get('/api/admin/approved-domains', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await pool.query(
      'SELECT domain FROM public.admin_approved_domains ORDER BY LOWER(domain)'
    );
    const domains = (r.rows || []).map((row) => row.domain || '').filter(Boolean);
    res.json({ domains });
  } catch (err) {
    const msg = err.message || '';
    const missing = err.code === '42P01' || msg.includes('admin_approved_domains') && (msg.includes('does not exist') || msg.includes('doesn\'t exist'));
    if (missing) {
      return res.json({ domains: [] });
    }
    console.error('[admin approved-domains GET] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: add a domain
app.post('/api/admin/approved-domains', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { domain: raw } = req.body || {};
  const domain = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!domain || domain.includes(' ') || !domain.includes('.')) {
    return res.status(400).json({ error: 'Valid domain required (e.g. company.com)' });
  }
  try {
    await pool.query(
      'INSERT INTO public.admin_approved_domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING',
      [domain]
    );
    const r = await pool.query('SELECT domain FROM public.admin_approved_domains ORDER BY LOWER(domain)');
    const domains = (r.rows || []).map((row) => row.domain || '').filter(Boolean);
    res.json({ ok: true, domains });
  } catch (err) {
    const msg = err.message || '';
    const missing = err.code === '42P01' || (msg.includes('admin_approved_domains') && (msg.includes('does not exist') || msg.includes('doesn\'t exist')));
    if (missing) {
      return res.status(400).json({ error: 'Table admin_approved_domains does not exist. Run migration 024 on Neon.' });
    }
    console.error('[admin approved-domains POST] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: remove a domain (domain in URL path)
app.delete('/api/admin/approved-domains/:domain', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const domain = typeof req.params.domain === 'string' ? req.params.domain.trim().toLowerCase() : '';
  if (!domain) {
    return res.status(400).json({ error: 'Domain required' });
  }
  try {
    await pool.query('DELETE FROM public.admin_approved_domains WHERE LOWER(domain) = $1', [domain]);
    const r = await pool.query('SELECT domain FROM public.admin_approved_domains ORDER BY LOWER(domain)');
    const domains = (r.rows || []).map((row) => row.domain || '').filter(Boolean);
    res.json({ ok: true, domains });
  } catch (err) {
    const msg = err.message || '';
    const missing = err.code === '42P01' || (msg.includes('admin_approved_domains') && (msg.includes('does not exist') || msg.includes('doesn\'t exist')));
    if (missing) {
      return res.status(400).json({ error: 'Table admin_approved_domains does not exist. Run migration 024 on Neon.' });
    }
    console.error('[admin approved-domains DELETE] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin backup config: check if table exists (for debugging "migration required" when Neon says it's there)
app.get('/api/admin/backup-config/check-table', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_backup_config') AS "exists"`
    );
    res.json({ exists: !!r.rows[0]?.exists });
  } catch (err) {
    res.json({ exists: false, error: err.message || String(err) });
  }
});

// Admin backup config: create table in API's DB (same as migration 022) - use when "API sees table: No"
app.post('/api/admin/backup-config/create-table', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await runBackupConfigSyncTable(pool);
    console.log('[admin backup-config] create-table: table created');
    res.json({ ok: true, message: 'Table created' });
  } catch (err) {
    console.error('[admin backup-config create-table] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Full sync: create table if missing with all columns, or add any missing columns. Safe to run anytime.
async function runBackupConfigSyncTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.admin_backup_config (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      gdrive_enabled BOOLEAN NOT NULL DEFAULT false,
      gdrive_folder_id TEXT,
      gdrive_last_run_at TIMESTAMPTZ,
      gdrive_last_status TEXT,
      gdrive_service_account_json TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    INSERT INTO public.admin_backup_config (id, gdrive_enabled, gdrive_folder_id, updated_at)
    VALUES (1, false, NULL, NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await db.query(`
    ALTER TABLE public.admin_backup_config ADD COLUMN IF NOT EXISTS gdrive_service_account_json TEXT
  `);
}

// Admin backup config: sync table (create if not exists, add missing columns). Use when Neon branch schema is wrong.
app.post('/api/admin/backup-config/sync-table', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await runBackupConfigSyncTable(pool);
    console.log('[admin backup-config] sync-table: schema synced');
    res.json({ ok: true, message: 'Table created or updated with correct schema' });
  } catch (err) {
    console.error('[admin backup-config sync-table] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Admin backup config: GET (protected by ?key=1615)
// If table does not exist (migration not run), returns default config + needsMigration so Admin page still loads
app.get('/api/admin/backup-config', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const r = await pool.query(
      'SELECT gdrive_enabled, gdrive_folder_id, gdrive_last_run_at, gdrive_last_status, updated_at FROM public.admin_backup_config WHERE id = 1'
    );
    if (r.rows.length === 0) {
      return res.json({
        enabled: false,
        folderId: '',
        lastRunAt: null,
        lastStatus: null,
        updatedAt: null,
        needsMigration: false,
        hasServiceAccount: false
      });
    }
    const row = r.rows[0];
    let hasServiceAccount = false;
    try {
      const r2 = await pool.query(
        `SELECT (gdrive_service_account_json IS NOT NULL AND TRIM(COALESCE(gdrive_service_account_json,'')) != '') AS has FROM public.admin_backup_config WHERE id = 1`
      );
      if (r2.rows[0]) hasServiceAccount = !!r2.rows[0].has;
    } catch (_) { /* column may not exist before migration 023 */ }
    res.json({
      enabled: !!row.gdrive_enabled,
      folderId: row.gdrive_folder_id || '',
      lastRunAt: row.gdrive_last_run_at,
      lastStatus: row.gdrive_last_status || null,
      updatedAt: row.updated_at,
      needsMigration: false,
      hasServiceAccount
    });
  } catch (err) {
    const msg = err.message || '';
    const isMissingTable = err.code === '42P01' || (msg.includes('admin_backup_config') && (msg.includes('does not exist') || msg.includes('doesn\'t exist')));
    if (isMissingTable) {
      console.warn('[admin backup-config GET] Table missing. Code:', err.code, 'Message:', msg);
      return res.json({
        enabled: false,
        folderId: '',
        lastRunAt: null,
        lastStatus: null,
        updatedAt: null,
        needsMigration: true,
        hasServiceAccount: false
      });
    }
    console.error('[admin backup-config GET] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin backup config: PUT (protected by ?key=1615). Partial update: only provided fields are updated.
// serviceAccountJson: set from Admin (never returned by GET). Send null or '' to clear.
app.put('/api/admin/backup-config', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { enabled, folderId, serviceAccountJson } = req.body || {};
  try {
    const existing = await pool.query(
      'SELECT gdrive_enabled, gdrive_folder_id FROM public.admin_backup_config WHERE id = 1'
    );
    const row = existing.rows[0];
    const newEnabled = enabled !== undefined ? !!enabled : (row && row.gdrive_enabled);
    const newFolderId = folderId !== undefined
      ? (folderId != null && String(folderId).trim() ? String(folderId).trim() : null)
      : (row && row.gdrive_folder_id);

    await pool.query(
      `INSERT INTO public.admin_backup_config (id, gdrive_enabled, gdrive_folder_id, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         gdrive_enabled = $1,
         gdrive_folder_id = $2,
         updated_at = NOW()`,
      [newEnabled, newFolderId]
    );
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'serviceAccountJson')) {
      const jsonVal = serviceAccountJson == null || String(serviceAccountJson).trim() === ''
        ? null
        : String(serviceAccountJson).trim();
      try {
        await pool.query(
          'UPDATE public.admin_backup_config SET gdrive_service_account_json = $1, updated_at = NOW() WHERE id = 1',
          [jsonVal]
        );
      } catch (e) {
        if (e.code === '42703') { /* column does not exist */ }
        else throw e;
      }
    }
    const r = await pool.query(
      'SELECT gdrive_enabled, gdrive_folder_id, updated_at FROM public.admin_backup_config WHERE id = 1'
    );
    const out = r.rows[0] || {};
    res.json({
      enabled: !!out.gdrive_enabled,
      folderId: out.gdrive_folder_id || '',
      updatedAt: out.updated_at
    });
  } catch (err) {
    const msg = err.message || '';
    const isMissingTable = err.code === '42P01' || (msg.includes('admin_backup_config') && (msg.includes('does not exist') || msg.includes('doesn\'t exist')));
    if (isMissingTable) {
      return res.status(400).json({
        error: 'Table admin_backup_config does not exist. Run migration 022 on the same Neon database your API uses (Railway NEON_DATABASE_URL).'
      });
    }
    console.error('[admin backup-config PUT] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Weekly backup to Google Drive (upcoming events, weekly subfolders) ---
function getISOWeekString(date) {
  const d = new Date(date);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const y = mon.getFullYear();
  const jan1 = new Date(y, 0, 1);
  const w = 1 + Math.floor((mon - jan1) / (7 * 24 * 3600 * 1000));
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function escapeCsvCell(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildRunOfShowCSV(row) {
  let scheduleItems = row.schedule_items;
  if (typeof scheduleItems === 'string') scheduleItems = JSON.parse(scheduleItems || '[]');
  if (!Array.isArray(scheduleItems)) scheduleItems = [];
  const customColumns = row.custom_columns || [];
  const customColumnHeaders = (Array.isArray(customColumns) ? customColumns : []).map((c) => c.name || c.id || '');
  const csvHeaders = [
    'ROW', 'CUE', 'Program Type', 'Shot Type', 'Segment Name', 'Duration',
    'Start Time', 'End Time', 'Notes', 'Assets', 'Speakers', 'Has PPT', 'Has QA',
    'Timer ID', 'Is Public', 'Is Indented', 'Day'
  ].concat(customColumnHeaders);
  const cleanNotes = (html) => {
    if (!html) return '';
    return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const rows = scheduleItems.map((item, index) => {
    const durH = item.durationHours ?? 0;
    const durM = item.durationMinutes ?? 0;
    const durS = item.durationSeconds ?? 0;
    const duration = `${durH}:${String(durM).padStart(2, '0')}:${String(durS).padStart(2, '0')}`;
    const programType = item.programType === 'Break F&B/B2B' ? 'Break' : (item.programType || '');
    const base = [
      index + 1,
      item.customFields?.cue || `CUE ${index + 1}`,
      programType,
      item.shotType || '',
      item.segmentName || '',
      duration,
      '', // Start Time - leave empty for backup
      '', // End Time
      cleanNotes(item.notes),
      item.assets || '',
      item.speakersText || '',
      item.hasPPT ? 'Yes' : 'No',
      item.hasQA ? 'Yes' : 'No',
      item.timerId || '',
      item.isPublic ? 'Yes' : 'No',
      item.isIndented ? 'Yes' : 'No',
      item.day ?? 1
    ];
    const customVals = customColumnHeaders.map(() => '');
    if (item.customFields && Array.isArray(customColumns)) {
      customColumns.forEach((col, i) => {
        const id = col.id ?? col.name;
        if (id != null) {
          const v = item.customFields[id] ?? item.customFields[String(id)];
          customVals[i] = v != null ? String(v) : '';
        }
      });
    }
    return base.concat(customVals).map(escapeCsvCell).join(',');
  });
  const headerLine = csvHeaders.map(escapeCsvCell).join(',');
  return '\uFEFF' + [headerLine, ...rows].join('\n');
}

async function runWeeklyBackupToDrive() {
  const configResult = await pool.query(
    'SELECT gdrive_enabled, gdrive_folder_id FROM public.admin_backup_config WHERE id = 1'
  );
  const config = configResult.rows[0];
  if (!config || !config.gdrive_folder_id || !String(config.gdrive_folder_id).trim()) {
    return { ok: false, error: 'Folder ID not set. Set and save the folder ID in Admin.' };
  }
  const folderId = String(config.gdrive_folder_id).trim();
  if (!folderId || folderId === '.' || folderId.length < 10) {
    return { ok: false, error: 'Invalid folder ID. Use the ID from the folder URL (e.g. drive.google.com/drive/folders/XXXXXXXX).' };
  }
  let serviceAccountJson = null;
  try {
    const r2 = await pool.query('SELECT gdrive_service_account_json FROM public.admin_backup_config WHERE id = 1');
    if (r2.rows[0] && r2.rows[0].gdrive_service_account_json) {
      const s = String(r2.rows[0].gdrive_service_account_json).trim();
      if (s) serviceAccountJson = s;
    }
  } catch (_) { /* column may not exist before migration 023 */ }
  if (!serviceAccountJson) serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    await pool.query(
      `UPDATE public.admin_backup_config SET gdrive_last_run_at = NOW(), gdrive_last_status = $1 WHERE id = 1`,
      ['Error: Set service account JSON in Admin (paste below) or set GOOGLE_SERVICE_ACCOUNT_JSON in API env']
    );
    return { ok: false, error: 'Set service account JSON in Admin or set GOOGLE_SERVICE_ACCOUNT_JSON in API env' };
  }
  let credentials;
  try {
    credentials = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  } catch (e) {
    await pool.query(
      `UPDATE public.admin_backup_config SET gdrive_last_run_at = NOW(), gdrive_last_status = $1 WHERE id = 1`,
      ['Error: Invalid service account JSON']
    );
    return { ok: false, error: 'Invalid service account JSON' };
  }
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  if (!token) {
    await pool.query(
      `UPDATE public.admin_backup_config SET gdrive_last_run_at = NOW(), gdrive_last_status = $1 WHERE id = 1`,
      ['Error: Could not get Drive access token']
    );
    return { ok: false, error: 'Could not get Drive access token' };
  }
  const weekName = getISOWeekString(new Date());
  let weekFolderId;
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and name = '${weekName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!listRes.ok) {
      const errBody = await listRes.text();
      throw new Error(`Drive list: ${listRes.status} ${errBody}`);
    }
    const listData = await listRes.json();
    if (listData.files && listData.files.length > 0) {
      weekFolderId = listData.files[0].id;
    } else {
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: weekName, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] })
      });
      if (!createRes.ok) {
        const errBody = await createRes.text();
        throw new Error(`Drive create folder: ${createRes.status} ${errBody}`);
      }
      const createData = await createRes.json();
      weekFolderId = createData.id;
    }
  } catch (e) {
    const msg = e.message || String(e);
    await pool.query(
      `UPDATE public.admin_backup_config SET gdrive_last_run_at = NOW(), gdrive_last_status = $1 WHERE id = 1`,
      [`Drive error: ${msg}`]
    );
    return { ok: false, error: msg };
  }
  const upcomingResult = await pool.query(
    `SELECT event_id, event_name, event_date, schedule_items, custom_columns
     FROM run_of_show_data
     WHERE (event_date::date >= CURRENT_DATE)
     ORDER BY event_date::date ASC`
  );
  const rows = upcomingResult.rows || [];
  const seen = new Map();
  for (const row of rows) {
    const eventDate = row.event_date
      ? (typeof row.event_date === 'string' ? row.event_date : row.event_date.toISOString().slice(0, 10))
      : '';
    const name = String(row.event_name || '').trim();
    const key = `${name}|${eventDate}`;
    if (!key || key === '|') continue;
    if (!seen.has(key)) seen.set(key, row);
  }
  const events = Array.from(seen.values()).sort((a, b) => {
    const dA = a.event_date ? (typeof a.event_date === 'string' ? a.event_date : a.event_date.toISOString().slice(0, 10)) : '';
    const dB = b.event_date ? (typeof b.event_date === 'string' ? b.event_date : b.event_date.toISOString().slice(0, 10)) : '';
    return dA.localeCompare(dB);
  });

  let uploaded = 0;
  const uploadErrors = [];
  for (const row of events) {
    try {
      const csv = buildRunOfShowCSV(row);
      const eventDate = row.event_date ? (typeof row.event_date === 'string' ? row.event_date : row.event_date.toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
      const safeName = (row.event_name || `Event_${row.event_id}`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 100);
      const fileName = `${safeName}_${eventDate}.csv`;
      const boundary = '----ROSBackup_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const metaPart = JSON.stringify({ name: fileName, parents: [weekFolderId] });
      const body = [
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        metaPart,
        `\r\n--${boundary}\r\n`,
        'Content-Type: text/csv; charset=UTF-8\r\n\r\n',
        csv,
        `\r\n--${boundary}--\r\n`
      ].join('');
      const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        throw new Error(`${uploadRes.status}: ${errBody.slice(0, 200)}`);
      }
      uploaded++;
    } catch (e) {
      const msg = e.message || String(e);
      console.error('[backup] upload failed for event', row.event_id, msg);
      uploadErrors.push((row.event_name || row.event_id) + ': ' + msg);
    }
  }
  const status = events.length === 0
    ? 'No upcoming events'
    : uploadErrors.length === events.length && events.length > 0
      ? `Found ${events.length} event(s) but upload failed: ${uploadErrors[0]}`
      : `Uploaded ${uploaded}/${events.length} to ${weekName}`;
  await pool.query(
    `UPDATE public.admin_backup_config SET gdrive_last_run_at = NOW(), gdrive_last_status = $1 WHERE id = 1`,
    [status]
  );
  return { ok: true, weekFolder: weekName, uploaded, total: events.length };
}

// Export upcoming events as JSON (for Google Apps Script or other schedulers to fetch and save to Drive)
// GET /api/backup/upcoming-export?key=1615 → { events: [ { eventId, eventName, eventDate, csv }, ... ] }
app.get('/api/backup/upcoming-export', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await pool.query(
      `SELECT event_id, event_name, event_date, schedule_items, custom_columns
       FROM run_of_show_data
       WHERE (event_date::date >= CURRENT_DATE)
       ORDER BY event_date::date ASC`
    );
    const rows = result.rows || [];
    const seen = new Map();
    for (const row of rows) {
      const eventDate = row.event_date
        ? (typeof row.event_date === 'string' ? row.event_date : row.event_date.toISOString().slice(0, 10))
        : '';
      const name = String(row.event_name || '').trim();
      const key = `${name}|${eventDate}`;
      if (!key || key === '|') continue;
      if (!seen.has(key)) seen.set(key, row);
    }
    const uniqueRows = Array.from(seen.values()).sort((a, b) => {
      const dA = a.event_date ? (typeof a.event_date === 'string' ? a.event_date : a.event_date.toISOString().slice(0, 10)) : '';
      const dB = b.event_date ? (typeof b.event_date === 'string' ? b.event_date : b.event_date.toISOString().slice(0, 10)) : '';
      return dA.localeCompare(dB);
    });
    const events = uniqueRows.map((row) => {
      const csv = buildRunOfShowCSV(row);
      const eventDate = row.event_date
        ? (typeof row.event_date === 'string' ? row.event_date : row.event_date.toISOString().slice(0, 10))
        : new Date().toISOString().slice(0, 10);
      return {
        eventId: row.event_id,
        eventName: row.event_name || `Event_${row.event_id}`,
        eventDate,
        csv
      };
    });
    res.json({ events });
  } catch (err) {
    console.error('[backup/upcoming-export] error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/backup-config/run-now', async (req, res) => {
  if (req.query.key !== '1615') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runWeeklyBackupToDrive();
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    const msg = err && (err.message || String(err));
    const stack = err && err.stack;
    console.error('[admin backup-config run-now] error:', msg, stack || '');
    res.status(500).json({
      error: msg,
      ok: false,
      ...(stack && { errorDetail: stack })
    });
  }
});

// Test endpoint to verify Upstash is working
app.get('/api/test-upstash', async (req, res) => {
  try {
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      return res.json({
        configured: false,
        message: 'Upstash environment variables not set',
        hasURL: !!UPSTASH_URL,
        hasToken: !!UPSTASH_TOKEN
      });
    }
    
    // Try to write a test value
    const testKey = 'test-key';
    const testValue = 'test-value-' + Date.now();
    
    const writeResponse = await fetch(`${UPSTASH_URL}/set/${testKey}/${encodeURIComponent(testValue)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (!writeResponse.ok) {
      return res.json({
        configured: true,
        writeSuccess: false,
        writeStatus: writeResponse.status,
        writeError: await writeResponse.text()
      });
    }
    
    // Try to read it back
    const readResponse = await fetch(`${UPSTASH_URL}/get/${testKey}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (readResponse.ok) {
      const data = await readResponse.json();
      return res.json({
        configured: true,
        writeSuccess: true,
        readSuccess: true,
        testValue: data.result,
        message: 'Upstash is working correctly!'
      });
    }
    
    return res.json({
      configured: true,
      writeSuccess: true,
      readSuccess: false,
      readStatus: readResponse.status
    });
    
  } catch (error) {
    res.status(500).json({
      configured: true,
      error: error.message
    });
  }
});

// Parse agenda from PDF or Word (server-side, no external APIs)
app.get('/api/parse-agenda', (req, res) => {
  res.json({ ok: true, message: 'POST a PDF or .docx file as "file" to parse agenda.' });
});

app.post('/api/parse-agenda', agendaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Send a PDF or Word (.docx) file as "file".' });
    }
    const buf = req.file.buffer;
    const name = (req.file.originalname || '').toLowerCase();
    const isPdf = name.endsWith('.pdf') || req.file.mimetype === 'application/pdf';
    const isDocx = name.endsWith('.docx') || req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    let rawText = '';
    if (isPdf) {
      const data = await pdf(buf);
      rawText = data.text || '';
    } else if (isDocx) {
      const result = await mammoth.extractRawText({ buffer: buf });
      rawText = result.value || '';
    } else {
      return res.status(400).json({ error: 'Unsupported format. Use PDF or Word (.docx) only.' });
    }

    const extractOnly = /^(1|true|yes)$/i.test(String(req.query.extractOnly ?? req.body?.extractOnly ?? '').trim());
    if (extractOnly) {
      const raw = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const rawLines = raw.split('\n');
      const suggestedStartLineIndex = findFirstTimeLineIndex(rawLines);
      return res.json({ rawText: raw, rawLines, suggestedStartLineIndex });
    }

    let startLineIndex = -1;
    const raw = String(req.query.startLineIndex ?? req.body?.startLineIndex ?? '').trim();
    if (raw !== '') {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 0) startLineIndex = n;
    }

    const { items, rawText: parsedRaw, firstTimeLineIndex, rawLines } = parseAgenda(rawText, startLineIndex);
    res.json({ items, rawText: parsedRaw, firstTimeLineIndex, rawLines: rawLines || [] });
  } catch (err) {
    console.error('Parse agenda error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse agenda document.' });
  }
});

// Parse agenda from raw text only (no file). Start line is enforced client-side by slicing before sending.
// Body: { rawText: string }. Always parses from line 0 of the provided text.
app.post('/api/parse-agenda-from-text', async (req, res) => {
  try {
    const rawText = typeof req.body?.rawText === 'string' ? req.body.rawText : '';
    if (!rawText.trim()) {
      return res.status(400).json({ error: 'Missing or empty rawText. Send JSON body: { rawText: string }.' });
    }
    const { items, rawText: parsedRaw, firstTimeLineIndex, rawLines } = parseAgenda(rawText, 0);
    res.json({ items, rawText: parsedRaw, firstTimeLineIndex, rawLines: rawLines || [] });
  } catch (err) {
    console.error('Parse agenda from text error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse agenda text.' });
  }
});

// Note: Authentication is now handled by Neon Auth
// Users are automatically synced to neon_auth.users_sync table
// No custom authentication endpoints needed

// Calendar Events endpoints – ensure schedule_data is always an object for consumers
function normalizeCalendarEvent(row) {
  if (!row) return row;
  const sd = row.schedule_data;
  if (typeof sd === 'string') {
    try {
      row.schedule_data = JSON.parse(sd);
    } catch (e) {
      row.schedule_data = {};
    }
  } else if (sd == null || typeof sd !== 'object') {
    row.schedule_data = row.schedule_data || {};
  }
  return row;
}

app.get('/api/calendar-events', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM calendar_events ORDER BY date DESC'
    );
    const rows = (result.rows || []).map(normalizeCalendarEvent);
    res.json(rows);
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
    res.json(normalizeCalendarEvent(result.rows[0]));
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

// Show mode (rehearsal vs in-show) - global per event, stored in run_of_show_data.settings
app.get('/api/show-mode/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const result = await pool.query(
      'SELECT settings FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );
    if (result.rows.length === 0) {
      return res.json({ showMode: 'rehearsal', trackWasDurations: false });
    }
    const settings = result.rows[0].settings || {};
    const showMode = (settings.show_mode === 'in-show' || settings.show_mode === 'rehearsal')
      ? settings.show_mode
      : 'rehearsal';
    const trackWasDurations = settings.track_was_durations === true;
    res.json({ showMode, trackWasDurations });
  } catch (error) {
    console.error('Error fetching show mode:', error);
    res.status(500).json({ error: 'Failed to fetch show mode' });
  }
});

app.patch('/api/show-mode/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { showMode, trackWasDurations } = req.body;
    const updates = {};
    if (showMode === 'rehearsal' || showMode === 'in-show') {
      updates.show_mode = showMode;
    }
    if (typeof trackWasDurations === 'boolean') {
      updates.track_was_durations = trackWasDurations;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Provide showMode and/or trackWasDurations' });
    }
    const result = await pool.query(
      `UPDATE run_of_show_data 
       SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
       WHERE event_id = $1
       RETURNING *`,
      [eventId, JSON.stringify(updates)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const settings = result.rows[0].settings || {};
    const currentShowMode = (settings.show_mode === 'in-show' || settings.show_mode === 'rehearsal')
      ? settings.show_mode
      : 'rehearsal';
    const currentTrackWasDurations = settings.track_was_durations === true;
    // CRITICAL: Only include showMode in broadcast when we actually updated it.
    // When only trackWasDurations was sent, omit showMode so clients don't overwrite in-show with stale/default.
    const payload = { event_id: eventId, trackWasDurations: currentTrackWasDurations };
    if (showMode === 'rehearsal' || showMode === 'in-show') payload.showMode = currentShowMode;
    broadcastUpdate(eventId, 'showModeUpdate', payload);
    res.json({ showMode: currentShowMode, trackWasDurations: currentTrackWasDurations });
  } catch (error) {
    console.error('Error updating show mode:', error);
    res.status(500).json({ error: 'Failed to update show mode' });
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
                subtitle: [speaker.title, speaker.org].filter(Boolean).join('\n'),
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

    // Cache to Upstash for fast access by Singular.Live, vMix, etc.
    const fullXML = xmlHeader + xmlContent;
    await setUpstashCache(`lower-thirds-xml-${eventId}`, encodeURIComponent(fullXML), 3600);
    
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.send(fullXML);
  } catch (error) {
    console.error('Error in lower-thirds.xml:', error);
    res.set('Content-Type', 'application/xml');
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Internal server error</error>');
  }
});

// ========================================
// UPSTASH CACHED ENDPOINTS
// These endpoints read from Upstash cache for fast, low-cost access
// Perfect for Singular.Live, vMix, and other graphics platforms
// ========================================

// Upstash-cached Lower Thirds XML - for Singular.Live
app.get('/api/cache/lower-thirds.xml', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    console.log('🔄 CACHE REQUEST: Lower Thirds XML for event:', eventId);
    
    if (!eventId) {
      res.set('Content-Type', 'application/xml');
      return res.status(400).send('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
    }
    
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.log('❌ Upstash not configured!');
      return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><error>Cache service not configured</error>');
    }
    
    console.log('📦 Reading from Upstash cache (NOT Neon database)');
    // Get from Upstash cache
    const response = await fetch(`${UPSTASH_URL}/get/lower-thirds-xml-${eventId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const xmlContent = decodeURIComponent(data.result);
        console.log('✅ CACHE HIT: Serving from Upstash (zero Neon queries!)');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        return res.send(xmlContent);
      }
    }
    
    // If not in cache, return error (data will be cached on next update)
    console.log('❌ CACHE MISS: Data not in Upstash yet');
    res.set('Content-Type', 'application/xml');
    res.status(404).send('<?xml version="1.0" encoding="UTF-8"?><error>Data not yet cached. Please update your schedule first.</error>');
    
  } catch (error) {
    console.error('❌ Upstash read error:', error);
    res.set('Content-Type', 'application/xml');
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Cache read error</error>');
  }
});

// Upstash-cached Lower Thirds CSV - for vMix, Singular.Live
app.get('/api/cache/lower-thirds.csv', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    console.log('🔄 CACHE REQUEST: Lower Thirds CSV for event:', eventId);
    
    if (!eventId) {
      res.set('Content-Type', 'text/csv');
      return res.status(400).send('Error,Event ID is required');
    }
    
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.log('❌ Upstash not configured!');
      return res.status(503).send('Error,Cache service not configured');
    }
    
    console.log('📦 Reading from Upstash cache (NOT Neon database)');
    // Get from Upstash cache
    const response = await fetch(`${UPSTASH_URL}/get/lower-thirds-csv-${eventId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const csvContent = decodeURIComponent(data.result);
        console.log('✅ CACHE HIT: Serving from Upstash (zero Neon queries!)');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        return res.send(csvContent);
      }
    }
    
    // If not in cache, return error
    console.log('❌ CACHE MISS: Data not in Upstash yet');
    res.set('Content-Type', 'text/csv');
    res.status(404).send('Error,Data not yet cached. Please update your schedule first.');
    
  } catch (error) {
    console.error('❌ Upstash read error:', error);
    res.set('Content-Type', 'text/csv');
    res.status(500).send('Error,Cache read error');
  }
});

// Upstash-cached Schedule XML
app.get('/api/cache/schedule.xml', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    console.log('🔄 CACHE REQUEST: Schedule XML for event:', eventId);
    
    if (!eventId) {
      res.set('Content-Type', 'application/xml');
      return res.status(400).send('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
    }
    
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.log('❌ Upstash not configured!');
      return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><error>Cache service not configured</error>');
    }
    
    console.log('📦 Reading from Upstash cache (NOT Neon database)');
    const response = await fetch(`${UPSTASH_URL}/get/schedule-xml-${eventId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const xmlContent = decodeURIComponent(data.result);
        console.log('✅ CACHE HIT: Serving Schedule XML from Upstash (zero Neon queries!)');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        return res.send(xmlContent);
      }
    }
    
    console.log('❌ CACHE MISS: Data not in Upstash yet');
    res.set('Content-Type', 'application/xml');
    res.status(404).send('<?xml version="1.0" encoding="UTF-8"?><error>Data not yet cached. Please update your schedule first.</error>');
    
  } catch (error) {
    console.error('❌ Upstash read error:', error);
    res.set('Content-Type', 'application/xml');
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Cache read error</error>');
  }
});

// Upstash-cached Schedule CSV
app.get('/api/cache/schedule.csv', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    console.log('🔄 CACHE REQUEST: Schedule CSV for event:', eventId);
    
    if (!eventId) {
      res.set('Content-Type', 'text/csv');
      return res.status(400).send('Error,Event ID is required');
    }
    
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.log('❌ Upstash not configured!');
      return res.status(503).send('Error,Cache service not configured');
    }
    
    console.log('📦 Reading from Upstash cache (NOT Neon database)');
    const response = await fetch(`${UPSTASH_URL}/get/schedule-csv-${eventId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const csvContent = decodeURIComponent(data.result);
        console.log('✅ CACHE HIT: Serving Schedule CSV from Upstash (zero Neon queries!)');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        return res.send(csvContent);
      }
    }
    
    console.log('❌ CACHE MISS: Data not in Upstash yet');
    res.set('Content-Type', 'text/csv');
    res.status(404).send('Error,Data not yet cached. Please update your schedule first.');
    
  } catch (error) {
    console.error('❌ Upstash read error:', error);
    res.set('Content-Type', 'text/csv');
    res.status(500).send('Error,Cache read error');
  }
});

// Upstash-cached Custom Columns XML
app.get('/api/cache/custom-columns.xml', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    console.log('🔄 CACHE REQUEST: Custom Columns XML for event:', eventId);
    
    if (!eventId) {
      res.set('Content-Type', 'application/xml');
      return res.status(400).send('<?xml version="1.0" encoding="UTF-8"?><error>Event ID is required</error>');
    }
    
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.log('❌ Upstash not configured!');
      return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><error>Cache service not configured</error>');
    }
    
    console.log('📦 Reading from Upstash cache (NOT Neon database)');
    const response = await fetch(`${UPSTASH_URL}/get/custom-columns-xml-${eventId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const xmlContent = decodeURIComponent(data.result);
        console.log('✅ CACHE HIT: Serving Custom Columns XML from Upstash (zero Neon queries!)');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        return res.send(xmlContent);
      }
    }
    
    console.log('❌ CACHE MISS: Data not in Upstash yet');
    res.set('Content-Type', 'application/xml');
    res.status(404).send('<?xml version="1.0" encoding="UTF-8"?><error>Data not yet cached. Please update your schedule first.</error>');
    
  } catch (error) {
    console.error('❌ Upstash read error:', error);
    res.set('Content-Type', 'application/xml');
    res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error>Cache read error</error>');
  }
});

// Upstash-cached Custom Columns CSV
app.get('/api/cache/custom-columns.csv', async (req, res) => {
  try {
    const eventId = req.query.eventId;
    console.log('🔄 CACHE REQUEST: Custom Columns CSV for event:', eventId);
    
    if (!eventId) {
      res.set('Content-Type', 'text/csv');
      return res.status(400).send('Error,Event ID is required');
    }
    
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
      console.log('❌ Upstash not configured!');
      return res.status(503).send('Error,Cache service not configured');
    }
    
    console.log('📦 Reading from Upstash cache (NOT Neon database)');
    const response = await fetch(`${UPSTASH_URL}/get/custom-columns-csv-${eventId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.result) {
        const csvContent = decodeURIComponent(data.result);
        console.log('✅ CACHE HIT: Serving Custom Columns CSV from Upstash (zero Neon queries!)');
        res.set('Content-Type', 'text/csv; charset=utf-8');
        return res.send(csvContent);
      }
    }
    
    console.log('❌ CACHE MISS: Data not in Upstash yet');
    res.set('Content-Type', 'text/csv');
    res.status(404).send('Error,Data not yet cached. Please update your schedule first.');
    
  } catch (error) {
    console.error('❌ Upstash read error:', error);
    res.set('Content-Type', 'text/csv');
    res.status(500).send('Error,Cache read error');
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
            speakersArray.forEach((speaker) => {
              const slot = speaker.slot || 1;
              if (slot >= 1 && slot <= 7) {
                const baseIdx = (slot - 1) * 3;
                speakers[baseIdx] = speaker.fullName || speaker.name || '';
                speakers[baseIdx + 1] = [speaker.title, speaker.org].filter(Boolean).join('\n');
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

    // Cache to Upstash for fast access
    await setUpstashCache(`lower-thirds-csv-${eventId}`, encodeURIComponent(csv), 3600);
    
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
      settings: incomingSettings,
      last_modified_by,
      last_modified_by_name,
      last_modified_by_role
    } = req.body;

    // Preserve show_mode and track_was_durations from DB when not in payload
    // (schedule saves don't include them, which was overwriting In-Show state)
    let settingsToSave = incomingSettings || {};
    const existing = await pool.query(
      'SELECT settings FROM run_of_show_data WHERE event_id = $1',
      [event_id]
    );
    if (existing.rows.length > 0) {
      const current = existing.rows[0].settings || {};
      if (incomingSettings?.show_mode === undefined && (current.show_mode === 'in-show' || current.show_mode === 'rehearsal')) {
        settingsToSave = { ...settingsToSave, show_mode: current.show_mode };
      }
      if (incomingSettings?.track_was_durations === undefined && typeof current.track_was_durations === 'boolean') {
        settingsToSave = { ...settingsToSave, track_was_durations: current.track_was_durations };
      }
      if (incomingSettings?.original_durations === undefined && current.original_durations && typeof current.original_durations === 'object') {
        settingsToSave = { ...settingsToSave, original_durations: current.original_durations };
      }
    }

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
        JSON.stringify(settingsToSave),
        last_modified_by,
        last_modified_by_name,
        last_modified_by_role
      ]
    );
    
    const savedData = result.rows[0];
    
    // Update Upstash cache immediately when schedule changes
    console.log('🔄 Schedule updated - regenerating Upstash cache for all formats...');
    await regenerateUpstashCache(event_id, savedData);
    
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
    
    // Determine if we should use SQL NOW() for started_at to avoid clock drift
    const useServerTime = !started_at || started_at === 'null';
    
    // Handle started_at based on timer state
    let started_at_value;
    if (timer_state === 'running') {
      // For running timers, use provided started_at or we'll use SQL NOW() below
      started_at_value = (started_at && started_at !== 'null') ? started_at : null;
    } else {
      // For loaded timers, use a placeholder timestamp (NOT NULL constraint requires a value)
      started_at_value = (started_at && started_at !== 'null') ? started_at : '2099-12-31T23:59:59.999Z';
    }
    
    console.log('🔄 Processing active timer request:', {
      event_id, item_id, timer_state, is_active, is_running, 
      started_at_original: started_at, started_at_value, useServerTime, duration_seconds
    });
    
    // Build SQL query - use NOW() for started_at when starting timer to avoid clock drift
    let query, params;
    if (useServerTime && timer_state === 'running') {
      // Use SQL NOW() for perfect server time sync
      query = `INSERT INTO active_timers (event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at, last_loaded_cue_id, cue_is, duration_seconds, elapsed_seconds, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, $12, NOW(), NOW())
       ON CONFLICT (event_id) 
       DO UPDATE SET 
         item_id = EXCLUDED.item_id,
         user_id = EXCLUDED.user_id,
         user_name = EXCLUDED.user_name,
         user_role = EXCLUDED.user_role,
         timer_state = EXCLUDED.timer_state,
         is_active = EXCLUDED.is_active,
         is_running = EXCLUDED.is_running,
         started_at = NOW(),
         last_loaded_cue_id = EXCLUDED.last_loaded_cue_id,
         cue_is = EXCLUDED.cue_is,
         duration_seconds = EXCLUDED.duration_seconds,
         elapsed_seconds = EXCLUDED.elapsed_seconds,
         updated_at = NOW()
       RETURNING *`;
      params = [event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, last_loaded_cue_id, cue_is, duration_seconds ?? 300, 0];
    } else {
      // Use provided started_at
      query = `INSERT INTO active_timers (event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at, last_loaded_cue_id, cue_is, duration_seconds, elapsed_seconds, created_at, updated_at)
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
       RETURNING *`;
      params = [event_id, item_id, user_id, user_name, user_role, timer_state, is_active, is_running, started_at_value, last_loaded_cue_id, cue_is, duration_seconds ?? 300, 0];
    }
    
    const result = await pool.query(query, params);
    
    // For debugging: log what we're broadcasting
    console.log('⏰ Timer sync debug:', {
      timer_state,
      db_started_at: result.rows[0].started_at,
      db_elapsed_seconds: result.rows[0].elapsed_seconds,
      duration_seconds: result.rows[0].duration_seconds,
      is_running: result.rows[0].is_running
    });
    
    // Use the elapsed_seconds from the database (which we set to 0 in the SQL)
    // Don't recalculate - it adds delay!
    const timerData = result.rows[0];
    
    // Broadcast update via WebSocket with database elapsed_seconds
    broadcastUpdate(event_id, 'timerUpdated', timerData);
    
    res.status(201).json(timerData);
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
    
    // Broadcast update via WebSocket (include event_id so clients can verify)
    broadcastUpdate(event_id, 'timersStopped', { count: result.rows.length, event_id });
    
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
    
    // Get timer data BEFORE stopping to calculate overtime
    const timerBeforeStop = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 AND item_id = $2',
      [event_id, item_id]
    );
    
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
    
    // Calculate and save overtime if timer was running
    if (timerBeforeStop.rows.length > 0 && timerBeforeStop.rows[0].is_running) {
      const timer = timerBeforeStop.rows[0];
      const startedAt = new Date(timer.started_at);
      const stoppedAt = new Date();
      const actualSeconds = Math.floor((stoppedAt - startedAt) / 1000);
      const scheduledSeconds = timer.duration_seconds || 0;
      const overtimeMinutes = Math.floor((actualSeconds - scheduledSeconds) / 60);
      
      if (Math.abs(overtimeMinutes) >= 1) {
        console.log(`⏰ Server: Overtime detected: ${overtimeMinutes} minutes for item ${item_id}`);
        
        // Save overtime to database
        await pool.query(
          `INSERT INTO overtime_minutes (event_id, item_id, overtime_minutes, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (event_id, item_id)
           DO UPDATE SET 
             overtime_minutes = EXCLUDED.overtime_minutes,
             updated_at = NOW()`,
          [event_id, item_id, overtimeMinutes]
        );
        
        // Broadcast overtime update
        broadcastUpdate(event_id, 'overtimeUpdate', {
          event_id,
          item_id,
          overtimeMinutes
        });
        
        console.log(`✅ Server: Overtime saved and broadcasted: ${overtimeMinutes} minutes`);
      }
    }
    
    // Broadcast timer stop update via WebSocket
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

// Update timer duration (active_timers counter and schedule row duration so the row stays in sync)
app.put('/api/active-timers/:eventId/:itemId/duration', async (req, res) => {
  try {
    const { eventId, itemId } = req.params;
    const itemIdNum = parseInt(itemId, 10);
    const { duration_seconds } = req.body;

    if (!duration_seconds || duration_seconds < 0) {
      return res.status(400).json({ error: 'duration_seconds must be a positive number' });
    }

    // 1. Update the timer duration (counter)
    const result = await pool.query(
      'UPDATE active_timers SET duration_seconds = $1, updated_at = NOW() WHERE event_id = $2 AND item_id = $3',
      [duration_seconds, eventId, itemIdNum]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Active timer not found' });
    }

    // 2. Update the schedule row duration (run_of_show_data.schedule_items) so the row shows the new duration
    const totalSec = Math.floor(Number(duration_seconds)) || 0;
    const durationHours = Math.floor(totalSec / 3600);
    const durationMinutes = Math.floor((totalSec % 3600) / 60);
    const durationSeconds = totalSec % 60;

    const rowResult = await pool.query(
      'SELECT schedule_items FROM run_of_show_data WHERE event_id = $1',
      [eventId]
    );
    if (rowResult.rows.length > 0 && rowResult.rows[0].schedule_items != null) {
      let scheduleItems = rowResult.rows[0].schedule_items;
      if (typeof scheduleItems === 'string') {
        try {
          scheduleItems = JSON.parse(scheduleItems);
        } catch (e) {
          scheduleItems = [];
        }
      }
      if (Array.isArray(scheduleItems)) {
        const idx = scheduleItems.findIndex((item) => {
          const id = item && (item.id !== undefined && item.id !== null) ? item.id : null;
          if (id == null) return false;
          return String(id) === String(itemId) || Number(id) === itemIdNum || String(id) === String(itemIdNum);
        });
        if (idx >= 0) {
          const updated = scheduleItems.map((it, i) =>
            i === idx
              ? { ...it, durationHours, durationMinutes, durationSeconds }
              : it
          );
          await pool.query(
            "UPDATE run_of_show_data SET schedule_items = $2, last_modified_by = 'companion', updated_at = NOW() WHERE event_id = $1",
            [eventId, JSON.stringify(updated)]
          );
          const savedRow = await pool.query('SELECT * FROM run_of_show_data WHERE event_id = $1', [eventId]);
          if (savedRow.rows[0]) {
            const payload = savedRow.rows[0];
            if (typeof payload.schedule_items === 'string') {
              try {
                payload.schedule_items = JSON.parse(payload.schedule_items);
              } catch (e) {}
            }
            broadcastUpdate(eventId, 'runOfShowDataUpdated', payload);
            console.log('⏱️ Row duration updated and broadcast for item_id', itemId);
          }
        } else {
          console.warn('⏱️ Timer duration: schedule item not found for item_id', itemId, '(schedule length:', scheduleItems.length, ')');
        }
      }
    }

    // Get the updated timer data with server-calculated elapsed_seconds
    const timerResult = await pool.query(
      `SELECT *, 
        CASE 
          WHEN is_running = true AND started_at IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (NOW() - started_at))::integer
          ELSE 0
        END as server_elapsed_seconds
      FROM active_timers 
      WHERE event_id = $1 AND item_id = $2`,
      [eventId, itemIdNum]
    );

    const timerData = {
      ...timerResult.rows[0],
      elapsed_seconds: timerResult.rows[0].server_elapsed_seconds
    };

    console.log('⏱️ Timer duration updated (counter + row) - broadcasting:', {
      itemId,
      duration_seconds,
      durationHours,
      durationMinutes,
      durationSeconds,
      elapsed_seconds: timerData.elapsed_seconds,
      is_running: timerData.is_running
    });

    broadcastUpdate(eventId, 'timerUpdated', timerData);

    res.json({
      success: true,
      message: 'Timer duration updated',
      timer: timerData
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

// POST endpoint to create a change log entry
app.post('/api/change-log', async (req, res) => {
  try {
    const {
      event_id,
      user_id,
      user_name,
      user_role,
      action,
      table_name,
      record_id,
      field_name,
      old_value,
      new_value,
      description,
      row_number,
      cue_number,
      metadata
    } = req.body;

    console.log('📝 Logging change:', { event_id, action, user_name, user_role, description, row_number, cue_number });

    const result = await pool.query(
      `INSERT INTO change_log (
        event_id, user_id, user_name, user_role, action, table_name, record_id,
        field_name, old_value, new_value, description, row_number, cue_number,
        old_values_json, new_values_json, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, created_at`,
      [
        event_id,
        user_id,
        user_name,
        user_role,
        action,
        table_name,
        record_id,
        field_name,
        old_value,
        new_value,
        description,
        row_number,
        cue_number,
        old_value ? JSON.stringify(old_value) : null,
        new_value ? JSON.stringify(new_value) : null,
        metadata ? JSON.stringify(metadata) : null
      ]
    );

    console.log('✅ Change logged:', result.rows[0].id);
    res.status(201).json({ id: result.rows[0].id, created_at: result.rows[0].created_at, success: true });
  } catch (error) {
    console.error('Error logging change:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ error: 'Failed to log change', details: error.message });
  }
});

// DELETE endpoint to clear change log for an event
app.delete('/api/change-log/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    console.log('🗑️ Clearing change log for event:', eventId);

    const result = await pool.query(
      'DELETE FROM change_log WHERE event_id = $1 RETURNING id',
      [eventId]
    );

    console.log(`✅ Cleared ${result.rowCount} change log entries`);
    res.json({ success: true, deletedCount: result.rowCount });
  } catch (error) {
    console.error('Error clearing change log:', error);
    res.status(500).json({ error: 'Failed to clear change log' });
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

// Save overtime minutes for a schedule item
app.post('/api/overtime-minutes', async (req, res) => {
  try {
    const { event_id, item_id, overtime_minutes } = req.body;
    
    if (!event_id || !item_id || typeof overtime_minutes !== 'number') {
      return res.status(400).json({ error: 'event_id, item_id, and overtime_minutes are required' });
    }
    
    console.log(`⏰ Saving overtime minutes: Event ${event_id}, Item ${item_id}, Overtime: ${overtime_minutes} minutes`);
    
    // Insert or update overtime in dedicated table (like completed_cues)
    const result = await pool.query(
      `INSERT INTO overtime_minutes (event_id, item_id, overtime_minutes, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (event_id, item_id)
       DO UPDATE SET 
         overtime_minutes = EXCLUDED.overtime_minutes,
         updated_at = NOW()
       RETURNING *`,
      [event_id, item_id, overtime_minutes]
    );
    
    const savedData = result.rows[0];
    console.log(`✅ Overtime saved to database:`, savedData);
    
    // Broadcast update via WebSocket for real-time sync
    broadcastUpdate(event_id, 'overtimeUpdate', {
      event_id,
      item_id,
      overtimeMinutes: overtime_minutes
    });
    
    console.log(`📡 Overtime update broadcasted via WebSocket: ${overtime_minutes} minutes for item ${item_id}`);
    res.json({ success: true, overtime_minutes, item_id, data: savedData });
    
  } catch (error) {
    console.error('❌ Error saving overtime minutes:', error);
    res.status(500).json({ error: 'Failed to save overtime minutes', details: error.message });
  }
});

// Get overtime minutes for an event
app.get('/api/overtime-minutes/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    console.log(`📊 Fetching overtime minutes for event: ${eventId}`);
    console.log(`🔍 Query: SELECT * FROM overtime_minutes WHERE event_id = $1 with eventId: ${eventId}`);
    
    const result = await pool.query(
      'SELECT * FROM overtime_minutes WHERE event_id = $1',
      [eventId]
    );
    
    console.log(`✅ Found ${result.rows.length} overtime records for event ${eventId}`);
    console.log(`📊 Overtime data:`, result.rows.map(row => ({ 
      item_id: row.item_id, 
      overtime_minutes: row.overtime_minutes,
      created_at: row.created_at 
    })));
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Error fetching overtime minutes:', error);
    console.error('❌ Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch overtime minutes', details: error.message });
  }
});

// Delete all overtime minutes for an event (used during reset)
app.delete('/api/overtime-minutes/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    console.log(`⏰ Deleting all overtime minutes for event: ${eventId}`);
    
    const result = await pool.query(
      'DELETE FROM overtime_minutes WHERE event_id = $1 RETURNING *',
      [eventId]
    );
    
    console.log(`✅ Deleted ${result.rows.length} overtime records for event ${eventId}`);
    
    // Broadcast the reset to other clients
    broadcastUpdate(eventId, 'overtimeReset', { event_id: eventId });
    
    res.json({ 
      success: true, 
      deletedCount: result.rows.length,
      message: `Deleted ${result.rows.length} overtime records` 
    });
    
  } catch (error) {
    console.error('❌ Error deleting overtime minutes:', error);
    res.status(500).json({ error: 'Failed to delete overtime minutes', details: error.message });
  }
});

// Save show start overtime for a schedule item (separate from duration overtime)
app.post('/api/show-start-overtime', async (req, res) => {
  try {
    const { event_id, item_id, show_start_overtime, scheduled_time, actual_time } = req.body;
    
    if (!event_id || !item_id || typeof show_start_overtime !== 'number') {
      return res.status(400).json({ error: 'event_id, item_id, and show_start_overtime are required' });
    }
    
    console.log(`⭐ Saving show start overtime: Event ${event_id}, Item ${item_id}, Overtime: ${show_start_overtime} minutes`);
    
    // Insert or update show start overtime in dedicated table
    const result = await pool.query(
      `INSERT INTO show_start_overtime (event_id, item_id, show_start_overtime, scheduled_time, actual_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (event_id, item_id)
       DO UPDATE SET 
         show_start_overtime = EXCLUDED.show_start_overtime,
         scheduled_time = EXCLUDED.scheduled_time,
         actual_time = EXCLUDED.actual_time,
         updated_at = NOW()
       RETURNING *`,
      [event_id, item_id, show_start_overtime, scheduled_time, actual_time]
    );
    
    const savedData = result.rows[0];
    console.log(`✅ Show start overtime saved to database:`, savedData);
    
    // Broadcast update via WebSocket for real-time sync
    broadcastUpdate(event_id, 'showStartOvertimeUpdate', {
      event_id,
      item_id,
      showStartOvertime: show_start_overtime,
      scheduledTime: scheduled_time,
      actualTime: actual_time
    });
    
    console.log(`📡 Show start overtime update broadcasted via WebSocket: ${show_start_overtime} minutes for item ${item_id}`);
    res.json({ success: true, show_start_overtime, item_id, data: savedData });
    
  } catch (error) {
    console.error('❌ Error saving show start overtime:', error);
    res.status(500).json({ error: 'Failed to save show start overtime', details: error.message });
  }
});

// Get show start overtime for an event
app.get('/api/show-start-overtime/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    console.log(`📊 Fetching show start overtime for event: ${eventId}`);
    
    const result = await pool.query(
      'SELECT * FROM show_start_overtime WHERE event_id = $1',
      [eventId]
    );
    
    console.log(`✅ Found ${result.rows.length} show start overtime records for event ${eventId}`);
    
    // Return the first record (there should only be one per event)
    const data = result.rows.length > 0 ? result.rows[0] : null;
    res.json(data);
    
  } catch (error) {
    console.error('❌ Error fetching show start overtime:', error);
    console.error('❌ Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch show start overtime', details: error.message });
  }
});

// Delete show start overtime for an event (used during reset)
app.delete('/api/show-start-overtime/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    console.log(`⭐ Deleting show start overtime for event: ${eventId}`);
    
    const result = await pool.query(
      'DELETE FROM show_start_overtime WHERE event_id = $1 RETURNING *',
      [eventId]
    );
    
    console.log(`✅ Deleted ${result.rows.length} show start overtime records for event ${eventId}`);
    
    // Broadcast the reset to other clients
    broadcastUpdate(eventId, 'showStartOvertimeReset', { event_id: eventId });
    
    res.json({ 
      success: true, 
      deletedCount: result.rows.length,
      message: `Deleted ${result.rows.length} show start overtime records` 
    });
    
  } catch (error) {
    console.error('❌ Error deleting show start overtime:', error);
    res.status(500).json({ error: 'Failed to delete show start overtime', details: error.message });
  }
});

// Save which cue is marked as START (star selection)
app.post('/api/start-cue-selection', async (req, res) => {
  try {
    const { event_id, item_id } = req.body;
    
    if (!event_id || !item_id) {
      return res.status(400).json({ error: 'event_id and item_id are required' });
    }
    
    console.log(`⭐ Saving START cue selection: Event ${event_id}, Item ${item_id}`);
    
    // Convert item_id to BigInt to match the table schema (BIGINT)
    const itemIdBigInt = BigInt(item_id);
    console.log(`🔍 Using item_id as BigInt: ${itemIdBigInt}`);
    
    // Insert or update start cue selection in show_start_overtime table
    // We'll use this table to track both the selection and any overtime
    const result = await pool.query(
      `INSERT INTO show_start_overtime (event_id, item_id, show_start_overtime, created_at, updated_at)
       VALUES ($1, $2, 0, NOW(), NOW())
       ON CONFLICT (event_id, item_id)
       DO UPDATE SET 
         updated_at = NOW()
       RETURNING *`,
      [event_id, itemIdBigInt.toString()]
    );
    
    const savedData = result.rows[0];
    console.log(`✅ START cue selection saved to database:`, savedData);
    
    // Broadcast update via WebSocket for real-time sync
    broadcastUpdate(event_id, 'startCueSelectionUpdate', {
      event_id,
      item_id
    });
    
    console.log(`📡 START cue selection broadcasted via WebSocket: item ${item_id}`);
    res.json({ success: true, item_id, data: savedData });
    
  } catch (error) {
    console.error('❌ Error saving START cue selection:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      query: error.query
    });
    res.status(500).json({ 
      error: 'Failed to save START cue selection', 
      details: error.message,
      code: error.code,
      hint: error.hint
    });
  }
});

// Get which cue is marked as START
app.get('/api/start-cue-selection/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    
    console.log(`📊 Fetching START cue selection for event: ${eventId}`);
    
    const result = await pool.query(
      'SELECT item_id FROM show_start_overtime WHERE event_id = $1',
      [eventId]
    );
    
    console.log(`✅ Found START cue selection for event ${eventId}:`, result.rows.length > 0 ? result.rows[0].item_id : 'none');
    
    // Return the item_id if found, null if not
    const data = result.rows.length > 0 ? { itemId: result.rows[0].item_id } : null;
    res.json(data);
    
  } catch (error) {
    console.error('❌ Error fetching START cue selection:', error);
    console.error('❌ Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch START cue selection', details: error.message });
  }
});

// Server-Sent Events support - DISABLED (redundant with Socket.IO)
// SSE was causing high egress due to heartbeat every 30s per client
// Socket.IO handles all real-time updates more efficiently
const SSEConnections = new Map(); // Store active SSE connections by eventId

// SSE endpoint for real-time updates - DISABLED
app.get('/api/events/:eventId/stream', (req, res) => {
  const { eventId } = req.params;
  
  // DISABLED: SSE is redundant with Socket.IO and causes high egress
  // Just send a message that SSE is disabled and close the connection
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*'
  });
  res.end('SSE disabled - using Socket.IO for real-time updates');
  
  console.log(`⚠️ SSE connection attempt for event ${eventId} - SSE is disabled, use Socket.IO instead`);
});

// Helper function to broadcast updates via Socket.IO only (SSE disabled)
function broadcastUpdate(eventId, updateType, data) {
  const message = {
    type: updateType,
    eventId,
    data,
    timestamp: new Date().toISOString()
  };
  
  // SSE DISABLED - only using Socket.IO to reduce egress
  // const sseConnection = SSEConnections.get(eventId);
  // if (sseConnection) { ... }
  
  // Send via WebSocket (Socket.IO) - ONLY method now
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
      duration_seconds ?? 300
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
    const { event_id, item_id, user_id, started_at } = req.body;
    
    console.log(`⏱️ OSC: Starting timer - Event: ${event_id}, Item: ${item_id}, Started_at: ${started_at}`);
    
    // Use provided started_at timestamp or NOW() as fallback
    const startedAtValue = started_at || 'NOW()';
    const startedAtParam = started_at ? '$3' : 'NOW()';
    const params = started_at ? [event_id, parseInt(item_id), started_at] : [event_id, parseInt(item_id)];
    
    // ONLY update active_timers table (like Supabase RPC did)
    await pool.query(`
      UPDATE active_timers 
      SET 
        is_active = true,
        is_running = true,
        timer_state = 'running',
        started_at = ${startedAtParam},
        updated_at = NOW()
      WHERE event_id = $1 AND item_id = $2
    `, params);
    
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
    
    // Get timer data BEFORE stopping to calculate overtime
    const timerBeforeStop = await pool.query(
      'SELECT * FROM active_timers WHERE event_id = $1 AND item_id = $2',
      [event_id, parseInt(item_id)]
    );
    
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
    
    // Calculate and save overtime if timer was running
    if (timerBeforeStop.rows.length > 0 && timerBeforeStop.rows[0].is_running) {
      const timer = timerBeforeStop.rows[0];
      const startedAt = new Date(timer.started_at);
      const stoppedAt = new Date();
      const actualSeconds = Math.floor((stoppedAt - startedAt) / 1000);
      const scheduledSeconds = timer.duration_seconds || 0;
      const overtimeMinutes = Math.floor((actualSeconds - scheduledSeconds) / 60);
      
      if (Math.abs(overtimeMinutes) >= 1) {
        console.log(`⏰ OSC: Overtime detected: ${overtimeMinutes} minutes for item ${item_id}`);
        
        // Save overtime to database
        await pool.query(
          `INSERT INTO overtime_minutes (event_id, item_id, overtime_minutes, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (event_id, item_id)
           DO UPDATE SET 
             overtime_minutes = EXCLUDED.overtime_minutes,
             updated_at = NOW()`,
          [event_id, parseInt(item_id), overtimeMinutes]
        );
        
        // Broadcast overtime update
        broadcastUpdate(event_id, 'overtimeUpdate', {
          event_id,
          item_id: parseInt(item_id),
          overtimeMinutes
        });
        
        console.log(`✅ OSC: Overtime saved and broadcasted: ${overtimeMinutes} minutes`);
      }
    }
    
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

// Presence: who's viewing Run of Show per event (in-memory, no DB)
const presenceByEvent = new Map(); // eventId -> Map(socketId -> { userId, userName, userRole })
const socketToEvent = new Map();   // socketId -> eventId (for cleanup on disconnect)

function broadcastPresence(eventId) {
  const m = presenceByEvent.get(eventId);
  const list = m ? Array.from(m.values()).map((v) => ({ userId: v.userId, userName: v.userName, userEmail: v.userEmail || '', userRole: v.userRole })) : [];
  io.to(`event:${eventId}`).emit('update', { type: 'presenceUpdated', data: list });
}

io.on('connection', (socket) => {
  console.log(`🔌 Socket.IO client connected: ${socket.id}`);
  
  // Send server time to client immediately on connection for clock sync
  socket.emit('serverTime', { serverTime: new Date().toISOString() });
  
  // Join event room
  socket.on('joinEvent', (eventId) => {
    socket.join(`event:${eventId}`);
    console.log(`🔌 Socket.IO client ${socket.id} joined event:${eventId}`);
    // Send server time again when joining event
    socket.emit('serverTime', { serverTime: new Date().toISOString() });
  });
  
  // Leave event room
  socket.on('leaveEvent', (eventId) => {
    socket.leave(`event:${eventId}`);
    console.log(`🔌 Socket.IO client ${socket.id} left event:${eventId}`);
  });

  // Presence: user viewing Run of Show for this event
  socket.on('presenceJoin', (data) => {
    const { eventId, userId, userName, userEmail, userRole } = data || {};
    if (!eventId || !userId) return;
    if (!presenceByEvent.has(eventId)) presenceByEvent.set(eventId, new Map());
    presenceByEvent.get(eventId).set(socket.id, { userId, userName: userName || '', userEmail: userEmail || '', userRole: userRole || 'VIEWER' });
    socketToEvent.set(socket.id, eventId);
    console.log(`👁️ Presence: ${userName || userId} joined event:${eventId}`);
    broadcastPresence(eventId);
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

  // Handle script scroll position updates
  socket.on('scriptScrollUpdate', (data) => {
    const { eventId, scrollPosition, lineNumber, fontSize } = data;
    console.log(`📜 Script scroll update for event:${eventId} - position: ${scrollPosition}, line: ${lineNumber}, fontSize: ${fontSize}`);
    
    // Broadcast to all other clients in the event room (except sender)
    socket.to(`event:${eventId}`).emit('scriptScrollSync', {
      eventId,
      scrollPosition,
      lineNumber,
      fontSize,
      timestamp: Date.now()
    });
  });

  // Handle comment updates (add, edit, delete)
  socket.on('scriptCommentUpdate', (data) => {
    const { eventId, action, comment, commentId } = data;
    console.log(`💬 Script comment ${action} for event:${eventId}`, commentId);
    
    // Broadcast to all clients in the event room (including sender for confirmation)
    io.to(`event:${eventId}`).emit('scriptCommentSync', {
      action, // 'add', 'edit', 'delete'
      comment,
      commentId,
      timestamp: Date.now()
    });
  });

  // Handle teleprompter settings updates
  socket.on('teleprompterSettingsUpdate', (data) => {
    const { eventId, settings } = data;
    console.log(`🎨 Teleprompter settings update for event:${eventId}`);
    
    // Broadcast to all other clients in the event room (except sender)
    socket.to(`event:${eventId}`).emit('teleprompterSettingsUpdated', {
      eventId,
      settings,
      timestamp: Date.now()
    });
  });

  // Handle teleprompter guide line position updates
  socket.on('teleprompterGuideLineUpdate', (data) => {
    const { eventId, guideLinePosition } = data;
    console.log(`📏 Teleprompter guide line update for event:${eventId}, position:${guideLinePosition}%`);
    
    // Broadcast to all other clients in the event room (except sender)
    socket.to(`event:${eventId}`).emit('teleprompterGuideLineUpdated', {
      eventId,
      guideLinePosition,
      timestamp: Date.now()
    });
  });

  // Handle overtime update event
  socket.on('overtimeUpdate', (data) => {
    const { event_id, item_id, overtimeMinutes } = data;
    console.log(`⏰ Overtime update for event:${event_id}, item:${item_id}, overtime:${overtimeMinutes} minutes`);
    
    // Broadcast to all other clients in the event room (except sender)
    socket.to(`event:${event_id}`).emit('overtimeUpdate', {
      event_id,
      item_id,
      overtimeMinutes
    });
  });

  // Handle show start overtime update event
  socket.on('showStartOvertimeUpdate', (data) => {
    const { event_id, item_id, showStartOvertime, scheduledTime, actualTime } = data;
    console.log(`⭐ Show start overtime update for event:${event_id}, item:${item_id}, overtime:${showStartOvertime} minutes`);
    
    // Broadcast to all other clients in the event room (except sender)
    socket.to(`event:${event_id}`).emit('showStartOvertimeUpdate', {
      event_id,
      item_id,
      showStartOvertime,
      scheduledTime,
      actualTime
    });
  });

  // Handle start cue selection update event
  socket.on('startCueSelectionUpdate', (data) => {
    const { event_id, item_id } = data;
    console.log(`⭐ Start cue selection update for event:${event_id}, item:${item_id}`);
    
    // Broadcast to all other clients in the event room (except sender)
    socket.to(`event:${event_id}`).emit('startCueSelectionUpdate', {
      event_id,
      item_id
    });
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
    const eventId = socketToEvent.get(socket.id);
    if (eventId) {
      const m = presenceByEvent.get(eventId);
      if (m) {
        m.delete(socket.id);
        if (m.size === 0) presenceByEvent.delete(eventId);
      }
      socketToEvent.delete(socket.id);
      broadcastPresence(eventId);
      console.log(`👁️ Presence: socket ${socket.id} left event:${eventId}`);
    }
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

// ========================================
// Scripts Follow API Endpoints
// ========================================

// Get all scripts (list)
app.get('/api/scripts', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, script_name, created_at, updated_at, created_by FROM scripts ORDER BY updated_at DESC'
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching scripts:', error);
    res.status(500).json({ error: 'Failed to fetch scripts' });
  }
});

// Get specific script with comments
app.get('/api/scripts/:scriptId', async (req, res) => {
  try {
    const { scriptId } = req.params;
    const result = await pool.query(
      'SELECT * FROM scripts WHERE id = $1',
      [scriptId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Script not found' });
    }
    
    const script = result.rows[0];
    
    // Get comments for this script
    const commentsResult = await pool.query(
      'SELECT * FROM script_comments WHERE script_id = $1 ORDER BY line_number ASC',
      [script.id]
    );
    
    res.json({
      script: script,
      comments: commentsResult.rows
    });
  } catch (error) {
    console.error('Error fetching script:', error);
    res.status(500).json({ error: 'Failed to fetch script' });
  }
});

// Create new script
app.post('/api/scripts', async (req, res) => {
  try {
    const { script_name, script_text, created_by } = req.body;
    
    const result = await pool.query(
      'INSERT INTO scripts (script_name, script_text, created_by) VALUES ($1, $2, $3) RETURNING *',
      [script_name, script_text, created_by]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating script:', error);
    res.status(500).json({ error: 'Failed to create script' });
  }
});

// Update script
app.put('/api/scripts/:scriptId', async (req, res) => {
  try {
    const { scriptId } = req.params;
    const { script_name, script_text } = req.body;
    
    const result = await pool.query(
      'UPDATE scripts SET script_name = $1, script_text = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [script_name, script_text, scriptId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Script not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating script:', error);
    res.status(500).json({ error: 'Failed to update script' });
  }
});

// Delete script
app.delete('/api/scripts/:scriptId', async (req, res) => {
  try {
    const { scriptId } = req.params;
    
    await pool.query('DELETE FROM scripts WHERE id = $1', [scriptId]);
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting script:', error);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

// Delete all comments for a script
app.delete('/api/script-comments/script/:scriptId', async (req, res) => {
  try {
    const { scriptId } = req.params;
    
    await pool.query('DELETE FROM script_comments WHERE script_id = $1', [scriptId]);
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting script comments:', error);
    res.status(500).json({ error: 'Failed to delete comments' });
  }
});

// Add comment
app.post('/api/script-comments', async (req, res) => {
  try {
    const { script_id, line_number, comment_text, comment_type, author } = req.body;
    
    const result = await pool.query(
      'INSERT INTO script_comments (script_id, line_number, comment_text, comment_type, author) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [script_id, line_number, comment_text, comment_type || 'GENERAL', author]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Update comment
app.put('/api/script-comments/:commentId', async (req, res) => {
  try {
    const { commentId} = req.params;
    const { comment_text } = req.body;
    
    const result = await pool.query(
      'UPDATE script_comments SET comment_text = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [comment_text, commentId]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete comment
app.delete('/api/script-comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    
    await pool.query('DELETE FROM script_comments WHERE id = $1', [commentId]);
    
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Error handler for multer / parse-agenda (return JSON instead of HTML)
app.use((err, req, res, next) => {
  const url = req.originalUrl || '';
  if (url.startsWith('/api/parse-agenda')) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'File too large. Maximum size is 10MB.'
      : (err.message || 'Upload failed.');
    return res.status(400).json({ error: msg });
  }
  next(err);
});

// Start server on all network interfaces (allows local network access)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Network access: http://<your-ip>:${PORT}/health`);
  console.log(`🔗 Database: ${process.env.NEON_DATABASE_URL ? 'Connected to Neon' : 'Not configured'}`);
  console.log(`📡 SSE endpoint: http://localhost:${PORT}/api/events/:eventId/stream`);
  console.log(`🔌 Socket.IO endpoint: ws://localhost:${PORT}`);
  console.log(`🔐 Auth: Using direct database connection`);
  console.log(`💡 Tip: Use 'ipconfig' (Windows) or 'ifconfig' (Mac/Linux) to find your IP address`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down API server...');
  await pool.end();
  process.exit(0);
});

module.exports = app;
