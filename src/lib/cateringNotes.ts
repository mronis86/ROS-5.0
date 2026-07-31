/** Catering note categories for shared event board. */

export const CATERING_NOTE_CATEGORIES = [
  'general',
  'break',
  'plating',
  'meal',
  'other',
] as const;

export type CateringNoteCategory = (typeof CATERING_NOTE_CATEGORIES)[number];

export const CATERING_NOTE_CATEGORY_LABELS: Record<CateringNoteCategory, string> = {
  general: 'General',
  break: 'Break / Lunch',
  plating: 'Plating',
  meal: 'Meal',
  other: 'Other',
};

export function isCateringNoteCategory(value: unknown): value is CateringNoteCategory {
  return (
    typeof value === 'string' &&
    (CATERING_NOTE_CATEGORIES as readonly string[]).includes(value)
  );
}

export function normalizeCateringNoteCategory(value: unknown): CateringNoteCategory {
  return isCateringNoteCategory(value) ? value : 'general';
}

/** Program types that usually matter for F&B / plating. */
export function isCateringRelevantProgramType(programType?: string): boolean {
  const t = String(programType || '').toLowerCase();
  return (
    t.includes('break') ||
    t.includes('f&b') ||
    t.includes('lunch') ||
    t.includes('meal') ||
    t.includes('reception') ||
    t.includes('dinner')
  );
}
