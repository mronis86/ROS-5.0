const MAX_DISPLAYS = 8;
const DISPLAYS_STORAGE_KEY = 'ros-offline-kiosk-v2-displays-v4';

const REMOTE_DEFAULTS = {
  vdo: 'https://vdo.ninja/',
  meshcast: 'https://app.meshcast.io/',
};

const TIMER_MODES = [
  { id: 'clock', label: 'Clock', route: '/timer' },
  { id: 'dsm', label: 'DSM', route: '/dsm-clock' },
];

const DISPLAY_PRESETS = [
  {
    id: 'timer',
    name: 'Stage Timer',
    route: '/timer',
    timerMode: 'clock',
    desc: 'Stage / confidence timer. Default to Clock or DSM for this kiosk.',
    ready: true,
    preset: true,
  },
  {
    id: 'photo',
    name: 'Photo View',
    route: '/photo-view',
    desc: 'Speaker photos and cue context for photo ops.',
    ready: false,
    preset: true,
  },
  {
    id: 'oplarge',
    name: 'Operator Large',
    route: '/operator-cue-display',
    desc: 'Large-type cue board for floor / remote ops.',
    ready: false,
    preset: true,
  },
  {
    id: 'custom',
    name: 'Custom URL',
    route: 'custom',
    desc: 'Any local Offline Show page or LAN graphic.',
    ready: true,
    preset: true,
  },
];

function newDisplayId() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTimerMode(value) {
  return value === 'dsm' ? 'dsm' : 'clock';
}

function timerModeMeta(mode) {
  return TIMER_MODES.find((m) => m.id === normalizeTimerMode(mode)) || TIMER_MODES[0];
}

function defaultNdiNameForDisplay(row) {
  const id = String(row?.id || '');
  if (id === 'timer') return 'SINOR-Timer';
  if (id === 'photo') return 'SINOR-Photo';
  if (id === 'oplarge') return 'SINOR-OpLarge';
  if (id === 'custom') return 'SINOR-Custom';
  const slug = String(row?.name || id || 'Display')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return `SINOR-${slug || 'Display'}`;
}

function defaultWlSettingsForDisplay(row) {
  return {
    format: '1080p50',
    previewFactor: 4,
    sharedName: defaultNdiNameForDisplay(row),
    screenDisplay: 0,
    ndi: [{ name: defaultNdiNameForDisplay(row), alpha: true }],
    outputs: {
      ndi: true,
      shared: false,
      screen: false,
      decklink: false,
      omt: false,
    },
  };
}

function normalizeWlSettings(raw, row) {
  const fallback = defaultWlSettingsForDisplay(row);
  const src = raw && typeof raw === 'object' ? raw : {};
  const outs = src.outputs && typeof src.outputs === 'object' ? src.outputs : {};
  const ndi = Array.isArray(src.ndi)
    ? src.ndi
        .map((n) => ({
          name: String(n?.name || '').trim(),
          alpha: n?.alpha !== false,
        }))
        .filter((n) => n.name)
    : [];
  const screenDisplay = Number.isFinite(Number(src.screenDisplay))
    ? Math.max(0, Math.floor(Number(src.screenDisplay)))
    : fallback.screenDisplay;
  return {
    format: typeof src.format === 'string' && src.format.trim() ? src.format.trim() : fallback.format,
    previewFactor: [1, 2, 4, 8].includes(Number(src.previewFactor))
      ? Number(src.previewFactor)
      : fallback.previewFactor,
    sharedName:
      typeof src.sharedName === 'string' && src.sharedName.trim()
        ? src.sharedName.trim()
        : fallback.sharedName,
    screenDisplay,
    ndi: ndi.length ? ndi : fallback.ndi,
    outputs: {
      ndi: typeof outs.ndi === 'boolean' ? outs.ndi : true,
      shared: Boolean(outs.shared),
      screen: Boolean(outs.screen),
      decklink: Boolean(outs.decklink),
      omt: Boolean(outs.omt),
    },
  };
}

function presetTemplate(p) {
  const row = {
    id: p.id,
    name: p.name,
    route: p.route,
    desc: p.desc,
    ready: p.ready !== false,
    preset: true,
    url: '',
  };
  if (p.id === 'timer') {
    row.timerMode = normalizeTimerMode(p.timerMode);
    row.route = timerModeMeta(row.timerMode).route;
  }
  row.wlSettings = defaultWlSettingsForDisplay(row);
  return row;
}

function defaultDisplays() {
  return DISPLAY_PRESETS.map(presetTemplate);
}

function normalizeDisplayRow(row, i = 0) {
  const preset = DISPLAY_PRESETS.find((p) => p.id === row?.id);
  if (preset) {
    const next = {
      ...presetTemplate(preset),
      url: typeof row?.url === 'string' ? row.url.trim() : '',
      name: preset.name,
    };
    if (preset.id === 'timer') {
      const mode = normalizeTimerMode(row?.timerMode || (row?.route === '/dsm-clock' ? 'dsm' : 'clock'));
      next.timerMode = mode;
      next.route = timerModeMeta(mode).route;
    }
    next.wlSettings = normalizeWlSettings(row?.wlSettings, next);
    return next;
  }
  const extra = {
    id: typeof row?.id === 'string' && row.id ? row.id : newDisplayId(),
    name: String(row?.name || `Display ${i + 1}`).slice(0, 64),
    route: 'custom',
    desc: 'Extra URL slot.',
    ready: true,
    preset: false,
    url: typeof row?.url === 'string' ? row.url.trim() : '',
  };
  extra.wlSettings = normalizeWlSettings(row?.wlSettings, extra);
  return extra;
}

function loadDisplays() {
  try {
    const raw =
      localStorage.getItem(DISPLAYS_STORAGE_KEY) ||
      localStorage.getItem('ros-offline-kiosk-v2-displays-v3') ||
      localStorage.getItem('ros-offline-kiosk-v2-displays-v2');
    if (!raw) return defaultDisplays();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultDisplays();

    const extras = parsed
      .filter((row) => row && !DISPLAY_PRESETS.some((p) => p.id === row.id))
      .map((row, i) => normalizeDisplayRow(row, i));

    const presets = DISPLAY_PRESETS.map((p) => {
      const saved = parsed.find((row) => row?.id === p.id);
      return normalizeDisplayRow(saved || p);
    });

    return [...presets, ...extras].slice(0, MAX_DISPLAYS);
  } catch {
    return defaultDisplays();
  }
}

function saveDisplays() {
  try {
    localStorage.setItem(
      DISPLAYS_STORAGE_KEY,
      JSON.stringify(
        state.displays.map((d) => ({
          id: d.id,
          name: d.name,
          url: d.url,
          route: d.route || 'custom',
          timerMode: d.id === 'timer' ? normalizeTimerMode(d.timerMode) : undefined,
          wlSettings: normalizeWlSettings(d.wlSettings, d),
          preset: Boolean(d.preset),
        }))
      )
    );
  } catch {
    /* ignore quota */
  }
}

function pageUrlForDisplay(row) {
  if (!row) return '';
  if (row.route === 'custom' || !row.route) return row.url || '';
  if (!state.eventId) return '';

  const base = 'http://127.0.0.1:3004';
  const ev = selectedEvent();
  const params = new URLSearchParams();
  params.set('eventId', state.eventId);

  if (row.id === 'timer') {
    const path = timerModeMeta(row.timerMode).route;
    return `${base}${path}?${params.toString()}`;
  }

  if (row.id === 'photo' || row.id === 'oplarge') {
    if (ev?.name) params.set('eventName', ev.name);
    if (ev?.date) params.set('eventDate', String(ev.date));
    if (ev?.location) params.set('eventLocation', ev.location);
    return `${base}${row.route}?${params.toString()}`;
  }

  return `${base}${row.route}?${params.toString()}`;
}

function syncPresetDisplayUrls() {
  let changed = false;
  for (const row of state.displays) {
    if (!row.preset || row.route === 'custom') continue;
    if (row.id === 'timer') {
      const path = timerModeMeta(row.timerMode).route;
      if (row.route !== path) {
        row.route = path;
        changed = true;
      }
    }
    const next = pageUrlForDisplay(row);
    if (row.url !== next) {
      row.url = next;
      changed = true;
    }
  }
  if (changed) saveDisplays();
}

const state = {
  tab: 'status',
  displays: loadDisplays(),
  /** @type {{ index: number, label: string, primary?: boolean }[]} */
  systemDisplays: [],
  /** @type {string[]} display ids with a live WebLinked source */
  armedDisplayIds: [],
  /** which card's pipeline the dock/overlay preview is showing */
  previewDisplayId: null,
  settingsDisplayId: null,
  weblinked: { running: false, baseUrl: null, port: null, error: '' },
  remoteProvider: null,
  remoteOpen: false,
  offlineShowRunning: false,
  events: [],
  eventId: '',
  eventScope: 'upcoming',
  eventSearch: '',
  busy: false,
  statusNote: '',
  cloudConnected: false,
  lanOnly: true,
  tokenConfigured: false,
  tokenPrefix: '',
  connectivity: null,
  /** @type {Record<string, any> | null} */
  pptBridge: null,
};

let pptBridgePollTimer = null;
let pptBridgeFetchSeq = 0;

