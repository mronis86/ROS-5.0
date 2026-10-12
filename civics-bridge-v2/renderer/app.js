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
      pressColors: $('pressColors').checked === true,
      pressSelectedColor: $('pressSelectedColor').value || '#2563eb',
      pressDefaultColor: $('pressDefaultColor').value || '#000000',
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
  $('pressColors').checked = comp.pressColors === true;
  $('pressSelectedColor').value = comp.pressSelectedColor || '#2563eb';
  $('pressDefaultColor').value = comp.pressDefaultColor || '#000000';
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

function showLayout() {
  const comp = readForm().companion;
  const el = $('companionLayout');
  const perRow = Math.max(1, comp.columns);
  const spots = [];
  for (let i = 0; i < comp.count; i += 1) {
    if (comp.apiVersion === 'v3') {
      spots.push(`row ${comp.startRow + Math.floor(i / perRow)} col ${comp.startColumn + (i % perRow)}`);
      continue;
    }
    const start = Math.max(1, comp.firstBank) - 1;
    const column = (start % 8) + (i % perRow);
    if (column > 7) {
      el.textContent = `Not allowed: ${perRow} per row from bank ${start + 1} runs past the 8 buttons in a Companion 2.4 row. Use ${Math.max(1, 8 - (start % 8))} or less. The bridge will refuse to change Companion.`;
      el.className = 'hint err';
      return;
    }
    spots.push(String((Math.floor(start / 8) + Math.floor(i / perRow)) * 8 + column + 1));
  }
  el.textContent = `Uses page ${comp.page}, ${comp.apiVersion === 'v3' ? '' : 'banks '}${spots.join(', ')}. Nothing else on the page is touched.`;
  el.className = 'hint ok';
  const press = $('pressUrls');
  if (!comp.pressColors) {
    press.textContent = 'Press colors are off.';
    press.className = 'hint';
    return;
  }
  press.textContent = `Watches Companion ${comp.host}:${comp.port}, page ${comp.page}, ${comp.apiVersion === 'v3' ? spots.join(', ') : `banks ${spots.join(', ')}`}. A press on one of those buttons recolors the set. Other buttons are ignored.`;
  press.className = 'hint ok';
}

async function init() {
  fillForm(await api.getConfig());
  showLayout();
  document.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', showLayout));
  api.onStatus(showStatus);
  $('btnPictureFolder').onclick = async () => {
    const picked = await api.pickFolder();
    if (picked) $('companionPictureFolder').value = picked;
  };
  $('btnSave').onclick = async () => {
    fillForm(await api.saveConfig(readForm()));
    showLayout();
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
