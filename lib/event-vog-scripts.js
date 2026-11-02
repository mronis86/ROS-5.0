/**
 * Neon table for VOG scripts (text + voice), separate from run_of_show_data.schedule_items.
 */

async function ensureEventVogScriptsSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.event_vog_scripts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id TEXT NOT NULL,
      schedule_item_id BIGINT NOT NULL,
      vog_text TEXT NOT NULL DEFAULT '',
      voice_id TEXT NOT NULL DEFAULT '',
      voice_name TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_by_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT event_vog_scripts_event_item_unique UNIQUE (event_id, schedule_item_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_vog_scripts_event
      ON public.event_vog_scripts (event_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_vog_scripts_event_updated
      ON public.event_vog_scripts (event_id, updated_at DESC)
  `);
}

function parseScheduleItems(raw) {
  let items = raw;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      return [];
    }
  }
  return Array.isArray(items) ? items : [];
}

function stripVogFieldsFromItem(item) {
  if (!item || typeof item !== 'object') return item;
  const next = { ...item };
  delete next.vogText;
  delete next.vogVoiceId;
  delete next.vogVoiceName;
  return next;
}

function stripVogFieldsFromScheduleItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map(stripVogFieldsFromItem);
}

async function listVogScriptsForEvent(db, eventId) {
  const result = await db.query(
    `SELECT schedule_item_id, vog_text, voice_id, voice_name, updated_at, updated_by, updated_by_name
       FROM public.event_vog_scripts
      WHERE event_id = $1
      ORDER BY schedule_item_id ASC`,
    [String(eventId)]
  );
  return result.rows;
}

function vogRowsToMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = Number(row.schedule_item_id);
    if (!Number.isFinite(id)) continue;
    map.set(id, row);
  }
  return map;
}

function applyVogRowToItem(item, row) {
  if (!row) {
    return {
      ...item,
      vogText: undefined,
      vogVoiceId: undefined,
      vogVoiceName: undefined,
    };
  }
  const text = String(row.vog_text || '');
  const voiceId = String(row.voice_id || '');
  const voiceName = String(row.voice_name || '');
  return {
    ...item,
    vogText: text || undefined,
    vogVoiceId: voiceId || undefined,
    vogVoiceName: voiceName || undefined,
  };
}

async function upsertVogScript(
  db,
  {
    eventId,
    scheduleItemId,
    vogText = '',
    voiceId = '',
    voiceName = '',
    updatedBy = null,
    updatedByName = null,
  }
) {
  const itemId = Number(scheduleItemId);
  if (!Number.isFinite(itemId)) {
    const err = new Error('schedule_item_id is required');
    err.statusCode = 400;
    throw err;
  }
  const text = String(vogText || '').trim();
  const vid = String(voiceId || '').trim();
  const vname = String(voiceName || '').trim();

  // Empty script + no voice → delete row (keep table tidy)
  if (!text && !vid) {
    await db.query(
      `DELETE FROM public.event_vog_scripts
        WHERE event_id = $1 AND schedule_item_id = $2`,
      [String(eventId), itemId]
    );
    return null;
  }

  const result = await db.query(
    `INSERT INTO public.event_vog_scripts
       (event_id, schedule_item_id, vog_text, voice_id, voice_name, updated_by, updated_by_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (event_id, schedule_item_id) DO UPDATE SET
       vog_text = EXCLUDED.vog_text,
       voice_id = EXCLUDED.voice_id,
       voice_name = EXCLUDED.voice_name,
       updated_by = EXCLUDED.updated_by,
       updated_by_name = EXCLUDED.updated_by_name,
       updated_at = NOW()
     RETURNING schedule_item_id, vog_text, voice_id, voice_name, updated_at`,
    [String(eventId), itemId, text, vid, vname, updatedBy, updatedByName]
  );
  return result.rows[0] || null;
}

async function applyVoiceToVogScripts(
  db,
  { eventId, itemIds, voiceId, voiceName, updatedBy = null, updatedByName = null }
) {
  const ids = (Array.isArray(itemIds) ? itemIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const vid = String(voiceId || '').trim();
  const vname = String(voiceName || '').trim();
  if (!ids.length || !vid) {
    return { updated: 0 };
  }

  // Update existing rows
  const updated = await db.query(
    `UPDATE public.event_vog_scripts
        SET voice_id = $3,
            voice_name = $4,
            updated_by = $5,
            updated_by_name = $6,
            updated_at = NOW()
      WHERE event_id = $1
        AND schedule_item_id = ANY($2::bigint[])
      RETURNING schedule_item_id`,
    [String(eventId), ids, vid, vname, updatedBy, updatedByName]
  );

  // Insert missing ids so bulk voice still sticks when script was only in memory
  const have = new Set(updated.rows.map((r) => Number(r.schedule_item_id)));
  let inserted = 0;
  for (const id of ids) {
    if (have.has(id)) continue;
    await upsertVogScript(db, {
      eventId,
      scheduleItemId: id,
      vogText: '',
      voiceId: vid,
      voiceName: vname,
      updatedBy,
      updatedByName,
    });
    inserted += 1;
  }
  return { updated: updated.rowCount + inserted };
}

/** Copy legacy schedule_items vog* fields into the table (only when table has no row yet). */
async function backfillVogFromScheduleItems(db, eventId, items, meta = {}) {
  const list = parseScheduleItems(items);
  if (!list.length) return { backfilled: 0 };
  const existing = vogRowsToMap(await listVogScriptsForEvent(db, eventId));
  let backfilled = 0;
  for (const item of list) {
    const id = Number(item?.id);
    if (!Number.isFinite(id) || existing.has(id)) continue;
    const text = String(item.vogText || '').trim();
    const voiceId = String(item.vogVoiceId || '').trim();
    const voiceName = String(item.vogVoiceName || '').trim();
    if (!text && !voiceId) continue;
    await upsertVogScript(db, {
      eventId,
      scheduleItemId: id,
      vogText: text,
      voiceId,
      voiceName,
      updatedBy: meta.updatedBy || null,
      updatedByName: meta.updatedByName || 'backfill',
    });
    backfilled += 1;
  }
  return { backfilled };
}

/**
 * Lazy-backfill from blob, then overlay table values onto schedule items for the client.
 */
async function mergeVogScriptsIntoScheduleItems(db, eventId, scheduleItems) {
  const items = parseScheduleItems(scheduleItems);
  if (!items.length) return items;
  try {
    await backfillVogFromScheduleItems(db, eventId, items);
    const map = vogRowsToMap(await listVogScriptsForEvent(db, eventId));
    return items.map((item) => applyVogRowToItem(item, map.get(Number(item.id))));
  } catch (err) {
    console.warn('[vog-scripts] merge skipped:', err.message || err);
    return items;
  }
}

/**
 * Persist any vog* still present on incoming items, then return items with vog* stripped for ROS blob.
 */
async function syncAndStripVogFromScheduleSave(db, eventId, scheduleItems, meta = {}) {
  const items = parseScheduleItems(scheduleItems);
  if (!items.length) return items;
  try {
    for (const item of items) {
      const id = Number(item?.id);
      if (!Number.isFinite(id)) continue;
      const hasKey =
        Object.prototype.hasOwnProperty.call(item, 'vogText') ||
        Object.prototype.hasOwnProperty.call(item, 'vogVoiceId') ||
        Object.prototype.hasOwnProperty.call(item, 'vogVoiceName');
      if (!hasKey) continue;
      await upsertVogScript(db, {
        eventId,
        scheduleItemId: id,
        vogText: item.vogText,
        voiceId: item.vogVoiceId,
        voiceName: item.vogVoiceName,
        updatedBy: meta.updatedBy || null,
        updatedByName: meta.updatedByName || null,
      });
    }
  } catch (err) {
    console.warn('[vog-scripts] sync-from-save skipped:', err.message || err);
  }
  return stripVogFieldsFromScheduleItems(items);
}

function registerEventVogScriptRoutes(app, { pool, userCanAccessEvent, broadcastUpdate }) {
  app.get('/api/vog-scripts/:eventId', async (req, res) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
      const { eventId } = req.params;
      if (!userCanAccessEvent(req.auth, eventId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const rows = await listVogScriptsForEvent(pool, eventId);
      res.json({
        eventId,
        scripts: rows.map((r) => ({
          scheduleItemId: Number(r.schedule_item_id),
          vogText: r.vog_text || '',
          vogVoiceId: r.voice_id || '',
          vogVoiceName: r.voice_name || '',
          updatedAt: r.updated_at,
        })),
      });
    } catch (err) {
      console.error('[vog-scripts] list failed:', err.message || err);
      res.status(500).json({ error: 'Failed to load VOG scripts' });
    }
  });

  app.put('/api/vog-scripts/:eventId/bulk-voice', async (req, res) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
      const { eventId } = req.params;
      if (!userCanAccessEvent(req.auth, eventId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (req.auth.isCreative && !req.auth.isAdmin && !req.auth.isEventManager) {
        return res.status(403).json({ error: 'Creative users cannot edit VOG scripts.' });
      }
      const result = await applyVoiceToVogScripts(pool, {
        eventId,
        itemIds: req.body?.itemIds || req.body?.item_ids,
        voiceId: req.body?.vogVoiceId ?? req.body?.voiceId ?? req.body?.voice_id,
        voiceName: req.body?.vogVoiceName ?? req.body?.voiceName ?? req.body?.voice_name,
        updatedBy: req.auth.userId || req.auth.id || null,
        updatedByName: req.auth.name || req.auth.email || null,
      });
      if (typeof broadcastUpdate === 'function') {
        broadcastUpdate(eventId, 'vogScriptsUpdated', { eventId, bulkVoice: true });
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[vog-scripts] bulk voice failed:', err.message || err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Failed to apply VOG voice' });
    }
  });

  app.put('/api/vog-scripts/:eventId/:itemId', async (req, res) => {
    try {
      if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
      const { eventId, itemId } = req.params;
      if (!userCanAccessEvent(req.auth, eventId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (req.auth.isCreative && !req.auth.isAdmin && !req.auth.isEventManager) {
        return res.status(403).json({ error: 'Creative users cannot edit VOG scripts.' });
      }
      const row = await upsertVogScript(pool, {
        eventId,
        scheduleItemId: itemId,
        vogText: req.body?.vogText ?? req.body?.vog_text,
        voiceId: req.body?.vogVoiceId ?? req.body?.voiceId ?? req.body?.voice_id,
        voiceName: req.body?.vogVoiceName ?? req.body?.voiceName ?? req.body?.voice_name,
        updatedBy: req.auth.userId || req.auth.id || null,
        updatedByName: req.auth.name || req.auth.email || null,
      });
      if (typeof broadcastUpdate === 'function') {
        broadcastUpdate(eventId, 'vogScriptsUpdated', {
          eventId,
          scheduleItemId: Number(itemId),
        });
      }
      res.json({
        ok: true,
        script: row
          ? {
              scheduleItemId: Number(row.schedule_item_id),
              vogText: row.vog_text || '',
              vogVoiceId: row.voice_id || '',
              vogVoiceName: row.voice_name || '',
              updatedAt: row.updated_at,
            }
          : null,
      });
    } catch (err) {
      console.error('[vog-scripts] upsert failed:', err.message || err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save VOG script' });
    }
  });
}

module.exports = {
  ensureEventVogScriptsSchema,
  listVogScriptsForEvent,
  upsertVogScript,
  applyVoiceToVogScripts,
  backfillVogFromScheduleItems,
  mergeVogScriptsIntoScheduleItems,
  syncAndStripVogFromScheduleSave,
  stripVogFieldsFromScheduleItems,
  registerEventVogScriptRoutes,
};