function wlSourceId(rowOrId) {
  const id = typeof rowOrId === 'string' ? rowOrId : rowOrId?.id;
  return String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isDisplayArmed(id) {
  return state.armedDisplayIds.includes(id);
}

function markDisplayArmed(id) {
  if (!id || isDisplayArmed(id)) return;
  state.armedDisplayIds = [...state.armedDisplayIds, id];
}

function markDisplayDisarmed(id) {
  state.armedDisplayIds = state.armedDisplayIds.filter((x) => x !== id);
  if (state.previewDisplayId === id) state.previewDisplayId = state.armedDisplayIds[0] || null;
}

function primaryArmedDisplayId() {
  return state.previewDisplayId || state.armedDisplayIds[0] || null;
}

let embedObserver = null;

function $(sel) {
  return document.querySelector(sel);
}

function $$(sel) {
  return Array.from(document.querySelectorAll(sel));
}

function selectedEvent() {
  return state.events.find((e) => e.id === state.eventId) || null;
}

/** PPT Bridge heartbeats use the calendar UUID, not the logical ROS event-… id. */
function pptStatusEventId() {
  const ev = selectedEvent();
  return String(ev?.calendarId || state.eventId || '').trim();
}

function findDisplay(id) {
  return state.displays.find((d) => d.id === id) || null;
}

function setDisplayNote(text) {
  const el = $('#displayNote');
  if (!el) return;
  const msg = text || '';
  el.textContent = msg;
  el.hidden = !msg;
}

function renderWebLinkedStatus() {
  const host = $('#weblinkedStatus');
  const text = $('#weblinkedStatusText');
  const startBtn = $('#startWebLinkedBtn');
  const stopBtn = $('#stopWebLinkedBtn');
  if (!host || !text) return;
  const w = state.weblinked;
  if (w.running) {
    host.dataset.state = 'ok';
    text.textContent = `WebLinked online · ${w.baseUrl || `:${w.port || '—'}`}`;
  } else {
    host.dataset.state = 'bad';
    text.textContent = w.error || 'WebLinked offline — start the engine (HTTP :7655 Sinor)';
  }
  const busy = Boolean(w.starting || w.stopping);
  if (startBtn) {
    startBtn.hidden = false;
    startBtn.disabled = busy;
    startBtn.textContent = w.starting
      ? 'Starting…'
      : w.running
        ? 'Restart WebLinked'
        : 'Start WebLinked';
  }
  if (stopBtn) {
    stopBtn.hidden = false;
    stopBtn.disabled = busy || !w.running;
    stopBtn.textContent = w.stopping ? 'Stopping…' : 'Stop WebLinked';
  }
}

async function refreshWebLinkedStatus() {
  if (!window.kiosk?.weblinkedStatus) {
    state.weblinked = { running: false, baseUrl: null, port: null, error: 'Bridge unavailable' };
    renderWebLinkedStatus();
    return;
  }
  const wasStarting = Boolean(state.weblinked.starting);
  const wasStopping = Boolean(state.weblinked.stopping);
  const result = await window.kiosk.weblinkedStatus();
  state.weblinked = {
    ...state.weblinked,
    running: Boolean(result?.running),
    baseUrl: result?.baseUrl || null,
    port: result?.port || null,
    error: wasStarting || wasStopping ? state.weblinked.error || '' : result?.error || '',
    // Status polls must not clear an in-flight Start/Stop (that re-enabled the button mid-boot).
    starting: wasStarting,
    stopping: wasStopping,
  };
  renderWebLinkedStatus();
}

function formatWebLinkedDiagnosticsText(result) {
  return [
    '=== ROS Offline Kiosk · WebLinked diagnostics ===',
    `When: ${new Date().toISOString()}`,
    '',
    '--- diagnostics ---',
    JSON.stringify(result?.diagnostics || result?.status?.diagnostics || {}, null, 2),
    '',
    '--- status ---',
    JSON.stringify(
      {
        ok: result?.status?.ok,
        running: result?.status?.running,
        error: result?.status?.error,
        baseUrl: result?.status?.baseUrl,
        exe: result?.status?.exe,
        logPath: result?.status?.logPath || result?.log?.path,
      },
      null,
      2
    ),
    '',
    `--- log (${result?.log?.path || 'n/a'}) ---`,
    result?.log?.text || result?.error || '(empty)',
    '',
  ].join('\n');
}

let wlLogCacheText = '';

async function fetchWebLinkedDiagnostics() {
  if (!window.kiosk?.weblinkedDiagnostics) return null;
  return window.kiosk.weblinkedDiagnostics();
}

async function fillWebLinkedLogViewer(result) {
  const pathEl = $('#wlLogPath');
  const bodyEl = $('#wlLogBody');
  if (!pathEl || !bodyEl) return;
  const payload = result || (await fetchWebLinkedDiagnostics());
  if (!payload) {
    pathEl.textContent = 'Diagnostics unavailable outside Electron.';
    bodyEl.textContent = '';
    wlLogCacheText = '';
    return;
  }
  const path =
    payload?.log?.path ||
    payload?.diagnostics?.logPath ||
    payload?.status?.logPath ||
    '(no log path)';
  pathEl.textContent = path;
  wlLogCacheText = formatWebLinkedDiagnosticsText(payload);
  bodyEl.textContent = wlLogCacheText;
  bodyEl.scrollTop = bodyEl.scrollHeight;
}

async function openWebLinkedLogViewer() {
  const overlay = $('#wlLogOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  const bodyEl = $('#wlLogBody');
  if (bodyEl) bodyEl.textContent = 'Loading…';
  await fillWebLinkedLogViewer();
}

function closeWebLinkedLogViewer() {
  const overlay = $('#wlLogOverlay');
  if (overlay) overlay.hidden = true;
}

async function copyWebLinkedDiagnostics() {
  if (!window.kiosk?.weblinkedDiagnostics) {
    setDisplayNote('Diagnostics only available in the Electron kiosk.');
    return;
  }
  setDisplayNote('Collecting WebLinked log…');
  const result = await fetchWebLinkedDiagnostics();
  const text = formatWebLinkedDiagnosticsText(result);
  wlLogCacheText = text;
  try {
    await navigator.clipboard.writeText(text);
    setDisplayNote(
      `WebLinked log copied. File also at: ${result?.log?.path || result?.diagnostics?.logPath || 'see clipboard'}`
    );
  } catch {
    setDisplayNote(
      `Could not copy clipboard. Use View log — path: ${result?.log?.path || result?.diagnostics?.logPath || '(unknown)'}`
    );
    await openWebLinkedLogViewer();
  }
}

async function startWebLinkedEngine() {
  if (!window.kiosk?.startWebLinked) {
    setDisplayNote('Start WebLinked is only available in the Electron kiosk.');
    return;
  }
  if (state.weblinked.starting || state.weblinked.stopping) return;
  const force = Boolean(state.weblinked.running);
  state.weblinked = { ...state.weblinked, starting: true, stopping: false, error: '' };
  renderWebLinkedStatus();
  setDisplayNote(
    force
      ? 'Restarting WebLinked…'
      : 'Starting WebLinked (first boot can take up to ~90s while CEF loads)…'
  );
  const result = await window.kiosk.startWebLinked({ force });
  state.weblinked = {
    running: Boolean(result?.running || result?.ok),
    baseUrl: result?.baseUrl || null,
    port: result?.port || null,
    error: result?.ok ? '' : result?.error || 'Start failed',
    starting: false,
    stopping: false,
    logPath: result?.logPath || null,
  };
  renderWebLinkedStatus();
  if (result?.ok) {
    setDisplayNote(
      force
        ? `WebLinked restarted · ${result.baseUrl || ':7655'}`
        : result.alreadyRunning
          ? 'WebLinked already running.'
          : `WebLinked started · ${result.baseUrl || ':7655'}`
    );
  } else {
    const logHint = result?.logPath ? ' · opening log…' : '';
    setDisplayNote((result?.error || 'Could not start WebLinked.') + logHint);
    if (window.kiosk?.weblinkedDiagnostics) void openWebLinkedLogViewer();
  }
}

async function stopWebLinkedEngine() {
  if (!window.kiosk?.stopWebLinked) {
    setDisplayNote('Stop WebLinked is only available in the Electron kiosk.');
    return;
  }
  state.weblinked = { ...state.weblinked, stopping: true, starting: false, error: '' };
  renderWebLinkedStatus();
  setDisplayNote('Stopping WebLinked…');
  const result = await window.kiosk.stopWebLinked();
  state.weblinked = {
    running: Boolean(result?.running),
    baseUrl: null,
    port: null,
    error: result?.ok ? '' : result?.error || 'Stop failed',
    starting: false,
    stopping: false,
  };
  renderWebLinkedStatus();
  setDisplayNote(
    result?.ok
      ? result.alreadyStopped
        ? 'WebLinked was already stopped.'
        : 'WebLinked stopped.'
      : result?.error || 'Could not stop WebLinked.'
  );
}

function startOfTodayLocal() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function parseEventDateLocal(dateStr) {
  const parts = String(dateStr || '')
    .trim()
    .split('-')
    .map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getEventLastDay(start, numberOfDays) {
  const days = Math.max(1, Math.floor(Number(numberOfDays) || 1));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  end.setDate(end.getDate() + (days - 1));
  return end;
}

function isEventUpcoming(ev, today = startOfTodayLocal()) {
  const start = parseEventDateLocal(ev.date);
  if (!start) return true;
  return getEventLastDay(start, ev.numberOfDays) >= today;
}

function isEventPast(ev, today = startOfTodayLocal()) {
  const start = parseEventDateLocal(ev.date);
  if (!start) return false;
  return getEventLastDay(start, ev.numberOfDays) < today;
}

function formatEventDate(dateStr) {
  const start = parseEventDateLocal(dateStr);
  if (!start) return dateStr || '';
  return start.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function standardEvents() {
  return state.events.filter((ev) => !ev.isQuickMode);
}

function countByScope() {
  const list = standardEvents();
  return {
    upcoming: list.filter((ev) => isEventUpcoming(ev)).length,
    past: list.filter((ev) => isEventPast(ev)).length,
    all: list.length,
  };
}

function filteredEvents() {
  const q = state.eventSearch.trim().toLowerCase();
  let list = standardEvents();
  if (state.eventScope === 'upcoming') list = list.filter((ev) => isEventUpcoming(ev));
  else list = list.filter((ev) => isEventPast(ev));
  if (q) {
    list = list.filter(
      (ev) =>
        String(ev.name || '')
          .toLowerCase()
          .includes(q) ||
        String(ev.location || '')
          .toLowerCase()
          .includes(q)
    );
  }
  list.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    return state.eventScope === 'past' ? db.localeCompare(da) : da.localeCompare(db);
  });
  return list;
}

function setEventNote(text) {
  state.statusNote = text || '';
  const el = $('#eventStatusNote');
  if (el) el.textContent = state.statusNote;
}

function applyConnectivity(payload) {
  const cloud = payload?.cloudMode || payload?.connectivity || payload;
  const conn = payload?.connectivity || state.connectivity;
  if (conn) state.connectivity = conn;

  if (cloud && typeof cloud.cloudConnected === 'boolean') {
    state.cloudConnected = cloud.cloudConnected;
    state.lanOnly = cloud.lanOnly !== false && !cloud.cloudConnected;
  } else if (conn) {
    state.cloudConnected = Boolean(conn.cloudConnected);
    state.lanOnly = Boolean(conn.lanOnly) || !conn.cloudConnected;
  }

  const token = payload?.token || conn?.railwayApiToken || null;
  if (token) {
    state.tokenConfigured = Boolean(token.configured);
    state.tokenPrefix = token.prefix || '';
  }

  renderConnectivity();
}

function setSvc(id, stateName, text) {
  const el = document.querySelector(`.svc[data-svc="${id}"]`);
  const map = {
    show: 'svcShow',
    mode: 'svcMode',
    internet: 'svcInternet',
    railway: 'svcRailway',
    neon: 'svcNeon',
    lan: 'svcLan',
    token: 'svcToken',
    ppt: 'svcPpt',
  };
  if (id === 'token') {
    const line = $('#tokenStatusLine');
    if (line) line.dataset.state = stateName || 'skip';
  }
  const valueEl = $(`#${map[id]}`);
  if (el) el.dataset.state = stateName || 'skip';
  if (valueEl) valueEl.textContent = text;
}

function formatPptAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return 'just now';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s ago` : `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function setPptText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function renderPptBridgeTab(view) {
  const hero = $('#pptHero');
  if (hero) hero.dataset.state = view.state || 'skip';
  setPptText('#pptStatusWord', view.statusWord || '—');
  setPptText('#pptHeroLabel', view.label || '—');
  setPptText('#pptHeroDetail', view.detail || '');
  setPptText('#pptModePill', view.mode || '—');
  setPptText('#pptEventValue', view.event || '—');
  setPptText('#pptEventPptsValue', view.eventPpts || '—');
  setPptText('#pptDeckValue', view.deck || '—');
  setPptText('#pptShowValue', view.show || '—');
  setPptText('#pptSlideValue', view.slide || '—');
  setPptText('#pptHeartbeatValue', view.heartbeat || '—');
  setPptText('#pptLastSeenValue', view.lastSeen || '—');
  setPptText('#pptCacheValue', view.cache || '—');
  setPptText('#pptCommandValue', view.command || '—');
  setPptText('#pptCueValue', view.cue || '—');

  const err = $('#pptErrorNote');
  if (err) {
    if (view.error) {
      err.hidden = false;
      err.textContent = view.error;
    } else {
      err.hidden = true;
      err.textContent = '';
    }
  }

  const card = $('#sessionPptCard');
  if (card) card.dataset.state = view.state === 'ok' ? 'ready' : view.state === 'bad' ? 'warn' : 'empty';
  setPptText('#statusPptCard', view.cardValue || view.statusWord || view.label || '—');
  setPptText('#statusPptCardHint', view.cardHint || 'Open PPT Bridge tab');
}

function renderPptBridgeStatus() {
  const note = $('#pptBridgeNote');
  const ppt = state.pptBridge;
  const ev = selectedEvent();

  const blankTab = (partial) => {
    renderPptBridgeTab({
      state: 'skip',
      statusWord: '—',
      label: '—',
      detail: '',
      mode: '—',
      event: '—',
      eventPpts: '—',
      deck: '—',
      show: '—',
      slide: '—',
      heartbeat: '—',
      lastSeen: '—',
      cache: '—',
      command: '—',
      cue: '—',
      cardValue: '—',
      cardHint: 'Open PPT Bridge tab',
      ...partial,
    });
  };

  if (!state.offlineShowRunning) {
    setSvc('ppt', 'skip', '—');
    if (note) {
      note.hidden = true;
      note.textContent = '';
    }
    blankTab({
      statusWord: 'Off',
      label: 'Offline Show not started',
      detail: 'Start Offline Show on Status first.',
      cardValue: 'Show off',
      cardHint: 'Start Offline Show first',
    });
    return;
  }
  if (!state.eventId) {
    setSvc('ppt', 'skip', 'Pick event');
    if (note) {
      note.hidden = false;
      note.textContent = 'Select an event on the Event tab to see PPT Bridge status.';
    }
    blankTab({
      statusWord: 'Wait',
      label: 'Pick an event',
      detail: 'Select an event on the Event tab.',
      cardValue: 'Pick event',
      cardHint: 'Needs a selected event',
    });
    return;
  }
  if (!ppt) {
    setSvc('ppt', 'skip', 'Checking…');
    if (note) {
      note.hidden = false;
      note.textContent = `Checking PPT Bridge for ${ev?.name || state.eventId}…`;
    }
    blankTab({
      statusWord: '…',
      label: 'Checking…',
      detail: `Looking up ${ev?.name || state.eventId}.`,
      event: ev?.name || state.eventId,
      cardValue: 'Checking…',
      cardHint: 'Polling Railway',
    });
    return;
  }
  if (ppt.reason === 'no-token' || (!state.tokenConfigured && ppt.online !== true)) {
    setSvc('ppt', 'skip', 'Need token');
    if (note) {
      note.hidden = false;
      note.textContent = ppt.message || 'Save an Integration token to check PPT Bridge on Railway.';
    }
    blankTab({
      statusWord: 'Token',
      label: 'Need Integration token',
      detail: 'Save a token on Status to check Railway.',
      event: ppt.eventName || ev?.name || state.eventId,
      cardValue: 'Need token',
      cardHint: 'Save token on Status',
      error: ppt.message || null,
    });
    return;
  }
  if (ppt.error && ppt.online !== true) {
    setSvc('ppt', 'bad', 'Error');
    if (note) {
      note.hidden = false;
      note.textContent = ppt.error;
    }
    blankTab({
      state: 'bad',
      statusWord: 'Error',
      label: 'Could not check PPT Bridge',
      detail: ppt.error,
      event: ppt.eventName || ev?.name || state.eventId,
      cardValue: 'Error',
      cardHint: ppt.error,
      error: ppt.error,
    });
    return;
  }

  const eventLabel = ppt.eventName || ev?.name || state.eventId;
  const mode = ppt.modeLabel || (ppt.online ? 'PPT Bridge' : 'No bridge');
  const age = formatPptAge(ppt.lastSeenAgeMs);
  const lastSeenText = ppt.lastSeen
    ? (() => {
        try {
          return new Date(ppt.lastSeen).toLocaleTimeString();
        } catch {
          return String(ppt.lastSeen);
        }
      })()
    : 'Never';

  if (ppt.online) {
    setSvc('ppt', 'ok', 'Online');
    if (note) {
      note.hidden = false;
      const deck = ppt.deckName ? ` · ${ppt.deckName}` : '';
      note.textContent = `${mode} online · ${eventLabel}${deck}`;
    }
  } else {
    setSvc('ppt', 'bad', 'Offline');
    if (note) {
      note.hidden = false;
      note.textContent = `No PPT Bridge online for ${eventLabel} (last ~25s).`;
    }
  }

  const live = ppt.online === true;
  const eventHasPpt = ppt.eventHasPpt === true || Number(ppt.pptCueCount) > 0;
  const pptCount = Number(ppt.pptCueCount) || 0;
  const eventPptsLine = eventHasPpt
    ? pptCount === 1
      ? 'Yes · 1 PPT cue'
      : `Yes · ${pptCount} PPT cues`
    : 'No PPT cues on this event';

  const slideParts = [];
  if (live && ppt.currentIndex != null && Number.isFinite(Number(ppt.currentIndex))) {
    slideParts.push(`#${Number(ppt.currentIndex) + 1}`);
  }
  if (live && ppt.slideCount > 0) slideParts.push(`of ${ppt.slideCount}`);
  const slideValue = live
    ? slideParts.length
      ? slideParts.join(' ')
      : ppt.slideCount > 0
        ? `${ppt.slideCount} slides`
        : '—'
    : '—';

  let showLine = '—';
  if (live) {
    if (ppt.slideshowActive) showLine = 'Slideshow running';
    else showLine = 'Connected · idle';
    if (ppt.liveCaptureActive) {
      showLine += ppt.liveCaptureSource ? ` · live capture (${ppt.liveCaptureSource})` : ' · live capture';
    }
  }

  const cueLine = live
    ? ppt.loadedCueLabel
      ? `${ppt.loadedCueLabel}${ppt.cueFollowAuto === false ? ' · manual' : ' · auto'}`
      : ppt.cueFollowAuto === false
        ? 'Manual'
        : 'Auto'
    : '—';

  let deckLine = '—';
  if (live && ppt.deckName) {
    if (ppt.deckOnEvent === false) deckLine = `${ppt.deckName} · not from this event`;
    else if (!eventHasPpt) deckLine = `${ppt.deckName} · event has no PPT cues`;
    else deckLine = ppt.deckName;
  } else if (live) {
    deckLine = 'No deck open';
  }

  const warnings = [];
  if (!live) {
    warnings.push(
      'No fresh bridge heartbeat. On the bridge PC: confirm Show with Timers / Launcher is linked to this event. Older builds go quiet when PowerPoint is closed — update Bridge V2.'
    );
  }
  if (!eventHasPpt) {
    warnings.push('This event has no PPT cues in the run of show.');
  }
  if (live && ppt.deckName && (ppt.deckOnEvent === false || !eventHasPpt)) {
    warnings.push('Open file does not match this event’s PPT cues (may be leftover from another show).');
  }
  if (ppt.lastError && !live) warnings.push(String(ppt.lastError));
  if (live && ppt.openStale) warnings.push('Open deck looks stale vs sync folder.');
  if (live && ppt.queuedCommand) {
    warnings.push(`Queued: ${typeof ppt.queuedCommand === 'string' ? ppt.queuedCommand : 'command pending'}`);
  }

  renderPptBridgeTab({
    state: live ? 'ok' : 'bad',
    statusWord: live ? 'Online' : 'Offline',
    label: live ? mode : 'PPT Bridge offline',
    detail: live
      ? `${eventHasPpt ? eventPptsLine : 'No event PPT cues'} · seen ${age}`
      : ppt.lastSeen
        ? `Last seen ${age}. Bridge must be running on the event (open PowerPoint is optional on newer Bridge builds).`
        : 'No bridge heartbeat yet for this event.',
    mode: live ? mode : '—',
    event: eventLabel,
    eventPpts: eventPptsLine,
    deck: deckLine,
    show: showLine,
    slide: slideValue,
    lastSeen: lastSeenText,
    heartbeat: live ? `Fresh · ${age}` : ppt.lastSeen ? `Stale · ${age}` : 'None',
    cache: live
      ? ppt.cacheLabel || (ppt.cacheTotal > 0 ? `${ppt.cacheOk}/${ppt.cacheTotal}` : '—')
      : '—',
    command: live && ppt.lastCommand ? ppt.lastCommand : '—',
    cue: cueLine,
    cardValue: live ? 'Online' : 'Offline',
    cardHint: eventHasPpt ? eventPptsLine : 'No event PPTs',
    error: warnings.length ? warnings.join(' · ') : null,
  });
}

async function refreshPptBridgeStatus() {
  if (!window.kiosk?.pptBridgeStatus) {
    state.pptBridge = { online: false, error: 'PPT status not available in this build.' };
    renderPptBridgeStatus();
    return;
  }
  if (!state.offlineShowRunning || !state.eventId) {
    state.pptBridge = null;
    renderPptBridgeStatus();
    return;
  }
  const seq = ++pptBridgeFetchSeq;
  const askedId = pptStatusEventId();
  try {
    const result = await window.kiosk.pptBridgeStatus({ eventId: askedId });
    // Ignore stale responses after the user switches events.
    if (seq !== pptBridgeFetchSeq || pptStatusEventId() !== askedId) return;
    state.pptBridge = result && typeof result === 'object' ? result : { online: false, error: 'Bad response' };
  } catch (e) {
    if (seq !== pptBridgeFetchSeq || pptStatusEventId() !== askedId) return;
    state.pptBridge = {
      online: false,
      error: e instanceof Error ? e.message : 'PPT status failed',
    };
  }
  renderPptBridgeStatus();
}

function startPptBridgePoll() {
  stopPptBridgePoll();
  void refreshPptBridgeStatus();
  const ms = state.tab === 'ppt' ? 5_000 : 12_000;
  pptBridgePollTimer = window.setInterval(() => {
    void refreshPptBridgeStatus();
  }, ms);
}

function stopPptBridgePoll() {
  if (pptBridgePollTimer) {
    clearInterval(pptBridgePollTimer);
    pptBridgePollTimer = null;
  }
}

function pillState(pill) {
  if (!pill) return { state: 'skip', text: '—' };
  if (pill.skipped) return { state: 'skip', text: pill.reason || 'Skipped' };
  if (pill.ok) return { state: 'ok', text: pill.label || 'OK' };
  return { state: 'bad', text: pill.error || pill.label || 'Down' };
}

function renderConnectivity() {
  const running = state.offlineShowRunning;
  const syncBtn = $('#syncCloudBtn');
  const refreshBtn = $('#refreshConnBtn');
  const modeLan = $('#modeLanBtn');
  const modeCloud = $('#modeCloudBtn');
  const tokenInput = $('#railwayTokenInput');
  const saveTokenBtn = $('#saveTokenBtn');

  if (syncBtn) syncBtn.hidden = !(running && state.cloudConnected);
  if (refreshBtn) refreshBtn.hidden = !running;
  [modeLan, modeCloud, tokenInput, saveTokenBtn].forEach((el) => {
    if (el) el.disabled = !running;
  });

  modeLan?.classList.toggle('is-active', running && (state.lanOnly || !state.cloudConnected));
  modeCloud?.classList.toggle('is-active', running && state.cloudConnected);

  setSvc('show', running ? 'ok' : 'bad', running ? 'Running' : 'Off');
  setSvc(
    'mode',
    running ? (state.cloudConnected ? 'ok' : 'skip') : 'skip',
    running ? (state.cloudConnected ? 'Cloud on' : 'LAN only') : '—'
  );

  const c = state.connectivity;
  renderPptBridgeStatus();

  if (!running) {
    setSvc('internet', 'skip', '—');
    setSvc('railway', 'skip', '—');
    setSvc('neon', 'skip', '—');
    setSvc('lan', 'skip', '—');
    setSvc('token', 'skip', '—');
  } else if (!c) {
    setSvc('internet', 'skip', 'Checking…');
    setSvc('railway', 'skip', 'Checking…');
    setSvc('neon', 'skip', 'Checking…');
    setSvc('lan', 'skip', 'Checking…');
    setSvc('token', state.tokenConfigured ? 'ok' : 'bad', state.tokenConfigured ? state.tokenPrefix || 'Set' : 'Missing');
  } else {
    const internet = pillState(c.internet);
    const railway = pillState(c.railway);
    const neon = pillState(c.neon);
    const lan = pillState(c.localLan);
    setSvc('internet', internet.state, internet.text);
    setSvc('railway', railway.state, railway.text);
    setSvc('neon', neon.state, neon.text);
    setSvc('lan', lan.state, lan.text);
    setSvc(
      'token',
      state.tokenConfigured ? 'ok' : state.cloudConnected ? 'bad' : 'skip',
      state.tokenConfigured ? state.tokenPrefix || 'Set' : 'Missing'
    );
  }

  const hero = $('#statusHero');
  const heroLabel = $('#statusHeroLabel');
  const heroDetail = $('#statusHeroDetail');
  const tokenNote = $('#tokenStatusNote');

  if (!running) {
    if (hero) hero.dataset.state = 'off';
    if (heroLabel) heroLabel.textContent = 'Offline Show not started';
    if (heroDetail) {
      heroDetail.textContent = 'Start the show to see Internet, Railway, Neon, LAN, and token status.';
    }
    if (tokenNote) tokenNote.textContent = 'Start Offline Show to manage Cloud / token.';
    return;
  }

  const cloudOk =
    state.cloudConnected &&
    c?.internet?.ok &&
    c?.railway?.ok &&
    c?.neon?.ok &&
    state.tokenConfigured;

  if (!state.cloudConnected) {
    if (hero) hero.dataset.state = 'lan';
    if (heroLabel) heroLabel.textContent = 'LAN only — local SQLite';
    if (heroDetail) {
      heroDetail.textContent =
        'Not using hosted calendar. Turn Cloud on (needs Integration token) to reach Railway / Neon.';
    }
  } else if (cloudOk) {
    if (hero) hero.dataset.state = 'cloud-ok';
    if (heroLabel) heroLabel.textContent = 'Cloud on — services OK';
    if (heroDetail) {
      heroDetail.textContent = 'Internet, Railway, Neon, and API token look good. Event list can sync from cloud.';
    }
  } else {
    if (hero) hero.dataset.state = 'cloud-bad';
    if (heroLabel) heroLabel.textContent = 'Cloud on — something is down';
    const problems = [];
    if (!state.tokenConfigured) problems.push('API token');
    if (c?.internet && !c.internet.ok && !c.internet.skipped) problems.push('Internet');
    if (c?.railway && !c.railway.ok && !c.railway.skipped) problems.push('Railway');
    if (c?.neon && !c.neon.ok && !c.neon.skipped) problems.push('Neon');
    if (heroDetail) {
      heroDetail.textContent = problems.length
        ? `Check: ${problems.join(', ')}.`
        : 'Cloud mode is on, but connectivity is incomplete. Hit Recheck.';
    }
  }

  if (tokenNote) {
    tokenNote.textContent = state.tokenConfigured
      ? `Token saved${state.tokenPrefix ? ` (${state.tokenPrefix})` : ''}.`
      : 'Paste ros_itok_… from Admin → Integration tokens (read + control + write), then Save.';
  }

  updateConnBar();
}

function hostBounds() {
  const host = $('#remoteEmbedHost');
  if (!host || host.offsetParent === null) return null;
  const r = host.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function pushEmbedBounds() {
  if (!state.remoteOpen || state.tab !== 'remoteop' || !window.kiosk?.remoteEmbedBounds) return;
  const bounds = hostBounds();
  if (!bounds || bounds.width < 2 || bounds.height < 2) return;
  void window.kiosk.remoteEmbedBounds(bounds);
}

function startEmbedObserver() {
  stopEmbedObserver();
  const host = $('#remoteEmbedHost');
  if (!host) return;
  embedObserver = new ResizeObserver(() => pushEmbedBounds());
  embedObserver.observe(host);
  window.addEventListener('resize', pushEmbedBounds);
}

function stopEmbedObserver() {
  if (embedObserver) {
    embedObserver.disconnect();
    embedObserver = null;
  }
  window.removeEventListener('resize', pushEmbedBounds);
}

function syncRemoteSubtabs() {
  document.querySelectorAll('.remoteop-subtab').forEach((btn) => {
    const active = btn.dataset.remote === state.remoteProvider;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function showRemotePicker() {
  $('#remoteopPicker').hidden = false;
  $('#remoteopLive').hidden = true;
}

function showRemoteLive() {
  $('#remoteopPicker').hidden = true;
  $('#remoteopLive').hidden = false;
}

async function resetRemoteChoice() {
  stopEmbedObserver();
  state.remoteProvider = null;
  state.remoteOpen = false;
  if (window.kiosk?.remoteEmbedClose) await window.kiosk.remoteEmbedClose();
  showRemotePicker();
  syncStatus();
}

async function loadRemoteProvider(provider, { force = false } = {}) {
  if (!provider) return;
  if (!force && state.remoteProvider === provider && state.remoteOpen) {
    syncRemoteSubtabs();
    showRemoteLive();
    pushEmbedBounds();
    return;
  }

  state.remoteProvider = provider;
  syncRemoteSubtabs();
  showRemoteLive();

  const url = REMOTE_DEFAULTS[provider] || REMOTE_DEFAULTS.vdo;
  if (!window.kiosk?.remoteEmbedOpen) {
    syncStatus();
    return;
  }

  startEmbedObserver();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const bounds = hostBounds();
  const result = await window.kiosk.remoteEmbedOpen({ url, provider, bounds });
  state.remoteOpen = Boolean(result?.ok);
  if (state.remoteOpen) pushEmbedBounds();
  else showRemotePicker();
  syncStatus();
}

async function refreshConnectivityOnly() {
  if (!state.offlineShowRunning || !window.kiosk?.getConnectivity) return;
  const result = await window.kiosk.getConnectivity();
  if (result?.ok && result.connectivity) {
    applyConnectivity({ connectivity: result.connectivity, token: result.connectivity.railwayApiToken });
  }
  renderConnectivity();
  void refreshPptBridgeStatus();
}

async function setTab(tabId) {
  state.tab = tabId;
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === tabId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const active = panel.id === `panel-${tabId}`;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });

  if (tabId === 'remoteop') {
    if (state.remoteProvider) {
      await loadRemoteProvider(state.remoteProvider, { force: !state.remoteOpen });
    } else {
      showRemotePicker();
      if (window.kiosk?.remoteEmbedHide) await window.kiosk.remoteEmbedHide();
    }
  } else if (state.remoteOpen && window.kiosk?.remoteEmbedHide) {
    await window.kiosk.remoteEmbedHide();
  }

  if (tabId === 'status') {
    if (state.offlineShowRunning) void refreshConnectivityOnly();
    startPerfHealthLoop();
  } else {
    stopPerfHealthLoop();
  }
  if (tabId === 'ppt' || tabId === 'status' || (state.offlineShowRunning && state.eventId)) {
    startPptBridgePoll();
  } else {
    stopPptBridgePoll();
  }
  if (tabId === 'displays') {
    void refreshWebLinkedStatus();
    startWlLivePreviewLoop();
  } else {
    stopWlLivePreviewLoop();
  }
}

function pickDefaultScope() {
  const counts = countByScope();
  if (state.eventScope === 'upcoming' && counts.upcoming === 0 && counts.past > 0) {
    state.eventScope = 'past';
  }
}

function renderEventBrowser() {
  const browser = $('#eventBrowser');
  if (!browser) return;
  browser.hidden = false;
  renderConnectivity();

  const counts = countByScope();
  document.querySelectorAll('.scope-chip').forEach((chip) => {
    const scope = chip.dataset.scope;
    chip.classList.toggle('is-active', scope === state.eventScope);
    if (scope === 'upcoming') chip.textContent = `Upcoming Events (${counts.upcoming})`;
    if (scope === 'past') chip.textContent = `Past Events (${counts.past})`;
  });

  const list = $('#eventList');
  const empty = $('#eventListEmpty');
  const rows = state.offlineShowRunning ? filteredEvents() : [];
  list.innerHTML = '';
  empty.hidden = rows.length > 0;

  if (!state.offlineShowRunning) {
    empty.textContent = 'Start Offline Show on Status, then return here to pick an event.';
  } else if (counts.all === 0) {
    empty.textContent = state.cloudConnected
      ? 'No calendar events from cloud yet. On Status: check token / pills, then Sync from cloud.'
      : 'No events in local SQLite. On Status: turn Cloud on with an Integration token, or add events in Offline Show.';
  } else if (state.eventScope === 'upcoming' && counts.upcoming === 0) {
    empty.textContent = `No upcoming events (${counts.past} past). Switch to Past Events.`;
  } else {
    empty.textContent = 'No events match this search.';
  }

  for (const ev of rows) {
    const tr = document.createElement('tr');
    tr.className = ev.id === state.eventId ? 'is-selected' : '';
    tr.innerHTML = `
      <td class="col-name">${ev.name}</td>
      <td class="col-date">${formatEventDate(ev.date)}</td>
      <td class="col-loc">${ev.location || '—'}</td>
      <td class="col-type">${ev.eventType || '—'}</td>
      <td class="col-tz">${ev.timezone || '—'}</td>
      <td class="col-actions"></td>
    `;
    const actions = tr.querySelector('.col-actions');
    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = `select-event-btn${ev.id === state.eventId ? ' is-selected' : ''}`;
    selectBtn.textContent = ev.id === state.eventId ? 'Selected' : 'Select';
    selectBtn.addEventListener('click', () => {
      state.eventId = ev.id;
      state.pptBridge = null;
      syncEventChrome();
      renderEventBrowser();
      renderPptBridgeStatus();
      startPptBridgePoll();
    });
    actions.appendChild(selectBtn);
    list.appendChild(tr);
  }

  if (state.statusNote) setEventNote(state.statusNote);
}

function syncEventChrome() {
  const ev = selectedEvent();
  $('#headerSub').textContent = ev
    ? ev.name
    : state.offlineShowRunning
      ? state.cloudConnected
        ? 'Cloud on · pick an event'
        : 'LAN only · pick an event'
      : 'No event selected';
  syncPresetDisplayUrls();
  renderDisplays();
}

function renderDisplays() {
  const list = $('#displayList');
  const countEl = $('#displayListCount');
  const addBtn = $('#addDisplayBtn');
  if (!list) return;

  syncPresetDisplayUrls();
  list.innerHTML = '';
  if (countEl) countEl.textContent = `${state.displays.length} / ${MAX_DISPLAYS}`;
  if (addBtn) addBtn.disabled = state.displays.length >= MAX_DISPLAYS;

  state.displays.forEach((row, index) => {
    const ready = row.ready !== false;
    const card = document.createElement('div');
    card.className = `output-card display-card${isDisplayArmed(row.id) ? ' is-armed' : ''}${
      ready ? '' : ' is-soon'
    }`;
    card.setAttribute('role', 'listitem');
    card.dataset.id = row.id;

    const nameEl = document.createElement(row.preset ? 'span' : 'input');
    if (row.preset) {
      nameEl.className = 'display-card-title';
      nameEl.textContent = row.name;
    } else {
      nameEl.className = 'display-card-name';
      nameEl.type = 'text';
      nameEl.maxLength = 64;
      nameEl.value = row.name || `Display ${index + 1}`;
      nameEl.addEventListener('change', () => {
        row.name = nameEl.value.trim().slice(0, 64) || `Display ${index + 1}`;
        saveDisplays();
        renderDisplays();
      });
    }

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = !ready
      ? 'Soon'
      : isDisplayArmed(row.id)
        ? 'On WebLinked'
        : 'Standby';

    const urlInput = document.createElement('input');
    urlInput.className = 'display-card-url';
    urlInput.type = 'url';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    const lockedRoute = row.preset && row.route && row.route !== 'custom';
    if (lockedRoute) {
      urlInput.readOnly = true;
      urlInput.value = row.url || (state.eventId ? pageUrlForDisplay(row) : '');
      urlInput.placeholder = state.eventId ? '' : 'Select an event on the Event tab';
    } else {
      urlInput.value = row.url || '';
      urlInput.placeholder = 'https://… or http://127.0.0.1:3004/…';
      urlInput.addEventListener('input', () => {
        row.url = urlInput.value.trim();
        saveDisplays();
      });
      urlInput.addEventListener('change', () => {
        row.url = urlInput.value.trim();
        saveDisplays();
      });
    }

    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent =
      row.desc || 'Preview shows this URL on the live 16:9 WebLinked feed. Settings for outputs.';

    const actions = document.createElement('div');
    actions.className = 'display-card-actions';

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'ghost-btn display-row-btn';
    settingsBtn.textContent = 'Settings';
    settingsBtn.title = `Settings for ${row.name} only (NDI name, outputs, format)`;
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openSimpleWlSettings(row.id);
    });

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'primary-btn display-row-btn';
    previewBtn.textContent = 'Preview';
    previewBtn.disabled = !ready;
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openDisplayPreview(row.id);
    });

    const pushBtn = document.createElement('button');
    pushBtn.type = 'button';
    pushBtn.className = 'ghost-btn display-row-btn';
    pushBtn.textContent = isDisplayArmed(row.id) ? 'Clear WL' : 'Push WL';
    pushBtn.title = 'Push or clear this card’s WebLinked source (other cards stay up)';
    pushBtn.disabled = !ready;
    pushBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void togglePushWebLinked(row.id);
    });

    actions.appendChild(settingsBtn);
    actions.appendChild(previewBtn);
    actions.appendChild(pushBtn);

    if (!row.preset) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'ghost-btn display-row-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void removeDisplayCard(row.id);
      });
      actions.appendChild(removeBtn);
    }

    card.appendChild(nameEl);
    card.appendChild(badge);

    if (row.id === 'timer') {
      const modeWrap = document.createElement('label');
      modeWrap.className = 'display-timer-mode';
      modeWrap.textContent = 'Default ';
      const modeSel = document.createElement('select');
      modeSel.className = 'display-timer-mode-select';
      modeSel.setAttribute('aria-label', 'Stage Timer default display');
      for (const mode of TIMER_MODES) {
        const opt = document.createElement('option');
        opt.value = mode.id;
        opt.textContent = mode.label;
        modeSel.appendChild(opt);
      }
      modeSel.value = normalizeTimerMode(row.timerMode);
      modeSel.addEventListener('change', () => {
        row.timerMode = normalizeTimerMode(modeSel.value);
        row.route = timerModeMeta(row.timerMode).route;
        row.url = pageUrlForDisplay(row);
        saveDisplays();
        renderDisplays();
        setDisplayNote(
          `Stage Timer default → ${timerModeMeta(row.timerMode).label}${
            state.eventId ? '' : ' (select an event to fill the URL)'
          }`
        );
      });
      modeWrap.appendChild(modeSel);
      card.appendChild(modeWrap);
    }

    card.appendChild(urlInput);
    card.appendChild(desc);
    card.appendChild(actions);
    list.appendChild(card);
  });

  syncStatus();
}

