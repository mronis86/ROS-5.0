const api = window.rosVmixBridge;
if (!api) {
  document.body.innerHTML =
    '<div style="padding:2rem;font-family:Segoe UI,sans-serif;background:#0b1220;color:#e8eef7;min-height:100vh">' +
    '<h1>Bridge UI failed to start</h1>' +
    '<p>Preload bridge API is missing. Close the app and relaunch from START.bat inside the unzipped <code>ros-vmix-datasource-bridge</code> folder (keep <code>resources\\app.asar</code> next to the exe).</p>' +
    '</div>';
  throw new Error('rosVmixBridge preload API missing');
}

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
  autoStopPill: document.getElementById('auto-stop-pill'),
  autoStopModal: document.getElementById('auto-stop-modal'),
  sessionLiveHours: document.getElementById('session-live-hours'),
  sessionHours: document.getElementById('sessionHours'),
  sessionModalError: document.getElementById('session-modal-error'),
  btnSession: document.getElementById('btn-session'),
  btnSessionCancel: document.getElementById('btn-session-cancel'),
  autoStopNotice: document.getElementById('auto-stop-notice'),
  autoStopNoticeText: document.getElementById('auto-stop-notice-text'),
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
/** @type {any[]} */
let loadedEvents = [];
/** @type {'upcoming' | 'past'} */
let eventFilter = 'upcoming';

function eventDateMs(ev) {
  const raw = String(ev?.date || ev?.event_date || ev?.eventDate || '').trim();
  // Parse YYYY-MM-DD as local calendar day (avoid UTC shift from Date('YYYY-MM-DD'))
  const parts = raw.split('-').map(Number);
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Multi-day length from calendar row (schedule_data or top-level). */
function eventNumberOfDays(ev) {
  const sd = ev?.schedule_data || ev?.scheduleData || {};
  const n = Number(ev?.numberOfDays ?? ev?.number_of_days ?? sd.numberOfDays ?? sd.number_of_days);
  return Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
}

/** Last inclusive calendar day of the event (start + days - 1). */
function eventLastDayMs(ev) {
  const startMs = eventDateMs(ev);
  if (startMs == null) return null;
  const days = eventNumberOfDays(ev);
  const end = new Date(startMs);
  end.setDate(end.getDate() + (days - 1));
  return end.getTime();
}

function formatEventDate(ev) {
  const ms = eventDateMs(ev);
  if (ms == null) return '';
  try {
    const days = eventNumberOfDays(ev);
    const startLabel = new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    if (days <= 1) return startLabel;
    const endMs = eventLastDayMs(ev);
    const endLabel =
      endMs != null
        ? new Date(endMs).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '';
    return endLabel ? `${startLabel}–${endLabel}` : startLabel;
  } catch {
    return '';
  }
}

function filterAndSortEvents(events, filter) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const list = Array.isArray(events) ? events.slice() : [];

  // Upcoming = still happening through last day (inclusive). Past only after last day ends.
  const filtered = list.filter((ev) => {
    const lastMs = eventLastDayMs(ev);
    if (lastMs == null) return filter === 'upcoming';
    return filter === 'upcoming' ? lastMs >= todayMs : lastMs < todayMs;
  });

  filtered.sort((a, b) => {
    const am = eventDateMs(a);
    const bm = eventDateMs(b);
    if (am == null && bm == null) return String(a.name || '').localeCompare(String(b.name || ''));
    if (am == null) return 1;
    if (bm == null) return -1;
    // Upcoming: soonest first. Past: most recent first.
    return filter === 'upcoming' ? am - bm : bm - am;
  });

  return filtered;
}

function renderEventSelect(preferredId) {
  const selectedId = preferredId || els.eventId.value.trim() || els.eventSelect.value || '';
  const events = filterAndSortEvents(loadedEvents, eventFilter);
  els.eventSelect.innerHTML =
    `<option value="">— select (${eventFilter}, ${events.length}) —</option>` +
    events
      .map((ev) => {
        const id = ev.id || '';
        const dateLabel = formatEventDate(ev);
        const name = ev.name || ev.title || 'Event';
        const label = dateLabel
          ? `${dateLabel} — ${name} (${String(id).slice(0, 8)}…)`
          : `${name} (${String(id).slice(0, 8)}…)`;
        return `<option value="${escapeAttr(id)}">${escapeHtml(label)}</option>`;
      })
      .join('');

  if (selectedId && [...els.eventSelect.options].some((o) => o.value === selectedId)) {
    els.eventSelect.value = selectedId;
  } else {
    els.eventSelect.value = '';
  }
}

