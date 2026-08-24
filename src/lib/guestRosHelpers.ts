import { stripHtmlNotes } from './eventGuestLinks';

export const ROS_PROGRAM_TYPES = [
  'PreShow/End',
  'Podium Transition',
  'Panel Transition',
  'Full-Stage/Ted-Talk',
  'Sub Cue',
  'No Transition',
  'Video',
  'Panel+Remote',
  'Remote Only',
  'Break F&B/B2B',
  'Breakout Session',
  'Delay Block',
  'TBD',
  'KILLED',
];

export const ROS_PROGRAM_TYPE_COLORS: Record<string, string> = {
  'PreShow/End': '#8B5CF6',
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#F3F4F6',
  'No Transition': '#059669',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  'Delay Block': '#7C3AED',
  TBD: '#6B7280',
  KILLED: '#DC2626',
  'Full-Stage/Ted-Talk': '#EA580C',
};

export const ROS_SHOT_TYPES = [
  'Podium',
  '1-Shot',
  '2-Shot',
  '3-Shot',
  '4-Shot',
  '5-Shot',
  '6-Shot',
  '7-Shot',
  'Ted-Talk',
];

export const GUEST_COLUMN_WIDTHS = {
  start: 128,
  programType: 224,
  duration: 224,
  segmentName: 320,
  shotType: 192,
  pptQA: 192,
  notes: 384,
  speakers: 384,
};

export const GUEST_VISIBLE_COLUMNS = {
  start: true,
  programType: true,
  duration: true,
  segmentName: true,
  shotType: true,
  pptQA: true,
  recording: false,
  notes: true,
  assets: false,
  participants: false,
  speakers: true,
  public: false,
  timer: false,
  custom: false,
};

export function displaySpeakersText(speakersTextJson: string): string {
  if (!speakersTextJson) return '';
  try {
    const speakers = JSON.parse(speakersTextJson);
    if (!Array.isArray(speakers) || speakers.length === 0) return '';
    return speakers
      .sort((a: { slot?: number }, b: { slot?: number }) => (a.slot || 0) - (b.slot || 0))
      .filter((speaker: { fullName?: string }) => speaker.fullName && String(speaker.fullName).trim())
      .map((speaker: { location?: string; slot?: number; fullName?: string }) => {
        const location =
          speaker.location === 'Podium'
            ? 'P'
            : speaker.location === 'Seat'
              ? 'S'
              : speaker.location === 'Virtual'
                ? 'V'
                : 'M';
        return `${location}${speaker.slot} - ${speaker.fullName || 'Unnamed'}`;
      })
      .join('\n');
  } catch {
    return speakersTextJson;
  }
}

export function getRowBackgroundColor(programType: string, index: number): string {
  const baseColor = ROS_PROGRAM_TYPE_COLORS[programType];
  if (!baseColor) return index % 2 === 0 ? 'rgba(30,41,59,1)' : 'rgba(15,23,42,1)';
  const hex = baseColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.3)`;
}

export function estimateRowHeightRem(
  notes: string,
  speakersText?: string,
  _participants?: string,
  _customFields?: unknown,
  _customColumns?: unknown[],
  voCueCount = 0
): string {
  let maxHeight = 6.5;
  if (voCueCount > 0) maxHeight = Math.max(maxHeight, 7);

  if (notes && notes.trim()) {
    const plain = stripHtmlNotes(notes);
    const lineCount = plain.split('\n').filter(Boolean).length;
    const wrapped = Math.ceil(plain.length / 42);
    maxHeight = Math.max(maxHeight, 4 + Math.max(lineCount, wrapped) * 1.35);
  }

  if (speakersText && speakersText.trim()) {
    try {
      const parsed = JSON.parse(speakersText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        maxHeight = Math.max(maxHeight, 4 + parsed.length * 1.5);
      }
    } catch {
      const lines = speakersText.split('\n').filter(Boolean).length;
      maxHeight = Math.max(maxHeight, 4 + lines * 1.5);
    }
  }

  return `${Math.min(maxHeight, 28)}rem`;
}

export function formatCueDisplay(cue?: string): string {
  if (!cue) return '';
  const trimmed = cue.trim();
  if (/^cue\s/i.test(trimmed)) return trimmed;
  return `CUE ${trimmed}`;
}

export function cueFieldValue(cue?: string): string {
  if (!cue) return '';
  return cue.replace(/^CUE\s*/i, '').trim();
}

/** Map guest API rows into the shape ScheduleRow expects. */
export function toScheduleRowItem(item: {
  id: number;
  day?: number;
  segmentName?: string;
  programType?: string;
  shotType?: string;
  durationHours?: number;
  durationMinutes?: number;
  durationSeconds?: number;
  speakers?: string;
  speakersText?: string;
  notes?: string;
  cue?: string;
  isIndented?: boolean;
  hasPPT?: boolean;
  hasQA?: boolean;
  needsRecording?: boolean;
  assets?: string;
  isPublic?: boolean;
  customFields?: Record<string, unknown>;
}): Record<string, unknown> {
  const custom =
    item.customFields && typeof item.customFields === 'object' ? { ...item.customFields } : {};
  const cueRaw = String(custom.cue || item.cue || '').trim();
  if (cueRaw && !custom.cue) {
    custom.cue = cueRaw.startsWith('CUE') ? cueRaw : `CUE ${cueRaw}`;
  }
  return {
    id: item.id,
    day: item.day || 1,
    segmentName: item.segmentName || '',
    programType: item.programType || '',
    shotType: item.shotType || '',
    durationHours: item.durationHours ?? 0,
    durationMinutes: item.durationMinutes ?? 0,
    durationSeconds: item.durationSeconds ?? 0,
    speakers: item.speakers || '',
    speakersText: item.speakersText || '',
    notes: item.notes || '',
    assets: item.assets || '',
    hasPPT: !!item.hasPPT,
    hasQA: !!item.hasQA,
    needsRecording: !!item.needsRecording,
    isPublic: !!item.isPublic,
    isIndented: !!item.isIndented,
    customFields: custom,
  };
}

export function buildIndentedLookup(items: { id: number; isIndented?: boolean }[]): Record<number, boolean> {
  const map: Record<number, boolean> = {};
  for (const item of items) {
    if (item.isIndented) map[item.id] = true;
  }
  return map;
}

export const noop = (): void => undefined;