function addDisplayRow() {
  if (state.displays.length >= MAX_DISPLAYS) {
    setDisplayNote(`Maximum ${MAX_DISPLAYS} URLs.`);
    return;
  }
  const n = state.displays.filter((d) => !d.preset).length + 1;
  const extra = {
    id: newDisplayId(),
    name: `Extra ${n}`,
    route: 'custom',
    desc: 'Extra URL slot.',
    ready: true,
    preset: false,
    url: '',
  };
  extra.wlSettings = defaultWlSettingsForDisplay(extra);
  state.displays.push(extra);
  saveDisplays();
  renderDisplays();
  setDisplayNote(`Added Extra ${n}.`);
}

const WL_RATE_GROUPS = [
  {
    label: 'PAL',
    rates: [
      { value: 'p25', label: '25p' },
      { value: 'p50', label: '50p' },
      { value: 'i25', label: '50i (25 Hz)' },
    ],
  },
  {
    label: 'NTSC',
    rates: [
      { value: 'p23.98', label: '23.98p' },
      { value: 'p29.97', label: '29.97p' },
      { value: 'p59.94', label: '59.94p' },
      { value: 'i29.97', label: '59.94i (29.97 Hz)' },
    ],
  },
  {
    label: 'Integer',
    rates: [
      { value: 'p24', label: '24p' },
      { value: 'p30', label: '30p' },
      { value: 'p60', label: '60p' },
    ],
  },
];

