/**
 * Platform maintenance checks (Node EOL, version pins, NODE_ENV).
 * EOL data from https://endoflife.date (with static fallback).
 */
const fs = require('fs');
const path = require('path');

const EOL_API_URL = 'https://endoflife.date/api/nodejs.json';
const EOL_FETCH_TIMEOUT_MS = 8000;
const WARN_WITHIN_DAYS = 90;

/** Fallback if endoflife.date is unreachable (keep in sync occasionally). */
const NODE_EOL_FALLBACK = [
  { cycle: '24', eol: '2028-04-30', lts: true, latest: '24.x' },
  { cycle: '22', eol: '2027-04-30', lts: true, latest: '22.x' },
  { cycle: '20', eol: '2026-04-30', lts: true, latest: '20.x' },
  { cycle: '18', eol: '2025-04-30', lts: true, latest: '18.x' },
];

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseNodeVersion(raw) {
  const s = String(raw || '').replace(/^v/i, '').trim();
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return {
    raw: s.startsWith('v') ? s : `v${s}`,
    major: Number(m[1]),
    minor: Number(m[2] || 0),
    patch: Number(m[3] || 0),
  };
}

function parseEnginesFloor(enginesNode) {
  if (!enginesNode || typeof enginesNode !== 'string') return null;
  const m = enginesNode.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] || 0),
    patch: Number(m[3] || 0),
    raw: enginesNode,
  };
}

function versionCmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function daysUntil(dateStr) {
  if (!dateStr || dateStr === true) return null;
  const end = new Date(`${dateStr}T23:59:59.000Z`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function statusFromEol(eol, isLts) {
  if (eol === true) {
    return {
      level: 'critical',
      label: 'End of life',
      detail: 'This Node cycle is already end of life.',
    };
  }
  const days = daysUntil(eol);
  if (days == null) {
    return { level: 'unknown', label: 'Unknown', detail: 'Could not parse EOL date.' };
  }
  if (days < 0) {
    return {
      level: 'critical',
      label: 'End of life',
      detail: `EOL was ${eol} (${Math.abs(days)} days ago). Upgrade to a supported LTS.`,
      daysRemaining: days,
    };
  }
  if (days <= WARN_WITHIN_DAYS) {
    return {
      level: 'warning',
      label: 'Approaching EOL',
      detail: `EOL on ${eol} (${days} days left). Plan an upgrade.`,
      daysRemaining: days,
    };
  }
  if (isLts === false) {
    return {
      level: 'warning',
      label: 'Non-LTS',
      detail: `Odd/current releases are short-lived. Prefer even LTS (EOL ${eol}).`,
      daysRemaining: days,
    };
  }
  return {
    level: 'ok',
    label: 'Supported',
    detail: `LTS supported until ${eol} (${days} days left).`,
    daysRemaining: days,
  };
}

function readRepoPins(rootDir) {
  const pkgPath = path.join(rootDir, 'package.json');
  const nvmPath = path.join(rootDir, '.nvmrc');
  const netlifyPath = path.join(rootDir, 'netlify.toml');

  let enginesNode = null;
  try {
    const pkg = JSON.parse(readTextSafe(pkgPath) || '{}');
    enginesNode = pkg.engines?.node || null;
  } catch {
    enginesNode = null;
  }

  const nvmrc = (readTextSafe(nvmPath) || '').trim() || null;

  let netlifyNode = null;
  const netlifyToml = readTextSafe(netlifyPath);
  if (netlifyToml) {
    const m = netlifyToml.match(/NODE_VERSION\s*=\s*"([^"]+)"/);
    if (m) netlifyNode = m[1];
  }

  return { enginesNode, nvmrc, netlifyNode };
}

async function fetchNodeEolCycles() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EOL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(EOL_API_URL, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected EOL payload');
    return { source: 'endoflife.date', cycles: data };
  } catch (err) {
    return {
      source: 'fallback',
      error: err.name === 'AbortError' ? 'Timeout fetching endoflife.date' : err.message,
      cycles: NODE_EOL_FALLBACK,
    };
  } finally {
    clearTimeout(t);
  }
}

function findCycle(cycles, major) {
  return cycles.find((c) => String(c.cycle) === String(major)) || null;
}

