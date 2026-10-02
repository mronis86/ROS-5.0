/**
 * Civics Bee graphics CSV helpers (Node mirror of src/lib/civicsBee.ts formatters).
 */

const TIER_RANK = { top25: 1, top10: 2, top5: 3 };

function entryMeetsFilter(entry, filter) {
  if (filter === 'all') return true;
  if (filter === 'participating') return entry.participating === true;
  if (!entry.participating || !entry.tier) return false;
  const need = TIER_RANK[filter];
  const have = TIER_RANK[entry.tier];
  if (need == null || have == null) return false;
  return have >= need;
}

function isAwardFilter(filter) {
  return (
    filter === '1st' ||
    filter === '2nd' ||
    filter === '3rd' ||
    filter === 'peoplesChoice'
  );
}

function entryMeetsCsvFilter(entry, filter) {
  if (filter === '1st' || filter === '2nd' || filter === '3rd') {
    return entry.participating === true && entry.place === filter;
  }
  if (filter === 'peoplesChoice') {
    return entry.participating === true && entry.peoplesChoice === true;
  }
  return entryMeetsFilter(entry, filter);
}

function splitStudentNameForGraphics(studentName) {
  const trimmed = String(studentName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastInitial: '' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastInitial: '' };
  }
  const last = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  const letterMatch = last.match(/[A-Za-z]/);
  const letter = letterMatch ? letterMatch[0] : last.charAt(0);
  return {
    firstName,
    lastInitial: letter ? letter.toUpperCase() : '',
  };
}

function splitStudentNameFull(studentName) {
  const trimmed = String(studentName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function escapeCsvField(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeFilter(raw) {
  const f = String(raw || 'participating').trim();
  if (
    f === 'all' ||
    f === 'participating' ||
    f === 'top25' ||
    f === 'top10' ||
    f === 'top5' ||
    f === '1st' ||
    f === '2nd' ||
    f === '3rd' ||
    f === 'peoplesChoice'
  ) {
    return f;
  }
  if (f === 'peoples' || f === 'peoples-choice' || f === 'people') return 'peoplesChoice';
  if (f === 'awards') return 'top5';
  return 'participating';
}

/** "Bob Smith" → "Bob S" for Top 25 / 10 / 5 graphics. */
function formatCivicsBeeShortDisplayName(studentName) {
  const { firstName, lastInitial } = splitStudentNameForGraphics(studentName);
  if (!firstName) return lastInitial;
  if (!lastInitial) return firstName;
  return `${firstName} ${lastInitial}`;
}

/**
 * Build graphics CSV.
 * Tier/roster: Name, State — e.g. "Bob S","Alabama"
 * Award feeds: Name, State — e.g. "Bob Smith","Alabama"
 * @param {unknown} rosterRaw module_data.civicsBee
 * @param {string} [filterRaw]
 */
function buildCivicsBeeGraphicsCsv(rosterRaw, filterRaw) {
  const filter = normalizeFilter(filterRaw);
  const entries = Array.isArray(rosterRaw?.entries) ? rosterRaw.entries : [];
  const awardMode = isAwardFilter(filter);
  const lines = ['Name,State'];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entryMeetsCsvFilter(entry, filter)) continue;
    const studentName =
      typeof entry.studentName === 'string'
        ? entry.studentName.trim().replace(/\s+/g, ' ')
        : '';
    if (!studentName) continue;
    const state = typeof entry.name === 'string' ? entry.name : '';
    const displayName = awardMode
      ? studentName
      : formatCivicsBeeShortDisplayName(studentName);
    if (!displayName) continue;
    lines.push([escapeCsvField(displayName), escapeCsvField(state)].join(','));
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildCivicsBeeGraphicsCsv,
  normalizeFilter,
  splitStudentNameForGraphics,
  splitStudentNameFull,
  formatCivicsBeeShortDisplayName,
};