function closeSimpleWlSettings() {
  const overlay = $('#wlSettingsOverlay');
  if (overlay) overlay.hidden = true;
  state.settingsDisplayId = null;
}

function setWlSettingsNote(text) {
  const el = $('#wlSettingsNote');
  if (el) el.textContent = text || '';
}

function parseWlFormat(text) {
  const m = String(text || '')
    .toLowerCase()
    .match(/^(?:(\d+)x)?(\d+)([pi])([0-9.]+)$/);
  if (!m) return { raster: '1080', rate: 'p50' };
  const width = m[1] ? Number(m[1]) : 0;
  const height = Number(m[2]);
  const rate = m[3] + m[4];
  let raster = '1080';
  if (height === 720) raster = '720';
  else if (height === 1080 && (!width || width === 1920)) raster = '1080';
  else if (height === 2160 && (!width || width === 3840)) raster = '2160';
  return { raster, rate };
}

function fillWlRateSelect(preferred) {
  const raster = $('#wlRasterSelect')?.value || '1080';
  const rateEl = $('#wlRateSelect');
  if (!rateEl) return;
  const skipInterlace = raster === '720' || raster === '2160';
  rateEl.innerHTML = '';
  for (const group of WL_RATE_GROUPS) {
    const rates = group.rates.filter((r) => !skipInterlace || r.value[0] === 'p');
    if (!rates.length) continue;
    const og = document.createElement('optgroup');
    og.label = group.label;
    for (const r of rates) {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      og.appendChild(opt);
    }
    rateEl.appendChild(og);
  }
  const values = Array.from(rateEl.options).map((o) => o.value);
  rateEl.value = values.includes(preferred)
    ? preferred
    : values.includes('p50')
      ? 'p50'
      : values[0] || '';
}

