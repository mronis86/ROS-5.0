const api = window.rosPptBridge;
if (!api) {
  document.body.innerHTML =
    '<div style="padding:2rem;font-family:Segoe UI,sans-serif;background:#0b1220;color:#e8eef7">' +
    '<h1>Bridge UI failed to start</h1><p>Relaunch from START.bat inside the unzipped powerpoint-bridge folder.</p></div>';
  throw new Error('rosPptBridge preload API missing');
}

const els = {
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  apiToken: document.getElementById('apiToken'),
  eventSelect: document.getElementById('eventSelect'),
  eventSearch: document.getElementById('eventSearch'),
  dayField: document.getElementById('day-field'),
  daySelect: document.getElementById('daySelect'),
  dayHint: document.getElementById('day-hint'),
  apiMsg: document.getElementById('api-msg'),
  runPill: document.getElementById('run-pill'),
  stPpt: document.getElementById('st-ppt'),
  stDeck: document.getElementById('st-deck'),
  stOpen: document.getElementById('st-open'),
  stCount: document.getElementById('st-count'),
  stShow: document.getElementById('st-show'),
  stLive: document.getElementById('st-live'),
  stCue: document.getElementById('st-cue'),
  stAction: document.getElementById('st-action'),
  stError: document.getElementById('st-error'),
  toast: document.getElementById('toast'),
  modeHint: document.getElementById('mode-hint'),
  pptHint: document.getElementById('ppt-hint'),
  cacheCard: document.getElementById('cache-card'),
  cacheList: document.getElementById('cache-list'),
  syncFolder: document.getElementById('syncFolder'),
  btnPickFolder: document.getElementById('btn-pick-folder'),
  btnStart: document.getElementById('btn-start'),
  btnSync: document.getElementById('btn-sync'),
  btnCapture: document.getElementById('btn-capture'),
  btnLiveStart: document.getElementById('btn-live-start'),
  btnLiveStop: document.getElementById('btn-live-stop'),
  liveViewUrl: document.getElementById('liveViewUrl'),
  stLivecap: document.getElementById('st-livecap'),
  stLivecapSrc: document.getElementById('st-livecap-src'),
  livecapError: document.getElementById('livecap-error'),
  focusTarget: document.getElementById('focusTarget'),
  forceEditMode: document.getElementById('forceEditMode'),
  meetingHubCard: document.getElementById('meetinghub-card'),
  hubDeckList: document.getElementById('hub-deck-list'),
  btnHubRefresh: document.getElementById('btn-hub-refresh'),
  sessionPill: document.getElementById('session-pill'),
  btnSession: document.getElementById('btn-session'),
  sessionModal: document.getElementById('session-modal'),
  sessionLiveHours: document.getElementById('session-live-hours'),
  sessionHours: document.getElementById('sessionHours'),
  sessionModalError: document.getElementById('session-modal-error'),
  btnSessionStart: document.getElementById('btn-session-start'),
  btnSessionCancel: document.getElementById('btn-session-cancel'),
};

let loadedEvents = [];
/** @type {'all' | 'upcoming' | 'past'} */
let eventFilter = 'upcoming';
/** @type {'follow' | 'playback' | 'meetinghub'} */
let bridgeMode = 'follow';
/** @type {'screen' | 'camera'} */
let liveCaptureSource = 'screen';
let selectedDay = 1;
/** @type {Record<string, number>} */
let selectedDaysByEvent = {};
/** @type {Array<{id:string,name?:string,original_name?:string,version?:number,versionCount?:number}>} */
let hubDecks = [];
let hubOpenDeckId = '';

function normalizeBridgeMode(raw) {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'playback') return 'playback';
  if (mode === 'meetinghub' || mode === 'hub') return 'meetinghub';
  return 'follow';
}

function selectedEvent() {
  const id = els.eventSelect.value.trim();
  return loadedEvents.find((ev) => String(ev.id) === id) || null;
}