async function buildPlatformMaintenanceReport(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const runtime = parseNodeVersion(process.version);
  const env = process.env.NODE_ENV || 'development';
  const pins = readRepoPins(rootDir);
  const eolFetch = await fetchNodeEolCycles();

  const checks = [];

  if (env === 'production') {
    checks.push({
      id: 'node_env',
      title: 'NODE_ENV',
      level: 'ok',
      label: 'production',
      detail: 'Production mode is on (Socket.IO allowlist + ops alerts enabled).',
      value: env,
    });
  } else {
    checks.push({
      id: 'node_env',
      title: 'NODE_ENV',
      level: 'warning',
      label: env || 'unset',
      detail: 'Not production — Socket.IO allows any origin and ops alerts stay off unless forced.',
      value: env,
    });
  }

  if (runtime) {
    const cycle = findCycle(eolFetch.cycles, runtime.major);
    const isLts = cycle ? Boolean(cycle.lts) : runtime.major % 2 === 0;
    const eol = cycle?.eol;
    const eolStatus = cycle
      ? statusFromEol(eol, isLts)
      : {
          level: 'unknown',
          label: 'Unknown cycle',
          detail: `No EOL data for Node ${runtime.major}.`,
        };

    checks.push({
      id: 'node_runtime_eol',
      title: 'API Node runtime (Railway)',
      level: eolStatus.level,
      label: eolStatus.label,
      detail: eolStatus.detail,
      value: process.version,
      meta: {
        major: runtime.major,
        eol: eol === true ? 'ended' : eol || null,
        daysRemaining: eolStatus.daysRemaining ?? null,
        latestInCycle: cycle?.latest || null,
        lts: isLts,
        eolDataSource: eolFetch.source,
      },
    });
  } else {
    checks.push({
      id: 'node_runtime_eol',
      title: 'API Node runtime (Railway)',
      level: 'unknown',
      label: 'Unreadable',
      detail: 'Could not parse process.version.',
      value: process.version,
    });
  }

  const floor = parseEnginesFloor(pins.enginesNode);
  if (floor && runtime) {
    const below = versionCmp(runtime, floor) < 0;
    const majorMismatch = runtime.major !== floor.major;
    if (majorMismatch) {
      checks.push({
        id: 'engines_mismatch',
        title: 'package.json engines',
        level: 'warning',
        label: 'Major mismatch',
        detail: `Runtime is Node ${runtime.major}, but engines asks for ${pins.enginesNode}.`,
        value: pins.enginesNode,
      });
    } else if (below) {
      checks.push({
        id: 'engines_mismatch',
        title: 'package.json engines',
        level: 'warning',
        label: 'Below engines floor',
        detail: `Runtime ${process.version} is below engines ${pins.enginesNode}. Consider NIXPACKS_NODE_VERSION on Railway.`,
        value: pins.enginesNode,
      });
    } else {
      checks.push({
        id: 'engines_mismatch',
        title: 'package.json engines',
        level: 'ok',
        label: 'Meets engines',
        detail: `Runtime satisfies engines ${pins.enginesNode}.`,
        value: pins.enginesNode,
      });
    }
  } else if (pins.enginesNode) {
    checks.push({
      id: 'engines_mismatch',
      title: 'package.json engines',
      level: 'unknown',
      label: 'Pinned',
      detail: 'Could not compare engines to runtime.',
      value: pins.enginesNode,
    });
  } else {
    checks.push({
      id: 'engines_mismatch',
      title: 'package.json engines',
      level: 'warning',
      label: 'Not set',
      detail: 'Add engines.node so Railway/Nixpacks pin a supported major.',
      value: null,
    });
  }

  if (pins.netlifyNode) {
    const netlifyParsed = parseNodeVersion(pins.netlifyNode);
    const netlifyCycle = netlifyParsed ? findCycle(eolFetch.cycles, netlifyParsed.major) : null;
    const netlifyStatus = netlifyCycle
      ? statusFromEol(netlifyCycle.eol, Boolean(netlifyCycle.lts))
      : {
          level: 'ok',
          label: 'Pinned',
          detail: 'From netlify.toml (build pin).',
        };
    const level =
      netlifyStatus.level === 'critical' || netlifyStatus.level === 'warning'
        ? netlifyStatus.level
        : 'ok';
    checks.push({
      id: 'netlify_node_pin',
      title: 'Netlify NODE_VERSION pin',
      level,
      label: level === 'ok' ? 'Pinned' : netlifyStatus.label,
      detail:
        level === 'ok'
          ? `netlify.toml sets NODE_VERSION=${pins.netlifyNode}. Build pin only — confirm in Netlify build logs.`
          : `${netlifyStatus.detail} (pin ${pins.netlifyNode})`,
      value: pins.netlifyNode,
    });
  } else {
    checks.push({
      id: 'netlify_node_pin',
      title: 'Netlify NODE_VERSION pin',
      level: 'warning',
      label: 'Not found',
      detail: 'Could not read NODE_VERSION from netlify.toml on the API host.',
      value: null,
    });
  }

  checks.push({
    id: 'nvmrc',
    title: '.nvmrc',
    level: pins.nvmrc ? 'ok' : 'warning',
    label: pins.nvmrc || 'Missing',
    detail: pins.nvmrc
      ? `Local/tooling pin: ${pins.nvmrc}`
      : 'Add .nvmrc so local and Nixpacks tooling agree on a major.',
    value: pins.nvmrc,
  });

  const order = { critical: 0, warning: 1, unknown: 2, ok: 3 };
  const worst = checks.reduce(
    (acc, c) => (order[c.level] < order[acc] ? c.level : acc),
    'ok'
  );

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      level: worst,
      critical: checks.filter((c) => c.level === 'critical').length,
      warning: checks.filter((c) => c.level === 'warning').length,
      ok: checks.filter((c) => c.level === 'ok').length,
    },
    runtime: {
      nodeVersion: process.version,
      env,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    pins,
    eolSource: eolFetch.source,
    eolError: eolFetch.error || null,
    checks,
    links: {
      nodeEol: 'https://endoflife.date/nodejs',
      nodeReleases: 'https://nodejs.org/en/about/previous-releases',
    },
  };
}

module.exports = {
  buildPlatformMaintenanceReport,
  parseNodeVersion,
};