function syncWlFormatControls(formatText) {
  const parsed = parseWlFormat(formatText || '1080p50');
  const rasterEl = $('#wlRasterSelect');
  if (rasterEl) rasterEl.value = parsed.raster;
  fillWlRateSelect(parsed.rate);
}

function currentWlFormatSpec() {
  const raster = $('#wlRasterSelect')?.value || '1080';
  const rate = $('#wlRateSelect')?.value || 'p50';
  return `${raster}${rate}`;
}

function renderWlNdiRows(rows) {
  const host = $('#wlNdiList');
  if (!host) return;
  host.innerHTML = '';
  const list = Array.isArray(rows) && rows.length ? rows : [{ name: 'SINOR', alpha: true }];
  for (const row of list) {
    const wrap = document.createElement('div');
    wrap.className = 'wl-ndi-row';
    const input = document.createElement('input');
    input.className = 'wl-settings-input';
    input.type = 'text';
    input.maxLength = 64;
    input.placeholder = 'NDI name';
    input.value = row.name || '';
    input.dataset.ndiName = '1';
    const alphaLabel = document.createElement('label');
    alphaLabel.className = 'wl-ndi-alpha';
    const alpha = document.createElement('input');
    alpha.type = 'checkbox';
    alpha.checked = row.alpha !== false;
    alpha.dataset.ndiAlpha = '1';
    alphaLabel.appendChild(alpha);
    alphaLabel.appendChild(document.createTextNode('Alpha'));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost-btn wl-ndi-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      wrap.remove();
      if (!$('#wlNdiList')?.querySelector('.wl-ndi-row')) {
        renderWlNdiRows([{ name: '', alpha: true }]);
      }
    });
    wrap.appendChild(input);
    wrap.appendChild(alphaLabel);
    wrap.appendChild(remove);
    host.appendChild(wrap);
  }
}

function collectWlNdiRows() {
  const rows = [];
  const seen = new Set();
  for (const wrap of $$('#wlNdiList .wl-ndi-row')) {
    const name = (wrap.querySelector('[data-ndi-name]')?.value || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name,
      alpha: Boolean(wrap.querySelector('[data-ndi-alpha]')?.checked),
    });
  }
  return rows;
}

function gateWlBackend(id, kind, backends) {
  const el = $(id);
  if (!el) return;
  const ok = !backends.length || backends.includes(kind);
  el.disabled = !ok;
  if (!ok) el.checked = false;
  const label = el.closest('label');
  if (label) label.style.opacity = ok ? '' : '0.45';
}

function syncWlNdiSectionEnabled() {
  const on = Boolean($('#wlOutNdi')?.checked) && !$('#wlOutNdi')?.disabled;
  const section = $('#wlNdiSection');
  if (section) section.classList.toggle('is-disabled', !on);
  const addBtn = $('#wlNdiAddBtn');
  if (addBtn) addBtn.disabled = !on;
  for (const input of $$('#wlNdiList input, #wlNdiList button')) {
    input.disabled = !on;
  }
}

function syncWlScreenSectionEnabled() {
  const on = Boolean($('#wlOutScreen')?.checked) && !$('#wlOutScreen')?.disabled;
  const section = $('#wlScreenSection');
  if (section) section.classList.toggle('is-disabled', !on);
  const sel = $('#wlScreenDisplay');
  if (sel) sel.disabled = !on;
}

function fillWlScreenDisplayOptions(displays, selectedIndex = 0) {
  const sel = $('#wlScreenDisplay');
  if (!sel) return;
  const list = Array.isArray(displays) && displays.length
    ? displays
    : [{ index: 0, label: 'Display 1' }];
  const want = Number.isFinite(Number(selectedIndex))
    ? Math.max(0, Math.floor(Number(selectedIndex)))
    : 0;
  sel.innerHTML = '';
  for (const d of list) {
    const opt = document.createElement('option');
    opt.value = String(d.index);
    opt.textContent = d.label || `Display ${Number(d.index) + 1}`;
    sel.appendChild(opt);
  }
  const max = list.length - 1;
  sel.value = String(Math.min(want, Math.max(0, max)));
}

function collectWlSettingsFromForm() {
  const ndiOn = Boolean($('#wlOutNdi')?.checked);
  return normalizeWlSettings(
    {
      format: currentWlFormatSpec(),
      previewFactor: Number($('#wlPreviewFactor')?.value || 4),
      sharedName: ($('#wlSharedName')?.value || '').trim(),
      screenDisplay: Number($('#wlScreenDisplay')?.value || 0),
      ndi: ndiOn ? collectWlNdiRows() : [],
      outputs: {
        ndi: ndiOn,
        shared: Boolean($('#wlOutShared')?.checked),
        screen: Boolean($('#wlOutScreen')?.checked),
        decklink: Boolean($('#wlOutDeckLink')?.checked),
        omt: Boolean($('#wlOutOmt')?.checked),
      },
    },
    findDisplay(state.settingsDisplayId) || { id: 'custom', name: 'Display' }
  );
}

function wlSettingsToPayload(settings, row, { save = false } = {}) {
  const s = normalizeWlSettings(settings, row || { id: 'custom', name: 'Display' });
  return {
    source: wlSourceId(row),
    format: s.format,
    previewFactor: s.previewFactor,
    sharedName: s.sharedName,
    screenDisplay: s.screenDisplay,
    ndi: s.outputs.ndi ? s.ndi : [],
    outputs: {
      preview: true,
      ndi: Boolean(s.outputs.ndi),
      shared: Boolean(s.outputs.shared),
      screen: Boolean(s.outputs.screen),
      decklink: Boolean(s.outputs.decklink),
      omt: Boolean(s.outputs.omt),
    },
    // Persist engine settings only from the Settings Apply button — not on every Preview.
    save: Boolean(save),
  };
}

async function applyDisplayWlSettings(displayId, { quiet = false, save = false } = {}) {
  const row = findDisplay(displayId);
  if (!row || !window.kiosk?.weblinkedApplySimpleSettings) {
    return { ok: false, error: 'WebLinked settings unavailable' };
  }
  const settings = normalizeWlSettings(row.wlSettings, row);
  row.wlSettings = settings;
  const result = await window.kiosk.weblinkedApplySimpleSettings(
    wlSettingsToPayload(settings, row, { save })
  );
  if (!quiet) {
    if (!result?.ok) setDisplayNote(result?.error || `Could not apply settings for ${row.name}.`);
    else setDisplayNote(`Applied ${row.name} output settings.`);
  }
  return result;
}

function fillWlSettingsForm(settings, backends = []) {
  const s = normalizeWlSettings(settings, findDisplay(state.settingsDisplayId) || {});
  const factorSel = $('#wlPreviewFactor');
  if (factorSel) factorSel.value = String(s.previewFactor);
  syncWlFormatControls(s.format);

  const setCheck = (id, on) => {
    const el = $(id);
    if (el) el.checked = Boolean(on);
  };
  setCheck('#wlOutNdi', s.outputs.ndi);
  setCheck('#wlOutShared', s.outputs.shared);
  setCheck('#wlOutScreen', s.outputs.screen);
  setCheck('#wlOutDeckLink', s.outputs.decklink);
  setCheck('#wlOutOmt', s.outputs.omt);

  const sharedName = $('#wlSharedName');
  if (sharedName) sharedName.value = s.sharedName;
  renderWlNdiRows(s.ndi);
  fillWlScreenDisplayOptions(state.systemDisplays || [], s.screenDisplay);

  gateWlBackend('#wlOutNdi', 'ndi', backends);
  gateWlBackend('#wlOutShared', 'shared', backends);
  gateWlBackend('#wlOutScreen', 'screen', backends);
  gateWlBackend('#wlOutDeckLink', 'decklink', backends);
  gateWlBackend('#wlOutOmt', 'omt', backends);
  syncWlNdiSectionEnabled();
  syncWlScreenSectionEnabled();
}

async function openSimpleWlSettings(displayId) {
  const row = findDisplay(displayId);
  if (!row) {
    setDisplayNote('Display card not found.');
    return;
  }
  if (!window.kiosk?.weblinkedGetState) {
    setDisplayNote('Display settings only available in the Electron kiosk.');
    return;
  }

  state.settingsDisplayId = row.id;
  const title = $('#wlSettingsTitle');
  if (title) title.textContent = `${row.name} settings`;
  const lead = $('#wlSettingsLead');
  if (lead) {
    lead.textContent = `Settings for this card only. NDI / Spout / SDI names and outputs do not affect other cards.`;
  }

  setDisplayNote(`Loading settings for ${row.name}…`);
  setWlSettingsNote('Loading…');
  const overlay = $('#wlSettingsOverlay');
  if (overlay) overlay.hidden = false;

  if (window.kiosk?.listSystemDisplays) {
    try {
      const screens = await window.kiosk.listSystemDisplays();
      state.systemDisplays = Array.isArray(screens?.displays) ? screens.displays : [];
    } catch {
      state.systemDisplays = [];
    }
  } else {
    state.systemDisplays = [];
  }

  // Prefill from this card immediately so cards never share another card's form values.
  fillWlSettingsForm(row.wlSettings || defaultWlSettingsForDisplay(row), []);

  const result = await window.kiosk.weblinkedGetState();
  if (!result?.ok) {
    setWlSettingsNote(
      `${result?.error || 'WebLinked offline'} · editing saved card settings only`
    );
    setDisplayNote(`Editing ${row.name} settings (engine offline).`);
    return;
  }

  state.weblinked = {
    ...state.weblinked,
    running: true,
    baseUrl: result.baseUrl || null,
    port: result.baseUrl ? Number(new URL(result.baseUrl).port) || null : null,
  };
  renderWebLinkedStatus();

  fillWlSettingsForm(row.wlSettings || defaultWlSettingsForDisplay(row), result.compiledBackends || []);

  const created = result.createdSource ? ' · started main source' : '';
  setWlSettingsNote(`Card · ${row.name} · ${result.baseUrl || ''}${created}`);
  setDisplayNote(`${row.name} settings ready.`);
}

async function applySimpleWlSettings() {
  if (!window.kiosk?.weblinkedApplySimpleSettings) return;
  const row = findDisplay(state.settingsDisplayId);
  if (!row) {
    setWlSettingsNote('No display card selected.');
    return;
  }

  const applyBtn = $('#wlSettingsApplyBtn');
  if (applyBtn) applyBtn.disabled = true;
  setWlSettingsNote(`Saving ${row.name}…`);

  const settings = collectWlSettingsFromForm();
  row.wlSettings = settings;
  saveDisplays();

  // Each card owns its WebLinked source — Apply always targets this card only.
  let result = await window.kiosk.weblinkedApplySimpleSettings(
    wlSettingsToPayload(settings, row, { save: true })
  );
  if (result?.ok) {
    const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];
    result.notes = [`Saved ${row.name}`, ...notes];
    markDisplayArmed(row.id);
  }

  if (applyBtn) applyBtn.disabled = false;

  if (!result?.ok) {
    setWlSettingsNote(result?.error || 'Apply failed.');
    setDisplayNote(result?.error || `Could not apply ${row.name} settings.`);
    void refreshWebLinkedStatus();
    return;
  }

  const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];
  const warn = result.warning ? ` · ${result.warning}` : '';
  setWlSettingsNote((notes.length ? notes.join(' · ') : 'Saved.') + warn);
  setDisplayNote(`${row.name} settings applied (this card’s source only).`);
  renderDisplays();
  void refreshWebLinkedStatus();
}

let wlPreviewBusy = false;
let wlPreviewTimer = null;
let wlPreviewLastSeq = -1;
let wlPreviewPlace = 'dock'; // 'dock' | 'overlay'
let wlInteractive = false;
let wlPendingMove = null;
let wlMoveScheduled = false;
let wlInputWired = false;

function wlPreviewCanvas() {
  return $('#wlLivePreviewCanvas');
}

function wlPreviewContext() {
  const canvas = wlPreviewCanvas();
  return canvas ? canvas.getContext('2d', { alpha: false }) : null;
}

