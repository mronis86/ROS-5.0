const form = document.getElementById('config-form');
const validateBtn = document.getElementById('validate-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');

const fields = {
  appBaseUrl: document.getElementById('appBaseUrl'),
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  apiToken: document.getElementById('apiToken'),
  eventId: document.getElementById('eventId'),
  spoutName: document.getElementById('spoutName'),
  width: document.getElementById('width'),
  height: document.getElementById('height'),
  fps: document.getElementById('fps'),
};

const statusApi = document.getElementById('status-api');
const statusSpoutDll = document.getElementById('status-spout-dll');
const statusOutput = document.getElementById('status-output');
const statusFps = document.getElementById('status-fps');
const statusUrl = document.getElementById('status-url');

function normalizeUrlInput(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');
  return s;
}

function readForm() {
  return {
    appBaseUrl: normalizeUrlInput(fields.appBaseUrl.value),
    apiBaseUrl: normalizeUrlInput(fields.apiBaseUrl.value),
    apiToken: fields.apiToken.value.trim(),
    eventId: fields.eventId.value.trim(),
    spoutName: fields.spoutName.value.trim() || 'ROS LED',
    width: Number(fields.width.value) || 1920,
    height: Number(fields.height.value) || 1080,
    fps: Number(fields.fps.value) || 60,
  };
}

function fillForm(config) {
  fields.appBaseUrl.value = normalizeUrlInput(config.appBaseUrl || '');
  fields.apiBaseUrl.value = normalizeUrlInput(config.apiBaseUrl || '');
  fields.apiToken.value = config.apiToken || '';
  fields.eventId.value = config.eventId || '';
  fields.spoutName.value = config.spoutName || 'ROS LED';
  fields.width.value = config.width || 1920;
  fields.height.value = config.height || 1080;
  fields.fps.value = config.fps || 60;
}

function setLine(el, text, kind = 'muted') {
  el.textContent = text;
  el.className = `status-line ${kind}`;
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  Object.values(fields).forEach((input) => {
    input.disabled = running;
  });
  validateBtn.disabled = running;
}

async function init() {
  const { config, spoutDll } = await window.rosLedSpout.loadConfig();
  fillForm(config);
  setLine(
    statusSpoutDll,
    spoutDll ? `Spout DLL: ${spoutDll}` : 'Spout DLL: not found — see vendor/README.md',
    spoutDll ? 'ok' : 'warn'
  );

  const out = await window.rosLedSpout.getOutputStatus();
  setRunning(!!out.running);
}

validateBtn.addEventListener('click', async () => {
  setLine(statusApi, 'API: testing…', 'muted');
  const result = await window.rosLedSpout.validateApi(readForm());
  setLine(statusApi, `API: ${result.message}`, result.ok ? 'ok' : 'error');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLine(statusOutput, 'Output: starting…', 'muted');
  const result = await window.rosLedSpout.startOutput(readForm());
  if (result.ok) {
    setRunning(true);
    setLine(statusOutput, 'Output: running', 'ok');
    setLine(statusUrl, result.url || '', 'muted');
  } else {
    setRunning(false);
    setLine(statusOutput, `Output: failed — ${result.message || 'unknown error'}`, 'error');
  }
});

stopBtn.addEventListener('click', async () => {
  await window.rosLedSpout.stopOutput();
  setRunning(false);
  setLine(statusOutput, 'Output: stopped', 'muted');
  setLine(statusFps, '', 'muted');
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
      `Publish: ~${status.fps} fps (target ${target})${sendNote}`,
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
