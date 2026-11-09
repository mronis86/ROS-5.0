const os = require('os');
const { execFile } = require('child_process');
const path = require('path');
const weblinked = require('./weblinked');
const offlineShow = require('./offline-show');

/** @type {{ idle: number, total: number } | null} */
let lastCpuSample = null;

function sampleCpuPercent() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    for (const value of Object.values(times)) total += Number(value) || 0;
    idle += Number(times.idle) || 0;
  }
  const prev = lastCpuSample;
  lastCpuSample = { idle, total };
  if (!prev || total <= prev.total) return null;
  const idleDelta = idle - prev.idle;
  const totalDelta = total - prev.total;
  if (totalDelta <= 0) return null;
  const busy = 1 - idleDelta / totalDelta;
  return Math.round(Math.min(100, Math.max(0, busy * 100)) * 10) / 10;
}

function formatBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function runPowerShell(command, timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        // Get-Process still exits non-zero when one name is missing, but stdout
        // can still hold the processes that were found — prefer that payload.
        const text = String(stdout || '').trim();
        if (text) {
          resolve(text);
          return;
        }
        resolve(err ? null : '');
      }
    );
  });
}

/**
 * Working-set MB for processes the kiosk typically owns.
 * Best-effort on Windows; returns zeros elsewhere.
 */
async function sampleRelatedProcessMemory() {
  if (process.platform !== 'win32') {
    return {
      weblinkedMb: 0,
      electronMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      nodeShowMb: 0,
      relatedMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    };
  }

  // Prefer names that usually exist so Get-Process does not fail the whole list.
  const script =
    "Get-Process sinor-weblinked,electron,node -ErrorAction SilentlyContinue | Select-Object Name,Id,WorkingSet64 | ConvertTo-Json -Compress";

  const raw = await runPowerShell(script);
  let rows = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rows = [];
    }
  }

  let weblinkedBytes = 0;
  let electronBytes = 0;
  let nodeBytes = 0;
  for (const row of rows) {
    const name = String(row?.Name || '').toLowerCase();
    const ws = Number(row?.WorkingSet64) || 0;
    if (name.includes('weblinked')) weblinkedBytes += ws;
    else if (name === 'electron') electronBytes += ws;
    else if (name === 'node') nodeBytes += ws;
  }

  // Always count this process even if Get-Process missed it.
  const selfRss = process.memoryUsage().rss || 0;
  if (electronBytes < selfRss) electronBytes = selfRss;

  // "Kiosk stack" = Electron shell + WebLinked only. Do not sum every node.exe
  // on the machine (dev PCs often have many unrelated Node processes).
  const related = weblinkedBytes + electronBytes;
  const toMb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
  return {
    weblinkedMb: toMb(weblinkedBytes),
    electronMb: toMb(electronBytes),
    nodeShowMb: toMb(nodeBytes),
    relatedMb: toMb(related),
  };
}

function rankLevel(parts) {
  const order = { ok: 0, warn: 1, hot: 2 };
  let level = 'ok';
  for (const part of parts) {
    if ((order[part] || 0) > (order[level] || 0)) level = part;
  }
  return level;
}

/**
 * Snapshot used by the Status tab performance meter.
 */
async function getSystemHealth() {
  const cpuPercent = sampleCpuPercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const memPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0;

  let wlRunning = false;
  let wlSources = 0;
  let wlSourceIds = [];
  let wlError = '';
  try {
    const status = await weblinked.getStatus();
    wlRunning = Boolean(status?.running);
    if (wlRunning && typeof weblinked.listSources === 'function') {
      const listed = await weblinked.listSources();
      wlSourceIds = Array.isArray(listed?.ids) ? listed.ids : [];
      wlSources = wlSourceIds.length;
    }
  } catch (e) {
    wlError = e instanceof Error ? e.message : 'WebLinked status failed';
  }

  let showRunning = false;
  try {
    const show = await offlineShow.getStatus();
    showRunning = Boolean(show?.running);
  } catch {
    showRunning = false;
  }

  const procs = await sampleRelatedProcessMemory();
  const self = process.memoryUsage();

  const tips = [];
  const levels = [];

  if (cpuPercent == null) {
    /* first sample — no delta yet */
  } else if (cpuPercent >= 90) {
    levels.push('hot');
    tips.push('CPU is very high — close RemoteOp or unused display sources.');
  } else if (cpuPercent >= 70) {
    levels.push('warn');
    tips.push('CPU is elevated — WebLinked sources and live preview add load.');
  } else {
    levels.push('ok');
  }

  if (memPercent >= 90) {
    levels.push('hot');
    tips.push('System RAM is nearly full — Clear WL on idle cards.');
  } else if (memPercent >= 75) {
    levels.push('warn');
    tips.push('System RAM is getting tight.');
  } else {
    levels.push('ok');
  }

  if (wlSources >= 6) {
    levels.push('hot');
    tips.push(`${wlSources} WebLinked sources — each is a full browser + outputs.`);
  } else if (wlSources >= 4) {
    levels.push('warn');
    tips.push(`${wlSources} WebLinked sources running at once.`);
  }

  if (procs.relatedMb >= 2500) {
    levels.push('hot');
    tips.push(`Kiosk + WebLinked ~${Math.round(procs.relatedMb)} MB RAM.`);
  } else if (procs.relatedMb >= 1200) {
    levels.push('warn');
    tips.push(`Kiosk + WebLinked ~${Math.round(procs.relatedMb)} MB RAM.`);
  }

  if (!tips.length) {
    tips.push(
      wlRunning
        ? 'Load looks manageable for this machine.'
        : 'Start WebLinked / Offline Show when you need outputs.'
    );
  }

  const level = rankLevel(levels);
  const label =
    level === 'hot' ? 'Overloaded' : level === 'warn' ? 'Busy' : 'Healthy';

  return {
    ok: true,
    at: new Date().toISOString(),
    level,
    label,
    tips: tips.slice(0, 3),
    host: {
      platform: process.platform,
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      cpuPercent,
      memPercent,
      memUsedBytes: usedMem,
      memTotalBytes: totalMem,
      memUsedLabel: formatBytes(usedMem),
      memTotalLabel: formatBytes(totalMem),
    },
    processes: {
      ...procs,
      kioskRssMb: Math.round((self.rss / 1024 / 1024) * 10) / 10,
      kioskHeapMb: Math.round((self.heapUsed / 1024 / 1024) * 10) / 10,
    },
    weblinked: {
      running: wlRunning,
      sources: wlSources,
      sourceIds: wlSourceIds,
      error: wlError || undefined,
    },
    offlineShow: {
      running: showRunning,
    },
  };
}

module.exports = {
  getSystemHealth,
  formatBytes,
};
