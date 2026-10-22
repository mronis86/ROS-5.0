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
  apiMsg: document.getElementById('api-msg'),
  runPill: document.getElementById('run-pill'),
  stPpt: document.getElementById('st-ppt'),
  stDeck: document.getElementById('st-deck'),
  stCount: document.getElementById('st-count'),
  stShow: document.getElementById('st-show'),
  stLive: document.getElementById('st-live'),
  stAction: document.getElementById('st-action'),
  stError: document.getElementById('st-error'),
  toast: document.getElementById('toast'),
};

let loadedEvents = [];

function formConfig() {
  return {
    apiBaseUrl: els.apiBaseUrl.value.trim(),
    apiToken: els.apiToken.value.trim(),
    eventId: els.eventSelect.value.trim(),
  };
}

function toast(msg) {
  els.toast.hidden = false;
  els.toast.textContent = msg;
  setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function eventDateMs(ev) {
  const raw = String(ev?.date || ev?.event_date || '').trim();
  const parts = raw.split('-').map(Number);
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function fillEvents(events, selectedId) {
  loadedEvents = Array.isArray(events) ? events : [];
  loadedEvents.sort((a, b) => eventDateMs(b) - eventDateMs(a));
  els.eventSelect.innerHTML = '<option value="">Select an event</option>';
  for (const ev of loadedEvents) {
    const opt = document.createElement('option');
    opt.value = ev.id;
    const date = ev.date || ev.event_date || '';
    opt.textContent = `${ev.name || 'Untitled'}${date ? ` — ${date}` : ''}`;
    if (selectedId && String(ev.id) === String(selectedId)) opt.selected = true;
    els.eventSelect.appendChild(opt);
  }
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
  els.stAction.textContent = status.lastAction || '—';
  els.stError.textContent = status.error || '';
}

async function load() {
  const cfg = await api.loadConfig();
  els.apiBaseUrl.value = cfg.apiBaseUrl || '';
  els.apiToken.value = cfg.apiToken || '';
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
    els.apiMsg.textContent = `${events.length} event(s)`;
  } catch (err) {
    els.apiMsg.textContent = err.message || String(err);
  }
};

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

document.getElementById('btn-start').onclick = async () => {
  const cfg = formConfig();
  if (!cfg.eventId) {
    els.apiMsg.textContent = 'Pick an event first.';
    return;
  }
  await api.startBridge(cfg);
};

document.getElementById('btn-stop').onclick = () => api.stopBridge();

api.onStatus(applyStatus);
void load();
