/** Quick Mode registers a hidden calendar row so active_timers can use a UUID event_id. */

export type QuickModeCalendarLike = {
  name?: string;
  schedule_data?: Record<string, unknown> | null;
};

export const QUICK_MODE_SESSION_EVENT_KEY = 'ros.quickMode.sessionEventId';
const QUICK_MODE_LAST_CREATED_ID_KEY = 'ros.quickMode.lastCreatedId';
const QUICK_MODE_LAST_CREATED_AT_KEY = 'ros.quickMode.lastCreatedAt';
const FORCE_NEW_DEDUPE_MS = 5000;

export const isValidQuickModeEventUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

const parseScheduleData = (scheduleData: QuickModeCalendarLike['schedule_data']) => {
  if (typeof scheduleData === 'string') {
    try {
      return JSON.parse(scheduleData) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return scheduleData && typeof scheduleData === 'object' ? scheduleData : {};
};

export const isQuickModeCalendarEvent = (calEvent: QuickModeCalendarLike): boolean => {
  const sd = parseScheduleData(calEvent.schedule_data);
  if (sd.quickMode === true) return true;
  if (sd.source === 'quick-mode') return true;
  if (/^Quick Mode/i.test(String(calEvent.name || ''))) return true;
  return false;
};

let quickModeEventCreationPromise: Promise<string> | null = null;

const readRecentForceNewId = (): string | null => {
  try {
    const id = sessionStorage.getItem(QUICK_MODE_LAST_CREATED_ID_KEY)?.trim() || '';
    const at = Number(sessionStorage.getItem(QUICK_MODE_LAST_CREATED_AT_KEY) || '0');
    if (id && isValidQuickModeEventUuid(id) && Date.now() - at < FORCE_NEW_DEDUPE_MS) {
      return id;
    }
  } catch {
    // ignore
  }
  return null;
};

const markRecentForceNewId = (id: string): void => {
  try {
    sessionStorage.setItem(QUICK_MODE_LAST_CREATED_ID_KEY, id);
    sessionStorage.setItem(QUICK_MODE_LAST_CREATED_AT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
};

export function clearQuickModeSessionEventId(): void {
  try {
    sessionStorage.removeItem(QUICK_MODE_SESSION_EVENT_KEY);
  } catch {
    // ignore
  }
}

export function clearQuickModeNewSessionDedupe(): void {
  try {
    sessionStorage.removeItem(QUICK_MODE_LAST_CREATED_ID_KEY);
    sessionStorage.removeItem(QUICK_MODE_LAST_CREATED_AT_KEY);
  } catch {
    // ignore
  }
}

const persistEventId = (id: string): string | null => {
  if (!isValidQuickModeEventUuid(id)) return null;
  try {
    sessionStorage.setItem(QUICK_MODE_SESSION_EVENT_KEY, id);
  } catch {
    // ignore
  }
  return id;
};

export async function resolveQuickModeEventId(
  fromQuery: string,
  createCalendarEvent: () => Promise<string>,
  options?: {
    forceNew?: boolean;
    verifyEventId?: (id: string) => Promise<boolean>;
  }
): Promise<string> {
  const forceNew = options?.forceNew === true;
  const verifyEventId = options?.verifyEventId;

  if (quickModeEventCreationPromise) {
    return quickModeEventCreationPromise;
  }

  const tryReuseId = async (id: string): Promise<string | null> => {
    if (!isValidQuickModeEventUuid(id)) return null;
    if (verifyEventId) {
      const exists = await verifyEventId(id);
      if (!exists) return null;
    }
    return persistEventId(id);
  };

  if (forceNew) {
    clearQuickModeSessionEventId();
    const recentId = readRecentForceNewId();
    if (recentId) {
      return recentId;
    }
  }

  const queryId = fromQuery.trim();
  if (queryId && !forceNew) {
    const resolved = await tryReuseId(queryId);
    if (resolved) return resolved;
    clearQuickModeSessionEventId();
  }

  if (!forceNew) {
    try {
      const fromSession = sessionStorage.getItem(QUICK_MODE_SESSION_EVENT_KEY)?.trim() || '';
      if (fromSession) {
        const resolved = await tryReuseId(fromSession);
        if (resolved) return resolved;
      }
    } catch {
      // ignore
    }
    clearQuickModeSessionEventId();
  }

  quickModeEventCreationPromise = createCalendarEvent()
    .then((id) => {
      const resolved = persistEventId(id);
      if (!resolved) {
        throw new Error('Quick Mode session was created without a valid event ID');
      }
      if (forceNew) {
        markRecentForceNewId(resolved);
      }
      return resolved;
    })
    .finally(() => {
      quickModeEventCreationPromise = null;
    });

  return quickModeEventCreationPromise;
}
