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
