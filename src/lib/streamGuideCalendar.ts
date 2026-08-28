import type { GuideListEntry } from './streamGuideList';
import { minutesToLabel } from './dashboardUtils';

const DEFAULT_TZ = 'America/New_York';

function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcsUtcStamp(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${day}T${h}${min}${s}Z`;
}

function minutesToLocalIcsDateTime(dateStr: string, totalMinutes: number): string {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const h = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}${String(min).padStart(2, '0')}00`;
}

function addDaysToDateKey(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function eventSummary(entry: GuideListEntry): string {
  const name = entry.event.name || 'Stream event';
  if (entry.event.numberOfDays > 1) {
    return `${name} (Day ${entry.dayBlock.dayNumber})`;
  }
  return name;
}

export function buildStreamGuideIcs(entry: GuideListEntry): string {
  const tz = entry.event.timezone?.trim() || DEFAULT_TZ;
  const uid = `ros-stream-${entry.blockKey}@ros-stream-guide`;
  const summary = eventSummary(entry);
  const location = entry.event.location || '';
  const timeLabel =
    entry.dayBlock.dateOnly
      ? 'Schedule times pending — check ROS for updates.'
      : `${minutesToLabel(entry.dayBlock.startMinutes)} – ${minutesToLabel(entry.dayBlock.endMinutes)}`;
  const description = [
    'ROS stream / broadcast reminder',
    timeLabel,
    entry.event.recordStreaming && entry.event.recordStreaming !== 'None'
      ? `Type: ${entry.event.recordStreaming}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ROS//Stream Guide//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtcStamp(new Date())}`,
  ];

  if (entry.dayBlock.dateOnly) {
    const dateKey = entry.dayBlock.calendarDate;
    const endDate = addDaysToDateKey(dateKey, 1);
    lines.push(`DTSTART;VALUE=DATE:${dateKey.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${endDate.replace(/-/g, '')}`);
  } else {
    const start = minutesToLocalIcsDateTime(
      entry.dayBlock.calendarDate,
      entry.dayBlock.startMinutes
    );
    const end = minutesToLocalIcsDateTime(entry.dayBlock.calendarDate, entry.dayBlock.endMinutes);
    lines.push(`DTSTART;TZID=${tz}:${start}`);
    lines.push(`DTEND;TZID=${tz}:${end}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(summary)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
  lines.push('STATUS:CONFIRMED');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  lines.push('');

  return lines.join('\r\n');
}

export function buildStreamGuideGoogleCalendarUrl(entry: GuideListEntry): string | null {
  const tz = entry.event.timezone?.trim() || DEFAULT_TZ;
  const text = encodeURIComponent(eventSummary(entry));
  const location = encodeURIComponent(entry.event.location || '');
  const details = encodeURIComponent(
    [
      'ROS stream reminder',
      entry.dayBlock.dateOnly
        ? 'Times pending in Run of Show — open ROS for schedule updates.'
        : `${minutesToLabel(entry.dayBlock.startMinutes)} – ${minutesToLabel(entry.dayBlock.endMinutes)}`,
    ].join('\n')
  );

  if (entry.dayBlock.dateOnly) {
    const d = entry.dayBlock.calendarDate.replace(/-/g, '');
    const end = addDaysToDateKey(entry.dayBlock.calendarDate, 1).replace(/-/g, '');
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${d}/${end}&details=${details}&location=${location}`;
  }

  const start = minutesToLocalIcsDateTime(
    entry.dayBlock.calendarDate,
    entry.dayBlock.startMinutes
  );
  const end = minutesToLocalIcsDateTime(entry.dayBlock.calendarDate, entry.dayBlock.endMinutes);
  const ctz = encodeURIComponent(tz);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&ctz=${ctz}&details=${details}&location=${location}`;
}

function icsFilename(entry: GuideListEntry): string {
  const safeName = (entry.event.name || 'stream')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `ros-stream-${entry.dayBlock.calendarDate}-${safeName || 'event'}.ics`;
}

export function downloadStreamGuideIcs(entry: GuideListEntry): void {
  const body = buildStreamGuideIcs(entry);
  const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = icsFilename(entry);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
