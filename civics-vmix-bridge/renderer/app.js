const api = window.civicsBridge;

function $(id) {
  return document.getElementById(id);
}

function readForm() {
  return {
    apiBaseUrl: $('apiBaseUrl').value.trim(),
    apiToken: $('apiToken').value.trim(),
    eventId: $('eventId').value.trim(),
    vmixHost: $('vmixHost').value.trim() || '127.0.0.1',
    vmixPort: parseInt($('vmixPort').value, 10) || 8088,
    pollSeconds: parseFloat($('pollSeconds').value) || 1,
    dataSources: {
      top25: { name: $('dsTop25').value.trim(), table: $('tblTop25').value.trim() },
      top10: { name: $('dsTop10').value.trim(), table: $('tblTop10').value.trim() },
      top5: { name: $('dsTop5').value.trim(), table: $('tblTop5').value.trim() },
    },
  };
}

function fillForm(cfg) {
  $('apiBaseUrl').value = cfg.apiBaseUrl || '';
  $('apiToken').value = cfg.apiToken || '';
  $('eventId').value = cfg.eventId || '';
  $('vmixHost').value = cfg.vmixHost || '127.0.0.1';
  $('vmixPort').value = String(cfg.vmixPort || 8088);
  $('pollSeconds').value = String(cfg.pollSeconds || 1);
  $('dsTop25').value = cfg.dataSources?.top25?.name || '';
  $('tblTop25').value = cfg.dataSources?.top25?.table || '';
  $('dsTop10').value = cfg.dataSources?.top10?.name || '';
  $('tblTop10').value = cfg.dataSources?.top10?.table || '';
  $('dsTop5').value = cfg.dataSources?.top5?.name || '';
  $('tblTop5').value = cfg.dataSources?.top5?.table || '';
}

function showStatus(status) {
  const el = $('status');
  const parts = [];
  if (status?.lastOk) parts.push(status.lastOk);
  if (status?.lastSelection) {
    parts.push(
      `ROS selection: ${status.lastSelection.name} · ${status.lastSelection.state} (${status.lastSelection.filter})`
    );
  }
  if (status?.lastError) parts.push(`Error: ${status.lastError}`);
  el.textContent = parts.join('\n') || '—';
  el.className = status?.lastError ? 'err' : 'ok';
  $('runState').textContent = status?.running ? 'Running' : 'Stopped';
}

async function init() {
  const cfg = await api.getConfig();
  fillForm(cfg);
  api.onStatus(showStatus);

  $('btnSave').onclick = async () => {
    const saved = await api.saveConfig(readForm());
    fillForm(saved);
    $('status').textContent = 'Config saved.';
    $('status').className = 'ok';
  };
  $('btnStart').onclick = async () => {
    await api.saveConfig(readForm());
    await api.start();
  };
  $('btnStop').onclick = async () => {
    await api.stop();
  };
  $('btnTest').onclick = async () => {
    await api.saveConfig(readForm());
    const r = await api.testVmix();
    $('status').textContent = r.message || (r.ok ? 'OK' : 'Failed');
    $('status').className = r.ok ? 'ok' : 'err';
  };
  $('btnResync').onclick = async () => {
    await api.saveConfig(readForm());
    const r = await api.resync();
    $('status').textContent = r.message || (r.ok ? 'OK' : 'Failed');
    $('status').className = r.ok ? 'ok' : 'err';
  };
}

init().catch((err) => {
  $('status').textContent = err.message || String(err);
  $('status').className = 'err';
});
