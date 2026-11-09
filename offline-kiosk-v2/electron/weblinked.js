const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const { weblinkedRoot, isPackaged, resourcesRoot } = require('./runtime-paths');
const { wlLog, wlWarn, wlError, logPath, readTail } = require('./kiosk-log');

/**
 * Sinor WebLinked-SDI defaults HTTP control to :7655.
 * Stock upstream WebLinked uses :7654 (OSC on :7655).
 * Probe Sinor first, then stock.
 */
const CANDIDATE_PORTS = [7655, 7654];

let resolvedBase = null;
let enginePid = null;
let startedByKiosk = false;
/** Prevents a second Start from killing a cold CEF boot still coming up. */
let startInFlight = null;

function engineProcessAlive() {
  for (const image of ['sinor-weblinked.exe', 'weblinked.exe']) {
    try {
      const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], {
        windowsHide: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (String(out).toLowerCase().includes(image.toLowerCase())) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function bundledRoot() {
  return weblinkedRoot();
}

function candidateExePaths() {
  const bundled = bundledRoot();
  const desktopRelease = path.join(
    os.homedir(),
    'OneDrive',
    'Desktop',
    'WebLinked-SDI',
    'build',
    'Release'
  );
  const desktopReleaseAlt = path.join(os.homedir(), 'Desktop', 'WebLinked-SDI', 'build', 'Release');

  const paths = [
    process.env.WEBLINKED_EXE,
    // Bundled with Offline Kiosk V2 (preferred for show-system packaging)
    path.join(bundled, 'sinor-weblinked.exe'),
    path.join(bundled, 'weblinked.exe'),
  ];

  // Dev-only fallbacks — portable builds must ship engines/weblinked
  if (!isPackaged()) {
    paths.push(
      path.join(desktopRelease, 'sinor-weblinked.exe'),
      path.join(desktopRelease, 'weblinked.exe'),
      path.join(desktopReleaseAlt, 'sinor-weblinked.exe'),
      path.join(desktopReleaseAlt, 'weblinked.exe'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'WebLinked', 'weblinked.exe'),
      path.join(
        process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        'WebLinked',
        'weblinked.exe'
      )
    );
  }

  return paths.filter(Boolean);
}

function findExe() {
  for (const p of candidateExePaths()) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function defaultHttpPortForExe(exePath) {
  const base = path.basename(exePath || '').toLowerCase();
  // Sinor build defaults --port 7655
  if (base.includes('sinor')) return 7655;
  return 7654;
}

function requestJson(baseUrl, urlPath, { method = 'GET', body = null, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      `${baseUrl}${urlPath}`,
      {
        method,
        timeout: timeoutMs,
        headers:
          payload == null
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': payload.length,
              },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(
              (data && data.error) || `HTTP ${res.statusCode} for ${urlPath}`
            );
            err.statusCode = res.statusCode;
            err.data = data;
            reject(err);
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout talking to WebLinked (${urlPath})`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probePort(port) {
  const base = `http://127.0.0.1:${port}`;
  for (const p of ['/api/sources', '/api/state', '/api/url']) {
    try {
      await requestJson(base, p, { timeoutMs: 900 });
      return base;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function resolveBase({ force = false } = {}) {
  if (!force && resolvedBase) {
    try {
      await requestJson(resolvedBase, '/api/sources', { timeoutMs: 800 });
      return resolvedBase;
    } catch {
      try {
        await requestJson(resolvedBase, '/api/state', { timeoutMs: 800 });
        return resolvedBase;
      } catch {
        resolvedBase = null;
      }
    }
  }

  for (const port of CANDIDATE_PORTS) {
    const base = await probePort(port);
    if (base) {
      resolvedBase = base;
      return base;
    }
  }
  resolvedBase = null;
  return null;
}

async function isRunning() {
  return Boolean(await resolveBase({ force: true }));
}

function missingRuntimeError() {
  const root = bundledRoot();
  if (isPackaged()) {
    return `WebLinked runtime missing under ${root}. Re-download Offline Kiosk Portable (not the small install zip).`;
  }
  return `WebLinked runtime not found in ${root}. The small install zip does not include WebLinked — use Offline Kiosk Portable, or on a build PC run: npm run sync:weblinked`;
}

function collectDiagnostics() {
  const root = bundledRoot();
  const exe = findExe();
  const libcef = path.join(root, 'libcef.dll');
  const locales = path.join(root, 'locales', 'en-US.pak');
  return {
    packaged: isPackaged(),
    resourcesRoot: resourcesRoot(),
    weblinkedRoot: root,
    exe,
    exeExists: Boolean(exe && fs.existsSync(exe)),
    libcefExists: fs.existsSync(libcef),
    localesExists: fs.existsSync(locales),
    engineAlive: engineProcessAlive(),
    resolvedBase,
    enginePid,
    logPath: logPath('weblinked'),
    candidates: candidateExePaths().map((p) => ({ path: p, exists: fs.existsSync(p) })),
  };
}

async function getStatus() {
  const exe = findExe();
  const base = await resolveBase({ force: true });
  if (!base) {
    return {
      ok: false,
      running: false,
      baseUrl: null,
      port: null,
      exe,
      startedByKiosk,
      logPath: logPath('weblinked'),
      diagnostics: collectDiagnostics(),
      error: exe ? 'WebLinked installed/bundled but not running' : missingRuntimeError(),
    };
  }
  const port = Number(new URL(base).port) || null;
  let sources = null;
  try {
    sources = await requestJson(base, '/api/sources', { timeoutMs: 2500 });
  } catch {
    sources = null;
  }
  return {
    ok: true,
    running: true,
    baseUrl: base,
    port,
    exe,
    startedByKiosk,
    sources,
    logPath: logPath('weblinked'),
  };
}

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Clear Mark-of-the-Web so SmartScreen / MOTW does not hang first launch. */
function unblockWebLinkedRuntime(exePath) {
  const dir = path.dirname(exePath);
  wlLog('unblock runtime', { dir });
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Get-ChildItem -LiteralPath ${psQuote(dir)} -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue`,
      ],
      { windowsHide: true, stdio: 'ignore', timeout: 15000 }
    );
  } catch (e) {
    wlWarn('unblock failed (continuing)', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  // Also strip Zone.Identifier ADS if present on the exe / libcef.
  for (const name of [path.basename(exePath), 'libcef.dll', 'chrome_elf.dll']) {
    const zone = `${path.join(dir, name)}:Zone.Identifier`;
    try {
      if (fs.existsSync(zone)) fs.unlinkSync(zone);
    } catch {
      /* ignore */
    }
  }
}

/** sinor-weblinked.exe is a CONSOLE-subsystem binary — Node spawn still flashes a terminal. */
function killOrphanEngines() {
  for (const image of ['sinor-weblinked.exe', 'weblinked.exe']) {
    try {
      execFileSync('taskkill', ['/F', '/IM', image, '/T'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      /* not running */
    }
  }
  enginePid = null;
  startedByKiosk = false;
  resolvedBase = null;
}

function engineLaunchArgs(port) {
  return [
    '--port',
    String(port),
    '--no-open',
    '--headless',
    '--disable-direct-composition',
  ];
}

function findRunningEnginePid() {
  for (const image of ['sinor-weblinked.exe', 'weblinked.exe']) {
    try {
      const out = execFileSync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const line = String(out)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().includes(image.toLowerCase()));
      if (!line) continue;
      // "sinor-weblinked.exe","1234","Session Name","Session#","Mem Usage"
      const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''));
      const pid = Number(cols[1]);
      if (Number.isFinite(pid) && pid > 0) return pid;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Hidden launch for CONSOLE-subsystem exe (avoids terminal windows). */
function spawnEngineVbsHidden(exe, port) {
  const args = engineLaunchArgs(port).join(' ');
  const cwd = path.dirname(exe);
  const vbsPath = path.join(
    os.tmpdir(),
    `ros-wl-launch-${process.pid}-${Date.now()}.vbs`
  );
  // WindowStyle 0 = hidden. Quote paths for WScript.Shell.Run.
  const runCmd = `"${exe}" ${args}`.replace(/"/g, '""');
  const vbs = [
    'On Error Resume Next',
    'Dim sh',
    'Set sh = CreateObject("WScript.Shell")',
    // VBS treats \ as literal — only double quotes need escaping.
    `sh.CurrentDirectory = "${cwd.replace(/"/g, '""')}"`,
    `sh.Run "${runCmd}", 0, False`,
  ].join('\r\n');
  fs.writeFileSync(vbsPath, vbs, 'utf8');
  wlLog('spawn vbs hidden', { exe, cwd, port, vbsPath });

  const child = spawn('wscript.exe', ['//B', '//Nologo', vbsPath], {
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
    shell: false,
  });
  child.unref();
  setTimeout(() => {
    try {
      fs.unlinkSync(vbsPath);
    } catch {
      /* ignore */
    }
  }, 5000);
  return { port: Number(port), method: 'vbs-hidden' };
}

function spawnEngineDirect(exe, port) {
  const args = engineLaunchArgs(port);
  wlLog('spawn direct', { exe, cwd: path.dirname(exe), args });
  const child = spawn(exe, args, {
    cwd: path.dirname(exe),
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
    shell: false,
  });
  child.unref();
  if (!child.pid) {
    throw new Error('Direct spawn returned no PID');
  }
  enginePid = child.pid;
  startedByKiosk = true;
  return { pid: child.pid, port: Number(port), method: 'direct' };
}

function spawnEnginePowerShell(exe, port, { timeoutMs = 8000 } = {}) {
  // No -PassThru: returns immediately after create (avoids MOTW hang on PassThru).
  const argList = engineLaunchArgs(port).map(psQuote).join(', ');
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `Start-Process -FilePath ${psQuote(exe)} -WorkingDirectory ${psQuote(path.dirname(exe))} -ArgumentList @(${argList}) -WindowStyle Hidden`,
  ].join('; ');

  wlLog('spawn powershell hidden', { exe, cwd: path.dirname(exe), port, timeoutMs });

  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      }
    );

    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`PowerShell Start-Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ port: Number(port), method: 'powershell-hidden' });
        return;
      }
      reject(
        new Error(
          stderr.trim() ||
            `WebLinked launch failed (PowerShell exit ${code == null ? '?' : code})`
        )
      );
    });
  });
}

async function finalizeSpawn(launched, port) {
  await sleep(400);
  const pid = findRunningEnginePid() || launched?.pid || null;
  if (pid) enginePid = pid;
  startedByKiosk = true;
  if (!engineProcessAlive()) {
    throw new Error(`WebLinked did not stay running after ${launched?.method || 'launch'}`);
  }
  return { pid: enginePid, port: Number(port), method: launched?.method || 'unknown' };
}

async function spawnEngine(exe) {
  const port = defaultHttpPortForExe(exe);
  unblockWebLinkedRuntime(exe);

  // Prefer hidden launchers so CONSOLE-subsystem sinor-weblinked.exe does not
  // open terminal windows. Direct spawn is last resort (works but shows consoles).
  const errors = [];

  try {
    const launched = spawnEngineVbsHidden(exe, port);
    return await finalizeSpawn(launched, port);
  } catch (e) {
    errors.push(`vbs: ${e instanceof Error ? e.message : String(e)}`);
    wlWarn('VBS hidden spawn failed', { error: errors[errors.length - 1] });
  }

  try {
    const launched = await spawnEnginePowerShell(exe, port, { timeoutMs: 8000 });
    return await finalizeSpawn(launched, port);
  } catch (e) {
    errors.push(`powershell: ${e instanceof Error ? e.message : String(e)}`);
    wlWarn('PowerShell hidden spawn failed', { error: errors[errors.length - 1] });
  }

  try {
    const launched = spawnEngineDirect(exe, port);
    return await finalizeSpawn(launched, port);
  } catch (e) {
    errors.push(`direct: ${e instanceof Error ? e.message : String(e)}`);
    throw new Error(errors.join(' | '));
  }
}

async function waitUntilReady(timeoutMs = 90000) {
  const start = Date.now();
  let lastBeat = 0;
  while (Date.now() - start < timeoutMs) {
    if (await isRunning()) return true;
    const elapsed = Date.now() - start;
    if (elapsed - lastBeat >= 5000) {
      lastBeat = elapsed;
      wlLog('waiting for API', {
        elapsedMs: elapsed,
        alive: engineProcessAlive(),
        ports: CANDIDATE_PORTS,
      });
    }
    await sleep(500);
  }
  return false;
}

async function startWebLinked({ force = false } = {}) {
  if (startInFlight) {
    wlLog('start joined in-flight request');
    return startInFlight;
  }

  startInFlight = (async () => {
    const diag = collectDiagnostics();
    wlLog('start begin', { force, ...diag });

    if (!force && (await isRunning())) {
      const status = await getStatus();
      wlLog('already running', { baseUrl: status.baseUrl });
      return { ok: true, alreadyRunning: true, ...status };
    }

    const exe = findExe();
    if (!exe) {
      const error = missingRuntimeError();
      wlError('exe missing', diag);
      return {
        ok: false,
        error,
        logPath: logPath('weblinked'),
        diagnostics: diag,
      };
    }

    // Fresh/forced start only — do not kill a boot already in progress from a double-click.
    killOrphanEngines();
    await sleep(400);

    let launched;
    try {
      launched = await spawnEngine(exe);
      wlLog('spawn ok', launched);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Failed to start WebLinked';
      wlError('spawn failed', { error, exe });
      return {
        ok: false,
        error,
        exe,
        logPath: logPath('weblinked'),
        diagnostics: collectDiagnostics(),
      };
    }

    // CEF cold-starts slowly the first time after unzip / AV scan — give it time.
    let ready = await waitUntilReady(90000);
    if (!ready && engineProcessAlive()) {
      wlWarn('API not ready yet but process alive — extending wait');
      ready = await waitUntilReady(45000);
    }
    if (!ready) {
      const alive = engineProcessAlive();
      const error = alive
        ? `WebLinked process is up but control API did not answer on :${CANDIDATE_PORTS.join(' / :')} yet — wait a few seconds and press Start again (or check AV blocking CEF).`
        : `WebLinked failed to stay running after launch (exe=${path.basename(exe)}). Check ${logPath('weblinked')}`;
      wlError('start timeout', { alive, exe, launched, diagnostics: collectDiagnostics() });
      return {
        ok: false,
        error,
        exe,
        enginePid: launched?.pid || enginePid,
        logPath: logPath('weblinked'),
        diagnostics: collectDiagnostics(),
      };
    }

    const status = await getStatus();
    wlLog('start ok', { baseUrl: status.baseUrl, method: launched?.method, pid: launched?.pid });
    return {
      ok: true,
      alreadyRunning: false,
      startedByKiosk: true,
      enginePid: launched?.pid || enginePid,
      ...status,
    };
  })();

  try {
    return await startInFlight;
  } finally {
    startInFlight = null;
  }
}

function getWebLinkedLog() {
  return readTail('weblinked');
}

/**
 * Require an already-running WebLinked. Never auto-starts the engine —
 * operators must press Start WebLinked; Push / Preview / Settings only work after that.
 */
async function ensureRunning() {
  if (await isRunning()) return { ok: true, ...(await getStatus()) };
  return {
    ok: false,
    running: false,
    error: 'WebLinked is not running. Start WebLinked on the Displays tab first.',
  };
}

async function stopWebLinked() {
  const wasRunning = await isRunning();
  killOrphanEngines();
  await sleep(300);
  const stillUp = await isRunning();
  return {
    ok: !stillUp,
    stopped: wasRunning && !stillUp,
    alreadyStopped: !wasRunning,
    running: stillUp,
    error: stillUp ? 'WebLinked still answering after stop' : undefined,
  };
}

function normalizePageUrl(u) {
  const raw = String(u || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    let path = parsed.pathname || '/';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

/** WebLinked source ids: letters, digits, _ and - only. */
function sanitizeSourceId(id) {
  const cleaned = String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || null;
}

function withSourceQuery(urlPath, source) {
  const id = sanitizeSourceId(source);
  if (!id) return urlPath;
  const join = urlPath.includes('?') ? '&' : '?';
  return `${urlPath}${join}source=${encodeURIComponent(id)}`;
}

async function listSources() {
  const base = await resolveBase({ force: true });
  if (!base) return { ok: false, error: 'WebLinked control API not reachable', sources: [] };
  try {
    const data = await requestJson(base, '/api/sources', { timeoutMs: 4000 });
    const sources = Array.isArray(data?.sources) ? data.sources : [];
    return {
      ok: true,
      baseUrl: base,
      primary: data?.primary || null,
      sources,
      ids: sources.map((s) => s?.id).filter(Boolean),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to list WebLinked sources',
      sources: [],
      ids: [],
    };
  }
}

/**
 * One WebLinked source per display card (multi-source). Independent URL + NDI
 * per card — same model as WebLinked-SDI `--config` / /api/sources/add.
 */
async function ensureDisplaySource(
  sourceId,
  { url = 'about:blank', format = '1080p50', previewFactor = 4 } = {}
) {
  const id = sanitizeSourceId(sourceId);
  if (!id) return { ok: false, error: 'Missing WebLinked source id' };

  const base = await resolveBase({ force: true });
  if (!base) {
    return { ok: false, error: 'WebLinked control API not reachable' };
  }

  const listed = await listSources();
  if (!listed.ok && listed.sources.length === 0) {
    /* /api/sources may 404 on very old builds — fall through to add */
  }
  if ((listed.ids || []).includes(id)) {
    return { ok: true, created: false, baseUrl: base, source: id };
  }

  const factor = [1, 2, 4, 8].includes(Number(previewFactor)) ? Number(previewFactor) : 4;
  try {
    await requestJson(base, '/api/sources/add', {
      method: 'POST',
      body: {
        source: {
          id,
          url: url || 'about:blank',
          format: format || '1080p50',
          outputs: [{ kind: 'preview', name: 'preview', options: { factor } }],
        },
      },
      timeoutMs: 12000,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/409|duplicate|already/i.test(msg)) {
      return { ok: false, error: msg || 'Failed to create WebLinked source', baseUrl: base };
    }
  }

  // Drop leftover idle "main" from older kiosk boots so its NDI does not clash.
  const after = await listSources();
  if ((after.ids || []).includes('main') && id !== 'main') {
    const onlyMainPlusUs =
      after.ids.every((sid) => sid === 'main' || sid === id) && after.ids.includes(id);
    if (onlyMainPlusUs) {
      try {
        await requestJson(base, '/api/sources/remove', {
          method: 'POST',
          body: { id: 'main' },
          timeoutMs: 8000,
        });
      } catch {
        /* keep going — display source is up */
      }
    }
  }

  return { ok: true, created: true, baseUrl: base, source: id };
}

async function setUrl(url, { source = null, ensure = true, force = false } = {}) {
  if (ensure) {
    const ready = await ensureRunning();
    if (!ready.ok) return ready;
  }

  const sourceId = sanitizeSourceId(source);
  if (sourceId) {
    const ensured = await ensureDisplaySource(sourceId, { url });
    if (!ensured.ok) return ensured;
  }

  const base = await resolveBase();
  if (!base) {
    return {
      ok: false,
      error: 'WebLinked is not running. Use Start WebLinked on the Displays tab.',
    };
  }

  // WebLinked CEF LoadURL always navigates — even to the same address — so the
  // control page only POSTs /api/url when the operator clicks Load. Match that.
  const wanted = normalizePageUrl(url);
  if (!force && wanted) {
    try {
      const state = await requestJson(base, withSourceQuery('/api/state', sourceId), {
        timeoutMs: 4000,
      });
      const loaded = normalizePageUrl(state?.source?.loaded_url || '');
      const configured = normalizePageUrl(state?.source?.url || '');
      if (loaded === wanted || configured === wanted) {
        return {
          ok: true,
          baseUrl: base,
          url,
          source: sourceId,
          skipped: true,
          reason: 'already-loaded',
          data: { ok: true },
        };
      }
    } catch {
      /* fall through and set */
    }
  }

  try {
    const data = await requestJson(base, withSourceQuery('/api/url', sourceId), {
      method: 'POST',
      body: { url },
      timeoutMs: 8000,
    });
    return { ok: true, baseUrl: base, url, source: sourceId, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to set WebLinked URL',
      baseUrl: base,
      source: sourceId,
    };
  }
}

async function clearUrl({ source = null } = {}) {
  if (!(await isRunning())) {
    return { ok: true, skipped: true, reason: 'WebLinked not running' };
  }
  return setUrl('about:blank', { source, ensure: false, force: true });
}

async function postApi(urlPath, body, { timeoutMs = 10000, source = null } = {}) {
  const base = await resolveBase();
  if (!base) {
    return {
      ok: false,
      error: 'WebLinked is not running. Start WebLinked first.',
    };
  }
  try {
    const data = await requestJson(base, withSourceQuery(urlPath, source), {
      method: 'POST',
      body,
      timeoutMs,
    });
    return { ok: true, baseUrl: base, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'WebLinked API failed',
      baseUrl: base,
    };
  }
}

/**
 * WebLinked can be listening with zero sources (idle). Format / output APIs then
 * return 503 "no sources are running". Ensure a primary tab exists first.
 */
async function ensurePrimarySource({ format = '1080p50', url = 'about:blank' } = {}) {
  const base = await resolveBase({ force: true });
  if (!base) {
    return { ok: false, error: 'WebLinked control API not reachable' };
  }

  let state = null;
  try {
    state = await requestJson(base, '/api/state', { timeoutMs: 5000 });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to read WebLinked state',
      baseUrl: base,
    };
  }

  const hasSource =
    Boolean(state?.running) ||
    Boolean(state?.format) ||
    (Array.isArray(state?.outputs) && state.outputs.length > 0);

  if (hasSource) {
    return { ok: true, created: false, baseUrl: base, state };
  }

  try {
    await requestJson(base, '/api/sources/add', {
      method: 'POST',
      body: {
        source: {
          id: 'main',
          url: url || 'about:blank',
          format: format || '1080p50',
          outputs: [{ kind: 'preview', name: 'preview', options: { factor: 4 } }],
        },
      },
      timeoutMs: 10000,
    });
    state = await requestJson(base, '/api/state', { timeoutMs: 5000 });
    return { ok: true, created: true, baseUrl: base, state };
  } catch (e) {
    // Duplicate id from a race — treat as ok and re-read.
    const msg = e instanceof Error ? e.message : String(e);
    if (/409|duplicate|already/i.test(msg)) {
      try {
        state = await requestJson(base, '/api/state', { timeoutMs: 5000 });
        return { ok: true, created: false, baseUrl: base, state };
      } catch (e2) {
        return {
          ok: false,
          error: e2 instanceof Error ? e2.message : 'Failed after sources/add conflict',
          baseUrl: base,
        };
      }
    }
    return {
      ok: false,
      error: msg || 'Failed to create WebLinked source',
      baseUrl: base,
    };
  }
}

async function getEngineState({ source = null } = {}) {
  const ready = await ensureRunning();
  if (!ready.ok && !ready.running) {
    return {
      ok: false,
      running: false,
      error: ready.error || 'WebLinked is not running',
    };
  }

  const sourceId = sanitizeSourceId(source);
  let createdSource = false;
  let base = await resolveBase({ force: true });
  if (!base) {
    return { ok: false, running: false, error: 'WebLinked control API not reachable' };
  }

  if (sourceId) {
    const ensured = await ensureDisplaySource(sourceId);
    if (!ensured.ok) {
      return {
        ok: false,
        running: false,
        error: ensured.error || 'WebLinked has no source page',
        baseUrl: ensured.baseUrl || base,
      };
    }
    createdSource = Boolean(ensured.created);
    base = ensured.baseUrl || base;
  } else {
    // Settings modal / status: prefer an existing page; only create idle "main" if none.
    const listed = await listSources();
    if (!(listed.ids || []).length) {
      const ensured = await ensurePrimarySource();
      if (!ensured.ok) {
        return {
          ok: false,
          running: false,
          error: ensured.error || 'WebLinked has no source page',
          baseUrl: ensured.baseUrl,
        };
      }
      createdSource = Boolean(ensured.created);
      base = ensured.baseUrl || base;
    }
  }

  try {
    const state = await requestJson(base, withSourceQuery('/api/state', sourceId), {
      timeoutMs: 5000,
    });
    return {
      ok: true,
      running: true,
      baseUrl: base,
      state,
      source: sourceId || state?.id || null,
      createdSource,
      compiledBackends: Array.isArray(state?.compiled_backends) ? state.compiled_backends : [],
      outputs: Array.isArray(state?.outputs) ? state.outputs : [],
      format: state?.format || '',
      displays: Array.isArray(state?.displays) ? state.displays : [],
    };
  } catch (e) {
    return {
      ok: false,
      running: false,
      error: e instanceof Error ? e.message : 'Failed to read WebLinked state',
      baseUrl: base,
    };
  }
}

function hasKind(outputs, kind) {
  return (outputs || []).some((o) => o?.kind === kind);
}

function outputsOfKind(outputs, kind) {
  return (outputs || []).filter((o) => o?.kind === kind);
}

/**
 * Simple operator settings aligned with WebLinked's control page:
 * format (raster+rate), preview quality, output kinds (incl. Spout/shared),
 * and multiple named NDI senders. Scoped to one source when payload.source is set
 * so each display card keeps its own NDI names.
 */
async function applySimpleSettings(payload = {}) {
  const format = typeof payload.format === 'string' ? payload.format.trim() : '';
  const sourceId = sanitizeSourceId(payload.source);
  const snap = await getEngineState({ source: sourceId });
  if (!snap.ok) return snap;

  const notes = [];
  if (snap.createdSource) notes.push(sourceId ? `Started source · ${sourceId}` : 'Started main source');
  let current = snap.outputs || [];
  const previewFactor = Number(payload.previewFactor);
  const want = payload.outputs || {};
  const apiOpts = { source: sourceId };

  function formatsMatch(a, b) {
    const left = String(a || '').trim().toLowerCase();
    const right = String(b || '').trim().toLowerCase();
    if (!left || !right) return false;
    if (left === right) return true;
    // Engine may report "1920x1080p50" while we send "1080p50".
    const strip = (s) => s.replace(/^\d+x/, '');
    return strip(left) === strip(right);
  }

  if (format && !formatsMatch(snap.format, format)) {
    const fmt = await postApi('/api/format', { format }, apiOpts);
    if (!fmt.ok) return { ...fmt, notes };
    notes.push(`Format → ${format}`);
  }

  // Preview quality (scale factor). Always ensure a preview output exists first.
  if (Number.isFinite(previewFactor) && previewFactor > 0) {
    let preview = outputsOfKind(current, 'preview')[0];
    if (!preview) {
      const added = await postApi(
        '/api/output/add',
        {
          kind: 'preview',
          name: 'preview',
          options: { factor: previewFactor },
        },
        apiOpts
      );
      if (!added.ok) return { ...added, notes };
      notes.push('Preview on');
      await refreshOutputs();
      preview = outputsOfKind(current, 'preview')[0];
    }
    if (preview) {
      const currentFactor = Number(preview.options?.factor ?? preview.factor) || 4;
      if (currentFactor !== previewFactor) {
        const updated = await postApi(
          '/api/output/update',
          {
            name: preview.name || 'preview',
            output: {
              kind: 'preview',
              name: preview.name || 'preview',
              options: Object.assign({}, preview.options || {}, { factor: previewFactor }),
              background: preview.background || 'transparent',
              background_colour: preview.background_colour || '#00b140',
            },
          },
          apiOpts
        );
        if (!updated.ok) return { ...updated, notes };
        notes.push(`Preview quality → ${previewFactor}`);
        await refreshOutputs();
      }
    }
  }

  async function refreshOutputs() {
    const base = await resolveBase();
    if (!base) return;
    try {
      const state = await requestJson(base, withSourceQuery('/api/state', sourceId), {
        timeoutMs: 5000,
      });
      current = Array.isArray(state?.outputs) ? state.outputs : current;
    } catch {
      /* keep previous */
    }
  }

  async function syncKind(kind, enabled, addBody) {
    const existing = outputsOfKind(current, kind);
    if (enabled && existing.length === 0) {
      const added = await postApi('/api/output/add', addBody, apiOpts);
      if (!added.ok) return added;
      notes.push(`${kind} on`);
      await refreshOutputs();
      return { ok: true };
    }
    if (enabled && existing.length > 0) {
      const have = existing[0];
      const nameChanged = Boolean(addBody?.name) && have.name !== addBody.name;
      const wantDisp = addBody?.options?.display;
      const haveDisp =
        have.options?.display ?? have.display ?? have.options?.monitor ?? null;
      const displayChanged =
        wantDisp != null &&
        Number.isFinite(Number(wantDisp)) &&
        Number(haveDisp) !== Number(wantDisp);
      if (nameChanged || displayChanged) {
        const updated = await postApi(
          '/api/output/update',
          {
            name: have.name,
            output: { ...addBody, kind },
          },
          apiOpts
        );
        if (!updated.ok) return updated;
        notes.push(
          displayChanged
            ? `${kind} → display ${wantDisp}`
            : `${kind} → ${addBody.name}`
        );
        await refreshOutputs();
        return { ok: true };
      }
    }
    if (!enabled && existing.length > 0) {
      for (const out of existing) {
        const removed = await postApi('/api/output/remove', { name: out.name }, apiOpts);
        if (!removed.ok) return removed;
      }
      notes.push(`${kind} off`);
      await refreshOutputs();
    }
    return { ok: true };
  }

  // Preview is always required — never allow operators to turn it off here.
  {
    const r = await syncKind('preview', true, {
      kind: 'preview',
      name: 'preview',
      options: {
        factor: Number.isFinite(previewFactor) && previewFactor > 0 ? previewFactor : 4,
      },
    });
    if (!r.ok) return { ...r, notes };
  }

  if (typeof want.shared === 'boolean') {
    const sharedName = (payload.sharedName || 'WebLinked').trim() || 'WebLinked';
    const r = await syncKind('shared', want.shared, {
      kind: 'shared',
      name: sharedName,
      options: {},
    });
    if (!r.ok) return { ...r, notes };
  }

  if (typeof want.screen === 'boolean') {
    const displayIndex = Number.isFinite(Number(payload.screenDisplay))
      ? Number(payload.screenDisplay)
      : 0;
    const r = await syncKind('screen', want.screen, {
      kind: 'screen',
      name: 'Screen',
      options: { display: displayIndex, scaling: 'fit' },
    });
    if (!r.ok) return { ...r, notes };
  }

  if (typeof want.decklink === 'boolean') {
    const r = await syncKind('decklink', want.decklink, {
      kind: 'decklink',
      name: 'DeckLink',
      device_index: 0,
      options: {},
    });
    if (!r.ok) return { ...r, notes };
  }

  if (typeof want.aja === 'boolean') {
    const r = await syncKind('aja', want.aja, {
      kind: 'aja',
      name: 'AJA',
      device_index: 0,
      options: {},
    });
    if (!r.ok) return { ...r, notes };
  }

  if (typeof want.omt === 'boolean') {
    const r = await syncKind('omt', want.omt, {
      kind: 'omt',
      name: 'OMT',
      options: { alpha: true },
    });
    if (!r.ok) return { ...r, notes };
  }

  // NDI: master toggle + multiple named senders (this source only).
  if (want.ndi === false) {
    const existingNdi = outputsOfKind(current, 'ndi');
    for (const out of existingNdi) {
      const removed = await postApi('/api/output/remove', { name: out.name }, apiOpts);
      if (!removed.ok) return { ...removed, notes };
      notes.push(`NDI off · ${out.name}`);
    }
    if (existingNdi.length) await refreshOutputs();
  } else if (Array.isArray(payload.ndi) || want.ndi === true) {
    const desired = [];
    const seen = new Set();
    for (const row of Array.isArray(payload.ndi) ? payload.ndi : []) {
      const name = String(row?.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      desired.push({
        name,
        alpha: row?.alpha !== false,
      });
    }

    if (desired.length === 0) {
      desired.push({ name: sourceId ? `SINOR-${sourceId}` : 'SINOR', alpha: true });
    }

    const existingNdi = outputsOfKind(current, 'ndi');
    const desiredNames = new Set(desired.map((d) => d.name.toLowerCase()));

    for (const out of existingNdi) {
      if (!desiredNames.has(String(out.name || '').toLowerCase())) {
        const removed = await postApi('/api/output/remove', { name: out.name }, apiOpts);
        if (!removed.ok) return { ...removed, notes };
        notes.push(`NDI off · ${out.name}`);
      }
    }
    await refreshOutputs();

    const still = outputsOfKind(current, 'ndi');
    const byName = new Map(still.map((o) => [String(o.name || '').toLowerCase(), o]));

    for (const wantNdi of desired) {
      const key = wantNdi.name.toLowerCase();
      const have = byName.get(key);
      if (!have) {
        const added = await postApi(
          '/api/output/add',
          {
            kind: 'ndi',
            name: wantNdi.name,
            options: { alpha: wantNdi.alpha },
          },
          apiOpts
        );
        if (!added.ok) return { ...added, notes };
        notes.push(`NDI on · ${wantNdi.name}`);
        await refreshOutputs();
        continue;
      }
      const haveAlpha = Boolean(have.options?.alpha);
      if (haveAlpha !== wantNdi.alpha) {
        const updated = await postApi(
          '/api/output/update',
          {
            name: have.name,
            output: {
              kind: 'ndi',
              name: wantNdi.name,
              options: { ...(have.options || {}), alpha: wantNdi.alpha },
              background: have.background || 'transparent',
              background_colour: have.background_colour || '#00b140',
            },
          },
          apiOpts
        );
        if (!updated.ok) return { ...updated, notes };
        notes.push(`NDI · ${wantNdi.name}`);
      }
    }
    await refreshOutputs();
  }

  if (payload.save === true) {
    const saved = await postApi('/api/settings/save', {});
    if (saved.ok) notes.push('Saved for next launch');
  }

  const after = await getEngineState({ source: sourceId });
  // Prefer reporting apply success even if a follow-up state read flakes.
  if (!after.ok) {
    return {
      ok: true,
      notes,
      warning: after.error || 'Applied, but could not re-read state',
      outputs: current,
      format,
      source: sourceId,
      baseUrl: snap.baseUrl,
    };
  }
  return {
    ok: true,
    notes,
    ...after,
    source: sourceId || after.source,
    error: undefined,
  };
}

/** Forward pointer/keyboard events to the offscreen page (POST /api/input). */
async function sendInput(event) {
  const source = sanitizeSourceId(event?.source);
  const body = { ...(event || {}) };
  delete body.source;
  return postApi('/api/input', body, { timeoutMs: 4000, source });
}

/**
 * Live preview frame from GET /api/preview (raw BGRA).
 * Same feed WebLinked's control page blits to its 16:9 canvas.
 * Pass source to read a specific display card's pipeline.
 */
async function getPreviewFrame({ timeoutMs = 2500, source = null } = {}) {
  const ready = await ensureRunning();
  if (!ready.ok && !ready.running) {
    return { ok: false, error: ready.error || 'WebLinked is not running' };
  }
  const base = await resolveBase();
  if (!base) {
    return { ok: false, error: 'WebLinked control API not reachable' };
  }

  const sourceId = sanitizeSourceId(source);
  const previewPath = withSourceQuery('/api/preview', sourceId);

  return new Promise((resolve) => {
    const req = http.get(`${base}${previewPath}`, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          resolve({
            ok: false,
            statusCode: res.statusCode,
            error:
              res.statusCode === 404
                ? 'Preview output is not running'
                : res.statusCode === 503
                  ? 'Waiting for first paint'
                  : `HTTP ${res.statusCode}`,
          });
          return;
        }
        const width = Number(res.headers['x-frame-width'] || 0);
        const height = Number(res.headers['x-frame-height'] || 0);
        const sequence = Number(res.headers['x-frame-sequence'] || 0);
        const bgra = Buffer.concat(chunks);
        if (!width || !height || bgra.length < width * height * 4) {
          resolve({ ok: false, error: 'Incomplete preview frame' });
          return;
        }
        resolve({
          ok: true,
          baseUrl: base,
          source: sourceId,
          width,
          height,
          sequence,
          bgra,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Preview frame timeout' });
    });
    req.on('error', (e) => {
      resolve({ ok: false, error: e instanceof Error ? e.message : 'Preview fetch failed' });
    });
  });
}

module.exports = {
  CANDIDATE_PORTS,
  findExe,
  getStatus,
  startWebLinked,
  stopWebLinked,
  ensureRunning,
  setUrl,
  clearUrl,
  resolveBase,
  isRunning,
  getEngineState,
  applySimpleSettings,
  getPreviewFrame,
  sendInput,
  ensureDisplaySource,
  listSources,
  sanitizeSourceId,
  hasKind,
  collectDiagnostics,
  getWebLinkedLog,
};
