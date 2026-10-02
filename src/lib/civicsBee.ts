/** Civics Bee Students — US states + territories roster helpers. */

export type CivicsBeeTier = 'top25' | 'top10' | 'top5';

export type CivicsBeeFilter = 'all' | 'participating' | CivicsBeeTier;

/** Final podium places (exclusive across the roster). */
export type CivicsBeePlace = '1st' | '2nd' | '3rd';

export type CivicsBeeEntry = {
  code: string;
  name: string;
  studentName: string;
  participating: boolean;
  /** Furthest advancement; null = not in a Top N cut. */
  tier: CivicsBeeTier | null;
  /** Podium place — only one student per place. */
  place: CivicsBeePlace | null;
  /** People's Choice — at most one student. Can stack with a podium place. */
  peoplesChoice: boolean;
};

export type CivicsBeeRoster = {
  entries: CivicsBeeEntry[];
  updatedAt?: string;
};

/** 50 states + DC + five inhabited territories commonly used in national student competitions. */
export const US_JURISDICTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'AS', name: 'American Samoa' },
  { code: 'GU', name: 'Guam' },
  { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
] as const;

const TIER_RANK: Record<CivicsBeeTier, number> = {
  top25: 1,
  top10: 2,
  top5: 3,
};

export function createDefaultCivicsBeeRoster(): CivicsBeeRoster {
  return {
    entries: US_JURISDICTIONS.map(({ code, name }) => ({
      code,
      name,
      studentName: '',
      participating: false,
      tier: null,
      place: null,
      peoplesChoice: false,
    })),
    updatedAt: undefined,
  };
}

function normalizeTier(raw: unknown): CivicsBeeTier | null {
  if (raw === 'top25' || raw === 'top10' || raw === 'top5') return raw;
  return null;
}

function normalizePlace(raw: unknown): CivicsBeePlace | null {
  if (raw === '1st' || raw === '2nd' || raw === '3rd') return raw;
  return null;
}

export const CIVICS_BEE_PLACE_OPTIONS: Array<{ value: CivicsBeePlace; label: string }> = [
  { value: '3rd', label: '3rd' },
  { value: '2nd', label: '2nd' },
  { value: '1st', label: '1st' },
];

export function parseCivicsBeeRoster(raw: unknown): CivicsBeeRoster {
  const defaults = createDefaultCivicsBeeRoster();
  if (!raw || typeof raw !== 'object') return defaults;

  const src = raw as Record<string, unknown>;
  const byCode = new Map<string, Partial<CivicsBeeEntry>>();
  const list = Array.isArray(src.entries) ? src.entries : [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const e = row as Record<string, unknown>;
    const code = String(e.code || '').trim().toUpperCase();
    if (!code) continue;
    byCode.set(code, {
      studentName: typeof e.studentName === 'string' ? e.studentName : '',
      participating: e.participating === true,
      tier: normalizeTier(e.tier),
      place: normalizePlace(e.place),
      peoplesChoice: e.peoplesChoice === true,
    });
  }

  return {
    entries: defaults.entries.map((base) => {
      const overlay = byCode.get(base.code);
      if (!overlay) return base;
      const participating = overlay.participating === true;
      const tier = participating ? overlay.tier ?? null : null;
      const inTop5 = participating && tier === 'top5';
      return {
        ...base,
        studentName: overlay.studentName ?? '',
        participating,
        tier,
        place: inTop5 ? overlay.place ?? null : null,
        peoplesChoice: inTop5 ? overlay.peoplesChoice === true : false,
      };
    }),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : undefined,
  };
}

/**
 * Toggle a podium place on one entry. Clears that place from everyone else.
 * Toggle off if the same place is already set on this entry.
 */
