/**
 * Split a multi-day calendar event: move some days into a new event,
 * keep the rest on the original (renumbered from Day 1).
 */

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDaysIso(dateStr, deltaDays) {
  const base = toDateOnly(dateStr);
  if (!base) return null;
  const d = new Date(`${base}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
}

function uniqSortedDays(raw) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(raw) ? raw : []) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1 || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => a - b);
  return out;
}

function buildDayMap(oldDaysSorted) {
  const map = {};
  oldDaysSorted.forEach((oldDay, idx) => {
    map[oldDay] = idx + 1;
  });
  return map;
}

function remapDayKeyedObject(obj, dayMap) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const old = Math.floor(Number(key));
    const next = dayMap[old];
    if (next != null) out[next] = value;
  }
  return out;
}

function remapCompletedDays(raw, dayMap) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    const next = dayMap[Math.floor(Number(v))];
    if (next == null || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.sort((a, b) => a - b);
}

function itemDay(item) {
  const n = Math.floor(Number(item?.day));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function remapScheduleItems(items, dayMap) {
  const list = Array.isArray(items) ? items : [];
  return list
    .filter((item) => dayMap[itemDay(item)] != null)
    .map((item) => ({
      ...item,
      day: dayMap[itemDay(item)],
    }));
}

function formatMovedDayLabel(days) {
  if (!days.length) return '';
  if (days.length === 1) return `Day ${days[0]}`;
  if (days.length === 2) return `Days ${days[0]}–${days[1]}`;
  return `Days ${days[0]}–${days[days.length - 1]}`;
}

function buildSplitSettings(settings, dayMap, numberOfDays, eventName, eventDate, locationFields) {
  const prev = settings && typeof settings === 'object' ? { ...settings } : {};
  const dayStartTimes = remapDayKeyedObject(prev.dayStartTimes, dayMap);
  const masterStartTime =
    dayStartTimes[1] ||
    prev.masterStartTime ||
    '';
  return {
    ...prev,
    eventName,
    eventDate,
    numberOfDays,
    masterStartTime,
    dayStartTimes,
    completedDays: remapCompletedDays(prev.completedDays, dayMap),
    location: locationFields.location,
    dayLocations: locationFields.dayLocations,
    locationDetail: locationFields.locationDetail,
    dayLocationDetails: locationFields.dayLocationDetails,
    lastSaved: new Date().toISOString(),
  };
}

function buildLocationFields(scheduleData, dayMap, numberOfDays) {
  const sd = scheduleData && typeof scheduleData === 'object' ? scheduleData : {};
  const dayLocations = remapDayKeyedObject(sd.dayLocations, dayMap);
  const dayLocationDetails = remapDayKeyedObject(sd.dayLocationDetails, dayMap);
  const primary =
    (typeof dayLocations[1] === 'string' && dayLocations[1].trim()) ||
    (typeof sd.location === 'string' && sd.location.trim()) ||
    'Great Hall';
  for (let d = 1; d <= numberOfDays; d++) {
    if (!dayLocations[d]) dayLocations[d] = primary;
  }
  return {
    location: primary,
    dayLocations,
    locationDetail:
      (typeof dayLocationDetails[1] === 'string' && dayLocationDetails[1]) ||
      (typeof sd.locationDetail === 'string' ? sd.locationDetail : '') ||
      '',
    dayLocationDetails,
  };
}

async function loadRosRow(client, candidateIds) {
  for (const id of candidateIds) {
    if (!id) continue;
    const result = await client.query(
      `SELECT * FROM run_of_show_data WHERE event_id = $1 LIMIT 1`,
      [String(id)]
    );
    if (result.rows[0]) return result.rows[0];
  }
  return null;
}

async function copyIndentedAndCompleted(client, fromEventId, toEventId, itemIds) {
  if (!itemIds.length) return;
  try {
    await client.query(
      `INSERT INTO indented_cues (event_id, item_id, parent_item_id, user_id, user_name, user_role, indented_at)
       SELECT $1, item_id, parent_item_id, user_id, user_name, user_role, indented_at
       FROM indented_cues
       WHERE event_id = $2 AND item_id = ANY($3::int[])
         AND NOT EXISTS (
           SELECT 1 FROM indented_cues x
           WHERE x.event_id = $1 AND x.item_id = indented_cues.item_id
         )`,
      [toEventId, fromEventId, itemIds]
    );
    await client.query(
      `DELETE FROM indented_cues WHERE event_id = $1 AND item_id = ANY($2::int[])`,
      [fromEventId, itemIds]
    );
  } catch (err) {
    console.warn('split-event-days: indented_cues migrate skipped:', err.message);
  }

  try {
    await client.query(
      `INSERT INTO completed_cues (event_id, item_id, cue_id, user_id, user_name, user_role, completed_at)
       SELECT $1, item_id, cue_id, user_id, user_name, user_role, completed_at
       FROM completed_cues
       WHERE event_id = $2 AND item_id = ANY($3::int[])
         AND NOT EXISTS (
           SELECT 1 FROM completed_cues x
           WHERE x.event_id = $1 AND x.item_id = completed_cues.item_id AND x.user_id = completed_cues.user_id
         )`,
      [toEventId, fromEventId, itemIds]
    );
    await client.query(
      `DELETE FROM completed_cues WHERE event_id = $1 AND item_id = ANY($2::int[])`,
      [fromEventId, itemIds]
    );
  } catch (err) {
    console.warn('split-event-days: completed_cues migrate skipped:', err.message);
  }
}

async function deleteIndentedAndCompleted(client, eventId, itemIds) {
  if (!itemIds.length) return;
  try {
    await client.query(
      `DELETE FROM indented_cues WHERE event_id = $1 AND item_id = ANY($2::int[])`,
      [eventId, itemIds]
    );
  } catch (err) {
    console.warn('split-event-days: indented_cues delete skipped:', err.message);
  }
  try {
    await client.query(
      `DELETE FROM completed_cues WHERE event_id = $1 AND item_id = ANY($2::int[])`,
      [eventId, itemIds]
    );
  } catch (err) {
    console.warn('split-event-days: completed_cues delete skipped:', err.message);
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   calendarEventId: string,
 *   keepDays: number[],
 *   moveDays?: number[],
 *   deleteDays?: number[],
 *   newEventName?: string,
 *   modifiedBy?: object
 * }} opts
 */
async function splitEventDays(pool, opts) {
  const calendarEventId = String(opts.calendarEventId || '').trim();
  const keepDays = uniqSortedDays(opts.keepDays);
  const moveDays = uniqSortedDays(opts.moveDays);
  const deleteDays = uniqSortedDays(opts.deleteDays);
  if (!calendarEventId) {
    return { ok: false, status: 400, error: 'calendarEventId is required' };
  }
  if (!keepDays.length) {
    return { ok: false, status: 400, error: 'Select at least one day to keep on this event' };
  }
  if (!moveDays.length && !deleteDays.length) {
    return {
      ok: false,
      status: 400,
      error: 'Select at least one day to move or delete',
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const calRes = await client.query(
      `SELECT * FROM calendar_events WHERE id::text = $1 AND deleted_at IS NULL LIMIT 1`,
      [calendarEventId]
    );
    const cal = calRes.rows[0];
    if (!cal) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Calendar event not found' };
    }

    const scheduleData = parseJson(cal.schedule_data, {});
    const numberOfDays = Math.max(1, Math.floor(Number(scheduleData.numberOfDays) || 1));
    if (numberOfDays <= 1) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Only multi-day events can be split' };
    }

    const allDays = Array.from({ length: numberOfDays }, (_, i) => i + 1);
    const chosen = [...keepDays, ...moveDays, ...deleteDays];
    const invalid = chosen.filter((d) => d < 1 || d > numberOfDays);
    if (invalid.length) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: `Invalid day(s): ${[...new Set(invalid)].join(', ')}` };
    }

    const overlaps = [];
    const seen = new Set();
    for (const d of chosen) {
      if (seen.has(d)) overlaps.push(d);
      seen.add(d);
    }
    if (overlaps.length) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        error: `Each day can only be Keep, Move, or Delete once (conflict: ${[...new Set(overlaps)].join(', ')})`,
      };
    }

    const unassigned = allDays.filter((d) => !seen.has(d));
    if (unassigned.length) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 400,
        error: `Choose Keep, Move, or Delete for every day (missing: ${unassigned
          .map((d) => `Day ${d}`)
          .join(', ')})`,
      };
    }

    const legacyEventId =
      (typeof scheduleData.eventId === 'string' && scheduleData.eventId.trim()) ||
      (typeof scheduleData.event_id === 'string' && scheduleData.event_id.trim()) ||
      '';
    const ros = await loadRosRow(client, [calendarEventId, legacyEventId]);
    if (!ros) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'No Run of Show data found for this event' };
    }

    const rosEventId = String(ros.event_id);
    const scheduleItems = parseJson(ros.schedule_items, []);
    const customColumns = parseJson(ros.custom_columns, []);
    const settings = parseJson(ros.settings, {});
    const eventDate = toDateOnly(cal.date) || toDateOnly(ros.event_date);
    if (!eventDate) {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: 'Event is missing a start date' };
    }

    const keepMap = buildDayMap(keepDays);
    const moveMap = buildDayMap(moveDays);
    const deleteMap = Object.fromEntries(deleteDays.map((d) => [d, true]));
    const keepCount = keepDays.length;
    const moveCount = moveDays.length;

    const keepItems = remapScheduleItems(scheduleItems, keepMap);
    const moveItems = moveCount ? remapScheduleItems(scheduleItems, moveMap) : [];
    const deleteItems = (Array.isArray(scheduleItems) ? scheduleItems : []).filter(
      (item) => deleteMap[itemDay(item)]
    );
    const moveItemIds = moveItems
      .map((item) => Math.floor(Number(item.id)))
      .filter((id) => Number.isFinite(id));
    const deleteItemIds = deleteItems
      .map((item) => Math.floor(Number(item.id)))
      .filter((id) => Number.isFinite(id));

    const keepLoc = buildLocationFields(scheduleData, keepMap, keepCount);
    const keepDate = addDaysIso(eventDate, keepDays[0] - 1);
    const keepName = String(cal.name || ros.event_name || 'Event').trim() || 'Event';
    const keepSettings = buildSplitSettings(settings, keepMap, keepCount, keepName, keepDate, keepLoc);
    const keepScheduleData = {
      ...scheduleData,
      location: keepLoc.location,
      dayLocations: keepLoc.dayLocations,
      locationDetail: keepLoc.locationDetail,
      dayLocationDetails: keepLoc.dayLocationDetails,
      numberOfDays: keepCount,
      eventId: rosEventId,
    };

    let created = null;
    if (moveCount > 0) {
      const moveLoc = buildLocationFields(scheduleData, moveMap, moveCount);
      const moveDate = addDaysIso(eventDate, moveDays[0] - 1);
      const defaultMoveName = `${keepName} (${formatMovedDayLabel(moveDays)})`;
      const moveName =
        (typeof opts.newEventName === 'string' && opts.newEventName.trim()) || defaultMoveName;
      const moveSettings = buildSplitSettings(
        settings,
        moveMap,
        moveCount,
        moveName,
        moveDate,
        moveLoc
      );
      const moveScheduleDataBase = {
        ...scheduleData,
        location: moveLoc.location,
        dayLocations: moveLoc.dayLocations,
        locationDetail: moveLoc.locationDetail,
        dayLocationDetails: moveLoc.dayLocationDetails,
        numberOfDays: moveCount,
        quickMode: false,
      };

      const createdCal = await client.query(
        `INSERT INTO calendar_events (name, date, schedule_data, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         RETURNING *`,
        [moveName, moveDate, JSON.stringify({ ...moveScheduleDataBase, eventId: null })]
      );
      const newCal = createdCal.rows[0];
      const newCalId = String(newCal.id);

      await client.query(
        `UPDATE calendar_events
         SET schedule_data = $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify({ ...moveScheduleDataBase, eventId: newCalId }), newCal.id]
      );

      await client.query(
        `INSERT INTO run_of_show_data
           (event_id, event_name, event_date, schedule_items, custom_columns, settings,
            last_modified_by, last_modified_by_name, last_modified_by_role, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, 1, NOW(), NOW())`,
        [
          newCalId,
          moveName,
          moveDate,
          JSON.stringify(moveItems),
          JSON.stringify(customColumns),
          JSON.stringify(moveSettings),
          opts.modifiedBy?.userId || null,
          opts.modifiedBy?.userName || null,
          opts.modifiedBy?.userRole || 'EDITOR',
        ]
      );

      await copyIndentedAndCompleted(client, rosEventId, newCalId, moveItemIds);
      created = {
        calendarEventId: newCalId,
        rosEventId: newCalId,
        name: moveName,
        date: moveDate,
        numberOfDays: moveCount,
        moveDays,
        scheduleItemCount: moveItems.length,
      };
    }

    await client.query(
      `UPDATE calendar_events
       SET name = $1, date = $2, schedule_data = $3::jsonb, updated_at = NOW()
       WHERE id = $4`,
      [keepName, keepDate, JSON.stringify(keepScheduleData), cal.id]
    );

    await client.query(
      `UPDATE run_of_show_data SET
         event_name = $1,
         event_date = $2,
         schedule_items = $3::jsonb,
         custom_columns = $4::jsonb,
         settings = $5::jsonb,
         last_modified_by = $6,
         last_modified_by_name = $7,
         last_modified_by_role = $8,
         last_change_at = NOW(),
         updated_at = NOW(),
         version = COALESCE(version, 1) + 1
       WHERE event_id = $9`,
      [
        keepName,
        keepDate,
        JSON.stringify(keepItems),
        JSON.stringify(customColumns),
        JSON.stringify(keepSettings),
        opts.modifiedBy?.userId || null,
        opts.modifiedBy?.userName || null,
        opts.modifiedBy?.userRole || 'EDITOR',
        rosEventId,
      ]
    );

    await deleteIndentedAndCompleted(client, rosEventId, deleteItemIds);

    await client.query('COMMIT');

    return {
      ok: true,
      original: {
        calendarEventId: String(cal.id),
        rosEventId,
        name: keepName,
        date: keepDate,
        numberOfDays: keepCount,
        keepDays,
        scheduleItemCount: keepItems.length,
      },
      created,
      deleted: {
        deleteDays,
        scheduleItemCount: deleteItems.length,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('splitEventDays failed:', error);
    return { ok: false, status: 500, error: error.message || 'Failed to split event days' };
  } finally {
    client.release();
  }
}

module.exports = {
  splitEventDays,
  uniqSortedDays,
  buildDayMap,
  addDaysIso,
  formatMovedDayLabel,
  remapScheduleItems,
};