function formConfig() {
  const ev = selectedEvent();
  return {
    apiBaseUrl: els.apiBaseUrl.value.trim(),
    apiToken: els.apiToken.value.trim(),
    eventId: els.eventSelect.value.trim(),
    bridgeMode,
    syncFolder: els.syncFolder ? els.syncFolder.value.trim() : '',
    liveCaptureSource,
    selectedDay,
    numberOfDays: ev ? eventNumberOfDays(ev) : 1,
    selectedDaysByEvent,
    focusTarget: (() => {
      const raw = String(els.focusTarget?.value || 'off').trim().toLowerCase();
      if (raw === 'presentation') return 'presenter';
      return raw === 'presenter' || raw === 'slideshow' || raw === 'app' ? raw : 'off';
    })(),
    forceEditMode: Boolean(els.forceEditMode?.checked),
  };
}

function applyModeUi() {
  const playback = bridgeMode === 'playback';
  const hub = bridgeMode === 'meetinghub';
  document.querySelectorAll('[data-bridge-mode]').forEach((btn) => {
    const active = btn.getAttribute('data-bridge-mode') === bridgeMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (els.btnStart) {
    els.btnStart.textContent = hub ? 'Ready for Hub decks' : playback ? 'Follow ROS cues' : 'Start follow';
    els.btnStart.hidden = hub;
  }
  if (els.btnSync) els.btnSync.hidden = !playback;
  if (els.btnCapture) els.btnCapture.hidden = playback || hub;
  if (els.cacheCard) els.cacheCard.hidden = !playback;
  if (els.meetingHubCard) els.meetingHubCard.hidden = !hub;
  if (els.dayField) els.dayField.hidden = hub;
  if (els.modeHint) {
    els.modeHint.textContent = hub
      ? 'Meeting Hub: open decks uploaded on the event’s Meeting Hub page. Use this on the room PowerPoint PC for General Meeting / Hollow Square Hub events.'
      : playback
        ? 'ROS PPT Launcher: pick a sync folder, then Sync decks. Sync downloads each deck and pulls or captures slide images (PowerPoint may open briefly). Follow ROS opens the matching file. Do not run both modes on this PC for the same event.'
        : 'PowerPoint Show with Timers: capture stills and fire cues when a slide is live. Do not run both modes on this PC for the same event.';
  }
  if (els.pptHint) {
    els.pptHint.textContent = hub
      ? 'Refresh decks, then Open. The helper downloads the current Hub version and launches PowerPoint on this PC.'
      : playback
        ? 'If another deck is already open, Follow ROS cues closes it and opens the matching synced file. Run Sync decks after connecting so slide images are ready before follow.'
        : 'Open the deck in PowerPoint on this PC, then capture stills. Start follow before Slideshow so live slides fire the mapped cues.';
  }
  if (hub) renderHubDecks(hubDecks);
}

function renderHubDecks(decks) {
  hubDecks = Array.isArray(decks) ? decks : [];
  if (!els.hubDeckList) return;
  if (!hubDecks.length) {
    els.hubDeckList.innerHTML =
      '<p class="hint">No current PowerPoint decks on this Meeting Hub yet. Upload PPT/PPTX (or Make PowerPoint from PDF) on the Hub page.</p>';
    return;
  }
  els.hubDeckList.innerHTML = hubDecks
    .map((deck) => {
      const label = deck.name || deck.original_name || deck.id;
      const open = String(hubOpenDeckId) === String(deck.id);
      const ver =
        Number(deck.versionCount) > 1
          ? ` · v${deck.version || 1}/${deck.versionCount}`
          : '';
      return (
        `<div class="cache-row${open ? ' cache-open' : ''}">` +
        `<div class="cache-meta"><strong>${escapeHtml(label)}</strong><span class="hint">${escapeHtml(ver.trim())}</span></div>` +
        `<button type="button" data-hub-open="${escapeHtml(String(deck.id))}" class="secondary">${open ? 'Re-open' : 'Open'}</button>` +
        `</div>`
      );
    })
    .join('');
  els.hubDeckList.querySelectorAll('[data-hub-open]').forEach((btn) => {
    btn.onclick = () => void openHubDeck(btn.getAttribute('data-hub-open'));
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function refreshHubDecks() {
  const cfg = formConfig();
  if (!cfg.eventId) {
    els.apiMsg.textContent = 'Pick a Meeting Hub event first.';
    return;
  }
  try {
    if (els.stError) els.stError.textContent = '';
    const status = await api.listMeetingHubDecks(cfg);
    hubOpenDeckId = status.openDeckId || '';
    renderHubDecks(status.decks || []);
    applyStatus(status);
    toast(`${(status.decks || []).length} deck(s)`);
  } catch (err) {
    if (els.stError) els.stError.textContent = err.message || String(err);
    if (els.hubDeckList) {
      els.hubDeckList.innerHTML = `<p class="error">${escapeHtml(err.message || String(err))}</p>`;
    }
  }
}

async function openHubDeck(deckId) {
  if (!deckId) return;
  try {
    if (els.stError) els.stError.textContent = '';
    const status = await api.openMeetingHubDeck(deckId, formConfig());
    hubOpenDeckId = status.openDeckId || deckId;
    renderHubDecks(status.decks?.length ? status.decks : hubDecks);
    applyStatus(status);
    toast(status.lastAction || 'Opened');
  } catch (err) {
    if (els.stError) els.stError.textContent = err.message || String(err);
  }
}

function applyCaptureSourceUi() {
  document.querySelectorAll('[data-capture-source]').forEach((btn) => {
    const active = btn.getAttribute('data-capture-source') === liveCaptureSource;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (els.stLivecapSrc) {
    els.stLivecapSrc.textContent = liveCaptureSource === 'camera' ? 'Camera / NDI' : 'Screen';
  }
}

function applyLiveCapture(status) {
  if (!status) return;
  if (status.source === 'camera' || status.source === 'screen') {
    liveCaptureSource = status.source;
    applyCaptureSourceUi();
  }
  if (els.stLivecap) els.stLivecap.textContent = status.active ? 'On' : 'Off';
  if (els.liveViewUrl && status.viewUrl != null) els.liveViewUrl.value = status.viewUrl || '';
  if (els.livecapError) els.livecapError.textContent = status.error || '';
}

function renderCache(rows) {
  if (!els.cacheList) return;
  const all = Array.isArray(rows) ? rows : [];
  const ev = selectedEvent();
  const days = ev ? eventNumberOfDays(ev) : 1;
  const list = days > 1 ? all.filter((row) => Number(row.day || 1) === selectedDay) : all;
  if (!all.length) {
    els.cacheList.innerHTML = '<p class="hint">No .ppt / .pptx assets on this event yet.</p>';
    return;
  }
  if (!list.length) {
    els.cacheList.innerHTML = `<p class="hint">No decks on Day ${selectedDay}. ${all.length} file(s) synced for other days.</p>`;
    return;
  }
  els.cacheList.innerHTML = list
    .map((row) => {
      const flag = row.hasPPT ? 'PPT cue' : 'file only';
      const file = row.localName || row.name || 'deck';
      const open = Number(row.itemId) === Number(window.__rosOpenItemId);
      const dayBit = days > 1 ? ` · Day ${row.day || 1}` : '';
      const cue =
        String(row.cueLabel || '').trim() ||
        (Number.isFinite(Number(row.itemId)) ? `CUE ${row.itemId}` : 'CUE');
      return `<div class="cache-row${open ? ' cache-open' : ''}"><strong>${file}</strong><span>${cue}${dayBit} · ${flag}${open ? ' · OPEN' : ''}</span><span class="cache-${row.state || 'ok'}">${row.detail || row.state || ''}</span></div>`;
    })
    .join('');
}

function toast(msg, ms = 2800) {
  els.toast.hidden = false;
  els.toast.textContent = msg;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    els.toast.hidden = true;
  }, Math.max(1200, Number(ms) || 2800));
}

function confirmSyncDecks(reason) {
  const lead =
    reason === 'event'
      ? 'Event selected. Sync PowerPoint decks and slide images now?\n\n'
      : 'Sync this event’s PowerPoint decks now?\n\n';
  return window.confirm(
    lead +
      '• Downloads / updates decks in the sync folder\n' +
      '• Downloads slide images from ROS when available\n' +
      '• Opens each missing deck briefly in PowerPoint to capture slide images\n\n' +
      'You’ll get a confirmation when sync finishes.'
  );
}

async function runSyncDecks({ reason } = {}) {
  if (!els.eventSelect?.value?.trim()) {
    els.stError.textContent = 'Pick an event first.';
    return false;
  }
  if (!String(els.syncFolder?.value || '').trim()) {
    els.stError.textContent = 'Pick a sync folder first.';
    return false;
  }
  if (!confirmSyncDecks(reason)) return false;
  await api.saveConfig(formConfig());
  els.stError.textContent = 'Syncing decks and slide images…';
  if (els.btnSync) els.btnSync.disabled = true;
  try {
    const result = await api.syncPlayback(formConfig());
    const rows = Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
    window.__rosCacheRows = rows;
    renderCache(rows);
    const status = (await api.getStatus()) || window.__rosLastStatus || {};
    const deckOk =
      Number(result?.deckOk) ||
      rows.filter((r) => r.state === 'ok' || r.state === 'replaced').length ||
      status.cacheOk ||
      0;
    const deckTotal = Number(result?.deckTotal) || rows.length || status.cacheTotal || deckOk;
    const slides = Number(result?.previewSlides ?? status.previewSlides ?? 0);
    const missing = Number(result?.previewMissing ?? status.previewMissing ?? 0);
    const captured = Number(result?.previewCaptured ?? status.previewCaptured ?? 0);
    const summary =
      result?.message ||
      [
        `Synced ${deckOk}/${deckTotal} decks`,
        slides > 0 ? `${slides} slide images` : null,
        captured > 0 ? `captured ${captured}` : null,
        missing > 0 ? `${missing} still need images` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    toast(`Sync complete · ${summary}`, 7000);
    els.stError.textContent = missing > 0 ? `Sync finished with gaps: ${summary}` : '';
    if (els.stAction) els.stAction.textContent = summary;
    return true;
  } catch (err) {
    els.stError.textContent = err.message || String(err);
    toast('Sync failed', 4000);
    return false;
  } finally {
    if (els.btnSync) els.btnSync.disabled = false;
  }
}

function eventDateMs(ev) {
  const raw = String(ev?.date || ev?.event_date || ev?.eventDate || '').trim();
  if (!raw) return null;
  // Calendar dates are stored as YYYY-MM-DD or …T00:00:00.000Z meaning that calendar day.
  // Do not use local getFullYear/Month/Date on the Date — UTC midnight becomes "yesterday" in US timezones.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if ([y, mo, d].every((n) => Number.isFinite(n))) {
      return new Date(y, mo - 1, d).getTime();
    }
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
}

function eventNumberOfDays(ev) {
  const sd = ev?.schedule_data || ev?.scheduleData || {};
  if (typeof sd === 'string') {
    try {
      return eventNumberOfDays({ ...ev, schedule_data: JSON.parse(sd) });
    } catch {
      /* ignore */
    }
  }
  const n = Number(ev?.numberOfDays ?? ev?.number_of_days ?? sd.numberOfDays ?? sd.number_of_days);
  return Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
}

function eventLastDayMs(ev) {
  const startMs = eventDateMs(ev);
  if (startMs == null) return null;
  const end = new Date(startMs);
  end.setDate(end.getDate() + (eventNumberOfDays(ev) - 1));
  return end.getTime();
}

function formatEventDate(ev) {
  const ms = eventDateMs(ev);
  if (ms == null) return String(ev?.date || ev?.event_date || '').trim();
  const days = eventNumberOfDays(ev);
  const startLabel = new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (days <= 1) return startLabel;
  const endMs = eventLastDayMs(ev);
  const endLabel =
    endMs != null
      ? new Date(endMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
  return endLabel ? `${startLabel}–${endLabel}` : startLabel;
}

function eventSearchHaystack(ev) {
  return [ev?.name, ev?.title, ev?.date, ev?.event_date, formatEventDate(ev), ev?.id]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
}

function filterAndSortEvents(events, filter, query) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const q = String(query || '').trim().toLowerCase();
  const list = Array.isArray(events) ? events.slice() : [];

  const filtered = list.filter((ev) => {
    const lastMs = eventLastDayMs(ev);
    if (filter === 'upcoming') {
      if (lastMs == null) return true;
      if (lastMs < todayMs) return false;
    } else if (filter === 'past') {
      if (lastMs == null || lastMs >= todayMs) return false;
    }
    if (q && !eventSearchHaystack(ev).includes(q)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const am = eventDateMs(a);
    const bm = eventDateMs(b);
    if (am == null && bm == null) return String(a.name || '').localeCompare(String(b.name || ''));
    if (am == null) return 1;
    if (bm == null) return -1;
    return filter === 'past' ? bm - am : am - bm;
  });
  return filtered;
}

function eventCalendarDay(ev) {
  const start = eventDateMs(ev);
  if (start == null) return null;
  const days = eventNumberOfDays(ev);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayIndex = Math.round((today.getTime() - start) / 86400000);
  if (dayIndex < 0 || dayIndex >= days) return null;
  return dayIndex + 1;
}

function formatDayOption(ev, day) {
  const start = eventDateMs(ev);
  if (start == null) return `Day ${day}`;
  const d = new Date(start);
  d.setDate(d.getDate() + (day - 1));
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Day ${day} — ${label}`;
}

function fillDaySelect() {
  const ev = selectedEvent();
  const days = ev ? eventNumberOfDays(ev) : 1;
  if (!els.dayField || !els.daySelect) return;
  els.dayField.hidden = false;
  const eventId = ev?.id != null ? String(ev.id) : '';
  const stored = eventId ? Number(selectedDaysByEvent[eventId]) : NaN;
  const todayDay = ev ? eventCalendarDay(ev) : null;
  if (Number.isFinite(stored) && stored >= 1 && stored <= days) selectedDay = stored;
  else if (todayDay) selectedDay = todayDay;
  else if (selectedDay < 1 || selectedDay > days) selectedDay = 1;
  els.daySelect.innerHTML = '';
  for (let day = 1; day <= days; day += 1) {
    const opt = document.createElement('option');
    opt.value = String(day);
    opt.textContent = formatDayOption(ev, day);
    if (day === selectedDay) opt.selected = true;
    els.daySelect.appendChild(opt);
  }
  if (eventId) selectedDaysByEvent[eventId] = selectedDay;
  if (!els.dayHint) return;
  if (!ev) {
    els.dayHint.textContent = 'Load events and pick a show. Multi-day events list every day here.';
    return;
  }
  if (days <= 1) {
    els.dayHint.textContent = 'This event is 1 day.';
    return;
  }
  els.dayHint.textContent =
    todayDay && todayDay !== selectedDay
      ? `Today is Day ${todayDay}. Follow only opens Day ${selectedDay} cues.`
      : `This event is ${days} days. Follow only opens Day ${selectedDay} cues.`;
}

function fillEvents(events, selectedId) {
  if (events) loadedEvents = Array.isArray(events) ? events : [];
  const keepId = selectedId || els.eventSelect.value || '';
  const visible = filterAndSortEvents(loadedEvents, eventFilter, els.eventSearch?.value);
  const selected = keepId ? loadedEvents.find((ev) => String(ev.id) === String(keepId)) : null;
  if (selected && !visible.some((ev) => String(ev.id) === String(selected.id))) {
    visible.unshift(selected);
  }

  els.eventSelect.innerHTML = `<option value="">Select an event (${eventFilter}, ${visible.length})</option>`;
  for (const ev of visible) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    const date = formatEventDate(ev);
    opt.textContent = `${ev.name || ev.title || 'Untitled'}${date ? ` — ${date}` : ''}`;
    if (keepId && String(ev.id) === String(keepId)) opt.selected = true;
    els.eventSelect.appendChild(opt);
  }
  fillDaySelect();
}

function setEventFilter(next) {
  eventFilter = next === 'past' || next === 'all' ? next : 'upcoming';
  document.querySelectorAll('[data-event-filter]').forEach((btn) => {
    const active = btn.getAttribute('data-event-filter') === eventFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  fillEvents(null, formConfig().eventId);
}

function applyStatus(status) {
  if (!status) return;
  window.__rosLastStatus = status;
  els.runPill.textContent = status.running ? 'Following' : 'Stopped';
  els.runPill.className = `pill ${status.running ? 'running' : 'stopped'}`;
  els.stPpt.textContent = status.powerpoint ? 'Found' : 'Not found';
  els.stDeck.textContent = status.deckName || '—';
  if (els.stOpen) {
    if (status.openMatch === 'unknown') {
      els.stOpen.textContent = `${status.deckName || 'Open file'} · not in sync folder`;
    } else if (status.openMatch === 'stale') {
      els.stOpen.textContent = `${status.loadedCueLabel || `CUE ${status.currentItemId}`} · older copy`;
    } else if (status.currentItemId != null) {
      els.stOpen.textContent = `${status.loadedCueLabel || `CUE ${status.currentItemId}`}${status.deckName ? ` · ${status.deckName}` : ''}`;
    } else {
      els.stOpen.textContent = status.powerpoint ? (status.deckName || 'Open, unidentified') : '—';
    }
  }
  els.stCount.textContent = status.slideCount || '—';
  els.stShow.textContent = status.slideshowActive ? 'Live' : 'Off';
  els.stLive.textContent =
    status.currentIndex != null
      ? status.slideCount
        ? `${status.currentIndex} / ${status.slideCount}`
        : String(status.currentIndex)
      : '—';
  if (els.stCue) {
    els.stCue.textContent =
      status.loadedCueLabel ||
      (status.loadedItemId != null ? `CUE ${status.loadedItemId}` : '—');
  }
  els.stAction.textContent = status.lastAction || status.message || '—';
  if (!(els.btnSync && els.btnSync.disabled)) {
    els.stError.textContent = status.error || '';
  }
  if (status.mode === 'playback' || bridgeMode === 'playback') {
    window.__rosOpenItemId = status.currentItemId;
    if (Array.isArray(status.cacheRows)) window.__rosCacheRows = status.cacheRows;
    renderCache(status.cacheRows || window.__rosCacheRows);
  }
  if (status.mode === 'meetinghub' || bridgeMode === 'meetinghub') {
    hubOpenDeckId = status.openDeckId || hubOpenDeckId;
    if (Array.isArray(status.decks)) renderHubDecks(status.decks);
  }
}

let sessionActive = false;
let sessionTickTimer = null;

function selectedSessionMode() {
  const checked = document.querySelector('input[name="sessionMode"]:checked');
  return checked ? checked.value : 'testing';
}

function syncSessionModeUi() {
  const mode = selectedSessionMode();
  if (els.sessionLiveHours) els.sessionLiveHours.hidden = mode !== 'live';
}

function applySession(state) {
  sessionActive = !!(state && state.active);
  if (els.sessionPill) {
    els.sessionPill.hidden = false;
    if (sessionActive) {
      els.sessionPill.classList.remove('expired');
      const left = state.remaining || '';
      els.sessionPill.textContent = left
        ? `${state.label || 'Session'} · ${left}`
        : state.label || 'Session active';
    } else {
      els.sessionPill.classList.add('expired');
      els.sessionPill.textContent = 'No session';
    }
  }
  if (els.btnSessionCancel) els.btnSessionCancel.hidden = !sessionActive;
  if (els.sessionModal && sessionActive) {
    els.sessionModal.hidden = true;
  }
}

function openSessionModal({ force = false } = {}) {
  if (!els.sessionModal) return;
  if (els.sessionModalError) els.sessionModalError.textContent = '';
  syncSessionModeUi();
  if (force || !sessionActive) {
    els.sessionModal.hidden = false;
  }
}

function closeSessionModal() {
  if (els.sessionModal && sessionActive) els.sessionModal.hidden = true;
}

async function refreshSession() {
  if (!api.getSession) return;
  const state = await api.getSession();
  applySession(state);
  if (!state.active) openSessionModal({ force: true });
}

async function confirmSession() {
  if (!api.startSession) return;
  if (els.sessionModalError) els.sessionModalError.textContent = '';
  const mode = selectedSessionMode();
  const hours = Number(els.sessionHours?.value || 4);
  const result = await api.startSession({ mode, hours });
  if (!result?.ok) {
    if (els.sessionModalError) els.sessionModalError.textContent = result?.error || 'Could not start session';
    return;
  }
  applySession(result);
  toast(result.label || 'Session started');
}

async function load() {
  const cfg = await api.loadConfig();
  els.apiBaseUrl.value = cfg.apiBaseUrl || '';
  els.apiToken.value = cfg.apiToken || '';
  bridgeMode = normalizeBridgeMode(cfg.bridgeMode);
  if (els.syncFolder) els.syncFolder.value = cfg.syncFolder || '';
  selectedDaysByEvent =
    cfg.selectedDaysByEvent && typeof cfg.selectedDaysByEvent === 'object' ? cfg.selectedDaysByEvent : {};
  selectedDay = Math.max(1, Math.floor(Number(cfg.selectedDay) || 1));
  applyModeUi();
  liveCaptureSource = cfg.liveCaptureSource === 'camera' ? 'camera' : 'screen';
  applyCaptureSourceUi();
  if (els.focusTarget) {
    const raw = String(cfg.focusTarget || '').trim().toLowerCase();
    if (raw === 'presenter' || raw === 'slideshow' || raw === 'app' || raw === 'off') {
      els.focusTarget.value = raw;
    } else if (raw === 'presentation' || cfg.focusPresentationView) {
      els.focusTarget.value = 'presenter';
    } else {
      els.focusTarget.value = 'off';
    }
  }
  if (els.forceEditMode) {
    els.forceEditMode.checked = cfg.forceEditMode !== false;
  }
  if (cfg.sessionMode) {
    const radio = document.querySelector(`input[name="sessionMode"][value="${cfg.sessionMode}"]`);
    if (radio) radio.checked = true;
  }
  if (els.sessionHours && cfg.sessionHours) {
    els.sessionHours.value = String(Math.min(24, Math.max(1, Math.floor(Number(cfg.sessionHours) || 4))));
  }
  syncSessionModeUi();
  if (cfg.eventId) {
    const opt = document.createElement('option');
    opt.value = cfg.eventId;
    opt.textContent = `Saved event ${cfg.eventId}`;
    els.eventSelect.appendChild(opt);
    els.eventSelect.value = cfg.eventId;
  }
  applyStatus(await api.getStatus());
  applyLiveCapture(await api.getLiveCapture());
  fillDaySelect();
  await refreshSession();
  if (sessionTickTimer) clearInterval(sessionTickTimer);
  sessionTickTimer = setInterval(() => {
    if (sessionActive) void refreshSession();
  }, 30_000);
}

document.getElementById('btn-save').onclick = async () => {
  await api.saveConfig(formConfig());
  toast('Saved');
};

document.getElementById('btn-validate').onclick = async () => {
  const result = await api.validateApi(formConfig());
  els.apiMsg.textContent = result.message || '';
  toast(result.ok ? 'API OK' : 'API failed');
};

document.getElementById('btn-load-events').onclick = async () => {
  try {
    await api.saveConfig(formConfig());
    const events = await api.listEvents(formConfig());
    fillEvents(events, formConfig().eventId);
    const visible = filterAndSortEvents(loadedEvents, eventFilter, els.eventSearch?.value).length;
    els.apiMsg.textContent = `${events.length} event(s) · ${visible} ${eventFilter}`;
  } catch (err) {
    els.apiMsg.textContent = err.message || String(err);
  }
};

document.querySelectorAll('[data-event-filter]').forEach((btn) => {
  btn.onclick = () => setEventFilter(btn.getAttribute('data-event-filter') || 'upcoming');
});

if (els.eventSearch) {
  els.eventSearch.addEventListener('input', () => fillEvents(null, formConfig().eventId));
}

if (els.eventSelect) {
  els.eventSelect.addEventListener('change', async () => {
    const id = els.eventSelect.value.trim();
    const stored = id ? Number(selectedDaysByEvent[id]) : NaN;
    if (Number.isFinite(stored) && stored >= 1) selectedDay = stored;
    fillDaySelect();
    await api.saveConfig(formConfig());
    if (bridgeMode === 'playback' && id && String(els.syncFolder?.value || '').trim()) {
      await runSyncDecks({ reason: 'event' });
    }
    if (bridgeMode === 'meetinghub' && id) {
      await refreshHubDecks();
    }
  });
}

if (els.daySelect) {
  els.daySelect.addEventListener('change', async () => {
    selectedDay = Math.max(1, Math.floor(Number(els.daySelect.value) || 1));
    const id = els.eventSelect.value.trim();
    if (id) selectedDaysByEvent[id] = selectedDay;
    fillDaySelect();
    await api.saveConfig(formConfig());
    if (bridgeMode === 'playback') renderCache(window.__rosCacheRows || []);
  });
}

document.querySelectorAll('[data-bridge-mode]').forEach((btn) => {
  btn.onclick = async () => {
    bridgeMode = normalizeBridgeMode(btn.getAttribute('data-bridge-mode'));
    applyModeUi();
    await api.saveConfig(formConfig());
    await api.stopBridge();
    if (bridgeMode === 'meetinghub' && formConfig().eventId) {
      await refreshHubDecks();
    }
  };
});

if (els.btnHubRefresh) {
  els.btnHubRefresh.onclick = () => void refreshHubDecks();
}

if (els.btnSync) {
  els.btnSync.onclick = async () => {
    await runSyncDecks({ reason: 'button' });
  };
}

document.getElementById('btn-capture').onclick = async () => {
  try {
    await api.saveConfig(formConfig());
    els.stError.textContent = 'Capturing stills…';
    await api.captureStills();
    toast('Stills uploaded');
  } catch (err) {
    els.stError.textContent = err.message || String(err);
  }
};

if (els.btnPickFolder) {
  els.btnPickFolder.onclick = async () => {
    const cfg = await api.pickSyncFolder();
    if (els.syncFolder) els.syncFolder.value = cfg.syncFolder || '';
    toast(cfg.syncFolder ? 'Sync folder saved' : 'No folder picked');
  };
}

document.querySelectorAll('input[name="sessionMode"]').forEach((input) => {
  input.addEventListener('change', syncSessionModeUi);
});

if (els.btnSession) {
  els.btnSession.onclick = () => openSessionModal({ force: true });
}
if (els.btnSessionStart) {
  els.btnSessionStart.onclick = () => void confirmSession();
}
if (els.btnSessionCancel) {
  els.btnSessionCancel.onclick = () => closeSessionModal();
}
if (api.onSession) {
  api.onSession((state) => {
    applySession(state);
    if (state?.ended) {
      toast(state.reason || 'Session ended — bridge stopped');
      openSessionModal({ force: true });
      void api.getLiveCapture().then(applyLiveCapture).catch(() => {});
      void api.getStatus().then(applyStatus).catch(() => {});
    }
  });
}

document.getElementById('btn-start').onclick = async () => {
  if (!sessionActive) {
    openSessionModal({ force: true });
    toast('Choose a session length first');
    return;
  }
  const cfg = formConfig();
  if (!cfg.eventId) {
    els.apiMsg.textContent = 'Pick an event first.';
    return;
  }
  if (cfg.bridgeMode === 'meetinghub') {
    const started = await api.startBridge(cfg);
    if (started && started.ok === false) {
      els.stError.textContent = started.error || 'Could not start';
      openSessionModal({ force: true });
      return;
    }
    await refreshHubDecks();
    return;
  }
  if (cfg.bridgeMode === 'playback' && !cfg.syncFolder) {
    const picked = await api.pickSyncFolder();
    if (els.syncFolder) els.syncFolder.value = picked.syncFolder || '';
    cfg.syncFolder = picked.syncFolder || '';
    if (!cfg.syncFolder) {
      els.stError.textContent = 'Pick a sync folder first.';
      return;
    }
  }
  const started = await api.startBridge(cfg);
  if (started && started.ok === false) {
    els.stError.textContent = started.error || 'Could not start';
    openSessionModal({ force: true });
  }
};

document.getElementById('btn-stop').onclick = () => api.stopBridge();

document.querySelectorAll('[data-capture-source]').forEach((btn) => {
  btn.onclick = async () => {
    liveCaptureSource = btn.getAttribute('data-capture-source') === 'camera' ? 'camera' : 'screen';
    applyCaptureSourceUi();
    await api.saveConfig({ liveCaptureSource });
  };
});

if (els.btnLiveStart) {
  els.btnLiveStart.onclick = async () => {
    try {
      if (!sessionActive) {
        openSessionModal({ force: true });
        toast('Choose a session length first');
        return;
      }
      await api.saveConfig(formConfig());
      if (els.livecapError) els.livecapError.textContent = '';
      applyLiveCapture(await api.startLiveCapture(formConfig()));
      toast('Live capture started');
    } catch (err) {
      if (els.livecapError) els.livecapError.textContent = err.message || String(err);
      if (/session/i.test(String(err?.message || ''))) openSessionModal({ force: true });
    }
  };
}

if (els.btnLiveStop) {
  els.btnLiveStop.onclick = async () => {
    applyLiveCapture(await api.stopLiveCapture());
    toast('Live capture stopped');
  };
}

api.onStatus(applyStatus);
if (api.onLiveCapture) api.onLiveCapture(applyLiveCapture);
void load();
