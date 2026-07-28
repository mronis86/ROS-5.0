const api = window.rosVmixBridge;

const els = {
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  apiToken: document.getElementById('apiToken'),
  eventSelect: document.getElementById('eventSelect'),
  eventId: document.getElementById('eventId'),
  vmixHost: document.getElementById('vmixHost'),
  vmixPort: document.getElementById('vmixPort'),
  pollSeconds: document.getElementById('pollSeconds'),
  bindings: document.getElementById('bindings'),
  vmixDsList: document.getElementById('vmix-ds-list'),
  toast: document.getElementById('toast'),
  runPill: document.getElementById('run-pill'),
  stRailway: document.getElementById('st-railway'),
  stSocket: document.getElementById('st-socket'),
  stVmix: document.getElementById('st-vmix'),
  stCue: document.getElementById('st-cue'),
  stMatches: document.getElementById('st-matches'),
  stError: document.getElementById('st-error'),
};

/** @type {{ name: string, tables: string[] }[]} */
let catalog = [];
let bindingState = [];

function showToast(message, isError = false) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  els.toast.classList.toggle('bad', isError);
  els.toast.classList.toggle('ok', !isError);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 4500);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function newBinding(partial = {}) {
  return {
    id: partial.id || `b${Date.now()}${Math.floor(Math.random() * 1000)}`,
    enabled: partial.enabled !== false,
    label: partial.label || '',
    dataSourceName: partial.dataSourceName || '',
    tableName: partial.tableName || '',
    matchMode: partial.matchMode === 'rowIndex' ? 'rowIndex' : 'cueColumn',
    cueColumn: partial.cueColumn || 'cue',
    dayFilter: partial.dayFilter == null ? '' : partial.dayFilter,
  };
}

function readForm() {
  return {
    apiBaseUrl: els.apiBaseUrl.value.trim(),
    apiToken: els.apiToken.value.trim(),
    eventId: els.eventId.value.trim(),
    vmixHost: els.vmixHost.value.trim() || '127.0.0.1',
    vmixPort: Number(els.vmixPort.value) || 8088,
    pollSeconds: Number(els.pollSeconds.value) || 5,
    bindings: bindingState.map((b, i) => ({
      id: b.id || `b${i + 1}`,
      enabled: b.enabled !== false,
      label: String(b.label || '').trim(),
      dataSourceName: String(b.dataSourceName || '').trim(),
      tableName: String(b.tableName || '').trim(),
      matchMode: b.matchMode === 'rowIndex' ? 'rowIndex' : 'cueColumn',
      cueColumn: String(b.cueColumn || 'cue').trim() || 'cue',
      dayFilter:
        b.dayFilter === '' || b.dayFilter == null || Number.isNaN(Number(b.dayFilter))
          ? null
          : Number(b.dayFilter),
    })),
  };
}

function fillForm(config) {
  els.apiBaseUrl.value = config.apiBaseUrl || '';
  els.apiToken.value = config.apiToken || '';
  els.eventId.value = config.eventId || '';
  els.vmixHost.value = config.vmixHost || '127.0.0.1';
  els.vmixPort.value = config.vmixPort || 8088;
  els.pollSeconds.value = config.pollSeconds || 5;
  bindingState =
    Array.isArray(config.bindings) && config.bindings.length
      ? config.bindings.map((b) => newBinding(b))
      : [newBinding({ id: 'default' })];
  renderBindings();
}

function tablesFor(dsName) {
  const entry = catalog.find((c) => c.name === dsName);
  return entry?.tables || [];
}