export function applyCivicsBeePlace(
  roster: CivicsBeeRoster,
  code: string,
  place: CivicsBeePlace
): CivicsBeeRoster {
  const target = roster.entries.find((e) => e.code === code);
  if (!target || !target.participating || target.tier !== 'top5') return roster;
  const clearing = target.place === place;
  return {
    ...roster,
    entries: roster.entries.map((e) => {
      if (e.code === code) {
        return { ...e, place: clearing ? null : place, participating: true };
      }
      if (!clearing && e.place === place) {
        return { ...e, place: null };
      }
      return e;
    }),
  };
}

/** Toggle People's Choice on one entry (exclusive). */
export function applyCivicsBeePeoplesChoice(
  roster: CivicsBeeRoster,
  code: string,
  enabled: boolean
): CivicsBeeRoster {
  const target = roster.entries.find((e) => e.code === code);
  if (!target || !target.participating || target.tier !== 'top5') return roster;
  return {
    ...roster,
    entries: roster.entries.map((e) => {
      if (e.code === code) {
        return { ...e, peoplesChoice: enabled, participating: true };
      }
      if (enabled && e.peoplesChoice) {
        return { ...e, peoplesChoice: false };
      }
      return e;
    }),
  };
}

export function entryMeetsFilter(entry: CivicsBeeEntry, filter: CivicsBeeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'participating') return entry.participating;
  if (!entry.participating || !entry.tier) return false;
  return TIER_RANK[entry.tier] >= TIER_RANK[filter];
}

export function filterCivicsBeeEntries(
  entries: CivicsBeeEntry[],
  filter: CivicsBeeFilter
): CivicsBeeEntry[] {
  return entries.filter((e) => entryMeetsFilter(e, filter));
}

export function countCivicsBeeByFilter(
  entries: CivicsBeeEntry[],
  filter: CivicsBeeFilter
): number {
  return filterCivicsBeeEntries(entries, filter).length;
}

export const CIVICS_BEE_FILTER_LABELS: Record<CivicsBeeFilter, string> = {
  all: 'All',
  participating: 'Participating',
  top25: 'Top 25',
  top10: 'Top 10',
  top5: 'Top 5',
};

export const CIVICS_BEE_TIER_OPTIONS: Array<{ value: CivicsBeeTier | ''; label: string }> = [
  { value: '', label: '—' },
  { value: 'top25', label: 'Top 25' },
  { value: 'top10', label: 'Top 10' },
  { value: 'top5', label: 'Top 5' },
];

/** Collapse punctuation / spacing for fuzzy jurisdiction matching. */
export function normalizeJurisdictionKey(raw: string): string {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const JURISDICTION_ALIASES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const add = (alias: string, code: string) => {
    const key = normalizeJurisdictionKey(alias);
    if (key) map[key] = code.toUpperCase();
  };
  for (const { code, name } of US_JURISDICTIONS) {
    add(code, code);
    add(name, code);
  }
  // Common spreadsheet variants
  add('Washington DC', 'DC');
  add('Washington D C', 'DC');
  add('D C', 'DC');
  add('District of Columbia DC', 'DC');
  add('US Virgin Islands', 'VI');
  add('U S Virgin Islands', 'VI');
  add('Virgin Islands', 'VI');
  add('Northern Marianas', 'MP');
  add('CNMI', 'MP');
  add('NMI', 'MP');
  add('Puerto Rico PR', 'PR');
  return map;
})();

/** Resolve a spreadsheet state cell to a roster jurisdiction code, or null. */
export function resolveJurisdictionCode(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (US_JURISDICTIONS.some((j) => j.code === upper)) return upper;
  const key = normalizeJurisdictionKey(trimmed);
  if (!key) return null;
  if (JURISDICTION_ALIASES[key]) return JURISDICTION_ALIASES[key];
  // Compact form without spaces (e.g. "newyork")
  const compact = key.replace(/\s+/g, '');
  for (const [alias, code] of Object.entries(JURISDICTION_ALIASES)) {
    if (alias.replace(/\s+/g, '') === compact) return code;
  }
  return null;
}

export function mergeStudentNames(first: string, last: string): string {
  return [String(first || '').trim(), String(last || '').trim()].filter(Boolean).join(' ');
}

