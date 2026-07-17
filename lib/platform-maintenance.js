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
      label: 'Urgent',
      daysRemaining: null,
    };
  }
  const days = daysUntil(eol);
  if (days == null) {
    return { level: 'unknown', label: 'Unknown', daysRemaining: null };
  }
  if (days < 0) {
    return { level: 'critical', label: 'Urgent', daysRemaining: days };
  }
  if (days <= WARN_WITHIN_DAYS) {
    return { level: 'warning', label: 'Review', daysRemaining: days };
  }
  if (isLts === false) {
    return { level: 'warning', label: 'Review', daysRemaining: days };
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
      title: 'Live security mode',
      whatIsThis:
        'Whether the API is running in “production” settings (stricter website access rules and alert emails).',
      level: 'ok',
      label: 'Good',
      plain: 'Live security settings are on. Website allowlist and alert emails are enabled.',
      action: null,
      recommendBy: null,
      recommendByLabel: null,
      dateRight: null,
      value: 'On',
      technical: 'NODE_ENV=production',
    });
  } else {
    checks.push({
      id: 'node_env',
      title: 'Live security mode',
      whatIsThis:
        'Whether the API is running in “production” settings (stricter website access rules and alert emails).',
      level: 'warning',
      label: 'Review',
      plain:
        'This server is not in live/production mode (normal for local testing). On Railway it should be production.',
      action: 'On Railway → Variables, set NODE_ENV to production, then redeploy.',
      recommendBy: todayIso(),
      recommendByLabel: 'Do on live API',
      dateRight: formatDisplayDate(todayIso()),
      value: env || 'Off',
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
    let dateRight = null;

    if (eolStatus.level === 'critical') {
      plain = `The API is on Node ${process.version}, which is no longer supported${eolDisplay ? ` (ended ${eolDisplay})` : ''}. Upgrade to Node 22 or 24.`;
      action = 'Upgrade Railway’s Node version, redeploy, then refresh this page.';
      recommendBy = todayIso();
      recommendByLabel = 'Upgrade now';
      dateRight = formatDisplayDate(todayIso());
    } else if (eolStatus.level === 'warning' && isLts === false) {
      plain = `The API is on a short-term Node version (${process.version}). Prefer a long-term version such as 22 or 24.`;
      action = 'Switch Railway to an LTS Node version and redeploy.';
      recommendBy = daysFromNowIso(30);
      recommendByLabel = 'Within 30 days';
      dateRight = formatDisplayDate(recommendBy);
    } else if (eolStatus.level === 'warning') {
      plain = `Node ${runtime.major} is still OK, but support ends ${eolDisplay || 'soon'}. Plan an upgrade before then.`;
      action = `Plan moving to the next long-term Node (for example ${runtime.major + 2}) before support ends.`;
      recommendBy = typeof eol === 'string' ? eol : daysFromNowIso(WARN_WITHIN_DAYS);
      recommendByLabel = 'Upgrade before';
      dateRight = eolDisplay || formatDisplayDate(recommendBy);
    } else if (eolStatus.level === 'ok' && typeof eol === 'string') {
      const planBy = addDaysIso(eol, -PLAN_AHEAD_DAYS);
      plain = `The API Node version (${process.version}) is healthy. Support runs until ${eolDisplay}.`;
      action = null;
      recommendBy = planBy;
      recommendByLabel = 'Next check';
      dateRight = formatDisplayDate(planBy);
    } else {
      plain = `Could not match Node ${process.version} to a known support schedule.`;
      action = 'Click Refresh dates later.';
    }

    checks.push({
      id: 'node_runtime_eol',
      title: 'API Node version',
      whatIsThis:
        'The Node.js version actually running on Railway. Versions eventually stop getting security updates.',
      level: eolStatus.level,
      label: levelAudienceLabel(eolStatus.level),
      plain,
      action,
      recommendBy,
      recommendByLabel,
      dateRight,
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

  // Same major + supported = Good (patch gap is not a warning)
  const floor = parseEnginesFloor(pins.enginesNode);
  if (floor && runtime) {
    const below = versionCmp(runtime, floor) < 0;
    const majorMismatch = runtime.major !== floor.major;
    if (majorMismatch) {
      checks.push({
        id: 'engines_mismatch',
        title: 'Project Node target',
        whatIsThis: 'What Node version the project asks for vs what Railway is running.',
        level: 'warning',
        label: 'Review',
        plain: `The project asks for Node ${pins.enginesNode}, but the API is on Node ${runtime.major}. Those should match.`,
        action: 'Align Railway’s Node version with the project, then redeploy.',
        recommendBy: daysFromNowIso(14),
        recommendByLabel: 'Within 2 weeks',
        dateRight: formatDisplayDate(daysFromNowIso(14)),
        value: `${process.version} → ${pins.enginesNode}`,
        technical: `engines ${pins.enginesNode} vs runtime ${process.version}`,
      });
    } else if (below) {
      checks.push({
        id: 'engines_mismatch',
        title: 'Project Node target',
        whatIsThis: 'What Node version the project asks for vs what Railway is running.',
        level: 'ok',
        label: 'Good',
        plain: `You are on Node 22 (supported). The API is ${process.version}; the project prefers ${pins.enginesNode}. That small patch difference is fine — shown as Good. Optional later: pin Railway to 22.20+ for an exact match.`,
        action: null,
        recommendBy: null,
        recommendByLabel: null,
        dateRight: null,
        value: process.version,
        technical: `same-major patch gap OK (${process.version} < ${pins.enginesNode})`,
      });
    } else {
      checks.push({
        id: 'engines_mismatch',
        title: 'Project Node target',
        whatIsThis: 'What Node version the project asks for vs what Railway is running.',
        level: 'ok',
        label: 'Good',
        plain: `The API Node version matches what the project asks for (${pins.enginesNode}).`,
        action: null,
        recommendBy: null,
        recommendByLabel: null,
        dateRight: null,
        value: pins.enginesNode,
        technical: `engines ${pins.enginesNode}`,
      });
    }
  } else if (pins.enginesNode) {
    checks.push({
      id: 'engines_mismatch',
      title: 'Project Node target',
      whatIsThis: 'What Node version the project asks for vs what Railway is running.',
      level: 'unknown',
      label: 'Unknown',
      plain: 'Could not compare the project Node target to the live API version.',
      action: 'Refresh dates later.',
      recommendBy: null,
      recommendByLabel: null,
      dateRight: null,
      value: pins.enginesNode,
      technical: pins.enginesNode,
    });
  } else {
    checks.push({
      id: 'engines_mismatch',
      title: 'Project Node target',
      whatIsThis: 'What Node version the project asks for vs what Railway is running.',
      level: 'warning',
      label: 'Review',
      plain: 'The project does not declare a preferred Node version yet.',
      action: 'Add engines.node in package.json (for example ^22.20).',
      recommendBy: daysFromNowIso(30),
      recommendByLabel: 'Within 30 days',
      dateRight: formatDisplayDate(daysFromNowIso(30)),
      value: null,
      technical: 'engines.node missing',
    });
  }

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
        ? `The website (Netlify) is set to build with Node ${pins.netlifyNode}. That is on a supported long-term line.`
        : `The website build Node pin (${pins.netlifyNode}) needs attention${eolDisplay ? ` (support ends ${eolDisplay})` : ''}.`;
    let action =
      level === 'ok'
        ? null
        : 'Update NODE_VERSION in netlify.toml to a supported LTS, then redeploy Netlify.';
    let recommendBy = null;
    let recommendByLabel = null;
    let dateRight = null;
    if (level === 'critical') {
      recommendBy = todayIso();
      recommendByLabel = 'Update now';
      dateRight = formatDisplayDate(todayIso());
    } else if (level === 'warning' && typeof netlifyCycle?.eol === 'string') {
      recommendBy = netlifyCycle.eol;
      recommendByLabel = 'Update before';
      dateRight = eolDisplay;
    } else if (level === 'ok' && typeof netlifyCycle?.eol === 'string') {
      const planBy = addDaysIso(netlifyCycle.eol, -PLAN_AHEAD_DAYS);
      recommendBy = planBy;
      recommendByLabel = 'Next check';
      dateRight = formatDisplayDate(planBy);
    }

    checks.push({
      id: 'netlify_node_pin',
      title: 'Website Node version',
      whatIsThis:
        'The Node version Netlify uses when building the website (separate from the Railway API).',
      level,
      label: levelAudienceLabel(level),
      plain,
      action,
      recommendBy,
      recommendByLabel,
      dateRight,
      value: pins.netlifyNode,
      technical: `netlify.toml NODE_VERSION=${pins.netlifyNode}`,
    });
  } else {
    checks.push({
      id: 'netlify_node_pin',
      title: 'Website Node version',
      whatIsThis:
        'The Node version Netlify uses when building the website (separate from the Railway API).',
      level: 'warning',
      label: 'Review',
      plain: 'Could not read the website Node pin from netlify.toml on this server.',
      action: 'Confirm netlify.toml is deployed, or set NODE_VERSION in the Netlify UI.',
      recommendBy: daysFromNowIso(14),
      recommendByLabel: 'Within 2 weeks',
      dateRight: formatDisplayDate(daysFromNowIso(14)),
      value: null,
      technical: 'netlify.toml NODE_VERSION not found',
    });
  }

  checks.push({
    id: 'nvmrc',
    title: 'Developer Node pin',
    whatIsThis: 'Helps developer laptops use the same Node major version as production.',
    level: pins.nvmrc ? 'ok' : 'warning',
    label: pins.nvmrc ? 'Good' : 'Review',
    plain: pins.nvmrc
      ? `Local development is pinned to Node ${pins.nvmrc}, matching the production major version.`
      : 'No developer Node pin file (.nvmrc) was found.',
    action: pins.nvmrc ? null : 'Add a .nvmrc file containing 22.',
    recommendBy: pins.nvmrc ? null : daysFromNowIso(30),
    recommendByLabel: pins.nvmrc ? null : 'Within 30 days',
    dateRight: pins.nvmrc ? null : formatDisplayDate(daysFromNowIso(30)),
    value: pins.nvmrc || 'Missing',
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
      'Dates update from endoflife.date when you click Refresh dates. Status is only Good, Review, or Urgent.',
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
