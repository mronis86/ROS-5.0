/**
 * Global speaker directory — search for ROS import, CRUD for Producers/Admins,
 * and prompted sync from the Speakers modal.
 */

function normalizeNameKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function trimField(value) {
  return String(value ?? '').trim();
}

function mapSpeakerRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name || '',
    title: row.title || '',
    org: row.org || '',
    photo_link: row.photo_link || '',
    notes: row.notes || '',
    email: row.email || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    updated_by: row.updated_by || null,
    updated_by_name: row.updated_by_name || null,
  };
}

async function ensureSpeakersSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.speakers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      full_name_key TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      org TEXT NOT NULL DEFAULT '',
      photo_link TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT,
      updated_by_name TEXT,
      CONSTRAINT speakers_full_name_key_unique UNIQUE (full_name_key)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_speakers_full_name_key
      ON public.speakers (full_name_key)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_speakers_name_lower
      ON public.speakers (lower(full_name))
  `);
}

function requireApprovedSession(req, res) {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (auth.type === 'neon_user' && auth.accessStatus && auth.accessStatus !== 'approved') {
    res.status(403).json({ error: 'Approved account required.' });
    return null;
  }
  return auth;
}

function actorFromAuth(auth) {
  return {
    updatedBy: auth?.userId || auth?.email || auth?.accessId || null,
    updatedByName: auth?.fullName || auth?.email || auth?.userId || null,
  };
}

function registerSpeakerRoutes(app, { pool, userCanManageSpeakers }) {
  app.get('/api/speakers', async (req, res) => {
    try {
      if (!requireApprovedSession(req, res)) return;
      await ensureSpeakersSchema(pool);
      const q = trimField(req.query.q);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
      let result;
      if (q) {
        const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
        result = await pool.query(
          `SELECT * FROM public.speakers
           WHERE full_name ILIKE $1
              OR title ILIKE $1
              OR org ILIKE $1
              OR email ILIKE $1
           ORDER BY full_name ASC
           LIMIT $2`,
          [like, limit]
        );
      } else {
        result = await pool.query(
          `SELECT * FROM public.speakers
           ORDER BY full_name ASC
           LIMIT $1`,
          [limit]
        );
      }
      res.json({ speakers: result.rows.map(mapSpeakerRow) });
    } catch (error) {
      console.error('[speakers GET]', error);
      res.status(500).json({ error: error.message || 'Failed to list speakers' });
    }
  });

  app.post('/api/speakers/lookup', async (req, res) => {
    try {
      if (!requireApprovedSession(req, res)) return;
      await ensureSpeakersSchema(pool);
      const names = Array.isArray(req.body?.names) ? req.body.names : [];
      const keys = [
        ...new Set(
          names
            .map((n) => normalizeNameKey(n))
            .filter(Boolean)
        ),
      ];
      if (keys.length === 0) {
        return res.json({ speakers: [] });
      }
      const result = await pool.query(
        `SELECT * FROM public.speakers WHERE full_name_key = ANY($1::text[])`,
        [keys]
      );
      res.json({ speakers: result.rows.map(mapSpeakerRow) });
    } catch (error) {
      console.error('[speakers lookup]', error);
      res.status(500).json({ error: error.message || 'Failed to look up speakers' });
    }
  });

  app.post('/api/speakers/sync', async (req, res) => {
    try {
      const auth = requireApprovedSession(req, res);
      if (!auth) return;
      await ensureSpeakersSchema(pool);
      const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
      const { updatedBy, updatedByName } = actorFromAuth(auth);
      const results = [];

      for (const action of actions) {
        const type = String(action?.type || '').toLowerCase();
        const fullName = trimField(action?.full_name || action?.fullName);
        const key = normalizeNameKey(fullName);
        if (!key) {
          results.push({ ok: false, error: 'full_name required' });
          continue;
        }
        const title = trimField(action?.title);
        const org = trimField(action?.org);
        const photoLink = trimField(action?.photo_link || action?.photoLink);
        const id = action?.id ? String(action.id) : null;

        if (type === 'add') {
          try {
            const inserted = await pool.query(
              `INSERT INTO public.speakers
                 (full_name, full_name_key, title, org, photo_link, updated_by, updated_by_name)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (full_name_key) DO NOTHING
               RETURNING *`,
              [fullName, key, title, org, photoLink, updatedBy, updatedByName]
            );
            if (inserted.rows[0]) {
              results.push({ ok: true, type: 'add', speaker: mapSpeakerRow(inserted.rows[0]) });
            } else {
              const existing = await pool.query(
                `SELECT * FROM public.speakers WHERE full_name_key = $1 LIMIT 1`,
                [key]
              );
              results.push({
                ok: true,
                type: 'add',
                skipped: true,
                speaker: mapSpeakerRow(existing.rows[0]),
              });
            }
          } catch (err) {
            results.push({ ok: false, type: 'add', error: err.message });
          }
          continue;
        }

        if (type === 'update') {
          try {
            let updated;
            if (id) {
              updated = await pool.query(
                `UPDATE public.speakers
                 SET full_name = $2,
                     full_name_key = $3,
                     title = $4,
                     org = $5,
                     photo_link = $6,
                     updated_at = NOW(),
                     updated_by = $7,
                     updated_by_name = $8
                 WHERE id = $1
                 RETURNING *`,
                [id, fullName, key, title, org, photoLink, updatedBy, updatedByName]
              );
            } else {
              updated = await pool.query(
                `UPDATE public.speakers
                 SET full_name = $2,
                     title = $3,
                     org = $4,
                     photo_link = $5,
                     updated_at = NOW(),
                     updated_by = $6,
                     updated_by_name = $7
                 WHERE full_name_key = $1
                 RETURNING *`,
                [key, fullName, title, org, photoLink, updatedBy, updatedByName]
              );
            }
            if (!updated.rows[0]) {
              results.push({ ok: false, type: 'update', error: 'Speaker not found' });
            } else {
              results.push({ ok: true, type: 'update', speaker: mapSpeakerRow(updated.rows[0]) });
            }
          } catch (err) {
            results.push({ ok: false, type: 'update', error: err.message });
          }
          continue;
        }

        results.push({ ok: false, error: `Unknown action type: ${type}` });
      }

      res.json({ ok: true, results });
    } catch (error) {
      console.error('[speakers sync]', error);
      res.status(500).json({ error: error.message || 'Failed to sync speakers' });
    }
  });

  app.get('/api/speakers/:id', async (req, res) => {
    try {
      if (!requireApprovedSession(req, res)) return;
      await ensureSpeakersSchema(pool);
      const result = await pool.query(`SELECT * FROM public.speakers WHERE id = $1 LIMIT 1`, [
        req.params.id,
      ]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Speaker not found' });
      res.json({ speaker: mapSpeakerRow(result.rows[0]) });
    } catch (error) {
      console.error('[speakers GET id]', error);
      res.status(500).json({ error: error.message || 'Failed to load speaker' });
    }
  });

  app.post('/api/speakers', async (req, res) => {
    try {
      const auth = requireApprovedSession(req, res);
      if (!auth) return;
      if (!userCanManageSpeakers(auth)) {
        return res.status(403).json({ error: 'Producer or Admin access required.' });
      }
      await ensureSpeakersSchema(pool);
      const fullName = trimField(req.body?.full_name || req.body?.fullName);
      const key = normalizeNameKey(fullName);
      if (!key) return res.status(400).json({ error: 'full_name is required' });
      const { updatedBy, updatedByName } = actorFromAuth(auth);
      const title = trimField(req.body?.title);
      const org = trimField(req.body?.org);
      const photoLink = trimField(req.body?.photo_link || req.body?.photoLink);
      const notes = trimField(req.body?.notes);
      const email = trimField(req.body?.email);
      try {
        const inserted = await pool.query(
          `INSERT INTO public.speakers
             (full_name, full_name_key, title, org, photo_link, notes, email, updated_by, updated_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [fullName, key, title, org, photoLink, notes, email, updatedBy, updatedByName]
        );
        res.status(201).json({ speaker: mapSpeakerRow(inserted.rows[0]) });
      } catch (err) {
        if (err.code === '23505') {
          return res.status(409).json({ error: 'A speaker with that name already exists.' });
        }
        throw err;
      }
    } catch (error) {
      console.error('[speakers POST]', error);
      res.status(500).json({ error: error.message || 'Failed to create speaker' });
    }
  });

  app.put('/api/speakers/:id', async (req, res) => {
    try {
      const auth = requireApprovedSession(req, res);
      if (!auth) return;
      if (!userCanManageSpeakers(auth)) {
        return res.status(403).json({ error: 'Producer or Admin access required.' });
      }
      await ensureSpeakersSchema(pool);
      const fullName = trimField(req.body?.full_name || req.body?.fullName);
      const key = normalizeNameKey(fullName);
      if (!key) return res.status(400).json({ error: 'full_name is required' });
      const { updatedBy, updatedByName } = actorFromAuth(auth);
      const title = trimField(req.body?.title);
      const org = trimField(req.body?.org);
      const photoLink = trimField(req.body?.photo_link || req.body?.photoLink);
      const notes = trimField(req.body?.notes);
      const email = trimField(req.body?.email);
      try {
        const updated = await pool.query(
          `UPDATE public.speakers
           SET full_name = $2,
               full_name_key = $3,
               title = $4,
               org = $5,
               photo_link = $6,
               notes = $7,
               email = $8,
               updated_at = NOW(),
               updated_by = $9,
               updated_by_name = $10
           WHERE id = $1
           RETURNING *`,
          [
            req.params.id,
            fullName,
            key,
            title,
            org,
            photoLink,
            notes,
            email,
            updatedBy,
            updatedByName,
          ]
        );
        if (!updated.rows[0]) return res.status(404).json({ error: 'Speaker not found' });
        res.json({ speaker: mapSpeakerRow(updated.rows[0]) });
      } catch (err) {
        if (err.code === '23505') {
          return res.status(409).json({ error: 'A speaker with that name already exists.' });
        }
        throw err;
      }
    } catch (error) {
      console.error('[speakers PUT]', error);
      res.status(500).json({ error: error.message || 'Failed to update speaker' });
    }
  });

  app.delete('/api/speakers/:id', async (req, res) => {
    try {
      const auth = requireApprovedSession(req, res);
      if (!auth) return;
      if (!userCanManageSpeakers(auth)) {
        return res.status(403).json({ error: 'Producer or Admin access required.' });
      }
      await ensureSpeakersSchema(pool);
      const deleted = await pool.query(
        `DELETE FROM public.speakers WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!deleted.rows[0]) return res.status(404).json({ error: 'Speaker not found' });
      res.json({ ok: true, id: req.params.id });
    } catch (error) {
      console.error('[speakers DELETE]', error);
      res.status(500).json({ error: error.message || 'Failed to delete speaker' });
    }
  });

  return { ensureSpeakersSchema };
}

module.exports = {
  registerSpeakerRoutes,
  ensureSpeakersSchema,
  normalizeNameKey,
};