function placeWlLivePreview(where) {
  const canvas = wlPreviewCanvas();
  const dock = $('#wlLivePreviewSlot');
  const overlaySlot = $('#wlPreviewOverlaySlot');
  const overlay = $('#wlPreviewOverlay');
  if (!canvas || !dock || !overlaySlot || !overlay) return;
  wlPreviewPlace = where === 'overlay' ? 'overlay' : 'dock';
  const slot = wlPreviewPlace === 'overlay' ? overlaySlot : dock;
  if (canvas.parentNode !== slot) slot.appendChild(canvas);
  overlay.hidden = wlPreviewPlace !== 'overlay';
  startWlLivePreviewLoop();
}

function setWlLivePreviewMeta(text) {
  const el = $('#wlLivePreviewMeta');
  if (el) el.textContent = text || 'WebLinked output · 16:9';
}

function wlModifiersOf(e) {
  let m = 0;
  if (e.getModifierState && e.getModifierState('CapsLock')) m |= 1 << 0;
  if (e.shiftKey) m |= 1 << 1;
  if (e.ctrlKey) m |= 1 << 2;
  if (e.altKey) m |= 1 << 3;
  if (e.metaKey) m |= 1 << 7;
  if (e.buttons & 1) m |= 1 << 4;
  if (e.buttons & 4) m |= 1 << 5;
  if (e.buttons & 2) m |= 1 << 6;
  return m;
}

function wlEventPosition(e) {
  const canvas = wlPreviewCanvas();
  if (!canvas) return { nx: 0, ny: 0 };
  const box = canvas.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return { nx: 0, ny: 0 };
  // Preview canvas uses object-fit: fill — map directly onto the element box.
  return {
    nx: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
    ny: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
  };
}

async function wlSendInput(event) {
  if (!window.kiosk?.weblinkedSendInput) return;
  const source = wlSourceId(state.previewDisplayId || primaryArmedDisplayId());
  try {
    await window.kiosk.weblinkedSendInput({ ...(event || {}), source });
  } catch {
    /* ignore */
  }
}

function flushWlMove() {
  wlMoveScheduled = false;
  if (wlPendingMove) {
    void wlSendInput(wlPendingMove);
    wlPendingMove = null;
  }
}

function setWlInteractive(on) {
  wlInteractive = Boolean(on);
  const canvas = wlPreviewCanvas();
  const dockToggle = $('#wlInteractiveToggle');
  const popToggle = $('#wlInteractiveTogglePop');
  const hint = $('#wlInteractiveHint');
  if (dockToggle) dockToggle.checked = wlInteractive;
  if (popToggle) popToggle.checked = wlInteractive;
  if (canvas) canvas.classList.toggle('is-interactive', wlInteractive);
  if (hint) hint.hidden = !wlInteractive;
  void wlSendInput({ type: 'focus', focused: wlInteractive });
  if (wlInteractive) canvas?.focus();
}

function wireWlPreviewInput() {
  if (wlInputWired) return;
  const canvas = wlPreviewCanvas();
  if (!canvas) return;
  wlInputWired = true;

  canvas.addEventListener('mousemove', (e) => {
    if (!wlInteractive) return;
    wlPendingMove = { type: 'move', ...wlEventPosition(e), modifiers: wlModifiersOf(e) };
    if (!wlMoveScheduled) {
      wlMoveScheduled = true;
      requestAnimationFrame(flushWlMove);
    }
  });
  canvas.addEventListener('mouseleave', (e) => {
    if (!wlInteractive) return;
    void wlSendInput({ type: 'move', ...wlEventPosition(e), leaving: true, modifiers: 0 });
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!wlInteractive) return;
    e.preventDefault();
    canvas.focus();
    void wlSendInput({
      type: 'down',
      ...wlEventPosition(e),
      button: e.button,
      clicks: e.detail || 1,
      modifiers: wlModifiersOf(e),
    });
  });
  canvas.addEventListener('mouseup', (e) => {
    if (!wlInteractive) return;
    e.preventDefault();
    void wlSendInput({
      type: 'up',
      ...wlEventPosition(e),
      button: e.button,
      clicks: e.detail || 1,
      modifiers: wlModifiersOf(e),
    });
  });
  canvas.addEventListener('contextmenu', (e) => {
    if (wlInteractive) e.preventDefault();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!wlInteractive) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : 1;
      void wlSendInput({
        type: 'wheel',
        ...wlEventPosition(e),
        dx: Math.round(-e.deltaX * scale),
        dy: Math.round(-e.deltaY * scale),
        modifiers: wlModifiersOf(e),
      });
    },
    { passive: false }
  );
  canvas.addEventListener('keydown', (e) => {
    if (!wlInteractive) return;
    e.preventDefault();
    e.stopPropagation();
    const modifiers = wlModifiersOf(e);
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    const character = printable ? e.key.charCodeAt(0) : 0;
    const vk = e.keyCode || e.which || 0;
    void wlSendInput({ type: 'key', action: 'down', key_code: vk, character: 0, modifiers });
    if (printable) {
      void wlSendInput({ type: 'key', action: 'char', key_code: character, character, modifiers });
    } else if (e.key === 'Enter') {
      void wlSendInput({ type: 'key', action: 'char', key_code: 13, character: 13, modifiers });
    }
  });
  canvas.addEventListener('keyup', (e) => {
    if (!wlInteractive) return;
    e.preventDefault();
    e.stopPropagation();
    const vk = e.keyCode || e.which || 0;
    void wlSendInput({
      type: 'key',
      action: 'up',
      key_code: vk,
      character: 0,
      modifiers: wlModifiersOf(e),
    });
  });
}

async function pullWlLivePreviewFrame() {
  if (wlPreviewBusy || !window.kiosk?.weblinkedGetPreviewFrame) return;
  if (document.hidden && wlPreviewPlace === 'dock') return;
  const panel = $('#panel-displays');
  if (wlPreviewPlace === 'dock' && panel?.hidden) return;

  wlPreviewBusy = true;
  try {
    const source = wlSourceId(state.previewDisplayId || primaryArmedDisplayId());
    const frame = await window.kiosk.weblinkedGetPreviewFrame({ source });
    if (!frame?.ok) {
      setWlLivePreviewMeta(frame?.error || 'Waiting for WebLinked…');
      return;
    }
    if (frame.sequence === wlPreviewLastSeq) return;
    wlPreviewLastSeq = frame.sequence;

    const canvas = wlPreviewCanvas();
    const ctx = wlPreviewContext();
    if (!canvas || !ctx) return;
    const { width, height, bgra } = frame;
    if (!width || !height || !bgra) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const bytes = bgra instanceof Uint8Array ? bgra : new Uint8Array(bgra);
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < width * height * 4; i += 4) {
      image.data[i] = bytes[i + 2];
      image.data[i + 1] = bytes[i + 1];
      image.data[i + 2] = bytes[i];
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    setWlLivePreviewMeta(`${width}×${height} · seq ${frame.sequence}`);
  } catch {
    setWlLivePreviewMeta('Preview unavailable');
  } finally {
    wlPreviewBusy = false;
  }
}

function startWlLivePreviewLoop() {
  if (wlPreviewTimer) return;
  wlPreviewTimer = setInterval(() => {
    void pullWlLivePreviewFrame();
  }, 125);
  void pullWlLivePreviewFrame();
}

function stopWlLivePreviewLoop() {
  if (wlPreviewPlace === 'overlay') return;
  if (wlPreviewTimer) {
    clearInterval(wlPreviewTimer);
    wlPreviewTimer = null;
  }
}

async function openDisplayPreview(id) {
  const row = findDisplay(id);
  if (!row) return;
  if (row.ready === false) {
    setDisplayNote(`${row.name} is coming soon.`);
    return;
  }
  if (row.preset && row.route !== 'custom' && !state.eventId) {
    setDisplayNote('Choose an event on the Event tab first.');
    return;
  }
  const url = (row.url || pageUrlForDisplay(row) || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    setDisplayNote('Enter a valid http(s) URL before Preview.');
    return;
  }
  if (!window.kiosk?.weblinkedGetPreviewFrame) {
    setDisplayNote('Live preview only available in the Electron kiosk.');
    return;
  }

  // Card already has its own WebLinked source — switch the dock feed only.
  // CEF LoadURL always navigates (even to the same address), so do not re-apply
  // or re-POST /api/url when this pipeline is already up.
  if (isDisplayArmed(row.id)) {
    state.previewDisplayId = row.id;
    renderDisplays();
    await setTab('displays');
    placeWlLivePreview('dock');
    // Touch setUrl with skip-if-same so a changed URL still updates once.
    if (window.kiosk?.setOutputArmed) {
      const touched = await window.kiosk.setOutputArmed({
        id: row.id,
        source: wlSourceId(row),
        name: row.name,
        armed: true,
        url,
      });
      const skipped = touched?.weblinked?.skipped || touched?.skipped;
      setDisplayNote(
        skipped || touched?.ok
          ? `Live preview · ${row.name} (already loaded — no reload)`
          : touched?.error || `Live preview · ${row.name}`
      );
    } else {
      setDisplayNote(`Live preview · ${row.name} (already loaded — no reload)`);
    }
    return;
  }

  setDisplayNote(`Loading ${row.name} into live preview…`);
  const applied = await applyDisplayWlSettings(row.id, { quiet: true, save: false });
  if (!applied?.ok) {
    setDisplayNote(applied?.error || `Could not apply ${row.name} output settings.`);
    void refreshWebLinkedStatus();
    return;
  }
  const pushed = window.kiosk?.setOutputArmed
    ? await window.kiosk.setOutputArmed({
        id: row.id,
        source: wlSourceId(row),
        name: row.name,
        armed: true,
        url,
      })
    : { ok: false, error: 'WebLinked bridge not available.' };
  if (!pushed?.ok) {
    setDisplayNote(pushed?.error || 'Could not load URL into WebLinked.');
    void refreshWebLinkedStatus();
    return;
  }
  markDisplayArmed(row.id);
  state.previewDisplayId = row.id;
  renderDisplays();
  await setTab('displays');
  placeWlLivePreview('dock');
  const skipped = pushed?.weblinked?.skipped || pushed?.skipped;
  setDisplayNote(
    skipped
      ? `Live preview · ${row.name} (already loaded — no reload)`
      : `Live preview · ${row.name} (use Larger to expand)`
  );
  void refreshWebLinkedStatus();
}

async function togglePushWebLinked(id) {
  const row = findDisplay(id);
  if (!row) return;
  if (row.ready === false && !isDisplayArmed(id)) {
    setDisplayNote(`${row.name} is coming soon.`);
    return;
  }

  if (isDisplayArmed(id)) {
    const result = window.kiosk?.setOutputArmed
      ? await window.kiosk.setOutputArmed({
          id,
          source: wlSourceId(id),
          armed: false,
          url: '',
        })
      : { ok: true };
    if (!result?.ok) {
      setDisplayNote(result?.error || 'Could not clear WebLinked.');
      return;
    }
    markDisplayDisarmed(id);
    renderDisplays();
    setDisplayNote(`${row.name} cleared (other cards unchanged).`);
    void refreshWebLinkedStatus();
    return;
  }

  if (row.preset && row.route !== 'custom' && !state.eventId) {
    setDisplayNote('Choose an event on the Event tab first.');
    return;
  }
  const url = (row.url || pageUrlForDisplay(row) || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    setDisplayNote('Enter a valid http(s) URL before pushing to WebLinked.');
    return;
  }
  setDisplayNote(`Pushing ${row.name} → WebLinked…`);
  const applied = await applyDisplayWlSettings(row.id, { quiet: true, save: false });
  if (!applied?.ok) {
    setDisplayNote(applied?.error || `Could not apply ${row.name} output settings.`);
    void refreshWebLinkedStatus();
    return;
  }
  const result = window.kiosk?.setOutputArmed
    ? await window.kiosk.setOutputArmed({
        id: row.id,
        source: wlSourceId(row),
        name: row.name,
        armed: true,
        url,
      })
    : { ok: false, error: 'WebLinked bridge not available.' };
  if (!result?.ok) {
    setDisplayNote(result?.error || 'WebLinked did not accept the URL.');
    void refreshWebLinkedStatus();
    return;
  }
  markDisplayArmed(row.id);
  state.previewDisplayId = row.id;
  renderDisplays();
  setDisplayNote(`${row.name} → WebLinked (independent source).`);
  void refreshWebLinkedStatus();
}

async function removeDisplayCard(id) {
  const row = findDisplay(id);
  if (row?.preset) {
    setDisplayNote('Preset display cards stay on the board.');
    return;
  }
  if (isDisplayArmed(id)) {
    await togglePushWebLinked(id);
  }
  if (window.kiosk?.closeDisplayPreview) await window.kiosk.closeDisplayPreview({ id });
  state.displays = state.displays.filter((d) => d.id !== id);
  saveDisplays();
  renderDisplays();
  setDisplayNote('Display removed.');
}

let perfHealthTimer = null;
let perfHealthBusy = false;
/** @type {object | null} */
let lastPerfHealth = null;