function setEventFilter(next) {
  eventFilter = next === 'past' ? 'past' : 'upcoming';
  document.querySelectorAll('.event-tab').forEach((btn) => {
    const active = btn.getAttribute('data-event-filter') === eventFilter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  renderEventSelect();
}
let sessionActive = false;
let sessionLabel = '';
let pendingStartAfterSession = false;
let sessionTickTimer = null;

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

function clampPoll(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(60, Math.max(1, v));
}

function selectedSessionMode() {
  const checked = document.querySelector('input[name="sessionMode"]:checked');
  return checked ? checked.value : 'testing';
}

function syncSessionModeUi() {
  const mode = selectedSessionMode();
  if (els.sessionLiveHours) els.sessionLiveHours.hidden = mode !== 'live';
}

function applySession(state) {
  sessionActive = !!(state && state.active);
  sessionLabel = sessionActive ? state.label || '' : '';
  if (els.autoStopPill) {
    if (sessionActive) {
      els.autoStopPill.hidden = false;
      const left = state.remaining || '';
      els.autoStopPill.textContent = left
        ? `${state.label || 'Session'} · ${left}`
        : state.label || 'Session active';
    } else {
      els.autoStopPill.hidden = false;
      els.autoStopPill.textContent = 'No session';
    }
  }
  if (els.btnSessionCancel) els.btnSessionCancel.hidden = !sessionActive;
  if (els.autoStopModal && sessionActive && !pendingStartAfterSession) {
    els.autoStopModal.hidden = true;
  }
}

function openSessionModal({ force = false, startAfter = false } = {}) {
  if (!els.autoStopModal) return;
  pendingStartAfterSession = !!startAfter;
  if (els.sessionModalError) els.sessionModalError.textContent = '';
  syncSessionModeUi();
  if (force || !sessionActive || startAfter) {
    els.autoStopModal.hidden = false;
  }
}

function closeSessionModal() {
  pendingStartAfterSession = false;
  if (els.autoStopModal && sessionActive) els.autoStopModal.hidden = true;
}

async function refreshSession() {
  if (!api.getSession) return { active: false };
  const state = await api.getSession();
  applySession(state);
  return state;
}

async function performStop({ auto = false, reason = '' } = {}) {
  window.rosCueSocket?.stopCueSocket?.();
  await api.stopBridge();
  if (auto) {
    els.autoStopNoticeText.textContent =
      reason ||
      (sessionLabel
        ? `Bridge stopped after ${sessionLabel} to limit Neon / Railway cost.`
        : 'Bridge stopped after the session timer ended.');
    els.autoStopNotice.hidden = false;
    showToast('Session ended — hit Start again when you need it', false);
  }
}

function syncPollPresetButtons() {
  const current = clampPoll(els.pollSeconds.value);
  document.querySelectorAll('#poll-presets [data-poll]').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.getAttribute('data-poll')) === current);
  });
}

function newBinding(partial = {}) {
  return {
    id: partial.id || `b${Date.now()}${Math.floor(Math.random() * 1000)}`,
    enabled: partial.enabled !== false,
    label: partial.label || '',
    dataSourceName: partial.dataSourceName || '',
    tableName: partial.tableName || '',
    feedUrl: partial.feedUrl || '',
    matchMode: 'cueColumn',
    cueColumn: partial.cueColumn || 'cue',
    dayFilter: partial.dayFilter == null ? '' : partial.dayFilter,
    csvHeaderIsDataRow:
      partial.csvHeaderIsDataRow === true ||
      (partial.csvHeaderIsDataRow == null && partial.vmixUsesHeaderRow === false),
  };
}

function readForm() {
  return {
    apiBaseUrl: els.apiBaseUrl.value.trim(),
    apiToken: els.apiToken.value.trim(),
    eventId: els.eventId.value.trim(),
    vmixHost: els.vmixHost.value.trim() || '127.0.0.1',
    vmixPort: Number(els.vmixPort.value) || 8088,
    pollSeconds: clampPoll(els.pollSeconds.value),
    bindings: bindingState.map((b, i) => ({
      id: b.id || `b${i + 1}`,
      enabled: b.enabled !== false,
      label: String(b.label || '').trim(),
      dataSourceName: String(b.dataSourceName || '').trim(),
      tableName: String(b.tableName || '').trim(),
      feedUrl: String(b.feedUrl || '').trim(),
      matchMode: 'cueColumn',
      cueColumn: String(b.cueColumn || 'cue').trim() || 'cue',
      dayFilter:
        b.dayFilter === '' || b.dayFilter == null || Number.isNaN(Number(b.dayFilter))
          ? null
          : Number(b.dayFilter),
      csvHeaderIsDataRow: b.csvHeaderIsDataRow === true,
    })),
  };
}

