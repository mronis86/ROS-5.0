const { normalizeBaseUrl } = require('./auth-session');
const {
  getRunOfShowData,
  getActiveTimer,
  listCalendarEvents,
  validateApi,
} = require('./railway-client');
const vmix = require('./vmix-client');
const { resolveRowIndex } = require('./row-matcher');

/**
 * Orchestrates Railway cue follow → row match → vMix DataSourceSelectRow.
 *
 * Cue detection matches Companion: REST poll /api/active-timers (Chromium net.fetch).
 * Optional live Socket.IO runs in the *renderer* (browser stack, same as the web app)
 * and forwards cues here via IPC — Node socket.io in main is avoided (XHR poll / TLS issues).
 */
class BridgeController {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.config = null;
    this.pollTimer = null;
    this.scheduleItems = [];
    this.lastItemId = null;
    this.lastSelectKey = '';
    this.status = this.emptyStatus();
  }

  emptyStatus() {
    return {
      running: false,
      railway: { ok: false, message: 'Not started' },
      socket: {
        ok: false,
        message: 'Renderer Socket.IO idle — REST poll is primary (same as Companion)',
      },
      vmix: { ok: false, message: 'Not tested' },
      cue: null,
      matches: [],
      lastError: null,
      updatedAt: null,
    };
  }

  emit() {
    this.status.running = this.running;
    this.status.updatedAt = new Date().toISOString();
    this.onStatus({ ...this.status });
  }

  async refreshSchedule() {
    const { apiBaseUrl, apiToken, eventId } = this.config;
    const data = await getRunOfShowData(apiBaseUrl, apiToken, eventId);
    this.scheduleItems = Array.isArray(data?.schedule_items) ? data.schedule_items : [];
    this.status.railway = {
      ok: true,
      message: `Schedule loaded (${this.scheduleItems.length} items)`,
      eventId,
    };
  }

  setSocketStatus(partial) {
    this.status.socket = {
      ...(this.status.socket || {}),
      ...(partial || {}),
    };
    this.resyncPollInterval();
    this.emit();
  }

  async applyCue(itemId, timerRow = {}) {
    if (!this.running || !this.config) return;
    const id = parseInt(String(itemId), 10);
    if (!Number.isFinite(id)) return;

    this.lastItemId = id;
    this.status.cue = {
      itemId: id,
      cueIs: timerRow.cue_is || timerRow.cueIs || null,
      timerState: timerRow.timer_state || null,
      isRunning: timerRow.is_running,
    };

    const bindings = (Array.isArray(this.config.bindings) ? this.config.bindings : []).filter(
      (b) => b && b.enabled !== false
    );
    const matches = [];

    if (!bindings.length) {
      this.status.matches = [
        { ok: false, message: 'No enabled Data Source bindings — turn some on in the Sources tab' },
      ];
      this.emit();
      return;
    }

    for (const binding of bindings) {
      if (!binding?.dataSourceName) {
        matches.push({
          bindingId: binding.id,
          label: binding.label || undefined,
          ok: false,
          message: 'Data Source name is empty',
        });
        continue;
      }

      const resolved = resolveRowIndex(binding.matchMode || 'cueColumn', {
        scheduleItems: this.scheduleItems,
        itemId: id,
        timerRow,
        dayFilter: binding.dayFilter,
        cueColumn: binding.cueColumn,
      });

      if (!resolved.ok) {
        matches.push({
          bindingId: binding.id,
          label: binding.label || undefined,
          dataSourceName: binding.dataSourceName,
          tableName: binding.tableName || '',
          ok: false,
          mode: binding.matchMode,
          message: resolved.message,
        });
        continue;
      }

      const selectKey = `${binding.dataSourceName}|${binding.tableName || ''}|${resolved.index}|${id}`;

      try {
        const result = await vmix.selectRow(
          this.config.vmixHost,
          this.config.vmixPort,
          binding.dataSourceName,
          binding.tableName,
          resolved.index
        );
        this.lastSelectKey = selectKey;
        const sheetBit = binding.tableName ? ` / ${binding.tableName}` : '';
        this.status.vmix = {
          ok: true,
          message: `Selected index ${resolved.index} on "${binding.dataSourceName}${sheetBit}"`,
          lastUrl: result.url,
          lastValue: result.value,
        };
        matches.push({
          bindingId: binding.id,
          label: binding.label || undefined,
          dataSourceName: binding.dataSourceName,
          tableName: binding.tableName || '',
          ok: true,
          mode: resolved.mode,
          index: resolved.index,
          cueValue: resolved.cueValue,
          message: resolved.message,
          vmixUrl: result.url,
        });
      } catch (err) {
        this.status.vmix = {
          ok: false,
          message: err.message || 'vMix select failed',
          lastUrl: err.url,
        };
        matches.push({
          bindingId: binding.id,
          label: binding.label || undefined,
          dataSourceName: binding.dataSourceName,
          tableName: binding.tableName || '',
          ok: false,
          mode: resolved.mode,
          index: resolved.index,
          message: err.message || 'vMix select failed',
        });
        this.status.lastError = err.message;
      }
    }

    this.status.matches = matches;
    this.status.railway = {
      ...(this.status.railway || {}),
      ok: true,
      message: this.status.railway?.message || 'OK',
    };
    this.emit();
  }

  async pollOnce() {
    if (!this.running || !this.config) return;
    try {
      const row = await getActiveTimer(
        this.config.apiBaseUrl,
        this.config.apiToken,
        this.config.eventId
      );
      if (!row) return;
      const state = row.timer_state;
      if (state !== 'loaded' && state !== 'running') return;
      const itemId = row.item_id != null ? parseInt(String(row.item_id), 10) : NaN;
      if (!Number.isFinite(itemId)) return;
      if (itemId === this.lastItemId && this.status.matches?.some((m) => m.ok)) {
        this.status.cue = {
          itemId,
          cueIs: row.cue_is || null,
          timerState: state,
          isRunning: row.is_running,
        };
        this.emit();
        return;
      }
      await this.applyCue(itemId, row);
    } catch (err) {
      this.status.railway = {
        ok: false,
        message: err.message || 'active-timers poll failed',
      };
      this.status.lastError = err.message;
      this.emit();
    }
  }

  async start(config) {
    await this.stop();
    this.config = { ...config };
    this.running = true;
    this.lastItemId = null;
    this.lastSelectKey = '';
    this.status = this.emptyStatus();
    this.status.running = true;
    this.status.socket = {
      ok: false,
      message: 'Waiting for renderer Socket.IO (optional) — REST poll active',
    };

    if (!this.config.eventId) {
      this.running = false;
      return { ok: false, message: 'Event ID is required' };
    }

    try {
      const vmixTest = await vmix.testConnection(this.config.vmixHost, this.config.vmixPort);
      this.status.vmix = {
        ok: vmixTest.ok,
        message: vmixTest.message,
        dataSourceNames: vmixTest.dataSourceNames,
      };
      if (!vmixTest.ok) {
        this.running = false;
        this.emit();
        return { ok: false, message: vmixTest.message };
      }
    } catch (err) {
      this.running = false;
      this.status.vmix = { ok: false, message: err.message };
      this.emit();
      return { ok: false, message: err.message };
    }

    try {
      await this.refreshSchedule();
    } catch (err) {
      this.running = false;
      this.status.railway = { ok: false, message: err.message || 'Failed to load schedule' };
      this.emit();
      return { ok: false, message: err.message || 'Failed to load schedule' };
    }

    this.resyncPollInterval();
    await this.pollOnce();
    this.emit();
    return {
      ok: true,
      message: 'Bridge running (REST poll + optional browser Socket.IO)',
      socketFollow: {
        apiBaseUrl: normalizeBaseUrl(this.config.apiBaseUrl),
        eventId: this.config.eventId,
        apiToken: this.config.apiToken || '',
      },
    };
  }

  resyncPollInterval() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.running || !this.config) return;
    const socketOk = this.status?.socket?.ok === true;
    const configured = Math.min(60, Math.max(1, Number(this.config.pollSeconds) || 1));
    // User poll interval is authoritative. With live Socket.IO, poll is only a slower safety net.
    const seconds = socketOk ? Math.max(configured, 5) : configured;
    this.pollTimer = setInterval(() => void this.pollOnce(), seconds * 1000);
  }

  async stop() {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.status.running = false;
    this.status.socket = { ok: false, message: 'Stopped' };
    this.emit();
    return { ok: true, stopSocketFollow: true };
  }

  async resync() {
    if (!this.running || !this.config) {
      return { ok: false, message: 'Bridge is not running' };
    }
    try {
      await this.refreshSchedule();
      this.lastItemId = null;
      this.lastSelectKey = '';
      await this.pollOnce();
      return { ok: true, message: 'Resync complete' };
    } catch (err) {
      return { ok: false, message: err.message || 'Resync failed' };
    }
  }

  getStatus() {
    return { ...this.status, running: this.running };
  }
}

module.exports = {
  BridgeController,
  listCalendarEvents,
  validateApi,
  vmix,
};
