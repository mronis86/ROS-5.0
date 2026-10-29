/**
 * Restricted users can see every calendar event and request access.
 * Event Managers / Crew / Admins approve or deny from the Event List banner.
 * ROS and per-event APIs stay gated by userCanAccessEvent.
 */

const { appendEventToUserAllowlist } = require('./event-share-access');
const { userCanManageAccess } = require('./api-auth');

function isMissingAccessRequestTableError(err) {
  return err && (err.code === '42P01' || /api_event_access_requests/i.test(String(err.message || '')));
}

function isQuickModeCalendarRow(event) {
  const sd = event && typeof event.schedule_data === 'object' ? event.schedule_data : {};
  if (sd.quickMode === true) return true;
  if (sd.source === 'quick-mode') return true;
  return /^Quick Mode/i.test(String(event?.name || ''));
}

function sanitizeLockedCalendarEvent(event) {
  const next = { ...event };
  if (next.schedule_data && typeof next.schedule_data === 'object') {
    const scheduleData = { ...next.schedule_data };
    delete scheduleData.streamDetails;
    next.schedule_data = scheduleData;
  }
  return next;
}

async function ensureEventAccessRequestsSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.api_event_access_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      access_id UUID NOT NULL REFERENCES public.api_user_access(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewed_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_event_access_requests_pending
      ON public.api_event_access_requests (access_id, event_id)
      WHERE status = 'pending'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_access_requests_status
      ON public.api_event_access_requests (status, created_at)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_api_event_access_requests_event
      ON public.api_event_access_requests (event_id)
  `);
}

function withOpenAccess(event) {
  return { ...event, canAccess: true, accessRequestStatus: null };
}

/**
 * Event list shows every event. Locked rows stay unopenable and hide stream keys.
 * If the requests table is missing, fall back to the old hide-unassigned list.
 */
async function annotateCalendarEventsForList(pool, events, auth) {
  const rows = Array.isArray(events) ? events : [];
  if (!auth || auth.isAdmin || !auth.allowedEventIds) {
    return rows.map(withOpenAccess);
  }

  let requestRows = [];
  try {
    if (auth.accessId) {
      const result = await pool.query(
        `SELECT event_id, status
           FROM public.api_event_access_requests
          WHERE access_id = $1 AND status IN ('pending', 'denied')`,
        [auth.accessId]
      );
      requestRows = result.rows || [];
    }
  } catch (err) {
    if (isMissingAccessRequestTableError(err)) {
      return rows
        .filter((event) => auth.allowedEventIds.has(String(event.id)))
        .map(withOpenAccess);
    }
    throw err;
  }

  const statusByEvent = new Map(
    requestRows.map((row) => [String(row.event_id), row.status])
  );
  const annotated = [];
  for (const event of rows) {
    const canAccess = auth.allowedEventIds.has(String(event.id));
    if (canAccess) {
      annotated.push(withOpenAccess(event));
      continue;
    }
    if (isQuickModeCalendarRow(event)) continue;
    annotated.push({
      ...sanitizeLockedCalendarEvent(event),
      canAccess: false,
      accessRequestStatus: statusByEvent.get(String(event.id)) || null,
    });
  }
  return annotated;
}

async function loadPendingAccessRequests(pool) {
  const result = await pool.query(
    `SELECT
        r.id,
        r.event_id,
        r.access_id,
        r.status,
        r.created_at,
        a.full_name,
        a.email,
        e.name AS event_name,
        e.date AS event_date
       FROM public.api_event_access_requests r
       JOIN public.api_user_access a ON a.id = r.access_id
       LEFT JOIN public.calendar_events e
         ON e.id::text = r.event_id AND e.deleted_at IS NULL
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC`
  );
  return (result.rows || []).map((row) => ({
    id: String(row.id),
    eventId: String(row.event_id),
    eventName: row.event_name || 'Event',
    eventDate: row.event_date || null,
    requesterName: row.full_name || '',
    requesterEmail: row.email || '',
    createdAt: row.created_at,
  }));
}

function isSignedInUser(auth) {
  return auth && (auth.type === 'user' || auth.type === 'neon_user');
}

function registerEventAccessRequestRoutes(app, pool) {
  app.post('/api/calendar-events/:id/access-request', async (req, res) => {
    try {
      if (!isSignedInUser(req.auth) || req.auth.accessStatus !== 'approved') {
        return res.status(401).json({ error: 'Sign in to request event access.' });
      }
      if (!req.auth.accessId) {
        return res.status(400).json({ error: 'Your account is not ready to request access.' });
      }
      if (req.auth.isAdmin || !req.auth.allowedEventIds) {
        return res.status(400).json({ error: 'You already have access to all events.' });
      }

      const eventId = String(req.params.id || '').trim();
      if (!eventId) {
        return res.status(400).json({ error: 'Missing event id.' });
      }
      if (req.auth.allowedEventIds.has(eventId)) {
        return res.status(400).json({ error: 'You already have access to this event.' });
      }

      await ensureEventAccessRequestsSchema(pool);

      const eventRes = await pool.query(
        `SELECT id, name, schedule_data
           FROM public.calendar_events
          WHERE id = $1 AND deleted_at IS NULL`,
        [eventId]
      );
      const event = eventRes.rows[0];
      if (!event) {
        return res.status(404).json({ error: 'Event not found.' });
      }
      if (isQuickModeCalendarRow(event)) {
        return res.status(400).json({ error: 'Quick Mode sessions cannot be requested.' });
      }

      const existing = await pool.query(
        `SELECT id, status
           FROM public.api_event_access_requests
          WHERE access_id = $1 AND event_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.auth.accessId, eventId]
      );
      const current = existing.rows[0];
      if (current?.status === 'pending') {
        return res.json({
          ok: true,
          status: 'pending',
          requestId: current.id,
          message: 'Your request is already waiting for approval.',
        });
      }
      if (current?.status === 'denied') {
        await pool.query(
          `UPDATE public.api_event_access_requests
              SET status = 'pending',
                  updated_at = NOW(),
                  reviewed_at = NULL,
                  reviewed_by_access_id = NULL
            WHERE id = $1`,
          [current.id]
        );
        return res.json({
          ok: true,
          status: 'pending',
          requestId: current.id,
          message: 'Access request sent.',
        });
      }

      const inserted = await pool.query(
        `INSERT INTO public.api_event_access_requests (access_id, event_id, status)
         VALUES ($1, $2, 'pending')
         RETURNING id`,
        [req.auth.accessId, eventId]
      );
      return res.json({
        ok: true,
        status: 'pending',
        requestId: inserted.rows[0]?.id,
        message: 'Access request sent.',
      });
    } catch (err) {
      if (isMissingAccessRequestTableError(err)) {
        return res.status(503).json({ error: 'Access requests are not available yet.' });
      }
      console.error('Error creating event access request:', err);
      return res.status(500).json({ error: 'Failed to request event access.' });
    }
  });

  app.get('/api/event-access-requests', async (req, res) => {
    try {
      if (!userCanManageAccess(req.auth)) {
        return res.status(403).json({ error: 'You cannot review event access requests.' });
      }
      await ensureEventAccessRequestsSchema(pool);
      const requests = await loadPendingAccessRequests(pool);
      return res.json({ requests });
    } catch (err) {
      if (isMissingAccessRequestTableError(err)) {
        return res.json({ requests: [] });
      }
      console.error('Error listing event access requests:', err);
      return res.status(500).json({ error: 'Failed to load access requests.' });
    }
  });

  async function reviewAccessRequest(req, res, nextStatus) {
    if (!userCanManageAccess(req.auth)) {
      return res.status(403).json({ error: 'You cannot review event access requests.' });
    }
    const requestId = String(req.params.id || '').trim();
    if (!requestId) {
      return res.status(400).json({ error: 'Missing request id.' });
    }

    await ensureEventAccessRequestsSchema(pool);
    const found = await pool.query(
      `SELECT id, access_id, event_id, status
         FROM public.api_event_access_requests
        WHERE id = $1`,
      [requestId]
    );
    const row = found.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    if (row.status !== 'pending') {
      return res.status(400).json({ error: 'This request was already reviewed.' });
    }

    if (nextStatus === 'approved') {
      const grant = await appendEventToUserAllowlist(pool, row.access_id, row.event_id);
      if (grant.status === 'error') {
        return res.status(400).json({ error: grant.message || 'Could not grant access.' });
      }
    }

    await pool.query(
      `UPDATE public.api_event_access_requests
          SET status = $2,
              updated_at = NOW(),
              reviewed_at = NOW(),
              reviewed_by_access_id = $3
        WHERE id = $1`,
      [requestId, nextStatus, req.auth.accessId || null]
    );

    return res.json({
      ok: true,
      status: nextStatus,
      message: nextStatus === 'approved' ? 'Access granted.' : 'Request denied.',
    });
  }

  app.post('/api/event-access-requests/:id/approve', async (req, res) => {
    try {
      await reviewAccessRequest(req, res, 'approved');
    } catch (err) {
      console.error('Error approving event access request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to approve access request.' });
      }
    }
  });

  app.post('/api/event-access-requests/:id/deny', async (req, res) => {
    try {
      await reviewAccessRequest(req, res, 'denied');
    } catch (err) {
      console.error('Error denying event access request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to deny access request.' });
      }
    }
  });
}

module.exports = {
  ensureEventAccessRequestsSchema,
  annotateCalendarEventsForList,
  registerEventAccessRequestRoutes,
  isMissingAccessRequestTableError,
};
