const api = window.civicsBridge;
const $ = (id) => document.getElementById(id);

function readForm() {
  return {
    apiBaseUrl: $('apiBaseUrl').value.trim(),
    eventId: $('eventId').value.trim(),
    pollSeconds: parseFloat($('pollSeconds').value) || 2,
    companion: {
      pictureFolder: $('companionPictureFolder').value.trim(),
      useShortStateNames: $('companionUseShortStateNames').checked === true,
      shortStateNames: $('companionShortStateNames').value,
      host: $('companionHost').value.trim() || '10.162.4.100',
      port: parseInt($('companionPort').value, 10) || 8888,
      apiVersion: $('companionApiVersion').value === 'v3' ? 'v3' : 'v2',
      page: parseInt($('companionPage').value, 10) || 1,
      firstBank: parseInt($('companionFirstBank').value, 10) || 1,
      count: parseInt($('companionCount').value, 10) || 10,
      startRow: parseInt($('companionStartRow').value, 10) || 0,
      startColumn: parseInt($('companionStartColumn').value, 10) || 0,
      columns: parseInt($('companionColumns').value, 10) || 5,
    },
  };
}

function fillForm(cfg) {
  const comp = cfg.companion || {};
  $('apiBaseUrl').value = cfg.apiBaseUrl || '';
  $('eventId').value = cfg.eventId || '';
  $('pollSeconds').value = String(cfg.pollSeconds || 2);
  $('companionPictureFolder').value = comp.pictureFolder || '';
  $('companionUseShortStateNames').checked = comp.useShortStateNames === true;
  $('companionShortStateNames').value = comp.shortStateNames || '';
  $('companionHost').value = comp.host || '10.162.4.100';
  $('companionPort').value = String(comp.port || 8888);
  $('companionApiVersion').value = comp.apiVersion === 'v3' ? 'v3' : 'v2';
  $('companionPage').value = String(comp.page || 1);
  $('companionFirstBank').value = String(comp.firstBank || 1);
  $('companionCount').value = String(comp.count || 10);
  $('companionStartRow').value = String(comp.startRow ?? 0);
  $('companionStartColumn').value = String(comp.startColumn ?? 0);
  $('companionColumns').value = String(comp.columns || 5);
}

function showStatus(status) {
  const el = $('status');
  const lines = [];
  if (status?.lastOk) lines.push(status.lastOk);
  if (status?.lastError) lines.push(status.lastError);
  el.textContent = lines.join('\n') || '—';
  el.className = status?.lastError ? 'err' : 'ok';
  $('runState').textContent = status?.running ? 'Watching for a website push' : 'Stopped';
}

async function init() {
  fillForm(await api.getConfig());
  api.onStatus(showStatus);
  $('btnPictureFolder').onclick = async () => {
    const picked = await api.pickFolder();
    if (picked) $('companionPictureFolder').value = picked;
  };
  $('btnSave').onclick = async () => {
    fillForm(await api.saveConfig(readForm()));
    $('status').textContent = 'Saved.';
    $('status').className = 'ok';
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
