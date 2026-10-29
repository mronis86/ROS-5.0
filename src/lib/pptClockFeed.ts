export type PptClockFeed = {
  enabled: boolean;
  imageUrl?: string;
  liveCaptureUrl?: string;
  liveCaptureActive?: boolean;
  slideIndex?: number | null;
  deckName?: string;
  itemId?: number | null;
  auto?: boolean;
};

const AUTO_KEY = (eventId: string) => `ros-ppt-auto-clock:${eventId}`;

export function isPptVdoViewUrl(raw?: string | null): boolean {
  const value = String(raw || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'vdo.ninja' || url.hostname === 'www.vdo.ninja') &&
      !!(url.searchParams.get('view') || url.searchParams.get('scene'))
    );
  } catch {
    return false;
  }
}

export function pptClockFeedHasVisual(feed: Partial<PptClockFeed> | null | undefined): boolean {
  if (!feed) return false;
  if (feed.liveCaptureActive && isPptVdoViewUrl(feed.liveCaptureUrl)) return true;
  return !!String(feed.imageUrl || '').trim();
}

export function readPptClockAuto(eventId: string): boolean {
  if (!eventId) return false;
  try {
    return window.localStorage.getItem(AUTO_KEY(eventId)) === '1';
  } catch {
    return false;
  }
}

export function writePptClockAuto(eventId: string, on: boolean): void {
  if (!eventId) return;
  try {
    window.localStorage.setItem(AUTO_KEY(eventId), on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function parsePptClockSync(data: any): PptClockFeed | null {
  if (!data || data.enabled === false) return null;
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
  const liveCaptureUrl = typeof data.liveCaptureUrl === 'string' ? data.liveCaptureUrl : '';
  const liveCaptureActive = !!data.liveCaptureActive;
  const slideIndex =
    typeof data.slideIndex === 'number' && Number.isFinite(data.slideIndex)
      ? data.slideIndex
      : null;
  const itemId =
    typeof data.itemId === 'number' && Number.isFinite(data.itemId) ? data.itemId : null;
  const next: PptClockFeed = {
    enabled: true,
    imageUrl,
    liveCaptureUrl,
    liveCaptureActive,
    slideIndex,
    deckName: typeof data.deckName === 'string' ? data.deckName : '',
    itemId,
    auto: !!data.auto,
  };
  return pptClockFeedHasVisual(next) ? next : null;
}
