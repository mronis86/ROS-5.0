/** Summary + sample rows for backup list / restore preview UI */

export type BackupPreviewSample = {
  cue: string;
  segment: string;
  hasNotes: boolean;
  hasSpeakers: boolean;
  notesPreview: string;
  speakersPreview: string;
};

export type BackupPreviewStats = {
  itemCount: number;
  rowsWithNotes: number;
  notesChars: number;
  rowsWithSpeakers: number;
  samples: BackupPreviewSample[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function cueOf(item: any): string {
  const raw =
    item?.customFields?.cue ??
    item?.cue ??
    '';
  return String(raw || '').trim() || '—';
}

function speakersLabel(item: any): string {
  const raw = item?.speakersText ?? item?.speakers ?? '';
  if (!raw || raw === '[]') return '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed
        .map((s) => s?.fullName || s?.name || '')
        .filter(Boolean)
        .join(', ');
    }
  } catch {
    /* plain text */
  }
  return stripHtml(String(raw)).slice(0, 80);
}

export function getBackupPreviewStats(
  schedule: unknown,
  sampleLimit = 8
): BackupPreviewStats {
  const items = Array.isArray(schedule) ? schedule : [];
  let rowsWithNotes = 0;
  let notesChars = 0;
  let rowsWithSpeakers = 0;
  const samples: BackupPreviewSample[] = [];

  for (const item of items) {
    const notes = item?.notes != null ? String(item.notes) : '';
    const notesTrim = notes.trim();
    const hasNotes = notesTrim.length > 0;
    if (hasNotes) {
      rowsWithNotes += 1;
      notesChars += notes.length;
    }
    const spLabel = speakersLabel(item);
    const hasSpeakers = spLabel.length > 0;
    if (hasSpeakers) rowsWithSpeakers += 1;

    if (samples.length < sampleLimit && (hasNotes || hasSpeakers)) {
      samples.push({
        cue: cueOf(item),
        segment: String(item?.segmentName || '').slice(0, 60),
        hasNotes,
        hasSpeakers,
        notesPreview: hasNotes ? stripHtml(notes).slice(0, 100) : '',
        speakersPreview: spLabel.slice(0, 80),
      });
    }
  }

  return {
    itemCount: items.length,
    rowsWithNotes,
    notesChars,
    rowsWithSpeakers,
    samples,
  };
}