function setPerfMeter(barId, valueId, percent, label) {
  const bar = $(barId);
  const value = $(valueId);
  const pct = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  if (bar) bar.style.width = `${pct}%`;
  if (value) value.textContent = label;
}

function bumpPerfLevel(current, next) {
  const order = { ok: 0, warn: 1, hot: 2 };
  return (order[next] || 0) > (order[current] || 0) ? next : current;
}

function renderPerfHealth(snap) {
  lastPerfHealth = snap;
  const panel = $('#perfPanel');
  if (!panel) return;

  const armedCount = state.armedDisplayIds.length;
  const remoteOpen = Boolean(state.remoteOpen);
  let level = snap?.level || 'warn';
  const tips = Array.isArray(snap?.tips) ? [...snap.tips] : [];

  if (armedCount >= 6) {
    level = bumpPerfLevel(level, 'hot');
    tips.unshift(`${armedCount} display cards armed — heavy for one machine.`);
  } else if (armedCount >= 4) {
    level = bumpPerfLevel(level, 'warn');
    tips.unshift(`${armedCount} display cards armed.`);
  }
  if (remoteOpen) {
    tips.push('RemoteOp multiview is open in this window.');
  }

  const label =
    !snap?.ok
      ? 'Unavailable'
      : level === 'hot'
        ? 'Overloaded'
        : level === 'warn'
          ? 'Busy'
          : snap.label || 'Healthy';

  panel.dataset.level = level;
  const labelEl = $('#perfLabel');
  const tipEl = $('#perfTip');
  if (labelEl) labelEl.textContent = label;
  if (tipEl) tipEl.textContent = tips.filter(Boolean)[0] || '—';

  const cpu = snap?.host?.cpuPercent;
  const mem = snap?.host?.memPercent;
  setPerfMeter(
    '#perfCpuBar',
    '#perfCpuValue',
    cpu,
    Number.isFinite(cpu) ? `${cpu.toFixed(0)}%` : 'Sampling…'
  );
  setPerfMeter(
    '#perfRamBar',
    '#perfRamValue',
    mem,
    Number.isFinite(mem)
      ? `${mem.toFixed(0)}% · ${snap.host.memUsedLabel} / ${snap.host.memTotalLabel}`
      : '—'
  );

  const wlEl = $('#perfWl');
  if (wlEl) {
    if (!snap?.ok) wlEl.textContent = '—';
    else if (!snap.weblinked?.running) wlEl.textContent = 'Off';
    else {
      const n = Number(snap.weblinked.sources) || 0;
      wlEl.textContent = n === 1 ? '1 source' : `${n} sources`;
    }
  }

  const armedEl = $('#perfArmed');
  if (armedEl) {
    armedEl.textContent = remoteOpen ? `${armedCount} · RemoteOp` : String(armedCount);
  }

  const stackEl = $('#perfStack');
  if (stackEl) {
    const mb = snap?.processes?.relatedMb;
    stackEl.textContent = Number.isFinite(mb) ? `~${mb.toFixed(0)} MB` : '—';
  }

  const showEl = $('#perfShow');
  if (showEl) {
    showEl.textContent = snap?.offlineShow?.running
      ? 'Running'
      : state.offlineShowRunning
        ? 'Running'
        : 'Off';
  }
}

async function refreshPerfHealth() {
  if (perfHealthBusy || !window.kiosk?.getSystemHealth) return;
  if (state.tab !== 'status') return;
  perfHealthBusy = true;
  try {
    const snap = await window.kiosk.getSystemHealth();
    renderPerfHealth(snap && typeof snap === 'object' ? snap : { ok: false, level: 'warn' });
  } catch (e) {
    renderPerfHealth({
      ok: false,
      level: 'warn',
      label: 'Unavailable',
      tips: [e instanceof Error ? e.message : 'Could not read system load'],
    });
  } finally {
    perfHealthBusy = false;
  }
}

function startPerfHealthLoop() {
  if (perfHealthTimer) return;
  void refreshPerfHealth();
  // Second tick fills in CPU % (needs a delta between samples).
  setTimeout(() => void refreshPerfHealth(), 1200);
  perfHealthTimer = setInterval(() => void refreshPerfHealth(), 4000);
}

function stopPerfHealthLoop() {
  if (perfHealthTimer) {
    clearInterval(perfHealthTimer);
    perfHealthTimer = null;
  }
}

function syncStatus() {
  const ev = selectedEvent();
  const armed = findDisplay(primaryArmedDisplayId());
  const filled = state.displays.filter((d) => (d.url || '').trim()).length;
  if (state.tab === 'status' && lastPerfHealth) renderPerfHealth(lastPerfHealth);

  const eventEl = $('#statusEvent');
  const eventHint = $('#statusEventHint');
  const eventCard = $('#sessionEventCard');
  if (eventEl) eventEl.textContent = ev ? ev.name : 'No event';
  if (eventHint) {
    eventHint.textContent = ev
      ? formatEventDate(ev.date) || 'Selected'
      : state.offlineShowRunning
        ? 'Pick a calendar event'
        : 'Start the show, then pick an event';
  }
  if (eventCard) eventCard.dataset.state = ev ? 'ready' : state.offlineShowRunning ? 'warn' : 'empty';

  const outEl = $('#statusOutputs');
  const outHint = $('#statusOutputsHint');
  const outCard = $('#sessionDisplaysCard');
  const armedCount = state.armedDisplayIds.length;
  if (outEl) {
    outEl.textContent = armedCount
      ? armedCount === 1
        ? armed?.name || '1 source'
        : `${armedCount} sources`
      : filled
        ? `${filled} URL${filled === 1 ? '' : 's'}`
        : 'None';
  }
  if (outHint) {
    outHint.textContent = armedCount
      ? armedCount === 1
        ? 'Pushed to WebLinked'
        : `${armedCount} independent WebLinked sources`
      : filled
        ? 'Preview or push from Settings'
        : 'Add up to 8 URLs';
  }
  if (outCard) outCard.dataset.state = armedCount ? 'ready' : filled ? 'warn' : 'empty';

  const camEl = $('#statusCamera');
  const camHint = $('#statusCameraHint');
  const camCard = $('#sessionRemoteCard');
  const remoteLabel = state.remoteOpen
    ? state.remoteProvider === 'vdo'
      ? 'VDO.Ninja'
      : 'Meshcast'
    : 'Not open';
  if (camEl) camEl.textContent = remoteLabel;
  if (camHint) {
    camHint.textContent = state.remoteOpen ? 'Multiview in this kiosk' : 'Open VDO or Meshcast';
  }
  if (camCard) camCard.dataset.state = state.remoteOpen ? 'ready' : 'empty';

  const startBtn = $('#startShowBtn');
  if (startBtn && !state.busy) {
    startBtn.textContent = state.offlineShowRunning ? 'Stop Offline Show' : 'Start Offline Show';
  }
  renderConnectivity();
}

function applyEventsResult(result) {
  const prev = state.eventId;
  state.events = Array.isArray(result?.events) ? result.events : [];
  if (prev && state.events.some((e) => e.id === prev)) state.eventId = prev;
  else if (!state.events.some((e) => e.id === state.eventId)) state.eventId = '';

  applyConnectivity(result);
  pickDefaultScope();

  const counts = countByScope();
  const notes = Array.isArray(result?.notes) ? result.notes.filter(Boolean) : [];
  notes.push(
    `${counts.all} event${counts.all === 1 ? '' : 's'} loaded (${counts.upcoming} upcoming · ${counts.past} past).`
  );
  setEventNote(notes.join(' '));
  renderEventBrowser();
  syncEventChrome();
}

async function refreshEventsFromShow() {
  if (!window.kiosk?.listEvents) {
    setEventNote('Offline Show bridge not available.');
    return;
  }
  setEventNote('Loading events (cloud sync if enabled)…');
  const result = await window.kiosk.listEvents();
  if (!result?.ok) {
    setEventNote(result?.error || 'Could not load events.');
    state.events = [];
    renderEventBrowser();
    syncEventChrome();
    return;
  }
  applyEventsResult(result);
}

async function syncCloudNow() {
  if (!window.kiosk?.syncFromCloud) return;
  setEventNote('Syncing from cloud…');
  const result = await window.kiosk.syncFromCloud();
  if (!result?.ok) {
    setEventNote(result?.error || 'Cloud sync failed.');
    return;
  }
  applyEventsResult({ ...result, notes: ['Manual cloud sync finished.'] });
}

let confirmResolver = null;

function askConfirm({ title, message, okLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const overlay = $('#confirmOverlay');
    const titleEl = $('#confirmTitle');
    const messageEl = $('#confirmMessage');
    const okBtn = $('#confirmOkBtn');
    if (!overlay || !titleEl || !messageEl || !okBtn) {
      resolve(window.confirm(message));
      return;
    }
    confirmResolver = resolve;
    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okLabel;
    overlay.hidden = false;
  });
}

