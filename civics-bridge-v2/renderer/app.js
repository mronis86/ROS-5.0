const api = window.civicsBridge;
const $ = (id) => document.getElementById(id);

function readForm() {
  return {
    apiBaseUrl: $('apiBaseUrl').value.trim(),
    eventId: $('eventId').value.trim(),
    pictureFolder: $('pictureFolder').value.trim(),
    pollSeconds: parseFloat($('pollSeconds').value) || 2,
  };
}

function fillForm(cfg) {
  $('apiBaseUrl').value = cfg.apiBaseUrl || '';
  $('eventId').value = cfg.eventId || '';
  $('pictureFolder').value = cfg.pictureFolder || '';
  $('pollSeconds').value = String(cfg.pollSeconds || 2);
}

function showStatus(status) {
  $('runState').textContent = status?.running ? 'Watching for a push' : 'Stopped';
  const lines = [];
  if (status?.lastOk) lines.push(status.lastOk);
  if (status?.lastError) lines.push(status.lastError);
  if (status?.pictureFolder) lines.push(status.pictureFolder);
  $('status').textContent = lines.join('\n') || '—';
}

async function init() {
  fillForm(await api.getConfig());
  api.onStatus(showStatus);
  $('btnFolder').onclick = async () => {
    const picked = await api.pickFolder();
    if (picked) $('pictureFolder').value = picked;
  };
  $('btnSave').onclick = async () => {
    fillForm(await api.saveConfig(readForm()));
    $('status').textContent = 'Saved.';
  };
  $('btnStart').onclick = async () => {
    await api.saveConfig(readForm());
    await api.start();
  };
  $('btnStop').onclick = async () => {
    await api.stop();
  };
}

init();
