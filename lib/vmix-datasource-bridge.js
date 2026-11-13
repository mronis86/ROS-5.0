/**
 * vMix DataSource Bridge presence — heartbeat per event (mirrors PPT playback live).
 * Bridge POSTs while running; kiosk/Admin GETs to see if it is online for that event.
 */

const { userCanAccessEvent } = require('./api-auth');
const os = require('os');

const CONNECTED_STALE_MS = 25_000;

const DDL = `
  CREATE TABLE IF NOT EXISTS public.vmix_datasource_sessions (
    event_id TEXT PRIMARY KEY,
    connected BOOLEAN NOT NULL DEFAULT false,
    last_seen TIMESTAMPTZ,
    vmix_ok BOOLEAN NOT NULL DEFAULT false,
    vmix_host TEXT NOT NULL DEFAULT '',
    cue_item_id BIGINT,
    cue_label TEXT NOT NULL DEFAULT '',
    match_ok_count INTEGER NOT NULL DEFAULT 0,
    binding_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    hostname TEXT NOT NULL DEFAULT '',
    helper_instance_id TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_vmix_datasource_sessions_last_seen
    ON public.vmix_datasource_sessions (last_seen DESC);
`;

let schemaReady = false;

async function ensureVmixDatasourceSchema(pool) {
  if (schemaReady) return;
  await pool.query(DDL);
  schemaReady = true;
}

function denyIfNoEventAccess(req, res, eventId) {
  if (req.auth && !userCanAccessEvent(req.auth, eventId)) {
    res.status(403).json({ error: 'You do not have access to this event.' });
    return true;
  }
  return false;
}

function sessionOnline(row) {
  if (!row || !row.connected || !row.last_seen) return false;
  return Date.now() - new Date(row.last_seen).getTime() <= CONNECTED_STALE_MS;
}

function mapSession(row) {
  if (!row) {
    return {
      connected: false,
      online: false,
      lastSeen: null,
      vmixOk: false,
      vmixHost: '',
      cueItemId: null,
      cueLabel: '',
      matchOkCount: 0,
      bindingCount: 0,
      lastError: null,
      hostname: '',
      helperInstanceId: '',
    };
  }
  const online = sessionOnline(row);
  return {
    connected: online,
    online,
    lastSeen: row.last_seen || null,
    vmixOk: online ? row.vmix_ok === true : false,
    vmixHost: online ? row.vmix_host || '' : '',
    cueItemId: online && row.cue_item_id != null ? Number(row.cue_item_id) : null,
    cueLabel: online ? row.cue_label || '' : '',
    matchOkCount: online ? Number(row.match_ok_count) || 0 : 0,
    bindingCount: online ? Number(row.binding_count) || 0 : 0,
    lastError: row.last_error || null,
    hostname: online ? row.hostname || '' : '',
    helperInstanceId: row.helper_instance_id || '',
  };
}

function registerVmixDatasourceBridgeRoutes(app, { pool, broadcastUpdate }) {
  app.get('/api/vmix-datasource/:eventId', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensureVmixDatasourceSchema(pool);
      const r = await pool.query(
        'SELECT * FROM public.vmix_datasource_sessions WHERE event_id = $1 LIMIT 1',
        [eventId]
      );
      const session = mapSession(r.rows[0] || null);
      res.json({ eventId, session });
    } catch (err) {
      console.error('[vmix-datasource] GET failed:', err);
      res.status(500).json({ error: err.message || 'Failed to load vMix bridge status' });
    }
  });

  app.post('/api/vmix-datasource/:eventId/live', async (req, res) => {
    try {
      const eventId = String(req.params.eventId || '').trim();
      if (!eventId) return res.status(400).json({ error: 'eventId required' });
      if (denyIfNoEventAccess(req, res, eventId)) return;
      await ensureVmixDatasourceSchema(pool);

      const body = req.body || {};
      const connected = body.connected !== false;
      const vmixOk = body.vmixOk === true || body.vmix_ok === true;
      const vmixHost = String(body.vmixHost || body.vmix_host || '').trim().slice(0, 120);
      const cueItemIdRaw = body.cueItemId ?? body.cue_item_id;
      const cueItemId =
        cueItemIdRaw != null && cueItemIdRaw !== '' && Number.isFinite(Number(cueItemIdRaw))
          ? Number(cueItemIdRaw)
          : null;
      const cueLabel = String(body.cueLabel || body.cue_label || '').trim().slice(0, 200);
      const matchOkCount = Math.max(0, Math.floor(Number(body.matchOkCount ?? body.match_ok_count) || 0));
      const bindingCount = Math.max(0, Math.floor(Number(body.bindingCount ?? body.binding_count) || 0));
      const lastError =
        body.lastError != null || body.last_error != null
          ? String(body.lastError ?? body.last_error ?? '').slice(0, 500)
          : null;
      const hostname = String(body.hostname || os.hostname() || '')
        .trim()
        .slice(0, 120);
      const helperInstanceId = String(body.helperInstanceId || body.helper_instance_id || '')
        .trim()
        .slice(0, 80);

      await pool.query(
        `INSERT INTO public.vmix_datasource_sessions (
           event_id, connected, last_seen, vmix_ok, vmix_host, cue_item_id, cue_label,
           match_ok_count, binding_count, last_error, hostname, helper_instance_id, updated_at
         ) VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (event_id) DO UPDATE SET
           connected = EXCLUDED.connected,
           last_seen = NOW(),
           vmix_ok = EXCLUDED.vmix_ok,
           vmix_host = EXCLUDED.vmix_host,
           cue_item_id = EXCLUDED.cue_item_id,
           cue_label = EXCLUDED.cue_label,
           match_ok_count = EXCLUDED.match_ok_count,
           binding_count = EXCLUDED.binding_count,
           last_error = EXCLUDED.last_error,
           hostname = EXCLUDED.hostname,
           helper_instance_id = COALESCE(NULLIF(EXCLUDED.helper_instance_id, ''), public.vmix_datasource_sessions.helper_instance_id),
           updated_at = NOW()`,
        [
          eventId,
          connected,
          vmixOk,
          vmixHost,
          cueItemId,
          cueLabel,
          matchOkCount,
          bindingCount,
          lastError,
          hostname,
          helperInstanceId,
        ]
      );

      const r = await pool.query(
        'SELECT * FROM public.vmix_datasource_sessions WHERE event_id = $1 LIMIT 1',
        [eventId]
      );
      const session = mapSession(r.rows[0] || null);
      if (typeof broadcastUpdate === 'function') {
        broadcastUpdate(eventId, 'vmixDatasourceStatus', { eventId, session });
      }
      res.json({ eventId, session });
    } catch (err) {
      console.error('[vmix-datasource] live failed:', err);
      res.status(500).json({ error: err.message || 'Failed to update vMix bridge status' });
    }
  });
}

module.exports = {
  CONNECTED_STALE_MS,
  ensureVmixDatasourceSchema,
  registerVmixDatasourceBridgeRoutes,
  mapSession,
  sessionOnline,
};
