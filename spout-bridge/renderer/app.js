const form = document.getElementById('config-form');
const validateBtn = document.getElementById('validate-btn');
const bakeBtn = document.getElementById('bake-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const pickPackBtn = document.getElementById('pick-pack-btn');
const liveFields = document.getElementById('live-fields');
const prerenderFields = document.getElementById('prerender-fields');

const fields = {
  sourceMode: document.getElementById('sourceMode'),
  appBaseUrl: document.getElementById('appBaseUrl'),
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  apiToken: document.getElementById('apiToken'),
  eventId: document.getElementById('eventId'),
  spoutName: document.getElementById('spoutName'),
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  fps: document.getElementById('fps'),
  useSelectedFps: document.getElementById('useSelectedFps'),
  formatApng: document.getElementById('formatApng'),
  formatWebp: document.getElementById('formatWebp'),
  formatWebm: document.getElementById('formatWebm'),
  prerenderPackPath: document.getElementById('prerenderPackPath'),
  offlineShowUrl: document.getElementById('offlineShowUrl'),
};

const statusApi = document.getElementById('status-api');
const statusBake = document.getElementById('status-bake');
const statusSpoutDll = document.getElementById('status-spout-dll');
const statusOutput = document.getElementById('status-output');
const statusFps = document.getElementById('status-fps');
const statusUrl = document.getElementById('status-url');
const sessionPill = document.getElementById('session-pill');
const sessionBtn = document.getElementById('session-btn');
const sessionModal = document.getElementById('session-modal');
const sessionLiveHours = document.getElementById('session-live-hours');
const sessionHours = document.getElementById('sessionHours');
const sessionModalError = document.getElementById('session-modal-error');
const btnSessionStart = document.getElementById('btn-session-start');
const btnSessionCancel = document.getElementById('btn-session-cancel');

let sessionActive = false;
let pendingStartAfterSession = false;
let sessionTickTimer = null;

function normalizeUrlInput(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  return s;
}

function isPrerender() {
  return fields.sourceMode.value === 'prerender';
}

function syncModeUi() {
  const prerender = isPrerender();
  liveFields.classList.toggle('hidden', prerender);
  prerenderFields.classList.toggle('hidden', !prerender);
  fields.appBaseUrl.required = !prerender;
  fields.apiBaseUrl.required = !prerender;
  fields.apiToken.required = !prerender;
  fields.prerenderPackPath.required = prerender;
  fields.offlineShowUrl.required = prerender;
  validateBtn.textContent = prerender ? 'Test pack' : 'Test live';
  fields.fps.disabled = !fields.useSelectedFps.checked;
}

function readForm() {
  const bakeFormats = [
    fields.formatApng.checked ? 'apng' : null,
    fields.formatWebp.checked ? 'webp' : null,
    fields.formatWebm.checked ? 'webm' : null,
  ].filter(Boolean);
  if (!bakeFormats.length) {
    fields.formatApng.checked = true;
    bakeFormats.push('apng');
  }
  return {
    sourceMode: fields.sourceMode.value === 'prerender' ? 'prerender' : 'live',
    appBaseUrl: normalizeUrlInput(fields.appBaseUrl.value),
    apiBaseUrl: normalizeUrlInput(fields.apiBaseUrl.value),
    apiToken: fields.apiToken.value.trim(),
    eventId: fields.eventId.value.trim(),
    spoutName: fields.spoutName.value.trim() || 'ROS LED',
    width: Number(fields.width.value) || 1920,
    height: Number(fields.height.value) || 1080,
    fps: Number(fields.fps.value) || 60,
    useSelectedFps: Boolean(fields.useSelectedFps?.checked),
    bakeFormats,
    prerenderPackPath: fields.prerenderPackPath.value.trim(),
    offlineShowUrl: normalizeUrlInput(fields.offlineShowUrl.value) || 'http://127.0.0.1:3004',
  };
}

function fillForm(config) {
  fields.sourceMode.value = config.sourceMode === 'prerender' ? 'prerender' : 'live';
  fields.appBaseUrl.value = normalizeUrlInput(config.appBaseUrl || '');
  fields.apiBaseUrl.value = normalizeUrlInput(config.apiBaseUrl || '');
  fields.apiToken.value = config.apiToken || '';
  fields.eventId.value = config.eventId || '';
  fields.spoutName.value = config.spoutName || 'ROS LED';
  fields.width.value = config.width || 1920;
  fields.height.value = config.height || 1080;
  fields.fps.value = config.fps || 60;
  if (fields.useSelectedFps) {
    fields.useSelectedFps.checked = Boolean(config.useSelectedFps);
  }
  const configuredFormats = Array.isArray(config.bakeFormats)
    ? config.bakeFormats
    : [config.bakeFormat || 'apng'];
  fields.formatApng.checked = configuredFormats.includes('apng');
  fields.formatWebp.checked = configuredFormats.includes('webp');
  fields.formatWebm.checked = configuredFormats.includes('webm');
  fields.prerenderPackPath.value = config.prerenderPackPath || '';
  fields.offlineShowUrl.value = normalizeUrlInput(config.offlineShowUrl || 'http://127.0.0.1:3004');
  syncModeUi();
}

function setLine(el, text, kind = 'muted') {
  el.textContent = text || '';
  el.className = `status-line ${kind}`;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  bakeBtn.disabled = running;
  Object.values(fields).forEach((input) => {
    input.disabled = running;
  });
  pickPackBtn.disabled = running;
  validateBtn.disabled = running;
  if (!running) syncModeUi();
}

function selectedSessionMode() {
  const checked = document.querySelector('input[name="sessionMode"]:checked');
  return checked ? checked.value : 'testing';
}

function syncSessionModeUi() {
  if (sessionLiveHours) sessionLiveHours.hidden = selectedSessionMode() !== 'live';
}

function applySession(state) {
  sessionActive = !!(state && state.active);
  if (sessionPill) {
    if (sessionActive) {
      sessionPill.classList.add('active');
      const left = state.remaining || '';
      sessionPill.textContent = left
        ? `${state.label || 'Session'} · ${left}`
        : state.label || 'Session active';
    } else {
      sessionPill.classList.remove('active');
      sessionPill.textContent = 'No session';
    }
  }
  if (btnSessionCancel) btnSessionCancel.hidden = !sessionActive;
  if (sessionModal && sessionActive && !pendingStartAfterSession) {
    sessionModal.hidden = true;
  }
}

function openSessionModal({ force = false, startAfter = false } = {}) {
  if (!sessionModal) return;
  pendingStartAfterSession = !!startAfter;
  if (sessionModalError) sessionModalError.textContent = '';
  syncSessionModeUi();
  if (force || !sessionActive || startAfter) sessionModal.hidden = false;
}

function closeSessionModal() {
  pendingStartAfterSession = false;
  if (sessionModal && sessionActive) sessionModal.hidden = true;
}

async function refreshSession() {
  if (!window.rosLedSpout.getSession) return { active: false };
  const state = await window.rosLedSpout.getSession();
  applySession(state);
  return state;
}

async function confirmSession() {
  if (!window.rosLedSpout.startSession) return;
  if (sessionModalError) sessionModalError.textContent = '';
  const result = await window.rosLedSpout.startSession({
    mode: selectedSessionMode(),
    hours: Number(sessionHours?.value || 4),
  });
  if (!result?.ok) {
    if (sessionModalError) sessionModalError.textContent = result?.error || 'Could not start session';
    return;
  }
  applySession(result);
  const shouldStart = pendingStartAfterSession;
  pendingStartAfterSession = false;
  if (sessionModal) sessionModal.hidden = true;
  if (shouldStart) await startSpoutOutput();
}

async function startSpoutOutput() {
  if (!sessionActive) {
    openSessionModal({ force: true, startAfter: true });
    return;
  }
  setLine(statusOutput, 'Output: starting…', 'muted');
  const result = await window.rosLedSpout.startOutput(readForm());
  if (result.ok) {
    setRunning(true);
    setLine(statusOutput, 'Output: running', 'ok');
    setLine(statusUrl, result.url || '', 'muted');
    await refreshSession();
  } else {
    setRunning(false);
    setLine(statusOutput, `Output: failed — ${result.message || result.error || 'unknown error'}`, 'error');
    if (/session/i.test(String(result.error || result.message || ''))) {
      openSessionModal({ force: true, startAfter: true });
    }
  }
}

async function init() {
  const { config, spoutDll } = await window.rosLedSpout.loadConfig();
  fillForm(config);
  if (config.sessionMode) {
    const radio = document.querySelector(`input[name="sessionMode"][value="${config.sessionMode}"]`);
    if (radio) radio.checked = true;
  }
  if (sessionHours && config.sessionHours) {
    sessionHours.value = String(Math.min(24, Math.max(1, Math.floor(Number(config.sessionHours) || 4))));
  }
  syncSessionModeUi();
  setLine(
    statusSpoutDll,
    spoutDll ? `Spout DLL: ${spoutDll}` : 'Spout DLL: not found — see vendor/README.md',
    spoutDll ? 'ok' : 'warn'
  );

  const out = await window.rosLedSpout.getOutputStatus();
  setRunning(!!out.running);

  const session = await refreshSession();
  if (!session.active) openSessionModal({ force: true });
  if (sessionTickTimer) clearInterval(sessionTickTimer);
  sessionTickTimer = setInterval(() => {
    if (sessionActive) void refreshSession();
  }, 30_000);
}

fields.sourceMode.addEventListener('change', syncModeUi);
fields.useSelectedFps.addEventListener('change', syncModeUi);

pickPackBtn.addEventListener('click', async () => {
  const result = await window.rosLedSpout.pickPrerenderPack();
  if (result?.ok && result.path) {
    fields.prerenderPackPath.value = result.path;
    if (result.eventId && !fields.eventId.value.trim()) {
      fields.eventId.value = result.eventId;
    }
    setLine(statusApi, `Pack: ${result.message || result.path}`, 'ok');
  } else if (result && result.cancelled) {
    /* ignore */
  } else if (result?.message) {
    setLine(statusApi, `Pack: ${result.message}`, 'error');
  }
});

validateBtn.addEventListener('click', async () => {
  setLine(statusApi, isPrerender() ? 'Pack: testing…' : 'API: testing…', 'muted');
  const result = await window.rosLedSpout.validateApi(readForm());
  setLine(
    statusApi,
    `${isPrerender() ? 'Pack' : 'API'}: ${result.message}`,
    result.ok ? 'ok' : 'error'
  );
});

bakeBtn.addEventListener('click', async () => {
  // Bake always needs live credentials — temporarily show live fields if on prerender
  const formData = readForm();
  if (!formData.appBaseUrl || !formData.apiBaseUrl || !formData.apiToken || !formData.eventId) {
    fields.sourceMode.value = 'live';
    syncModeUi();
    setLine(
      statusBake,
      'Switch to Live fields, fill app URL / API / token / event ID, then Bake pack again.',
      'warn'
    );
    return;
  }

  bakeBtn.disabled = true;
  setLine(statusBake, 'Bake: choose a folder, then wait while cues export…', 'muted');
  const result = await window.rosLedSpout.bakePack(formData);
  bakeBtn.disabled = false;

  if (result?.cancelled) {
    setLine(statusBake, 'Bake: cancelled', 'muted');
    return;
  }
  if (!result?.ok) {
    setLine(statusBake, `Bake failed: ${result?.message || 'unknown error'}`, 'error');
    return;
  }

  if (result.outDir) {
    fields.prerenderPackPath.value = result.outDir;
  }
  if (result.config) {
    fillForm({ ...readForm(), ...result.config, prerenderPackPath: result.outDir || fields.prerenderPackPath.value });
  }

  setLine(statusBake, result.message || 'Bake complete', 'ok');
  setLine(statusApi, `Pack ready: ${result.outDir}`, 'ok');

  // Offer offline mode
  fields.sourceMode.value = 'prerender';
  syncModeUi();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await startSpoutOutput();
});

stopBtn.addEventListener('click', async () => {
  await window.rosLedSpout.stopOutput();
  setRunning(false);
  setLine(statusOutput, 'Output: stopped', 'muted');
  setLine(statusFps, '', 'muted');
});

document.querySelectorAll('input[name="sessionMode"]').forEach((input) => {
  input.addEventListener('change', syncSessionModeUi);
});
if (sessionBtn) sessionBtn.addEventListener('click', () => openSessionModal({ force: true }));
if (btnSessionStart) btnSessionStart.addEventListener('click', () => void confirmSession());
if (btnSessionCancel) btnSessionCancel.addEventListener('click', () => closeSessionModal());
if (window.rosLedSpout.onSession) {
  window.rosLedSpout.onSession((state) => {
    applySession(state);
    if (state?.ended) {
      setRunning(false);
      setLine(statusOutput, state.reason || 'Session ended — Spout stopped', 'warn');
      setLine(statusFps, '', 'muted');
      openSessionModal({ force: true });
    }
  });
}

window.rosLedSpout.onBakeProgress((status) => {
  if (!status?.message) return;
  const kind = status.phase === 'error' ? 'error' : status.phase === 'done' ? 'ok' : 'muted';
  setLine(statusBake, `Bake: ${status.message}`, kind);
});

window.rosLedSpout.onOutputStatus((status) => {
  if (status.error) {
    setLine(statusOutput, `Output: ${status.error}`, 'error');
  } else if (status.warning) {
    setLine(statusOutput, status.warning, 'warn');
  } else if (status.message) {
    setLine(statusOutput, `Output: ${status.message}`, status.running ? 'ok' : 'muted');
  }
  if (status.spout) {
    const isError =
      status.spout.includes('mismatch') ||
      status.spout.includes('failed') ||
      status.spout.includes('SendImage') ||
      status.spout.includes('Invalid') ||
      status.spout.includes('Empty');
    const kind = status.spout.includes('publishing')
      ? 'ok'
      : status.spout.includes('not found') || isError || (status.spoutSendsFailed ?? 0) > 0
        ? 'warn'
        : 'muted';
    setLine(statusSpoutDll, `Spout: ${status.spout}`, kind);
  }
  if (status.running && status.fps != null) {
    const target = status.targetFps ?? 60;
    const cueNote = status.activeCueId != null ? ` · cue ${status.activeCueId}` : '';
    const sendNote =
      status.spoutSendsFailed > 0 || status.spoutSendsOk > 0
        ? ` (${status.spoutSendsOk ?? 0} ok / ${status.spoutSendsFailed} failed)`
        : status.captureAttempts != null && status.captureAttempts === 0
          ? ' (waiting for first frame)'
          : '';
    const warn =
      status.spoutSendsFailed > 0 ||
      (status.fps > 0 && status.fps < target - 3) ||
      (status.fps === 0 && status.captureAttempts > 0);
    setLine(
      statusFps,
      `Publish: ~${status.fps} fps (target ${target})${cueNote}${sendNote}`,
      warn ? 'warn' : 'ok'
    );
  }
  if (status.url) {
    setLine(statusUrl, status.url, 'muted');
  }
  if (status.running && (status.spoutSendsOk ?? 0) === 0 && (status.spoutSendsFailed ?? 0) > 0 && status.spout) {
    setLine(statusSpoutDll, `Spout: ${status.spout}`, 'warn');
  }
});

init().catch((err) => {
  setLine(statusOutput, `Init error: ${err.message}`, 'error');
});
