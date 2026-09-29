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

function escapeCsvField(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeFilter(raw) {
  const f = String(raw || 'participating').trim().toLowerCase();
  if (f === 'all' || f === 'participating' || f === 'top25' || f === 'top10' || f === 'top5') {
    return f;
  }
  return 'participating';
}

/**
 * Build graphics CSV: First Name, Last Initial, State
 * @param {unknown} rosterRaw module_data.civicsBee
 * @param {string} [filterRaw]
 */
function buildCivicsBeeGraphicsCsv(rosterRaw, filterRaw) {
  const filter = normalizeFilter(filterRaw);
  const entries = Array.isArray(rosterRaw?.entries) ? rosterRaw.entries : [];
  const lines = ['First Name,Last Initial,State'];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entryMeetsFilter(entry, filter)) continue;
    const studentName = typeof entry.studentName === 'string' ? entry.studentName.trim() : '';
    if (!studentName) continue;
    const { firstName, lastInitial } = splitStudentNameForGraphics(studentName);
    const state = typeof entry.name === 'string' ? entry.name : '';
    lines.push(
      [escapeCsvField(firstName), escapeCsvField(lastInitial), escapeCsvField(state)].join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildCivicsBeeGraphicsCsv,
  normalizeFilter,
  splitStudentNameForGraphics,
};
