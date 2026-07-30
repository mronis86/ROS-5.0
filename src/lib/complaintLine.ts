/** Complaint Line categories + labels for capture UI and reports. */

export const COMPLAINT_LINE_CATEGORIES = [
  'complaint',
  'technical',
  'client',
  'other',
] as const;

export type ComplaintLineCategory = (typeof COMPLAINT_LINE_CATEGORIES)[number];

export const COMPLAINT_LINE_CATEGORY_LABELS: Record<ComplaintLineCategory, string> = {
  complaint: 'Complaint',
  technical: 'Technical',
  client: 'Client',
  other: 'Other',
};

export function isComplaintLineCategory(value: unknown): value is ComplaintLineCategory {
  return (
    typeof value === 'string' &&
    (COMPLAINT_LINE_CATEGORIES as readonly string[]).includes(value)
  );
}

export function normalizeComplaintLineCategory(value: unknown): ComplaintLineCategory {
  return isComplaintLineCategory(value) ? value : 'complaint';
}
