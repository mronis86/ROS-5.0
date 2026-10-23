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
  apiMsg: document.getElementById('api-msg'),
  runPill: document.getElementById('run-pill'),
  stPpt: document.getElementById('st-ppt'),
  stDeck: document.getElementById('st-deck'),
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
};

let loadedEvents = [];
/** @type {'all' | 'upcoming' | 'past'} */
let eventFilter = 'upcoming';
/** @type {'follow' | 'playback'} */
let bridgeMode = 'follow';

function formConfig() {
  return {
    apiBaseUrl: els.apiBaseUrl.value.trim(),
    apiToken: els.apiToken.value.trim(),
    eventId: els.eventSelect.value.trim(),
    bridgeMode,
    syncFolder: els.syncFolder ? els.syncFolder.value.trim() : '',
  };
}

function applyModeUi() {
  const playback = bridgeMode === 'playback';
  document.querySelectorAll('[data-bridge-mode]').forEach((btn) => {
    const active = btn.getAttribute('data-bridge-mode') === bridgeMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (els.btnStart) els.btnStart.textContent = playback ? 'Follow ROS cues' : 'Start follow';
  if (els.btnSync) els.btnSync.hidden = !playback;
  if (els.btnCapture) els.btnCapture.hidden = playback;
  if (els.cacheCard) els.cacheCard.hidden = !playback;
  if (els.modeHint) {
    els.modeHint.textContent = playback
      ? 'ROS PPT Launcher: pick a sync folder, download the event decks, then follow ROS. When a PPT cue starts, only that deck opens and runs. Do not run both modes on this PC for the same event.'
      : 'PowerPoint Show with Timers: capture stills and fire cues when a slide is live. Do not run both modes on this PC for the same event.';
  }
  if (els.pptHint) {
    els.pptHint.textContent = playback
      ? 'If another deck is already open, Follow ROS cues closes it and opens the matching synced file. Start the cue on Run of Show to run slideshow.'
      : 'Open the deck in PowerPoint on this PC, then capture stills. Start follow before Slideshow so live slides fire the mapped cues.';
  }
}

function renderCache(rows) {
  if (!els.cacheList) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    els.cacheList.innerHTML = '<p class="hint">No .ppt / .pptx assets on this event yet.</p>';
    return;
  }
  els.cacheList.innerHTML = list
    .map((row) => {
      const flag = row.hasPPT ? 'PPT cue' : 'file only';
      const file = row.localName || row.name || 'deck';
      return `<div class="cache-row"><strong>${file}</strong><span>cue ${row.itemId} · ${flag}</span><span class="cache-${row.state || 'ok'}">${row.detail || row.state || ''}</span></div>`;
    })
    .join('');
}

function toast(msg) {
  els.toast.hidden = false;
  els.toast.textContent = msg;
  setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function eventDateMs(ev) {
  const raw = String(ev?.date || ev?.event_date || ev?.eventDate || '').trim();
  const parts = raw.split('-').map(Number);
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function eventNumberOfDays(ev) {
  const sd = ev?.schedule_data || ev?.scheduleData || {};
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
}

function setEventFilter(next) {
  eventFilter = next === 'past' || next === 'all' ? next : 'upcoming';
  document.querySelectorAll('.event-tab').forEach((btn) => {
    const active = btn.getAttribute('data-event-filter') === eventFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  fillEvents(null, formConfig().eventId);
}

function applyStatus(status) {
  if (!status) return;
  els.runPill.textContent = status.running ? 'Following' : 'Stopped';
  els.runPill.className = `pill ${status.running ? 'running' : 'stopped'}`;
  els.stPpt.textContent = status.powerpoint ? 'Found' : 'Not found';
  els.stDeck.textContent = status.deckName || '—';
  els.stCount.textContent = status.slideCount || '—';
  els.stShow.textContent = status.slideshowActive ? 'Live' : 'Off';
  els.stLive.textContent = status.currentIndex != null ? String(status.currentIndex) : '—';
  if (els.stCue) {
    els.stCue.textContent =
      status.loadedCueLabel ||
      (status.loadedItemId != null ? `Cue ${status.loadedItemId}` : '—');
  }
  els.stAction.textContent = status.lastAction || '—';
  els.stError.textContent = status.error || '';
  if (status.mode === 'playback' || bridgeMode === 'playback') {
    renderCache(status.cacheRows);
  }
}

async function load() {
  const cfg = await api.loadConfig();
  els.apiBaseUrl.value = cfg.apiBaseUrl || '';
  els.apiToken.value = cfg.apiToken || '';
  bridgeMode = cfg.bridgeMode === 'playback' ? 'playback' : 'follow';
  if (els.syncFolder) els.syncFolder.value = cfg.syncFolder || '';
  applyModeUi();
  if (cfg.eventId) {
    const opt = document.createElement('option');
    opt.value = cfg.eventId;
    opt.textContent = `Saved event ${cfg.eventId}`;
    els.eventSelect.appendChild(opt);
    els.eventSelect.value = cfg.eventId;
  }
  applyStatus(await api.getStatus());
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

document.querySelectorAll('.event-tab').forEach((btn) => {
  btn.onclick = () => setEventFilter(btn.getAttribute('data-event-filter') || 'upcoming');
});

if (els.eventSearch) {
  els.eventSearch.addEventListener('input', () => fillEvents(null, formConfig().eventId));
}

document.querySelectorAll('[data-bridge-mode]').forEach((btn) => {
  btn.onclick = async () => {
    bridgeMode = btn.getAttribute('data-bridge-mode') === 'playback' ? 'playback' : 'follow';
    applyModeUi();
    await api.saveConfig(formConfig());
    await api.stopBridge();
  };
});

if (els.btnSync) {
  els.btnSync.onclick = async () => {
    try {
      await api.saveConfig(formConfig());
      els.stError.textContent = 'Syncing decks…';
      const rows = await api.syncPlayback(formConfig());
      renderCache(rows);
      toast('Decks synced');
      els.stError.textContent = '';
    } catch (err) {
      els.stError.textContent = err.message || String(err);
    }
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

document.getElementById('btn-start').onclick = async () => {
  const cfg = formConfig();
  if (!cfg.eventId) {
    els.apiMsg.textContent = 'Pick an event first.';
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
  await api.startBridge(cfg);
};

document.getElementById('btn-stop').onclick = () => api.stopBridge();

api.onStatus(applyStatus);
void load();
