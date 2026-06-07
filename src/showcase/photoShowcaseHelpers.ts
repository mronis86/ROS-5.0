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

export function parseSpeakers(speakersText?: string): ParsedSpeaker[] {
  if (!speakersText) return [];
  try {
    const parsed = JSON.parse(speakersText);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getSpeakerForSlot(speakersText: string | undefined, slot: number): ParsedSpeaker | null {
  return parseSpeakers(speakersText).find((s) => s.slot === slot) ?? null;
}
