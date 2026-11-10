/**
 * Display clients (Green Room first) — standby heartbeat + queued start/stop commands.
 * Cloud rendezvous so kiosk can see / control PCs that are not on the same LAN.
 */

const crypto = require('crypto');

const STALE_MS = 45 * 1000;
const VALID_KINDS = new Set(['green-room']);
const VALID_STATUS = new Set(['standby', 'active']);
const VALID_ACTIONS = new Set(['start', 'stop', 'assign']);

const DDL = `
  CREATE TABLE IF NOT EXISTS public.display_clients (
    client_id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'green-room',
    name TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'standby',
    event_id TEXT NOT NULL DEFAULT '',
    last_seen TIMESTAMPTZ,
    queued_command JSONB,
    last_command_id TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_display_clients_owner_kind
    ON public.display_clients (owner_key, kind);
  CREATE INDEX IF NOT EXISTS idx_display_clients_last_seen
    ON public.display_clients (last_seen DESC);
`;

let schemaReady = false;

async function ensureDisplayClientsSchema(pool) {
  if (schemaReady) return;
  await pool.query(DDL);
  schemaReady = true;
}

function ownerKeyFromAuth(auth) {
  if (!auth) return null;
  if (auth.type === 'integration' && auth.tokenId) return `itok:${auth.tokenId}`;
  if ((auth.type === 'user' || auth.type === 'neon_user') && auth.userId) {
    return `user:${auth.userId}`;
  }
  if (auth.isAdmin && auth.email) return `admin:${String(auth.email).toLowerCase()}`;
  return null;
}

function normalizeKind(raw) {
  const k = String(raw || 'green-room')
    .trim()
    .toLowerCase();
  return VALID_KINDS.has(k) ? k : 'green-room';
}

function normalizeStatus(raw) {
  const s = String(raw || 'standby')
    .trim()
    .toLowerCase();
  return VALID_STATUS.has(s) ? s : 'standby';
}

function isFresh(lastSeen) {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  return Number.isFinite(t) && Date.now() - t <= STALE_MS;
}

function rowToClient(row) {
  if (!row) return null;
  const fresh = isFresh(row.last_seen);
  const status = fresh ? normalizeStatus(row.status) : 'offline';
  return {
    clientId: row.client_id,
    kind: row.kind,
    name: row.name || row.hostname || row.client_id,
    hostname: row.hostname || '',
    status,
    online: fresh,
    eventId: row.event_id || '',
    lastSeen: row.last_seen || null,
    lastSeenAgeMs: row.last_seen
      ? Math.max(0, Date.now() - new Date(row.last_seen).getTime())
      : null,
    queuedCommand: row.queued_command || null,
    lastCommandId: row.last_command_id || null,
    lastError: row.last_error || '',
    updatedAt: row.updated_at || null,
  };
}