/** Split "First … Last" into first name(s) + last-name initial for graphics. */
export function splitStudentNameForGraphics(studentName: string): {
  firstName: string;
  lastInitial: string;
} {
  const trimmed = String(studentName || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return { firstName: '', lastInitial: '' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastInitial: '' };
  }
  const last = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  const letter = last.match(/[A-Za-z]/)?.[0] || last.charAt(0);
  return {
    firstName,
    lastInitial: letter ? letter.toUpperCase() : '',
  };
}

/** Split "First … Last" into first name(s) + full last name (award CSVs). */
export function splitStudentNameFull(studentName: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = String(studentName || '').trim().replace(/\s+/g, ' ');
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

export function isCivicsBeeAwardCsvFilter(
  filter: CivicsBeeCsvFilter
): filter is CivicsBeePlace | 'peoplesChoice' {
  return (
    filter === '1st' ||
    filter === '2nd' ||
    filter === '3rd' ||
    filter === 'peoplesChoice'
  );
}

function escapeCivicsCsvField(value: string): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV / live-URL filter: roster tiers plus award slices. */
export type CivicsBeeCsvFilter = CivicsBeeFilter | CivicsBeePlace | 'peoplesChoice';

export const CIVICS_BEE_AWARD_CSV_OPTIONS: Array<{
  value: CivicsBeePlace | 'peoplesChoice';
  label: string;
  fileSlug: string;
}> = [
  { value: '1st', label: '1st Place', fileSlug: '1st' },
  { value: '2nd', label: '2nd Place', fileSlug: '2nd' },
  { value: '3rd', label: '3rd Place', fileSlug: '3rd' },
  { value: 'peoplesChoice', label: "People's Choice", fileSlug: 'peoples-choice' },
];

export const CIVICS_BEE_CSV_FILTER_LABELS: Record<string, string> = {
  ...CIVICS_BEE_FILTER_LABELS,
  '1st': '1st Place',
  '2nd': '2nd Place',
  '3rd': '3rd Place',
  peoplesChoice: "People's Choice",
};

export function normalizeCivicsBeeCsvFilter(raw: unknown): CivicsBeeCsvFilter {
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
  // common aliases
  if (f === 'peoples' || f === 'peoples-choice' || f === 'people') return 'peoplesChoice';
  // legacy combined awards feed → top5 roster slice
  if (f === 'awards') return 'top5';
  return 'participating';
}

export function entryMeetsCsvFilter(entry: CivicsBeeEntry, filter: CivicsBeeCsvFilter): boolean {
  if (filter === '1st' || filter === '2nd' || filter === '3rd') {
    return entry.participating && entry.place === filter;
  }
  if (filter === 'peoplesChoice') {
    return entry.participating && entry.peoplesChoice === true;
  }
  return entryMeetsFilter(entry, filter);
}

export type CivicsBeeGraphicsRow = {
  firstName: string;
  lastInitial: string;
  state: string;
  code: string;
};

export type CivicsBeeAwardCsvRow = {
  firstName: string;
  lastName: string;
  state: string;
  code: string;
};

/** Graphics-oriented rows: First Name, Last initial, State (full name). */
export function buildCivicsBeeGraphicsRows(
  entries: CivicsBeeEntry[],
  filter: CivicsBeeCsvFilter = 'participating'
): CivicsBeeGraphicsRow[] {
  return entries
    .filter((e) => entryMeetsCsvFilter(e, filter))
    .filter((e) => e.studentName.trim().length > 0)
    .map((e) => {
      const { firstName, lastInitial } = splitStudentNameForGraphics(e.studentName);
      return {
        firstName,
        lastInitial,
        state: e.name,
        code: e.code,
      };
    });
}

/** Award rows: First Name, full Last Name, State. */
export function buildCivicsBeeAwardCsvRows(
  entries: CivicsBeeEntry[],
  filter: CivicsBeePlace | 'peoplesChoice'
): CivicsBeeAwardCsvRow[] {
  return entries
    .filter((e) => entryMeetsCsvFilter(e, filter))
    .filter((e) => e.studentName.trim().length > 0)
    .map((e) => {
      const { firstName, lastName } = splitStudentNameFull(e.studentName);
      return {
        firstName,
        lastName,
        state: e.name,
        code: e.code,
      };
    });
}

/** "Bob Smith" → "Bob S" for Top 25 / 10 / 5 graphics. */
export function formatCivicsBeeShortDisplayName(studentName: string): string {
  const { firstName, lastInitial } = splitStudentNameForGraphics(studentName);
  if (!firstName) return lastInitial;
  if (!lastInitial) return firstName;
  return `${firstName} ${lastInitial}`;
}

/**
 * CSV for custom graphics.
 * Tier/roster (Top 25/10/5 etc.): Name, State — e.g. "Bob S","Alabama"
 * Award feeds (1st/2nd/3rd/People's): Name, State — e.g. "Bob Smith","Alabama"
 */
export function buildCivicsBeeGraphicsCsv(
  entries: CivicsBeeEntry[],
  filter: CivicsBeeCsvFilter = 'participating'
): string {
  const lines = ['Name,State'];

  if (isCivicsBeeAwardCsvFilter(filter)) {
    for (const entry of entries) {
      if (!entryMeetsCsvFilter(entry, filter)) continue;
      const fullName = String(entry.studentName || '').trim().replace(/\s+/g, ' ');
      if (!fullName) continue;
      lines.push(
        [escapeCivicsCsvField(fullName), escapeCivicsCsvField(entry.name)].join(',')
      );
    }
    return `${lines.join('\n')}\n`;
  }

  for (const entry of entries) {
    if (!entryMeetsCsvFilter(entry, filter)) continue;
    const fullName = String(entry.studentName || '').trim();
    if (!fullName) continue;
    const shortName = formatCivicsBeeShortDisplayName(fullName);
    if (!shortName) continue;
    lines.push(
      [escapeCivicsCsvField(shortName), escapeCivicsCsvField(entry.name)].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export type CivicsBeeImportRow = {
  stateRaw: string;
  firstName: string;
  lastName: string;
};

export type CivicsBeeImportResult = {
  roster: CivicsBeeRoster;
  applied: number;
  unmatched: string[];
  skippedEmpty: number;
};

/**
 * Apply spreadsheet rows onto the roster: merge first+last → studentName,
 * match state/territory, and mark matched rows as participating (in game).
 * Unmatched states are left unchanged and reported.
 */
export function applyCivicsBeeImportRows(
  roster: CivicsBeeRoster,
  rows: CivicsBeeImportRow[]
): CivicsBeeImportResult {
  const byCode = new Map<string, { studentName: string }>();
  const unmatched: string[] = [];
  let skippedEmpty = 0;

  for (const row of rows) {
    const studentName = mergeStudentNames(row.firstName, row.lastName);
    const stateRaw = String(row.stateRaw || '').trim();
    if (!stateRaw && !studentName) {
      skippedEmpty += 1;
      continue;
    }
    const code = resolveJurisdictionCode(stateRaw);
    if (!code) {
      if (stateRaw) unmatched.push(stateRaw);
      else skippedEmpty += 1;
      continue;
    }
    if (!studentName) {
      skippedEmpty += 1;
      continue;
    }
    byCode.set(code, { studentName });
  }

  let applied = 0;
  const entries = roster.entries.map((entry) => {
    const hit = byCode.get(entry.code);
    if (!hit) return entry;
    applied += 1;
    return {
      ...entry,
      studentName: hit.studentName,
      participating: true,
      // Keep existing tier / awards; import only fills names + In game
    };
  });

  return {
    roster: { ...roster, entries },
    applied,
    unmatched: [...new Set(unmatched)],
    skippedEmpty,
  };
}
