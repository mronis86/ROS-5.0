/** Global + per-event Pre-Flight checklist feature gates. */

export const PREFLIGHT_FEATURE_STORAGE_KEY = 'ros.preflightChecklistEnabled';
export const PREFLIGHT_FEATURE_CHANGE_EVENT = 'ros:preflight-checklist-enabled-change';

let cachedPreflightFeatureEnabled: boolean | null = null;

function readFromStorage(): boolean | null {
  try {
    const raw = localStorage.getItem(PREFLIGHT_FEATURE_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return null;
}

/** Global Admin switch (app_settings). Off by default until enabled. */
export function getPreflightFeatureEnabled(): boolean {
  if (cachedPreflightFeatureEnabled != null) return cachedPreflightFeatureEnabled;
  return readFromStorage() ?? false;
}

export function applyPreflightFeatureEnabled(enabled: boolean): void {
  cachedPreflightFeatureEnabled = !!enabled;
  try {
    localStorage.setItem(PREFLIGHT_FEATURE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PREFLIGHT_FEATURE_CHANGE_EVENT, {
        detail: { preflightChecklistEnabled: !!enabled },
      })
    );
  }
}

/** Per-event flag on calendar schedule_data / Event. */
export function parsePreflightChecklistEnabled(scheduleData: unknown): boolean {
  if (!scheduleData || typeof scheduleData !== 'object') return false;
  return (scheduleData as { preflightChecklistEnabled?: unknown }).preflightChecklistEnabled === true;
}

export function eventHasPreflightChecklist(
  event: { preflightChecklistEnabled?: boolean } | null | undefined
): boolean {
  return event?.preflightChecklistEnabled === true;
}

/** Both global Admin switch and this event must be on. */
export function isPreflightChecklistActive(
  event: { preflightChecklistEnabled?: boolean } | null | undefined
): boolean {
  return getPreflightFeatureEnabled() && eventHasPreflightChecklist(event);
}
