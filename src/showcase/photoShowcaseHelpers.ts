/** Photo View showcase helpers — mirrors PhotoViewPage formatting. */

export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

export function formatNameForTwoLines(fullName: string): { html: string; needsSmallText: boolean } {
  if (!fullName?.trim()) return { html: '', needsSmallText: false };

  const name = fullName.trim();
  const parts = name.split(/\s+/);
  if (parts.length <= 1) return { html: name, needsSmallText: false };

  const titles = ['Dr', 'Dr.', 'Prof', 'Prof.', 'Mr', 'Mr.', 'Mrs', 'Mrs.', 'Ms', 'Ms.'];
  let title = '';
  let rest = [...parts];
  if (titles.includes(rest[0])) {
    title = rest.shift()!;
  }
  if (rest.length <= 1) return { html: name, needsSmallText: false };

  const lastName = rest.pop()!;
  const firstName = rest.join(' ');
  const line1 = [title, firstName].filter(Boolean).join(' ');
  const html = `${line1}<br/>${lastName}`;
  return { html, needsSmallText: name.length > 18 };
}

export function formatSpeakerLocation(location?: string): string {
  if (!location) return 'Unknown';
  if (location === 'Podium') return 'Podium';
  if (location === 'Seat') return 'Seat';
  if (location === 'Virtual') return 'Virtual';
  if (location === 'Moderator') return 'Moderator';
  if (location === 'Ted-Talk' || location === 'Walking') return 'Ted-Talk';
  return location;
}

export type ParsedSpeaker = {
  slot: number;
  fullName: string;
  title?: string;
  org?: string;
  location?: string;
  photoLink?: string;
};

function speakerPhotoUrl(raw: Record<string, unknown>): string {
  return String(raw.photoLink || raw.photoUrl || raw.photo_link || '').trim();
}

export function parseSpeakers(speakersText?: string | unknown[] | null): ParsedSpeaker[] {
  if (!speakersText) return [];
  let parsed: unknown = speakersText;
  if (typeof speakersText === 'string') {
    const trimmed = speakersText.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((raw, index) => {
    const speaker = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const slotRaw = speaker.slot ?? speaker.slotNumber ?? index + 1;
    const slot = Number(slotRaw);
    return {
      ...(speaker as ParsedSpeaker),
      slot: Number.isFinite(slot) && slot >= 1 ? slot : index + 1,
      fullName: String(speaker.fullName || speaker.name || '').trim(),
      title: speaker.title != null ? String(speaker.title) : undefined,
      org: speaker.org != null ? String(speaker.org) : undefined,
      location: speaker.location != null ? String(speaker.location) : undefined,
      photoLink: speakerPhotoUrl(speaker),
    };
  });
}

export function getSpeakerForSlot(speakersText: string | undefined, slot: number): ParsedSpeaker | null {
  return parseSpeakers(speakersText).find((s) => Number(s.slot) === slot) ?? null;
}
