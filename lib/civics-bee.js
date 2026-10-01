/**
 * Civics Bee graphics CSV helpers (Node mirror of src/lib/civicsBee.ts formatters).
 */

const TIER_RANK = { top25: 1, top10: 2, top5: 3 };
const AWARD_SORT_RANK = { '1st': 1, '2nd': 2, '3rd': 3 };

function entryMeetsFilter(entry, filter) {
  if (filter === 'all') return true;
  if (filter === 'participating') return entry.participating === true;
  if (!entry.participating || !entry.tier) return false;
  const need = TIER_RANK[filter];
  const have = TIER_RANK[entry.tier];
  if (need == null || have == null) return false;
  return have >= need;
}

function entryMeetsCsvFilter(entry, filter) {
  if (filter === '1st' || filter === '2nd' || filter === '3rd') {
    return entry.participating === true && entry.place === filter;
  }
  if (filter === 'peoplesChoice') {
    return entry.participating === true && entry.peoplesChoice === true;
  }
  if (filter === 'awards') {
    return (
      entry.participating === true &&
      (!!entry.place || entry.peoplesChoice === true)
    );
  }
  return entryMeetsFilter(entry, filter);
}

function awardSortKey(entry) {
  if (entry.place && AWARD_SORT_RANK[entry.place] != null) return AWARD_SORT_RANK[entry.place];
  if (entry.peoplesChoice) return 4;
  return 99;
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
    f === 'peoplesChoice' ||
    f === 'awards'
  ) {
    return f;
  }
  if (f === 'peoples' || f === 'peoples-choice' || f === 'people') return 'peoplesChoice';
  return 'participating';
}

/**
 * Build graphics CSV: First Name, Last Initial, State, Place, People's Choice, Award
 * @param {unknown} rosterRaw module_data.civicsBee
 * @param {string} [filterRaw]
 */
function buildCivicsBeeGraphicsCsv(rosterRaw, filterRaw) {
  const filter = normalizeFilter(filterRaw);
  const entries = Array.isArray(rosterRaw?.entries) ? rosterRaw.entries : [];
  const lines = ["First Name,Last Initial,State,Place,People's Choice,Award"];

  const matched = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entryMeetsCsvFilter(entry, filter)) continue;
    const studentName = typeof entry.studentName === 'string' ? entry.studentName.trim() : '';
    if (!studentName) continue;
    matched.push(entry);
  }

  const isAwardFilter =
    filter === 'awards' ||
    filter === '1st' ||
    filter === '2nd' ||
    filter === '3rd' ||
    filter === 'peoplesChoice';
  if (isAwardFilter) {
    matched.sort((a, b) => {
      const d = awardSortKey(a) - awardSortKey(b);
      if (d !== 0) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  for (const entry of matched) {
    const studentName = typeof entry.studentName === 'string' ? entry.studentName.trim() : '';
    const { firstName, lastInitial } = splitStudentNameForGraphics(studentName);
    const state = typeof entry.name === 'string' ? entry.name : '';
    const place =
      entry.place === '1st' || entry.place === '2nd' || entry.place === '3rd' ? entry.place : '';
    const peoplesChoice = entry.peoplesChoice === true ? 'Yes' : '';
    const awardParts = [];
    if (place) awardParts.push(place);
    if (entry.peoplesChoice === true) awardParts.push("People's Choice");
    lines.push(
      [
        escapeCsvField(firstName),
        escapeCsvField(lastInitial),
        escapeCsvField(state),
        escapeCsvField(place),
        escapeCsvField(peoplesChoice),
        escapeCsvField(awardParts.join(' + ')),
      ].join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildCivicsBeeGraphicsCsv,
  normalizeFilter,
  splitStudentNameForGraphics,
};