function newCommandId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function registerDisplayClientRoutes(app, { pool }) {
  app.get('/api/display-clients', async (req, res) => {
    try {
      const ownerKey = ownerKeyFromAuth(req.auth);
      if (!ownerKey) return res.status(401).json({ error: 'Authentication required' });
      await ensureDisplayClientsSchema(pool);
      const kind = req.query.kind ? normalizeKind(req.query.kind) : null;
      const rows = kind
        ? (
            await pool.query(
              `SELECT * FROM public.display_clients
               WHERE owner_key = $1 AND kind = $2
               ORDER BY name ASC, client_id ASC`,
              [ownerKey, kind]
            )
          ).rows
        : (
            await pool.query(
              `SELECT * FROM public.display_clients
               WHERE owner_key = $1
               ORDER BY kind ASC, name ASC, client_id ASC`,
              [ownerKey]
            )
          ).rows;
      res.json({
        ok: true,
        staleMs: STALE_MS,
        clients: rows.map(rowToClient),
      });
    } catch (err) {
      console.error('[display-clients] list failed:', err);
      res.status(500).json({ error: err.message || 'Failed to list display clients' });
    }
  });

  app.get('/api/display-clients/:clientId', async (req, res) => {
    try {
      const ownerKey = ownerKeyFromAuth(req.auth);
      if (!ownerKey) return res.status(401).json({ error: 'Authentication required' });
      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) return res.status(400).json({ error: 'clientId required' });
      await ensureDisplayClientsSchema(pool);
      const r = await pool.query(
        `SELECT * FROM public.display_clients WHERE client_id = $1 AND owner_key = $2`,
        [clientId, ownerKey]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Client not found' });
      res.json({ ok: true, client: rowToClient(r.rows[0]) });
    } catch (err) {
      console.error('[display-clients] get failed:', err);
      res.status(500).json({ error: err.message || 'Failed to get display client' });
    }
  });

  /**
   * Client register + heartbeat. Also acks queued commands via lastCommandId.
   * Body: { clientId, name?, hostname?, kind?, status?, eventId?, lastCommandId?, lastError?, meta? }
   */
  app.post('/api/display-clients/heartbeat', async (req, res) => {
    try {
      const ownerKey = ownerKeyFromAuth(req.auth);
      if (!ownerKey) return res.status(401).json({ error: 'Authentication required' });
      const body = req.body || {};
      const clientId = String(body.clientId || body.client_id || '').trim();
      if (!clientId) return res.status(400).json({ error: 'clientId required' });
      await ensureDisplayClientsSchema(pool);

      const kind = normalizeKind(body.kind);
      const status = normalizeStatus(body.status);
      const name = String(body.name || '').trim().slice(0, 120);
      const hostname = String(body.hostname || '').trim().slice(0, 120);
      const eventId = String(body.eventId || body.event_id || '').trim();
      const lastError = String(body.lastError || body.last_error || '').trim().slice(0, 500);
      const ackId = String(body.lastCommandId || body.last_command_id || '').trim() || null;
      const meta = body.meta && typeof body.meta === 'object' ? body.meta : null;

      const existing = await pool.query(
        `SELECT queued_command, last_command_id FROM public.display_clients WHERE client_id = $1`,
        [clientId]
      );
      let queued = existing.rows[0]?.queued_command || null;
      if (
        ackId &&
        queued &&
        String(queued.id || queued.commandId || '') === ackId
      ) {
        queued = null;
      }
      // Ownership: first register wins; later heartbeats must match owner.
      if (existing.rows[0]) {
        const own = await pool.query(
          `SELECT owner_key FROM public.display_clients WHERE client_id = $1`,
          [clientId]
        );
        if (own.rows[0] && own.rows[0].owner_key !== ownerKey) {
          return res.status(403).json({ error: 'Client id owned by another token/account' });
        }
      }

      await pool.query(
        `INSERT INTO public.display_clients (
           client_id, owner_key, kind, name, hostname, status, event_id,
           last_seen, queued_command, last_command_id, last_error, meta, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,$11::jsonb,NOW())
         ON CONFLICT (client_id) DO UPDATE SET
           kind = EXCLUDED.kind,
           name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE display_clients.name END,
           hostname = CASE WHEN EXCLUDED.hostname <> '' THEN EXCLUDED.hostname ELSE display_clients.hostname END,
           status = EXCLUDED.status,
           event_id = EXCLUDED.event_id,
           last_seen = NOW(),
           queued_command = $8,
           last_command_id = COALESCE($9, display_clients.last_command_id),
           last_error = EXCLUDED.last_error,
           meta = COALESCE($11::jsonb, display_clients.meta),
           updated_at = NOW()`,
        [
          clientId,
          ownerKey,
          kind,
          name,
          hostname,
          status,
          eventId,
          queued ? JSON.stringify(queued) : null,
          ackId,
          lastError,
          meta ? JSON.stringify(meta) : null,
        ]
      );

      const r = await pool.query(`SELECT * FROM public.display_clients WHERE client_id = $1`, [
        clientId,
      ]);
      res.json({ ok: true, client: rowToClient(r.rows[0]), staleMs: STALE_MS });
    } catch (err) {
      console.error('[display-clients] heartbeat failed:', err);
      res.status(500).json({ error: err.message || 'Heartbeat failed' });
    }
  });

  /**
   * Queue a command for a standby/active client (kiosk / operator).
   * Body: { action: 'start'|'stop'|'assign', eventId?, page?, url? }
   */
  app.post('/api/display-clients/:clientId/command', async (req, res) => {
    try {
      const ownerKey = ownerKeyFromAuth(req.auth);
      if (!ownerKey) return res.status(401).json({ error: 'Authentication required' });
      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) return res.status(400).json({ error: 'clientId required' });
      const action = String(req.body?.action || '')
        .trim()
        .toLowerCase();
      if (!VALID_ACTIONS.has(action)) {
        return res.status(400).json({ error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` });
      }
      const eventId = String(req.body?.eventId || req.body?.event_id || '').trim();
      if ((action === 'start' || action === 'assign') && !eventId) {
        return res.status(400).json({ error: 'eventId required for start/assign' });
      }
      await ensureDisplayClientsSchema(pool);
      const existing = await pool.query(
        `SELECT * FROM public.display_clients WHERE client_id = $1 AND owner_key = $2`,
        [clientId, ownerKey]
      );
      if (!existing.rows[0]) return res.status(404).json({ error: 'Client not found' });
      if (!isFresh(existing.rows[0].last_seen)) {
        return res.status(409).json({
          error: 'Client is offline (no recent heartbeat)',
          client: rowToClient(existing.rows[0]),
        });
      }

      const page = String(req.body?.page || 'green-room')
        .trim()
        .toLowerCase() || 'green-room';
      const url = String(req.body?.url || '').trim();
      const command = {
        id: newCommandId(),
        action,
        eventId: eventId || existing.rows[0].event_id || '',
        page,
        url,
        queuedAt: new Date().toISOString(),
      };

      await pool.query(
        `UPDATE public.display_clients
         SET queued_command = $2::jsonb,
             event_id = CASE WHEN $3 <> '' THEN $3 ELSE event_id END,
             updated_at = NOW()
         WHERE client_id = $1`,
        [clientId, JSON.stringify(command), eventId]
      );

      const r = await pool.query(`SELECT * FROM public.display_clients WHERE client_id = $1`, [
        clientId,
      ]);
      res.json({ ok: true, command, client: rowToClient(r.rows[0]) });
    } catch (err) {
      console.error('[display-clients] command failed:', err);
      res.status(500).json({ error: err.message || 'Failed to queue command' });
    }
  });

  app.delete('/api/display-clients/:clientId', async (req, res) => {
    try {
      const ownerKey = ownerKeyFromAuth(req.auth);
      if (!ownerKey) return res.status(401).json({ error: 'Authentication required' });
      const clientId = String(req.params.clientId || '').trim();
      if (!clientId) return res.status(400).json({ error: 'clientId required' });
      await ensureDisplayClientsSchema(pool);
      const r = await pool.query(
        `DELETE FROM public.display_clients WHERE client_id = $1 AND owner_key = $2 RETURNING client_id`,
        [clientId, ownerKey]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Client not found' });
      res.json({ ok: true, deleted: clientId });
    } catch (err) {
      console.error('[display-clients] delete failed:', err);
      res.status(500).json({ error: err.message || 'Failed to delete client' });
    }
  });
}

module.exports = {
  STALE_MS,
  ensureDisplayClientsSchema,
  registerDisplayClientRoutes,
  ownerKeyFromAuth,
  rowToClient,
};
