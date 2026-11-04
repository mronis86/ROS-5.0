/** Rehearsal → In-Show baseline: snapshot schedule at enter, diff during show. */

export type RehearsalBaselineItem = {
  id: number;
  day?: number;
  cue: string;
  segmentName: string;
  programType: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  speakersText: string;
  notes: string;
  assets: string;
};

export type RehearsalBaseline = {
  capturedAt: string;
  itemCount: number;
  items: Record<string, RehearsalBaselineItem>;
};

export type BaselineDiffField =
  | 'cue'
  | 'segmentName'
  | 'programType'
  | 'duration'
  | 'speakers'
  | 'notes'
  | 'assets';

export type BaselineDiffRow = {
  itemId: number;
  kind: 'changed' | 'added' | 'removed';
  cue: string;
  segmentName: string;
  field?: BaselineDiffField;
  fieldLabel?: string;
  before?: string;
  after?: string;
};

type ScheduleLike = {
  id: number;
  day?: number;
  programType?: string;
  segmentName?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  notes?: string;
  assets?: string;
  speakers?: string;
  speakersText?: string;
  customFields?: Record<string, string>;
};

const FIELD_LABELS: Record<BaselineDiffField, string> = {
  cue: 'Cue',
  segmentName: 'Segment',
  programType: 'Program type',
  duration: 'Duration',
  speakers: 'Speakers',
  notes: 'Notes',
  assets: 'Assets',
};

export function formatDurationHms(h: number, m: number, s: number): string {
  const hh = Math.max(0, Math.floor(Number(h) || 0));
  const mm = Math.max(0, Math.floor(Number(m) || 0));
  const ss = Math.max(0, Math.floor(Number(s) || 0));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function norm(v: unknown): string {
  return String(v ?? '').trim();
}

function cueOf(item: ScheduleLike): string {
  return norm(item.customFields?.cue);
}

function speakersOf(item: ScheduleLike): string {
  return norm(item.speakersText || item.speakers);
}

export function snapshotScheduleItem(item: ScheduleLike): RehearsalBaselineItem {
  return {
    id: item.id,
    day: item.day,
    cue: cueOf(item),
    segmentName: norm(item.segmentName),
    programType: norm(item.programType),
    durationHours: Number(item.durationHours) || 0,
    durationMinutes: Number(item.durationMinutes) || 0,
    durationSeconds: Number(item.durationSeconds) || 0,
    speakersText: speakersOf(item),
    notes: norm(item.notes),
    assets: norm(item.assets),
  };
}

export function buildRehearsalBaseline(schedule: ScheduleLike[]): RehearsalBaseline {
  const items: Record<string, RehearsalBaselineItem> = {};
  for (const item of schedule || []) {
    if (item?.id == null) continue;
    items[String(item.id)] = snapshotScheduleItem(item);
  }
  return {
    capturedAt: new Date().toISOString(),
    itemCount: Object.keys(items).length,
    items,
  };
}

export function parseRehearsalBaseline(raw: unknown): RehearsalBaseline | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<RehearsalBaseline>;
  if (!obj.items || typeof obj.items !== 'object') return null;
  return {
    capturedAt: typeof obj.capturedAt === 'string' ? obj.capturedAt : new Date().toISOString(),
    itemCount: typeof obj.itemCount === 'number' ? obj.itemCount : Object.keys(obj.items).length,
    items: obj.items as Record<string, RehearsalBaselineItem>,
  };
}

export function baselineToOriginalDurations(
  baseline: RehearsalBaseline
): Record<number, { durationHours: number; durationMinutes: number; durationSeconds: number }> {
  const out: Record<number, { durationHours: number; durationMinutes: number; durationSeconds: number }> = {};
  for (const [id, item] of Object.entries(baseline.items || {})) {
    const n = Number(id);
    if (!Number.isFinite(n) || !item) continue;
    out[n] = {
      durationHours: item.durationHours ?? 0,
      durationMinutes: item.durationMinutes ?? 0,
      durationSeconds: item.durationSeconds ?? 0,
    };
  }
  return out;
}

export function diffScheduleAgainstBaseline(
  schedule: ScheduleLike[],
  baseline: RehearsalBaseline | null
): BaselineDiffRow[] {
  if (!baseline?.items) return [];
  const diffs: BaselineDiffRow[] = [];
  const currentIds = new Set<number>();

  for (const item of schedule || []) {
    if (item?.id == null) continue;
    currentIds.add(item.id);
    const before = baseline.items[String(item.id)];
    const after = snapshotScheduleItem(item);
    const cue = after.cue || before?.cue || '';
    const segmentName = after.segmentName || before?.segmentName || `Item ${item.id}`;

    if (!before) {
      diffs.push({
        itemId: item.id,
        kind: 'added',
        cue,
        segmentName,
      });
      continue;
    }

    const checks: { field: BaselineDiffField; before: string; after: string }[] = [
      { field: 'cue', before: before.cue, after: after.cue },
      { field: 'segmentName', before: before.segmentName, after: after.segmentName },
      { field: 'programType', before: before.programType, after: after.programType },
      {
        field: 'duration',
        before: formatDurationHms(before.durationHours, before.durationMinutes, before.durationSeconds),
        after: formatDurationHms(after.durationHours, after.durationMinutes, after.durationSeconds),
      },
      { field: 'speakers', before: before.speakersText, after: after.speakersText },
      { field: 'notes', before: before.notes, after: after.notes },
      { field: 'assets', before: before.assets, after: after.assets },
    ];

    for (const c of checks) {
      if (c.before === c.after) continue;
      diffs.push({
        itemId: item.id,
        kind: 'changed',
        cue,
        segmentName,
        field: c.field,
        fieldLabel: FIELD_LABELS[c.field],
        before: c.before || '(empty)',
        after: c.after || '(empty)',
      });
    }
  }

  for (const [id, before] of Object.entries(baseline.items)) {
    const n = Number(id);
    if (!Number.isFinite(n) || currentIds.has(n)) continue;
    diffs.push({
      itemId: n,
      kind: 'removed',
      cue: before.cue || '',
      segmentName: before.segmentName || `Item ${n}`,
    });
  }

  diffs.sort((a, b) => {
    if (a.kind !== b.kind) {
      const order = { removed: 0, added: 1, changed: 2 };
      return order[a.kind] - order[b.kind];
    }
    return a.itemId - b.itemId || String(a.fieldLabel || '').localeCompare(String(b.fieldLabel || ''));
  });

  return diffs;
}