function closeConfirm(result) {
  const overlay = $('#confirmOverlay');
  if (overlay) overlay.hidden = true;
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

function barPillClass(pill) {
  if (!pill) return 'is-skip';
  if (pill.skipped) return 'is-skip';
  return pill.ok ? 'is-ok' : 'is-bad';
}

function barPillText(label, pill) {
  if (!pill) return label;
  if (pill.skipped) return label;
  if (pill.ok) return label;
  return `${label}!`;
}

function updateConnBar() {
  const modeBtn = $('#connBarModeBtn');
  const pills = $('#connBarPills');
  const host = $('#connBarHost');
  if (host) host.textContent = '127.0.0.1:3004';

  if (!modeBtn) return;

  if (!state.offlineShowRunning) {
    modeBtn.dataset.mode = 'off';
    modeBtn.textContent = 'Not started';
    modeBtn.disabled = true;
    if (pills) {
      pills.innerHTML = ['Internet', 'Railway', 'Neon', 'Local LAN']
        .map((label) => `<span class="conn-bar-pill is-skip">${label}</span>`)
        .join('');
    }
    return;
  }

  modeBtn.disabled = false;
  if (state.cloudConnected) {
    modeBtn.dataset.mode = 'cloud';
    modeBtn.textContent = 'Cloud on';
  } else {
    modeBtn.dataset.mode = 'lan';
    modeBtn.textContent = 'LAN only';
  }

  if (pills) {
    const c = state.connectivity;
    if (!c) {
      pills.innerHTML = ['Internet', 'Railway', 'Neon', 'Local LAN']
        .map((label) => `<span class="conn-bar-pill is-skip">${label}</span>`)
        .join('');
      return;
    }
    const items = [
      ['Internet', c.internet],
      ['Railway', c.railway],
      ['Neon', c.neon],
      ['Local LAN', c.localLan],
    ];
    pills.innerHTML = items
      .map(
        ([label, pill]) =>
          `<span class="conn-bar-pill ${barPillClass(pill)}" title="${
            pill?.error || pill?.reason || pill?.label || label
          }">${barPillText(label, pill)}</span>`
      )
      .join('');
  }
}

async function applyMode(mode) {
  if (!window.kiosk?.setCloudMode) return;
  setEventNote(mode === 'cloud-connected' ? 'Enabling Cloud on…' : 'Switching to LAN only…');
  const result = await window.kiosk.setCloudMode({ mode });
  if (!result?.ok) {
    setEventNote(result?.error || 'Could not change mode.');
    renderConnectivity();
    return;
  }
  applyConnectivity({ cloudMode: result.cloudMode });
  updateConnBar();
  if (mode === 'cloud-connected') await syncCloudNow();
  else await refreshEventsFromShow();
}

async function requestModeChange(mode) {
  if (!state.offlineShowRunning) return;
  const alreadyCloud = state.cloudConnected;
  const alreadyLan = !state.cloudConnected;
  if (mode === 'cloud-connected' && alreadyCloud) return;
  if (mode === 'lan-only' && alreadyLan) return;

  if (mode === 'lan-only') {
    const ok = await askConfirm({
      title: 'Switch to LAN only',
      message:
        'Switch to LAN only? Event list and schedules use the local SQLite copy on this machine. No Railway/Neon reads or writes while LAN only is on.',
      okLabel: 'Switch to LAN only',
    });
    if (!ok) return;
    await applyMode('lan-only');
    return;
  }

  const tokenReady = state.tokenConfigured;
  const ok = await askConfirm({
    title: 'Turn Cloud on',
    message: tokenReady
      ? 'Turn Cloud on? Offline Show will connect to Railway / Neon for hosted calendars, then sync events into this kiosk. This is connect-only (no local show upload).'
      : 'Warning: no Railway Integration token saved yet. Cloud calendar sync may fail until you paste ros_itok_… (read + control + write).\n\nTurn Cloud on anyway?',
    okLabel: 'Turn Cloud on',
  });
  if (!ok) return;
  await applyMode('cloud-connected');
}

async function saveToken() {
  const token = ($('#railwayTokenInput')?.value || '').trim();
  if (!token) {
    setEventNote('Paste an Integration token first.');
    return;
  }
  if (!window.kiosk?.saveRailwayToken) return;
  setEventNote('Saving and validating token…');
  const result = await window.kiosk.saveRailwayToken({ token });
  if (!result?.ok) {
    setEventNote(result?.error || 'Token save failed.');
    return;
  }
  if ($('#railwayTokenInput')) $('#railwayTokenInput').value = '';
  applyConnectivity({ token: result.token });
  setEventNote('Token saved.');
  if (!state.cloudConnected) {
    await requestModeChange('cloud-connected');
  } else {
    await syncCloudNow();
  }
}

let sessionActive = false;
let pendingStartAfterSession = false;
let sessionTickTimer = null;

function selectedSessionMode() {
  const checked = document.querySelector('input[name="sessionMode"]:checked');
  return checked ? checked.value : 'testing';
}

function syncSessionModeUi() {
  const hours = $('#sessionLiveHours');
  if (hours) hours.hidden = selectedSessionMode() !== 'live';
}

function applySession(sessionState) {
  sessionActive = !!(sessionState && sessionState.active);
  const pill = $('#sessionPill');
  if (pill) {
    pill.classList.toggle('is-active', sessionActive);
    if (sessionActive) {
      const left = sessionState.remaining || '';
      pill.textContent = left
        ? `${sessionState.label || 'Session'} · ${left}`
        : sessionState.label || 'Session active';
    } else {
      pill.textContent = 'No session';
    }
  }
  const cancel = $('#sessionCancelBtn');
  if (cancel) cancel.hidden = !sessionActive;
  const modal = $('#sessionModal');
  if (modal && sessionActive && !pendingStartAfterSession) modal.hidden = true;
}

function openSessionModal({ force = false, startAfter = false } = {}) {
  const modal = $('#sessionModal');
  if (!modal) return;
  pendingStartAfterSession = !!startAfter;
  const err = $('#sessionModalError');
  if (err) err.textContent = '';
  syncSessionModeUi();
  if (force || !sessionActive || startAfter) modal.hidden = false;
}

function closeSessionModal() {
  pendingStartAfterSession = false;
  const modal = $('#sessionModal');
  if (modal && sessionActive) modal.hidden = true;
}

async function refreshSession() {
  if (!window.kiosk?.getSession) return { active: false };
  const sessionState = await window.kiosk.getSession();
  applySession(sessionState);
  return sessionState;
}

async function confirmKioskSession() {
  if (!window.kiosk?.startSession) return;
  const err = $('#sessionModalError');
  if (err) err.textContent = '';
  const result = await window.kiosk.startSession({
    mode: selectedSessionMode(),
    hours: Number($('#sessionHours')?.value || 4),
  });
  if (!result?.ok) {
    if (err) err.textContent = result?.error || 'Could not start session';
    return;
  }
  applySession(result);
  const shouldStart = pendingStartAfterSession;
  pendingStartAfterSession = false;
  const modal = $('#sessionModal');
  if (modal) modal.hidden = true;
  setEventNote(result.label || 'Session started');
  if (shouldStart) await connectOfflineShow();
}

async function connectOfflineShow() {
  if (!window.kiosk?.startOfflineShow) {
    setEventNote('Start Offline Show is only available in the Electron kiosk.');
    return;
  }
  if (!sessionActive) {
    openSessionModal({ force: true, startAfter: true });
    return;
  }
  state.busy = true;
  const btn = $('#startShowBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting…';
  }
  setEventNote('Starting Offline Show on :3004…');
  try {
    const result = await window.kiosk.startOfflineShow();
    if (!result?.ok) {
      state.offlineShowRunning = false;
      setEventNote(result?.error || 'Failed to start Offline Show.');
      if (/session/i.test(String(result?.error || ''))) {
        openSessionModal({ force: true, startAfter: true });
      }
      return;
    }
    state.offlineShowRunning = true;
    setEventNote(
      result.alreadyRunning
        ? 'Offline Show already running — preferring Cloud on / loading events…'
        : 'Offline Show started — preferring Cloud on / loading events…'
    );
    await refreshEventsFromShow();
    // Belt-and-suspenders: if prepareEvents left us LAN-only but a token exists, force Cloud.
    if (!state.cloudConnected && state.tokenConfigured && window.kiosk?.setCloudMode) {
      setEventNote('Token present — turning Cloud on…');
      await applyMode('cloud-connected');
    }
    startPptBridgePoll();
  } finally {
    state.busy = false;
    if (btn) btn.disabled = false;
    syncStatus();
  }
}

async function disconnectOfflineShow() {
  state.busy = true;
  const btn = $('#startShowBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Stopping…';
  }
  try {
    if (window.kiosk?.stopOfflineShow) {
      const stop = await window.kiosk.stopOfflineShow();
      if (stop?.stopped) setEventNote('Stopped Offline Show (started by this kiosk).');
      else setEventNote(stop?.note || 'Disconnected. Offline Show left running.');
    } else {
      setEventNote('Disconnected.');
    }
    state.offlineShowRunning = false;
    state.events = [];
    state.eventId = '';
    state.connectivity = null;
    state.pptBridge = null;
    stopPptBridgePoll();
    renderEventBrowser();
    syncEventChrome();
    renderPptBridgeStatus();
  } finally {
    state.busy = false;
    if (btn) btn.disabled = false;
    syncStatus();
  }
}

async function toggleOfflineShow() {
  if (state.busy) return;
  if (state.offlineShowRunning) await disconnectOfflineShow();
  else await connectOfflineShow();
}

async function bootstrap() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => void setTab(tab.dataset.tab));
  });

  document.querySelectorAll('.remoteop-subtab').forEach((btn) => {
    btn.addEventListener('click', () => void loadRemoteProvider(btn.dataset.remote, { force: true }));
  });

  $('#pickVdoBtn')?.addEventListener('click', () => void loadRemoteProvider('vdo', { force: true }));
  $('#pickMeshcastBtn')?.addEventListener('click', () => void loadRemoteProvider('meshcast', { force: true }));
  $('#remoteopChangeBtn')?.addEventListener('click', () => void resetRemoteChoice());

  document.querySelectorAll('.scope-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.eventScope = chip.dataset.scope;
      renderEventBrowser();
    });
  });

  $('#eventSearch')?.addEventListener('input', (e) => {
    state.eventSearch = e.target.value;
    renderEventBrowser();
  });

  document.querySelectorAll('.session-card[data-goto]').forEach((card) => {
    card.addEventListener('click', () => void setTab(card.dataset.goto));
  });

  $('#startShowBtn')?.addEventListener('click', () => void toggleOfflineShow());
  $('#sessionBtn')?.addEventListener('click', () => openSessionModal({ force: true }));
  $('#sessionStartBtn')?.addEventListener('click', () => void confirmKioskSession());
  $('#sessionCancelBtn')?.addEventListener('click', () => closeSessionModal());
  document.querySelectorAll('input[name="sessionMode"]').forEach((input) => {
    input.addEventListener('change', syncSessionModeUi);
  });
  if (window.kiosk?.onSession) {
    window.kiosk.onSession((sessionState) => {
      applySession(sessionState);
      if (sessionState?.ended) {
        state.offlineShowRunning = false;
        state.events = [];
        state.eventId = '';
        renderEventBrowser();
        syncEventChrome();
        syncStatus();
        setEventNote(sessionState.reason || 'Session ended — Offline Show stopped');
        openSessionModal({ force: true });
      }
    });
  }
  void refreshSession().then((sessionState) => {
    if (!sessionState?.active) openSessionModal({ force: true });
    if (sessionTickTimer) clearInterval(sessionTickTimer);
    sessionTickTimer = setInterval(() => {
      if (sessionActive) void refreshSession();
    }, 30_000);
  });
  $('#startWebLinkedBtn')?.addEventListener('click', () => void startWebLinkedEngine());
  $('#stopWebLinkedBtn')?.addEventListener('click', () => void stopWebLinkedEngine());
  $('#refreshWebLinkedBtn')?.addEventListener('click', () => void refreshWebLinkedStatus());
  $('#viewWebLinkedLogBtn')?.addEventListener('click', () => void openWebLinkedLogViewer());
  $('#copyWebLinkedLogBtn')?.addEventListener('click', () => void copyWebLinkedDiagnostics());
  $('#wlLogCloseBtn')?.addEventListener('click', () => closeWebLinkedLogViewer());
  $('#wlLogRefreshBtn')?.addEventListener('click', () => void fillWebLinkedLogViewer());
  $('#wlLogCopyBtn')?.addEventListener('click', async () => {
    const text = wlLogCacheText || formatWebLinkedDiagnosticsText(await fetchWebLinkedDiagnostics());
    try {
      await navigator.clipboard.writeText(text);
      setDisplayNote('WebLinked log copied.');
    } catch {
      setDisplayNote('Could not copy — select text in the log viewer instead.');
    }
  });
  $('#wlLogOverlay')?.addEventListener('click', (e) => {
    if (e.target?.id === 'wlLogOverlay') closeWebLinkedLogViewer();
  });
  $('#refreshPptBtn')?.addEventListener('click', () => void refreshPptBridgeStatus());
  $('#wlSettingsCancelBtn')?.addEventListener('click', () => closeSimpleWlSettings());
  $('#wlSettingsApplyBtn')?.addEventListener('click', () => void applySimpleWlSettings());
  $('#wlSettingsOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('#wlSettingsOverlay')) closeSimpleWlSettings();
  });
  $('#wlOutNdi')?.addEventListener('change', () => syncWlNdiSectionEnabled());
  $('#wlOutScreen')?.addEventListener('change', () => syncWlScreenSectionEnabled());
  $('#wlRasterSelect')?.addEventListener('change', () => {
    fillWlRateSelect($('#wlRateSelect')?.value || 'p50');
  });
  $('#wlNdiAddBtn')?.addEventListener('click', () => {
    const existing = collectWlNdiRows();
    existing.push({ name: '', alpha: true });
    renderWlNdiRows(existing);
    syncWlNdiSectionEnabled();
    const last = $('#wlNdiList')?.querySelector('.wl-ndi-row:last-child input[data-ndi-name]');
    last?.focus();
  });
  fillWlRateSelect('p50');
  wireWlPreviewInput();
  $('#wlInteractiveToggle')?.addEventListener('change', (e) => {
    setWlInteractive(Boolean(e.target.checked));
  });
  $('#wlInteractiveTogglePop')?.addEventListener('change', (e) => {
    setWlInteractive(Boolean(e.target.checked));
  });
  $('#wlLivePreviewLargerBtn')?.addEventListener('click', () => {
    setWlInteractive(true);
    placeWlLivePreview('overlay');
  });
  $('#wlPreviewOverlayCloseBtn')?.addEventListener('click', () => placeWlLivePreview('dock'));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (wlInteractive && document.activeElement === wlPreviewCanvas()) return;
    const settings = $('#wlSettingsOverlay');
    if (settings && !settings.hidden) {
      closeSimpleWlSettings();
      return;
    }
    const previewOverlay = $('#wlPreviewOverlay');
    if (previewOverlay && !previewOverlay.hidden) placeWlLivePreview('dock');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.tab === 'displays') startWlLivePreviewLoop();
  });
  $('#addDisplayBtn')?.addEventListener('click', () => addDisplayRow());
  $('#refreshEventsBtn')?.addEventListener('click', () => void refreshEventsFromShow());
  $('#refreshConnBtn')?.addEventListener('click', () => void refreshConnectivityOnly());
  $('#refreshPerfBtn')?.addEventListener('click', () => void refreshPerfHealth());
  $('#syncCloudBtn')?.addEventListener('click', () => void syncCloudNow());
  $('#modeLanBtn')?.addEventListener('click', () => void requestModeChange('lan-only'));
  $('#modeCloudBtn')?.addEventListener('click', () => void requestModeChange('cloud-connected'));
  $('#connBarModeBtn')?.addEventListener('click', () => {
    if (!state.offlineShowRunning) return;
    void requestModeChange(state.cloudConnected ? 'lan-only' : 'cloud-connected');
  });
  $('#saveTokenBtn')?.addEventListener('click', () => void saveToken());
  $('#confirmCancelBtn')?.addEventListener('click', () => closeConfirm(false));
  $('#confirmOkBtn')?.addEventListener('click', () => closeConfirm(true));
  $('#confirmOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('#confirmOverlay')) closeConfirm(false);
  });
  updateConnBar();

  showRemotePicker();
  renderEventBrowser();
  syncEventChrome();
  renderWebLinkedStatus();
  void setTab('status');

  try {
    const data = window.kiosk ? await window.kiosk.getBootstrap() : null;
    if ($('#footerMeta')) {
      $('#footerMeta').textContent = data?.version || 'V2';
    }
    void refreshWebLinkedStatus();
    if (data?.offlineShowRunning) {
      state.offlineShowRunning = true;
      setEventNote('Offline Show already running — checking cloud / loading events…');
      await refreshEventsFromShow();
      startPptBridgePoll();
    }
  } catch {
    /* ignore */
  }
}

void bootstrap();
