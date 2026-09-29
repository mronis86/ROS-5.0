/** Civics Bee Students — US states + territories roster helpers. */

export type CivicsBeeTier = 'top25' | 'top10' | 'top5';

export type CivicsBeeFilter = 'all' | 'participating' | CivicsBeeTier;

export type CivicsBeeEntry = {
  code: string;
  name: string;
  studentName: string;
  participating: boolean;
  /** Furthest advancement; null = not in a Top N cut. */
  tier: CivicsBeeTier | null;
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
    })),
    updatedAt: undefined,
  };
}

function normalizeTier(raw: unknown): CivicsBeeTier | null {
  if (raw === 'top25' || raw === 'top10' || raw === 'top5') return raw;
  return null;
}

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
    });
  }

  return {
    entries: defaults.entries.map((base) => {
      const overlay = byCode.get(base.code);
      if (!overlay) return base;
      const participating = overlay.participating === true;
      return {
        ...base,
        studentName: overlay.studentName ?? '',
        participating,
        tier: participating ? overlay.tier ?? null : null,
      };
    }),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : undefined,
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
    };
  });

  return {
    roster: { ...roster, entries },
    applied,
    unmatched: [...new Set(unmatched)],
    skippedEmpty,
  };
}
