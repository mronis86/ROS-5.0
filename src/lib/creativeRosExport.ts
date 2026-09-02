import type { GuestScheduleItem } from './eventGuestLinks';
import { displaySpeakersText } from './guestRosHelpers';

export type CreativeExportField =
  | 'cue'
  | 'start'
  | 'programType'
  | 'duration'
  | 'segmentName'
  | 'speakers'
  | 'notes'
  | 'shotType';

export const CREATIVE_EXPORT_FIELD_OPTIONS: { id: CreativeExportField; label: string }[] = [
  { id: 'cue', label: 'Cue' },
  { id: 'start', label: 'Start' },
  { id: 'programType', label: 'Program type' },
  { id: 'duration', label: 'Duration' },
  { id: 'segmentName', label: 'Segment name' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'notes', label: 'Notes' },
  { id: 'shotType', label: 'Shot type' },
];

export const DEFAULT_CREATIVE_EXPORT_FIELDS: CreativeExportField[] = [
  'cue',
  'segmentName',
  'speakers',
];

function formatDuration(item: GuestScheduleItem): string {
  const h = String(Number(item.durationHours) || 0).padStart(2, '0');
  const m = String(Number(item.durationMinutes) || 0).padStart(2, '0');
  const s = String(Number(item.durationSeconds) || 0).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function stripNotes(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldValue(
  item: GuestScheduleItem,
  field: CreativeExportField,
  startTimeById: Record<number, string>
): string {
  switch (field) {
    case 'cue':
      return String(item.cue || '').trim();
    case 'start':
      return startTimeById[item.id] || '';
    case 'programType':
      return String(item.programType || '').trim();
    case 'duration':
      return formatDuration(item);
    case 'segmentName':
      return String(item.segmentName || '').trim();
    case 'speakers':
      return displaySpeakersText(item.speakersText || item.speakers || '');
    case 'notes':
      return stripNotes(item.notes || '');
    case 'shotType':
      return String(item.shotType || '').trim();
    default:
      return '';
  }
}

function csvEscape(value: string): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCreativeExportCsv(
  items: GuestScheduleItem[],
  fields: CreativeExportField[],
  startTimeById: Record<number, string>
): string {
  const headers = fields.map(
    (id) => CREATIVE_EXPORT_FIELD_OPTIONS.find((o) => o.id === id)?.label || id
  );
  const lines = [headers.map(csvEscape).join(',')];
  for (const item of items) {
    lines.push(fields.map((f) => csvEscape(fieldValue(item, f, startTimeById))).join(','));
  }
  return lines.join('\r\n');
}

export function buildCreativeExportText(
  items: GuestScheduleItem[],
  fields: CreativeExportField[],
  startTimeById: Record<number, string>,
  eventName?: string
): string {
  const blocks: string[] = [];
  if (eventName) blocks.push(eventName, '');
  for (const item of items) {
    const lines: string[] = [];
    for (const field of fields) {
      const label = CREATIVE_EXPORT_FIELD_OPTIONS.find((o) => o.id === field)?.label || field;
      const value = fieldValue(item, field, startTimeById);
      if (!value) {
        lines.push(`${label}:`);
        continue;
      }
      if (value.includes('\n')) {
        lines.push(`${label}:`);
        lines.push(value);
      } else {
        lines.push(`${label}: ${value}`);
      }
    }
    blocks.push(lines.join('\n'), '');
  }
  return blocks.join('\n').trim() + '\n';
}

export function downloadTextFile(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
