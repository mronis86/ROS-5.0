/**
 * Per-event content review assignees (creative + production).
 */

const MAX_ASSIGNEES_PER_ROLE = 2;

const ASSIGNEE_SELECT = `
  SELECT
    a.id,
    a.event_id,
    a.access_id,
    a.assignee_role,
    a.notify_on_change,
    a.created_at,
    u.email,
    u.full_name,
    u.is_creative,
    u.is_admin,
    u.is_event_manager
  FROM public.event_content_review_assignees a
  JOIN public.api_user_access u ON u.id = a.access_id
`;

function mapAssigneeRow(row) {
  return {
    id: row.id,
    event_id: row.event_id,
    access_id: row.access_id,
    assignee_role: row.assignee_role,
    notify_on_change: row.notify_on_change !== false,
    created_at: row.created_at,
    email: row.email || '',
    full_name: row.full_name || '',
    is_creative: row.is_creative === true,
    is_admin: row.is_admin === true,
    is_event_manager: row.is_event_manager === true,
  };
}

async function ensureAssigneesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.event_content_review_assignees (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      access_id UUID NOT NULL REFERENCES public.api_user_access(id) ON DELETE CASCADE,
      assignee_role TEXT NOT NULL CHECK (assignee_role IN ('creative', 'production')),
      assigned_by_access_id UUID REFERENCES public.api_user_access(id) ON DELETE SET NULL,
      notify_on_change BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT event_content_review_assignees_unique_user UNIQUE (event_id, access_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_cr_assignees_event
      ON public.event_content_review_assignees (event_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_cr_assignees_access
      ON public.event_content_review_assignees (access_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_event_cr_assignees_event_role
      ON public.event_content_review_assignees (event_id, assignee_role)
  `);
}

function isCreativeAssigneeCandidate(user) {
  if (!user || user.is_creative !== true) return false;
  if (user.is_admin || user.is_event_manager || user.is_bts_crew) return false;
  return true;
}

function isProductionAssigneeCandidate(user) {
  return !isCreativeAssigneeCandidate(user);
}

function canManageContentReviewAssignees(auth) {
  if (!auth) return false;
  if (auth.isAdmin) return true;
  return auth.isCreative === true;
}

async function listAssigneeCandidates(pool) {
  const r = await pool.query(
    `SELECT id, email, full_name, is_creative, is_admin, is_event_manager, is_bts_crew, dashboard_enabled
     FROM public.api_user_access
     WHERE status = 'approved'
       AND email IS NOT NULL AND TRIM(email) <> ''
     ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), email) ASC`
  );
  return (r.rows || []).map((row) => ({
    id: row.id,
    email: row.email || '',
    full_name: row.full_name || '',
    is_creative: row.is_creative === true,
    is_admin: row.is_admin === true,
    is_event_manager: row.is_event_manager === true,
    is_bts_crew: row.is_bts_crew === true,
    dashboard_enabled: row.dashboard_enabled === true,
  }));
}

async function getEventAssignees(pool, eventId) {
  const r = await pool.query(
    `${ASSIGNEE_SELECT} WHERE a.event_id = $1 ORDER BY a.assignee_role, a.created_at ASC`,
    [eventId]
  );
  const assignees = (r.rows || []).map(mapAssigneeRow);
  return {
    creative: assignees.filter((a) => a.assignee_role === 'creative'),
    production: assignees.filter((a) => a.assignee_role === 'production'),
  };
}

async function grantEventAccessIfRestricted(client, accessId, eventId) {
  const countRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.api_user_event_access WHERE access_id = $1`,
    [accessId]
  );
  const restricted = (countRes.rows[0]?.n || 0) > 0;
  if (!restricted) return;
  await client.query(
    `INSERT INTO public.api_user_event_access (access_id, event_id)
     VALUES ($1, $2)
     ON CONFLICT (access_id, event_id) DO NOTHING`,
    [accessId, eventId]
  );
}

