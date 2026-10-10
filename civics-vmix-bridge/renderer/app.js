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
    csvHeaderIsDataRow: $('csvHeaderIsDataRow').checked === true,
    companion: {
      enabled: $('companionEnabled').checked === true,
      host: $('companionHost').value.trim() || '127.0.0.1',
      port: parseInt($('companionPort').value, 10) || 8000,
      page: parseInt($('companionPage').value, 10) || 1,
      startRow: parseInt($('companionStartRow').value, 10) || 0,
      startColumn: parseInt($('companionStartColumn').value, 10) || 0,
      count: parseInt($('companionCount').value, 10) || 10,
      columns: parseInt($('companionColumns').value, 10) || 10,
      listenPort: parseInt($('companionListenPort').value, 10) || 3921,
    },
    dataSources: {
      top25: {
        name: $('dsTop25').value.trim(),
        table: $('tblTop25').value.trim(),
        feedUrl: $('urlTop25').value.trim(),
      },
      top10: {
        name: $('dsTop10').value.trim(),
        table: $('tblTop10').value.trim(),
        feedUrl: $('urlTop10').value.trim(),
      },
      top5: {
        name: $('dsTop5').value.trim(),
        table: $('tblTop5').value.trim(),
        feedUrl: $('urlTop5').value.trim(),
      },
    },
  };
}

function bindingOf(cfg, filter) {
  const fromBindings = (cfg.bindings || []).find((b) => b.filter === filter);
  if (fromBindings) {
    return {
      name: fromBindings.dataSourceName || '',
      table: fromBindings.tableName || '',
      feedUrl: fromBindings.feedUrl || '',
      csvHeaderIsDataRow: fromBindings.csvHeaderIsDataRow === true,
    };
  }
  const legacy = cfg.dataSources?.[filter] || {};
  return {
    name: legacy.name || '',
    table: legacy.table || '',
    feedUrl: legacy.feedUrl || '',
    csvHeaderIsDataRow: cfg.csvHeaderIsDataRow === true,
  };
}

function fillForm(cfg) {
  $('apiBaseUrl').value = cfg.apiBaseUrl || '';
  $('apiToken').value = cfg.apiToken || '';
  $('eventId').value = cfg.eventId || '';
  $('vmixHost').value = cfg.vmixHost || '127.0.0.1';
  $('vmixPort').value = String(cfg.vmixPort || 8088);
  $('pollSeconds').value = String(cfg.pollSeconds || 1);
  const top25 = bindingOf(cfg, 'top25');
  const top10 = bindingOf(cfg, 'top10');
  const top5 = bindingOf(cfg, 'top5');
  $('csvHeaderIsDataRow').checked =
    top25.csvHeaderIsDataRow || top10.csvHeaderIsDataRow || top5.csvHeaderIsDataRow;
  const comp = cfg.companion || {};
  $('companionEnabled').checked = comp.enabled === true;
  $('companionHost').value = comp.host || '127.0.0.1';
  $('companionPort').value = String(comp.port || 8000);
  $('companionPage').value = String(comp.page || 1);
  $('companionStartRow').value = String(comp.startRow ?? 0);
  $('companionStartColumn').value = String(comp.startColumn ?? 0);
  $('companionCount').value = String(comp.count || 10);
  $('companionColumns').value = String(comp.columns || 10);
  $('companionListenPort').value = String(comp.listenPort || 3921);
  const hint = $('companionPressHint');
  if (hint) {
    const port = comp.listenPort || 3921;
    hint.textContent = `Button 1: http://127.0.0.1:${port}/top10/0    Button 2: http://127.0.0.1:${port}/top10/1`;
  }
  $('dsTop25').value = top25.name;
  $('tblTop25').value = top25.table;
  $('urlTop25').value = top25.feedUrl;
  $('dsTop10').value = top10.name;
  $('tblTop10').value = top10.table;
  $('urlTop10').value = top10.feedUrl;
  $('dsTop5').value = top5.name;
  $('tblTop5').value = top5.table;
  $('urlTop5').value = top5.feedUrl;
}

function showStatus(status) {
  const el = $('status');
  const parts = [];
  if (status?.lastOk) parts.push(status.lastOk);
  if (status?.lastSelection) {
    parts.push(
      `ROS selection: ${status.lastSelection.name} · ${status.lastSelection.state} (${status.lastSelection.filter}) @ ${status.lastSelection.updatedAt || '—'}`
    );
  } else if (status?.running) {
    parts.push('ROS selection: (none)');
  }
  if (status?.lastCompanionOk) parts.push(status.lastCompanionOk);
  if (status?.lastCompanionError) parts.push(`Companion: ${status.lastCompanionError}`);
  if (status?.lastError) parts.push(`Error: ${status.lastError}`);
  el.textContent = parts.join('\n') || '—';
  el.className = status?.lastError || status?.lastCompanionError ? 'err' : 'ok';
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