function fillForm(config) {
  els.apiBaseUrl.value = config.apiBaseUrl || '';
  els.apiToken.value = config.apiToken || '';
  els.eventId.value = config.eventId || '';
  els.vmixHost.value = config.vmixHost || '127.0.0.1';
  els.vmixPort.value = config.vmixPort || 8088;
  els.pollSeconds.value = clampPoll(config.pollSeconds ?? 1);
  if (config.sessionMode) {
    const radio = document.querySelector(`input[name="sessionMode"][value="${config.sessionMode}"]`);
    if (radio) radio.checked = true;
  }
  if (els.sessionHours && config.sessionHours) {
    els.sessionHours.value = String(Math.min(24, Math.max(1, Math.floor(Number(config.sessionHours) || 4))));
  }
  syncSessionModeUi();
  syncPollPresetButtons();
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

/** Datalist suggestions when vMix happens to expose sources in API XML. */
function dsDatalistOptions() {
  return catalog.map((c) => `<option value="${escapeAttr(c.name)}"></option>`).join('');
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
  const list = document.getElementById('vmix-ds-datalist');
  if (list) list.innerHTML = dsDatalistOptions();

  if (!catalog.length) {
    els.vmixDsList.innerHTML =
      'vMix usually <strong>does not list</strong> Data Sources in its web API. Type the <strong>exact name</strong> from ' +
      '<em>Settings → Data Sources</em> (or the Data Sources Manager buttons). Sheet names are optional for XML/CSV.';
    return;
  }
  const bits = catalog.map((c) => {
    const sheets = c.tables.length ? ` → ${c.tables.join(', ')}` : '';
    return `<strong>${escapeHtml(c.name)}</strong>${escapeHtml(sheets)}`;
  });
  els.vmixDsList.innerHTML = `API listed ${catalog.length} Data Source(s): ${bits.join(' · ')}`;
}

function applyCatalog(nextCatalog, namesFallback) {
  if (Array.isArray(nextCatalog)) {
    catalog = nextCatalog.map((c) => ({
      name: c.name,
      tables: Array.isArray(c.tables) ? c.tables : [],
    }));
  } else if (Array.isArray(namesFallback)) {
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
            Data Source name
            <span class="hint">(exact name from vMix Data Sources Manager)</span>
            <input
              data-field="dataSourceName"
              type="text"
              list="vmix-ds-datalist"
              value="${escapeAttr(b.dataSourceName || '')}"
              placeholder="e.g. Schedule / Speakers / Excel Workbook"
              spellcheck="false"
            />
          </label>
          <label>
            Sheet / table
            <select data-field="_sheetPick">${sheetOptions(b.dataSourceName, sheetSelectValue)}</select>
          </label>
          <label>
            Sheet name (type if needed)
            <input data-field="tableName" type="text" value="${escapeAttr(b.tableName || '')}" placeholder="blank for XML/CSV · Sheet1 for Excel" spellcheck="false" />
          </label>
        </div>

        <label>
          Feed URL
          <span class="hint">(same CSV/XML URL you pasted into vMix — Schedule, Lower Thirds, or Custom Columns)</span>
          <input
            data-field="feedUrl"
            type="url"
            value="${escapeAttr(b.feedUrl || '')}"
            placeholder="https://…/api/schedule.csv?eventId=…"
            spellcheck="false"
          />
        </label>

        <p class="hint mode-hint">
          <strong>Cue match:</strong> finds the feed’s <code>Cue</code> column and selects that vMix row
          (e.g. <code>CUE 9</code> ≈ <code>9</code>).
        </p>

        <fieldset class="header-mode">
          <legend>CSV header in vMix</legend>
          <label class="enable">
            <input data-field="csvHeaderIsDataRow" type="radio" name="hdr-${i}" value="0" ${b.csvHeaderIsDataRow ? '' : 'checked'} />
            <strong>Column names</strong> — vMix “Use first row as column names” is <em>ON</em> (recommended). Index 0 = first cue.
          </label>
          <label class="enable">
            <input data-field="csvHeaderIsDataRow" type="radio" name="hdr-${i}" value="1" ${b.csvHeaderIsDataRow ? 'checked' : ''} />
            <strong>Counts as a data row</strong> — that box is <em>OFF</em> (you see Column1/Column2 and a Row/Cue header line). Index 0 = header; cues start at 1.
          </label>
          <p class="hint">Must match the checkbox in vMix Data Source settings. XML feeds ignore this.</p>
        </fieldset>

        <details class="advanced">
          <summary>Advanced</summary>
          <div class="grid2">
            <label>
              Cue field name
              <input data-field="cueColumn" type="text" value="${escapeAttr(b.cueColumn || 'cue')}" />
            </label>
            <label>
              Day filter
              <input data-field="dayFilter" type="number" min="1" value="${escapeAttr(b.dayFilter ?? '')}" placeholder="all days" />
            </label>
          </div>
          <p class="hint">
            Day filter appends <code>?day=N</code> when fetching the feed (and filters by Day column if present).
          </p>
        </details>
      </article>`;
    })
    .join('');

  els.bindings.querySelectorAll('.binding').forEach((node) => {
    const index = Number(node.dataset.index);

    node.querySelectorAll('[data-field]').forEach((input) => {
      const apply = (event) => {
        const field = input.getAttribute('data-field');
        if (field === 'enabled') {
          bindingState[index].enabled = input.checked;
          node.classList.toggle('disabled', !input.checked);
          return;
        }
        if (field === 'csvHeaderIsDataRow') {
          bindingState[index].csvHeaderIsDataRow = input.value === '1';
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
          if (event.type === 'change') {
            const tables = tablesFor(input.value);
            if (bindingState[index].tableName && !tables.includes(bindingState[index].tableName)) {
              bindingState[index].tableName = '';
              bindingState[index]._sheetPick = '';
              renderBindings();
            }
          }
          return;
        }
        bindingState[index][field] = input.value;
      };
      input.addEventListener('change', apply);
      if (input.tagName === 'INPUT' && input.type !== 'checkbox') {
        input.addEventListener('input', apply);
      }
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
          ? `index ${m.index} (cue)${m.cueValue ? ` · ${escapeHtml(m.cueValue)}` : ''}`
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
  if (catalog.length) {
    showToast(`Found ${catalog.length} Data Source(s) in API`);
  } else {
    showToast(
      'vMix connected, but Data Sources are not in the API. Type the exact name from Data Sources Manager.',
      false
    );
  }
}

async function startBridgeNow() {
  if (!sessionActive) {
    openSessionModal({ force: true, startAfter: true });
    return;
  }

  els.autoStopNotice.hidden = true;
  await api.saveConfig(readForm());
  const form = readForm();
  const result = await api.startBridge(form);
  if (result && result.ok === false) {
    showToast(result.error || result.message || 'Start failed', true);
    if (/session/i.test(String(result.error || ''))) openSessionModal({ force: true, startAfter: true });
    return;
  }
  showToast(result.message || (result.ok ? 'Started' : 'Start failed'), !result.ok);
  if (!result.ok) return;

  closeSessionModal();
  setTab('live');
  const follow = result.socketFollow || {
    apiBaseUrl: form.apiBaseUrl,
    eventId: form.eventId,
    apiToken: form.apiToken,
  };
  window.rosCueSocket?.startCueSocket?.(follow);
  await refreshSession();
}

async function confirmSessionAndMaybeStart() {
  if (!api.startSession) return;
  if (els.sessionModalError) els.sessionModalError.textContent = '';
  const mode = selectedSessionMode();
  const hours = Number(els.sessionHours?.value || 4);
  const result = await api.startSession({ mode, hours });
  if (!result?.ok) {
    if (els.sessionModalError) els.sessionModalError.textContent = result?.error || 'Could not start session';
    return;
  }
  applySession(result);
  showToast(result.label || 'Session started');
  const shouldStart = pendingStartAfterSession;
  pendingStartAfterSession = false;
  els.autoStopModal.hidden = true;
  if (shouldStart) await startBridgeNow();
}

async function init() {
  const config = await api.loadConfig();
  fillForm(config);
  updateCatalogBanner();

  api.onStatus(renderLive);
  renderLive(await api.getStatus());

  const session = await refreshSession();
  if (!session.active) openSessionModal({ force: true });
  if (sessionTickTimer) clearInterval(sessionTickTimer);
  sessionTickTimer = setInterval(() => {
    if (sessionActive) void refreshSession();
  }, 30_000);

  if (api.onSession) {
    api.onSession((state) => {
      applySession(state);
      if (state?.ended) {
        window.rosCueSocket?.stopCueSocket?.();
        els.autoStopNoticeText.textContent = state.reason || 'Bridge stopped after the session timer ended.';
        els.autoStopNotice.hidden = false;
        showToast(state.reason || 'Session ended — bridge stopped', false);
        openSessionModal({ force: true });
        void api.getStatus().then(renderLive).catch(() => {});
      }
    });
  }

  document.querySelectorAll('input[name="sessionMode"]').forEach((input) => {
    input.addEventListener('change', syncSessionModeUi);
  });

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
        cueColumn: last.cueColumn,
        dayFilter: last.dayFilter,
        feedUrl: last.feedUrl,
        csvHeaderIsDataRow: last.csvHeaderIsDataRow,
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

  els.pollSeconds.addEventListener('change', () => {
    els.pollSeconds.value = String(clampPoll(els.pollSeconds.value));
    syncPollPresetButtons();
  });
  els.pollSeconds.addEventListener('input', syncPollPresetButtons);

  document.querySelectorAll('#poll-presets [data-poll]').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.pollSeconds.value = btn.getAttribute('data-poll');
      syncPollPresetButtons();
    });
  });

  document.getElementById('btn-validate-api').addEventListener('click', async () => {
    const result = await api.validateApi(readForm());
    showToast(result.message || (result.ok ? 'OK' : 'Failed'), !result.ok);
  });

  document.getElementById('btn-test-socket')?.addEventListener('click', async () => {
    const form = readForm();
    if (!window.rosCueSocket?.testCueSocket) {
      showToast('Socket test unavailable', true);
      return;
    }
    showToast('Testing browser Socket.IO…');
    const result = await window.rosCueSocket.testCueSocket(form);
    showToast(result.message || (result.ok ? 'OK' : 'Failed'), !result.ok);
  });

  document.getElementById('btn-load-events').addEventListener('click', async () => {
    const result = await api.listEvents(readForm());
    if (!result.ok) {
      showToast(result.message || 'Failed to load events', true);
      return;
    }
    loadedEvents = result.events || [];
    renderEventSelect(els.eventId.value.trim());
    const visible = filterAndSortEvents(loadedEvents, eventFilter).length;
    showToast(`Loaded ${loadedEvents.length} events · ${visible} ${eventFilter}`);
  });

  document.querySelectorAll('.event-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      setEventFilter(btn.getAttribute('data-event-filter') || 'upcoming');
    });
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

  document.getElementById('btn-start').addEventListener('click', () => {
    if (!sessionActive) {
      openSessionModal({ force: true, startAfter: true });
      return;
    }
    void startBridgeNow();
  });

  if (els.btnSession) {
    els.btnSession.addEventListener('click', () => openSessionModal({ force: true }));
  }

  document.getElementById('btn-auto-stop-confirm').addEventListener('click', () => {
    void confirmSessionAndMaybeStart();
  });

  if (els.btnSessionCancel) {
    els.btnSessionCancel.addEventListener('click', () => closeSessionModal());
  }

  document.getElementById('btn-auto-stop-restart').addEventListener('click', () => {
    els.autoStopNotice.hidden = true;
    openSessionModal({ force: true, startAfter: true });
  });

  els.autoStopModal.addEventListener('click', (e) => {
    if (e.target === els.autoStopModal && sessionActive) closeSessionModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.autoStopModal.hidden && sessionActive) closeSessionModal();
  });

  document.getElementById('btn-stop').addEventListener('click', async () => {
    els.autoStopNotice.hidden = true;
    await performStop({ auto: false });
    showToast('Stopped');
  });

  document.getElementById('btn-resync').addEventListener('click', async () => {
    if (!sessionActive) {
      openSessionModal({ force: true });
      showToast('Choose a session length first', true);
      return;
    }
    const result = await api.resync();
    showToast(result.message || (result.ok ? 'Resync OK' : 'Resync failed'), !result.ok);
  });
}

init().catch((err) => {
  showToast(err.message || String(err), true);
});