function dsOptions(selected) {
  const names = catalog.length ? catalog.map((c) => c.name) : selected ? [selected] : [];
  const opts = ['<option value="">— choose Data Source —</option>'];
  for (const name of names) {
    const sel = name === selected ? ' selected' : '';
    const sheets = tablesFor(name);
    const suffix = sheets.length ? ` (${sheets.length} sheet${sheets.length === 1 ? '' : 's'})` : '';
    opts.push(`<option value="${escapeAttr(name)}"${sel}>${escapeHtml(name)}${escapeHtml(suffix)}</option>`);
  }
  if (selected && !names.includes(selected)) {
    opts.push(`<option value="${escapeAttr(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  return opts.join('');
}

function sheetOptions(dsName, selected) {
  const tables = tablesFor(dsName);
  const opts = [
    `<option value=""${!selected ? ' selected' : ''}>— none (XML / CSV) —</option>`,
    `<option value="__custom__"${selected === '__custom__' ? ' selected' : ''}>Custom sheet name…</option>`,
  ];
  for (const t of tables) {
    const sel = t === selected ? ' selected' : '';
    opts.push(`<option value="${escapeAttr(t)}"${sel}>${escapeHtml(t)}</option>`);
  }
  if (selected && selected !== '__custom__' && !tables.includes(selected)) {
    opts.push(`<option value="${escapeAttr(selected)}" selected>${escapeHtml(selected)} (saved)</option>`);
  }
  return opts.join('');
}

function updateCatalogBanner() {
  if (!catalog.length) {
    els.vmixDsList.innerHTML =
      'No catalog yet — open <strong>Connections</strong>, test vMix, or click <strong>Refresh from vMix</strong>.';
    return;
  }
  const bits = catalog.map((c) => {
    const sheets = c.tables.length ? ` → ${c.tables.join(', ')}` : '';
    return `<strong>${escapeHtml(c.name)}</strong>${escapeHtml(sheets)}`;
  });
  els.vmixDsList.innerHTML = `Loaded ${catalog.length} Data Source(s): ${bits.join(' · ')}`;
}

function applyCatalog(nextCatalog, namesFallback) {
  if (Array.isArray(nextCatalog) && nextCatalog.length) {
    catalog = nextCatalog.map((c) => ({
      name: c.name,
      tables: Array.isArray(c.tables) ? c.tables : [],
    }));
  } else if (Array.isArray(namesFallback) && namesFallback.length) {
    catalog = namesFallback.map((name) => ({ name, tables: [] }));
  }
  updateCatalogBanner();
  renderBindings();
}

function renderBindings() {
  els.bindings.innerHTML = bindingState
    .map((b, i) => {
      const enabled = b.enabled !== false;
      const title =
        b.label ||
        [b.dataSourceName || 'Untitled source', b.tableName ? `/ ${b.tableName}` : '']
          .filter(Boolean)
          .join(' ') ||
        `Source ${i + 1}`;
      const tables = tablesFor(b.dataSourceName);
      const isCustomSheet =
        b._sheetPick === '__custom__' || (!!b.tableName && !tables.includes(b.tableName));
      const sheetSelectValue = isCustomSheet ? '__custom__' : b.tableName || '';
      const showCustomInput = sheetSelectValue === '__custom__';

      return `
      <article class="binding ${enabled ? '' : 'disabled'}" data-index="${i}">
        <div class="binding-head">
          <div class="binding-title">
            <label class="enable">
              <input type="checkbox" data-field="enabled" ${enabled ? 'checked' : ''} />
              On
            </label>
            <strong>${escapeHtml(title)}</strong>
          </div>
          <div class="binding-actions">
            <button type="button" data-dup="${i}" title="Duplicate">Duplicate</button>
            <button type="button" class="danger" data-remove="${i}" ${bindingState.length <= 1 ? 'disabled' : ''}>Remove</button>
          </div>
        </div>

        <label>
          Nickname <span class="hint">(optional — e.g. Lower thirds · Sheet1)</span>
          <input data-field="label" type="text" value="${escapeAttr(b.label || '')}" placeholder="Friendly name" />
        </label>

        <div class="grid3">
          <label>
            Data Source
            <select data-field="dataSourceName">${dsOptions(b.dataSourceName)}</select>
          </label>
          <label>
            Sheet / table
            <select data-field="_sheetPick">${sheetOptions(b.dataSourceName, sheetSelectValue)}</select>
          </label>
          <label ${showCustomInput ? '' : 'hidden'}>
            Custom sheet name
            <input data-field="tableName" type="text" value="${escapeAttr(b.tableName || '')}" placeholder="Sheet1" />
          </label>
        </div>

        <div class="mode-seg" data-mode-index="${i}">
          <button type="button" data-mode="cueColumn" class="${b.matchMode !== 'rowIndex' ? 'active' : ''}">Cue column</button>
          <button type="button" data-mode="rowIndex" class="${b.matchMode === 'rowIndex' ? 'active' : ''}">Row index</button>
        </div>

        <details class="advanced">
          <summary>Advanced</summary>
          <div class="grid2">
            <label>
              Cue column hint
              <input data-field="cueColumn" type="text" value="${escapeAttr(b.cueColumn || 'cue')}" />
            </label>
            <label>
              Day filter
              <input data-field="dayFilter" type="number" min="1" value="${escapeAttr(b.dayFilter ?? '')}" placeholder="all days" />
            </label>
          </div>
          <p class="hint">Cue column mode matches ROS schedule cue text. Row index uses schedule order — must match the sheet/XML row order.</p>
        </details>
      </article>`;
    })
    .join('');

  els.bindings.querySelectorAll('.binding').forEach((node) => {
    const index = Number(node.dataset.index);

    node.querySelectorAll('[data-field]').forEach((input) => {
      const apply = () => {
        const field = input.getAttribute('data-field');
        if (field === 'enabled') {
          bindingState[index].enabled = input.checked;
          node.classList.toggle('disabled', !input.checked);
          return;
        }
        if (field === '_sheetPick') {
          bindingState[index]._sheetPick = input.value;
          if (input.value === '__custom__') {
            // keep existing tableName for editing
          } else {
            bindingState[index].tableName = input.value;
          }
          renderBindings();
          return;
        }
        if (field === 'dataSourceName') {
          bindingState[index].dataSourceName = input.value;
          // Reset sheet when source changes if old sheet not in new source
          const tables = tablesFor(input.value);
          if (bindingState[index].tableName && !tables.includes(bindingState[index].tableName)) {
            bindingState[index].tableName = '';
            bindingState[index]._sheetPick = '';
          }
          renderBindings();
          return;
        }
        bindingState[index][field] = input.value;
      };
      input.addEventListener('change', apply);
      if (input.tagName === 'INPUT' && input.type !== 'checkbox') {
        input.addEventListener('input', apply);
      }
    });

    node.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        bindingState[index].matchMode = btn.getAttribute('data-mode');
        renderBindings();
      });
    });

    const removeBtn = node.querySelector('[data-remove]');
    removeBtn?.addEventListener('click', () => {
      if (bindingState.length <= 1) return;
      bindingState.splice(index, 1);
      renderBindings();
    });

    const dupBtn = node.querySelector('[data-dup]');
    dupBtn?.addEventListener('click', () => {
      const src = bindingState[index];
      bindingState.splice(
        index + 1,
        0,
        newBinding({
          ...src,
          id: undefined,
          label: src.label ? `${src.label} copy` : '',
        })
      );
      renderBindings();
    });
  });
}

function setStatusClass(el, ok) {
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('bad', ok === false);
}

function setTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
}

function renderLive(status) {
  if (!status) return;
  const running = !!status.running;
  els.runPill.textContent = running ? 'Running' : 'Stopped';
  els.runPill.classList.toggle('running', running);
  els.runPill.classList.toggle('stopped', !running);

  els.stRailway.textContent = status.railway?.message || '—';
  setStatusClass(els.stRailway, status.railway?.ok);

  els.stSocket.textContent = status.socket?.message || '—';
  setStatusClass(els.stSocket, status.socket?.ok);

  els.stVmix.textContent = status.vmix?.message || '—';
  setStatusClass(els.stVmix, status.vmix?.ok);

  if (status.cue) {
    els.stCue.textContent = `item ${status.cue.itemId} · ${status.cue.cueIs || '(no cue_is)'} · ${status.cue.timerState || '?'}`;
  } else {
    els.stCue.textContent = '—';
  }

  if (Array.isArray(status.matches) && status.matches.length) {
    els.stMatches.innerHTML = status.matches
      .map((m) => {
        const cls = m.ok ? 'ok' : 'bad';
        const title = m.label || m.dataSourceName || m.bindingId || 'Binding';
        const sheet = m.tableName ? ` · sheet ${escapeHtml(m.tableName)}` : '';
        const detail = m.ok
          ? `index ${m.index} (${escapeHtml(m.mode || '')})${m.cueValue ? ` · ${escapeHtml(m.cueValue)}` : ''}`
          : escapeHtml(m.message || 'failed');
        return `<div class="match-card"><div class="title ${cls}">${escapeHtml(title)}${sheet}</div><div>${detail}</div></div>`;
      })
      .join('');
  } else {
    els.stMatches.textContent = '—';
  }

  els.stError.textContent = status.lastError || '—';
  setStatusClass(els.stError, status.lastError ? false : null);
}

async function refreshDataSources() {
  const partial = readForm();
  const result = await api.listDataSources(partial);
  if (!result.ok) {
    showToast(result.message || 'Failed to list Data Sources', true);
    return;
  }
  applyCatalog(result.catalog, result.names);
  showToast(`Found ${catalog.length} Data Source(s)`);
}

async function init() {
  const config = await api.loadConfig();
  fillForm(config);
  updateCatalogBanner();

  api.onStatus(renderLive);
  renderLive(await api.getStatus());

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });

  document.getElementById('btn-add-binding').addEventListener('click', () => {
    bindingState.push(newBinding());
    renderBindings();
    setTab('sources');
  });

  document.getElementById('btn-add-sheet').addEventListener('click', () => {
    const last = bindingState[bindingState.length - 1];
    if (!last?.dataSourceName) {
      showToast('Pick a Data Source on a binding first, then Add sheet', true);
      return;
    }
    bindingState.push(
      newBinding({
        dataSourceName: last.dataSourceName,
        matchMode: last.matchMode,
        cueColumn: last.cueColumn,
        dayFilter: last.dayFilter,
        label: last.label ? `${last.label} (sheet)` : `${last.dataSourceName} sheet`,
        tableName: '',
        _sheetPick: '__custom__',
      })
    );
    renderBindings();
  });

  els.eventSelect.addEventListener('change', () => {
    if (els.eventSelect.value) els.eventId.value = els.eventSelect.value;
  });

  document.getElementById('btn-validate-api').addEventListener('click', async () => {
    const result = await api.validateApi(readForm());
    showToast(result.message || (result.ok ? 'OK' : 'Failed'), !result.ok);
  });

  document.getElementById('btn-load-events').addEventListener('click', async () => {
    const result = await api.listEvents(readForm());
    if (!result.ok) {
      showToast(result.message || 'Failed to load events', true);
      return;
    }
    const events = result.events || [];
    els.eventSelect.innerHTML =
      '<option value="">— select —</option>' +
      events
        .map((ev) => {
          const id = ev.id || '';
          const label = `${ev.name || ev.title || 'Event'} (${String(id).slice(0, 8)}…)`;
          return `<option value="${escapeAttr(id)}">${escapeHtml(label)}</option>`;
        })
        .join('');
    showToast(`Loaded ${events.length} events`);
  });

  document.getElementById('btn-test-vmix').addEventListener('click', async () => {
    const result = await api.testVmix(readForm());
    applyCatalog(result.catalog, result.dataSourceNames);
    showToast(result.message || (result.ok ? 'OK' : 'Failed'), !result.ok);
  });

  document.getElementById('btn-refresh-ds').addEventListener('click', () => void refreshDataSources());
  document.getElementById('btn-refresh-ds-2').addEventListener('click', () => void refreshDataSources());

  document.getElementById('btn-save').addEventListener('click', async () => {
    const saved = await api.saveConfig(readForm());
    fillForm(saved);
    showToast('Settings saved');
  });

  document.getElementById('btn-start').addEventListener('click', async () => {
    await api.saveConfig(readForm());
    const result = await api.startBridge(readForm());
    showToast(result.message || (result.ok ? 'Started' : 'Start failed'), !result.ok);
    if (result.ok) setTab('live');
  });

  document.getElementById('btn-stop').addEventListener('click', async () => {
    await api.stopBridge();
    showToast('Stopped');
  });

  document.getElementById('btn-resync').addEventListener('click', async () => {
    const result = await api.resync();
    showToast(result.message || (result.ok ? 'Resync OK' : 'Resync failed'), !result.ok);
  });
}

init().catch((err) => {
  showToast(err.message || String(err), true);
});
