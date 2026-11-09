'use strict';

const { getCloudMode } = require('./cloud-mode');
const { railwayRequest, RAILWAY_BASE_URL } = require('./railway-client');
const { upsertCalendarEvent, upsertRunOfShow, logicalEventId } = require('./sqlite-mirror');
const { mirrorToSqlite } = require('./cloud-proxy');

function isCloudConnected(db) {
  return getCloudMode(db).cloudConnected;
}

async function syncFromCloud(db) {
  const events = await railwayRequest('GET', '/api/calendar-events');
  const list = Array.isArray(events) ? events : [];
  const sync = db.transaction((rows) => {
    for (const row of rows) upsertCalendarEvent(db, row);
  });
  sync(list);

  let runOfShow = 0;
  let liveState = 0;
  for (const ev of list) {
    const eventId = logicalEventId(ev);
    try {
      const ros = await railwayRequest('GET', `/api/run-of-show-data/${encodeURIComponent(eventId)}`);
      upsertRunOfShow(db, ros);
      runOfShow += 1;
    } catch (e) {
      if (e.status !== 404) console.warn(`⚠️ ROS sync skip ${eventId}:`, e.message);
    }

    const statePaths = [
      `/api/active-timers/${encodeURIComponent(eventId)}`,
      `/api/completed-cues/${encodeURIComponent(eventId)}`,
      `/api/overtime-minutes/${encodeURIComponent(eventId)}`,
      `/api/show-start-overtime/${encodeURIComponent(eventId)}`,
      `/api/timer-messages/${encodeURIComponent(eventId)}`,
      `/api/indented-cues/${encodeURIComponent(eventId)}`,
      `/api/sub-cue-timers/${encodeURIComponent(eventId)}`,
    ];
    for (const p of statePaths) {
      try {
        const data = await railwayRequest('GET', p);
        mirrorToSqlite(db, 'GET', p, null, data);
        liveState += 1;
      } catch (e) {
        if (e.status !== 404) console.warn(`⚠️ Live state sync skip ${p}:`, e.message);
      }
    }
  }
  console.log(
    `☁️ Synced ${list.length} calendar + ${runOfShow} run-of-show + ${liveState} live-state pulls from Railway`
  );
  return { calendarEvents: list.length, runOfShow, liveState, source: RAILWAY_BASE_URL };
}

module.exports = {
  isCloudConnected,
  syncFromCloud,
};