async function validateAssigneeIds(pool, role, accessIds) {
  if (!Array.isArray(accessIds)) {
    return { error: `${role} must be an array of user ids.` };
  }
  const unique = [...new Set(accessIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (unique.length > MAX_ASSIGNEES_PER_ROLE) {
    return { error: `At most ${MAX_ASSIGNEES_PER_ROLE} ${role} assignees allowed.` };
  }
  if (unique.length === 0) return { ids: [] };

  const r = await pool.query(
    `SELECT id, email, full_name, is_creative, is_admin, is_event_manager, is_bts_crew, status
     FROM public.api_user_access
     WHERE id = ANY($1::uuid[])`,
    [unique]
  );
  const byId = new Map((r.rows || []).map((row) => [String(row.id), row]));
  for (const id of unique) {
    const user = byId.get(id);
    if (!user) return { error: `User not found: ${id}` };
    if (user.status !== 'approved') return { error: `${user.email || id} is not an approved user.` };
    if (role === 'creative' && !isCreativeAssigneeCandidate(user)) {
      return {
        error: `${user.full_name || user.email} is not a Creative-only user (admins, event managers, and BTS are assigned as Production).`,
      };
    }
    if (role === 'production' && !isProductionAssigneeCandidate(user)) {
      return {
        error: `${user.full_name || user.email} is a Creative-only user — assign under Creative reviewers instead.`,
      };
    }
  }
  return { ids: unique };
}

async function replaceEventAssignees(pool, eventId, { creative = [], production = [] }, assignedByAccessId) {
  const creativeCheck = await validateAssigneeIds(pool, 'creative', creative);
  if (creativeCheck.error) return { error: creativeCheck.error };
  const productionCheck = await validateAssigneeIds(pool, 'production', production);
  if (productionCheck.error) return { error: productionCheck.error };

  const overlap = creativeCheck.ids.filter((id) => productionCheck.ids.includes(id));
  if (overlap.length > 0) {
    return { error: 'A user cannot be assigned as both Creative and Production reviewer.' };
  }

  const client = await pool.connect();
  try {
    const before = await getEventAssignees(pool, eventId);
    const beforeIds = new Set([
      ...before.creative.map((a) => a.access_id),
      ...before.production.map((a) => a.access_id),
    ]);

    await client.query('BEGIN');
    await client.query(`DELETE FROM public.event_content_review_assignees WHERE event_id = $1`, [eventId]);

    const inserted = [];
    for (const accessId of creativeCheck.ids) {
      const ins = await client.query(
        `INSERT INTO public.event_content_review_assignees
           (event_id, access_id, assignee_role, assigned_by_access_id)
         VALUES ($1, $2, 'creative', $3)
         RETURNING id`,
        [eventId, accessId, assignedByAccessId || null]
      );
      await grantEventAccessIfRestricted(client, accessId, eventId);
      inserted.push({ access_id: accessId, assignee_role: 'creative', id: ins.rows[0]?.id });
    }
    for (const accessId of productionCheck.ids) {
      const ins = await client.query(
        `INSERT INTO public.event_content_review_assignees
           (event_id, access_id, assignee_role, assigned_by_access_id)
         VALUES ($1, $2, 'production', $3)
         RETURNING id`,
        [eventId, accessId, assignedByAccessId || null]
      );
      await grantEventAccessIfRestricted(client, accessId, eventId);
      inserted.push({ access_id: accessId, assignee_role: 'production', id: ins.rows[0]?.id });
    }
    await client.query('COMMIT');

    const after = await getEventAssignees(pool, eventId);
    const newlyAssigned = [];
    for (const row of [...after.creative, ...after.production]) {
      if (!beforeIds.has(row.access_id)) newlyAssigned.push(row);
    }
    return { assignees: after, newlyAssigned };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getNotifyRecipientsForRole(pool, eventId, role, excludeAccessId) {
  const r = await pool.query(
    `SELECT a.access_id, u.email, u.full_name
     FROM public.event_content_review_assignees a
     JOIN public.api_user_access u ON u.id = a.access_id
     WHERE a.event_id = $1
       AND a.assignee_role = $2
       AND a.notify_on_change = TRUE
       AND u.status = 'approved'
       AND u.email IS NOT NULL AND TRIM(u.email) <> ''`,
    [eventId, role]
  );
  return (r.rows || [])
    .filter((row) => !excludeAccessId || String(row.access_id) !== String(excludeAccessId))
    .map((row) => ({
      access_id: row.access_id,
      email: row.email,
      full_name: row.full_name || '',
    }));
}

module.exports = {
  MAX_ASSIGNEES_PER_ROLE,
  ensureAssigneesTable,
  canManageContentReviewAssignees,
  isCreativeAssigneeCandidate,
  isProductionAssigneeCandidate,
  listAssigneeCandidates,
  getEventAssignees,
  replaceEventAssignees,
  getNotifyRecipientsForRole,
};
