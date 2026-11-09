/** Station / page identity for Admin hot-display traffic tracking. */

export const DISPLAY_STATION_LABEL_KEY = 'ros-display-label';

const PAGE_LABELS: Array<{ test: RegExp; label: string }> = [
  { test: /powerpoint-playback|\/powerpoint\/?$/i, label: 'PPT Launcher' },
  { test: /\/dsm-clock/i, label: 'DSM Clock' },
  { test: /\/clock/i, label: 'Clock' },
  { test: /fullscreen-timer|\/timer/i, label: 'Full Screen Timer' },
  { test: /green-room/i, label: 'Green Room' },
  { test: /photo-view|\/photo/i, label: 'Photo View' },
  { test: /operator-cue|cue-display/i, label: 'Operator Cue Display' },
  { test: /mic-manager/i, label: 'Mic Manager' },
  { test: /teleprompter/i, label: 'Teleprompter' },
  { test: /scripts-follow|\/scripts/i, label: 'Scripts Follow' },
  { test: /content-review/i, label: 'Content Review' },
  { test: /creative/i, label: 'Creative ROS' },
  { test: /run-of-show|\/ros\b/i, label: 'Run of Show' },
  { test: /admin/i, label: 'Admin' },
];

export function getDisplayStationLabel(): string {
  try {
    return String(localStorage.getItem(DISPLAY_STATION_LABEL_KEY) || '').trim().slice(0, 64);
  } catch {
    return '';
  }
}

export function setDisplayStationLabel(label: string): void {
  try {
    const next = String(label || '').trim().slice(0, 64);
    if (next) localStorage.setItem(DISPLAY_STATION_LABEL_KEY, next);
    else localStorage.removeItem(DISPLAY_STATION_LABEL_KEY);
  } catch {
    /* ignore */
  }
}

export function inferDisplayClientPage(pathname = typeof window !== 'undefined' ? window.location.pathname : ''): string {
  const path = String(pathname || '');
  for (const row of PAGE_LABELS) {
    if (row.test.test(path)) return row.label;
  }
  const clean = path.replace(/^\//, '').split('/')[0];
  return clean ? clean.slice(0, 40) : 'web';
}

/** Headers merged into display/API polls so Admin can show page + station. */
export function displayClientIdentityHeaders(pageOverride?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-ROS-Client-Page': pageOverride || inferDisplayClientPage(),
  };
  const station = getDisplayStationLabel();
  if (station) headers['X-ROS-Display-Label'] = station;
  return headers;
}
