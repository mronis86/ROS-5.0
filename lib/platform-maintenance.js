/**
 * Platform maintenance checks (Node EOL, version pins, NODE_ENV).
 * EOL dates refresh live from https://endoflife.date (with static fallback).
 */
const fs = require('fs');
const path = require('path');

const EOL_API_URL = 'https://endoflife.date/api/nodejs.json';
const EOL_FETCH_TIMEOUT_MS = 8000;
const WARN_WITHIN_DAYS = 90;
const PLAN_AHEAD_DAYS = 90;

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

function formatDisplayDate(dateStr) {
  if (!dateStr || dateStr === true) return null;
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function addDaysIso(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNowIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusFromEol(eol, isLts) {
  if (eol === true) {
    return {
      level: 'critical',
      label: 'Needs upgrade now',
      daysRemaining: null,
    };
  }
  const days = daysUntil(eol);
  if (days == null) {
    return { level: 'unknown', label: 'Unknown', daysRemaining: null };
  }
  if (days < 0) {
    return { level: 'critical', label: 'Needs upgrade now', daysRemaining: days };
  }
  if (days <= WARN_WITHIN_DAYS) {
    return { level: 'warning', label: 'Plan upgrade soon', daysRemaining: days };
  }
  if (isLts === false) {
    return { level: 'warning', label: 'Short-term version', daysRemaining: days };
  }
  return { level: 'ok', label: 'Good', daysRemaining: days };
}

function readRepoPins(rootDir) {
  let enginesNode = null;
  try {
    const pkg = JSON.parse(readTextSafe(path.join(rootDir, 'package.json')) || '{}');
    enginesNode = pkg.engines?.node || null;
  } catch {
    enginesNode = null;
  }
  const nvmrc = (readTextSafe(path.join(rootDir, '.nvmrc')) || '').trim() || null;
  let netlifyNode = null;
  const netlifyToml = readTextSafe(path.join(rootDir, 'netlify.toml'));
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

function summaryHeadline(level, critical, warning) {
  if (level === 'ok') return 'Everything looks good';
  if (critical > 0) {
    return critical === 1 ? '1 urgent item needs attention' : `${critical} urgent items need attention`;
  }
  if (warning > 0) {
    return warning === 1 ? '1 optional item to review' : `${warning} optional items to review`;
  }
  return 'Some items could not be fully checked';
}

function levelAudienceLabel(level) {
  if (level === 'ok') return 'Good';
  if (level === 'warning') return 'Review';
  if (level === 'critical') return 'Urgent';
  return 'Unknown';
}

async function buildPlatformMaintenanceReport(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const runtime = parseNodeVersion(process.version);
  const env = process.env.NODE_ENV || 'development';
  const pins = readRepoPins(rootDir);
  const eolFetch = await fetchNodeEolCycles();
  const checks = [];

  // NODE_ENV
  if (env === 'production') {
    checks.push({
      id: 'node_env',
      title: 'Production mode',
      level: 'ok',
      label: levelAudienceLabel('ok'),
      plain:
        'The live API is running in production mode. Security settings like the website allowlist and alert emails are on.',
      action: null,
      recommendBy: null,
      recommendByLabel: null,
      value: env,
      technical: 'NODE_ENV=production',
    });
  } else {
    checks.push({
      id: 'node_env',
      title: 'Production mode',
      level: 'warning',
      label: levelAudienceLabel('warning'),
      plain:
        'This API is not in production mode (common for local testing). On Railway, production mode should stay on so security settings and alerts work.',
      action: 'On Railway Variables, set NODE_ENV to production, then redeploy.',
      recommendBy: todayIso(),
      recommendByLabel: 'Do now on live servers',
      value: env,
      technical: `NODE_ENV=${env}`,
    });
  }

  // Runtime EOL
  if (runtime) {
    const cycle = findCycle(eolFetch.cycles, runtime.major);
    const isLts = cycle ? Boolean(cycle.lts) : runtime.major % 2 === 0;
    const eol = cycle?.eol;
    const eolStatus = cycle
      ? statusFromEol(eol, isLts)
      : { level: 'unknown', label: 'Unknown', daysRemaining: null };

    const eolDisplay = eol && eol !== true ? formatDisplayDate(eol) : null;
    let plain;
    let action = null;
    let recommendBy = null;
    let recommendByLabel = null;

    if (eolStatus.level === 'critical') {
      plain = `The server is on Node ${process.version}, which is past its support end date${eolDisplay ? ` (${eolDisplay})` : ''}. Upgrade to a supported long-term version (for example Node 22 or 24).`;
      action = 'Upgrade the Railway Node version, redeploy, then confirm this page shows Good.';
      recommendBy = todayIso();
      recommendByLabel = 'Upgrade now';
    } else if (eolStatus.level === 'warning' && isLts === false) {
      plain = `The server is on a short-term Node version (${process.version}). Prefer a long-term support (LTS) version such as Node 22 or 24.`;
      action = 'Switch Railway to an LTS Node version and redeploy.';
      recommendBy = daysFromNowIso(30);
      recommendByLabel = 'Recommended within 30 days';
    } else if (eolStatus.level === 'warning') {
      plain = `Node ${runtime.major} is still supported, but support ends ${eolDisplay || 'soon'}. Plan an upgrade before that date.`;
      action = `Plan upgrade to the next LTS (for example Node ${runtime.major + 2}) before support ends.`;
      recommendBy = typeof eol === 'string' ? eol : daysFromNowIso(WARN_WITHIN_DAYS);
      recommendByLabel = eolDisplay ? `Upgrade before ${eolDisplay}` : 'Upgrade soon';
    } else if (eolStatus.level === 'ok' && typeof eol === 'string') {
      const planBy = addDaysIso(eol, -PLAN_AHEAD_DAYS);
      plain = `The API server Node version (${process.version}) is supported until ${eolDisplay}. No urgent action.`;
      action = `Around ${formatDisplayDate(planBy)}, plan moving to the next long-term Node version.`;
      recommendBy = planBy;
      recommendByLabel = `Next review by ${formatDisplayDate(planBy)}`;
    } else {
      plain = `Could not fully match Node ${process.version} to a known support schedule.`;
      action = 'Click Refresh later, or check endoflife.date/nodejs.';
    }

    checks.push({
      id: 'node_runtime_eol',
      title: 'API server Node version',
      level: eolStatus.level,
      label: eolStatus.label || levelAudienceLabel(eolStatus.level),
      plain,
      action,
      recommendBy,
      recommendByLabel,
      value: process.version,
      technical: `Railway runtime ${process.version}; EOL ${eol === true ? 'ended' : eol || 'unknown'}`,
      meta: {
        major: runtime.major,
        eol: eol === true ? 'ended' : eol || null,
        eolDisplay,
        daysRemaining: eolStatus.daysRemaining,
        latestInCycle: cycle?.latest || null,
        lts: isLts,
        eolDataSource: eolFetch.source,
      },
    });
  }

  // engines vs runtime
  const floor = parseEnginesFloor(pins.enginesNode);
  if (floor && runtime) {
    const below = versionCmp(runtime, floor) < 0;
    const majorMismatch = runtime.major !== floor.major;
    if (majorMismatch) {
      checks.push({
        id: 'engines_mismatch',
        title: 'Project vs server version',
        level: 'warning',
        label: levelAudienceLabel('warning'),
        plain: `The project asks for Node ${pins.enginesNode}, but the server is on Node ${runtime.major}. They should match.`,
        action: 'Align Railway’s Node version with package.json engines, then redeploy.',
        recommendBy: daysFromNowIso(14),
        recommendByLabel: 'Recommended within 2 weeks',
        value: pins.enginesNode,
        technical: `engines ${pins.enginesNode} vs runtime ${process.version}`,
      });
    } else if (below) {
      checks.push({
        id: 'engines_mismatch',
        title: 'Project vs server version',
        level: 'warning',
        label: levelAudienceLabel('warning'),
        plain: `This is the item showing as the warning. The project prefers Node ${pins.enginesNode}, but the API is running ${process.version}. Same major family (22), just an older patch. Not urgent, but you can tighten it.`,
        action:
          'In Railway Variables, add NIXPACKS_NODE_VERSION=22.20.0 (or newer 22.x), redeploy, then Refresh this page.',
        recommendBy: daysFromNowIso(30),
        recommendByLabel: 'Optional within 30 days',
        value: `${process.version} vs ${pins.enginesNode}`,
        technical: `runtime below engines floor (${process.version} < ${pins.enginesNode})`,
      });
    } else {
      checks.push({
        id: 'engines_mismatch',
        title: 'Project vs server version',
        level: 'ok',
        label: levelAudienceLabel('ok'),
        plain: `The API Node version meets what the project asks for (${pins.enginesNode}).`,
        action: null,
        recommendBy: null,
        recommendByLabel: null,
        value: pins.enginesNode,
        technical: `engines ${pins.enginesNode}`,
      });
    }
  } else if (pins.enginesNode) {
    checks.push({
      id: 'engines_mismatch',
      title: 'Project vs server version',
      level: 'unknown',
      label: levelAudienceLabel('unknown'),
      plain: 'Could not compare the project version pin to the live server version.',
      action: 'Refresh later. If this persists, check package.json engines.',
      recommendBy: null,
      recommendByLabel: null,
      value: pins.enginesNode,
      technical: pins.enginesNode,
    });
  } else {
    checks.push({
      id: 'engines_mismatch',
      title: 'Project vs server version',
      level: 'warning',
      label: levelAudienceLabel('warning'),
      plain: 'The project does not declare a preferred Node version yet.',
      action: 'Add engines.node in package.json (for example ^22.20).',
      recommendBy: daysFromNowIso(30),
      recommendByLabel: 'Optional within 30 days',
      value: null,
      technical: 'engines.node missing',
    });
  }

  // Netlify pin
  if (pins.netlifyNode) {
    const netlifyParsed = parseNodeVersion(pins.netlifyNode);
    const netlifyCycle = netlifyParsed ? findCycle(eolFetch.cycles, netlifyParsed.major) : null;
    const netlifyStatus = netlifyCycle
      ? statusFromEol(netlifyCycle.eol, Boolean(netlifyCycle.lts))
      : { level: 'ok', label: 'Good', daysRemaining: null };
    const level =
      netlifyStatus.level === 'critical' || netlifyStatus.level === 'warning'
        ? netlifyStatus.level
        : 'ok';
    const eolDisplay =
      netlifyCycle?.eol && netlifyCycle.eol !== true ? formatDisplayDate(netlifyCycle.eol) : null;

    let plain =
      level === 'ok'
        ? `The website build is set to use Node ${pins.netlifyNode}. After a Netlify deploy from master, confirm the build log shows Node 22.`
        : `The website build pin (${pins.netlifyNode}) is on a Node line that needs attention${eolDisplay ? ` (support ends ${eolDisplay})` : ''}.`;
    let action =
      level === 'ok'
        ? null
        : 'Update NODE_VERSION in netlify.toml to a supported LTS (for example 22.20.0 or 24.x), then redeploy Netlify.';
    let recommendBy = null;
    let recommendByLabel = null;
    if (level === 'critical') {
      recommendBy = todayIso();
      recommendByLabel = 'Update now';
    } else if (level === 'warning' && typeof netlifyCycle?.eol === 'string') {
      recommendBy = netlifyCycle.eol;
      recommendByLabel = `Update before ${eolDisplay}`;
    }

    checks.push({
      id: 'netlify_node_pin',
      title: 'Website build Node version',
      level,
      label: level === 'ok' ? 'Good' : netlifyStatus.label || levelAudienceLabel(level),
      plain,
      action,
      recommendBy,
      recommendByLabel,
      value: pins.netlifyNode,
      technical: `netlify.toml NODE_VERSION=${pins.netlifyNode}`,
    });
  } else {
    checks.push({
      id: 'netlify_node_pin',
      title: 'Website build Node version',
      level: 'warning',
      label: levelAudienceLabel('warning'),
      plain: 'Could not read the website Node version pin from netlify.toml on this server.',
      action: 'Confirm netlify.toml is deployed with the API, or set NODE_VERSION in the Netlify UI.',
      recommendBy: daysFromNowIso(14),
      recommendByLabel: 'Check within 2 weeks',
      value: null,
      technical: 'netlify.toml NODE_VERSION not found',
    });
  }

  // nvmrc
  checks.push({
    id: 'nvmrc',
    title: 'Local development pin',
    level: pins.nvmrc ? 'ok' : 'warning',
    label: pins.nvmrc ? 'Good' : levelAudienceLabel('warning'),
    plain: pins.nvmrc
      ? `Local tooling is pinned to Node ${pins.nvmrc}, which helps developers match production.`
      : 'No .nvmrc file found. Adding one helps local machines use the same Node major as production.',
    action: pins.nvmrc ? null : 'Add a .nvmrc file with 22 (or your chosen LTS major).',
    recommendBy: pins.nvmrc ? null : daysFromNowIso(30),
    recommendByLabel: pins.nvmrc ? null : 'Optional within 30 days',
    value: pins.nvmrc,
    technical: pins.nvmrc ? `.nvmrc=${pins.nvmrc}` : '.nvmrc missing',
  });

  const order = { critical: 0, warning: 1, unknown: 2, ok: 3 };
  const worst = checks.reduce((acc, c) => (order[c.level] < order[acc] ? c.level : acc), 'ok');
  const critical = checks.filter((c) => c.level === 'critical').length;
  const warning = checks.filter((c) => c.level === 'warning').length;
  const ok = checks.filter((c) => c.level === 'ok').length;

  const attention = checks
    .filter((c) => c.level === 'critical' || c.level === 'warning')
    .sort((a, b) => order[a.level] - order[b.level]);

  const recommendations = attention
    .filter((c) => c.action)
    .map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
      action: c.action,
      recommendBy: c.recommendBy,
      recommendByLabel: c.recommendByLabel,
      recommendByDisplay: c.recommendBy ? formatDisplayDate(c.recommendBy) : null,
    }));

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      level: worst,
      headline: summaryHeadline(worst, critical, warning),
      critical,
      warning,
      ok,
      audienceLabel: levelAudienceLabel(worst),
    },
    runtime: {
      nodeVersion: process.version,
      env,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    pins,
    eolSource: eolFetch.source,
    eolError: eolFetch.error || null,
    eolNote:
      'Support end dates refresh automatically from endoflife.date whenever you click Refresh (with a built-in backup list if that site is unreachable).',
    checks,
    attention,
    recommendations,
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
