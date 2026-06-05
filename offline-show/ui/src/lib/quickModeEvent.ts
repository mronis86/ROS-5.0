/** Quick Mode registers a hidden calendar row so active_timers can use a UUID event_id. */

export type QuickModeCalendarLike = {
  name?: string;
  schedule_data?: Record<string, unknown> | null;
};

export const QUICK_MODE_SESSION_EVENT_KEY = 'ros.quickMode.sessionEventId';

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

export function clearQuickModeSessionEventId(): void {
  try {
    sessionStorage.removeItem(QUICK_MODE_SESSION_EVENT_KEY);
  } catch {
    // ignore private mode / quota
  }
  quickModeEventCreationPromise = null;
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

/** One calendar event per Quick Mode session; dedupes concurrent creation. */
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

  if (forceNew) {
    clearQuickModeSessionEventId();
  }

  const tryReuseId = async (id: string): Promise<string | null> => {
    if (!isValidQuickModeEventUuid(id)) return null;
    if (verifyEventId) {
      const exists = await verifyEventId(id);
      if (!exists) return null;
    }
    return persistEventId(id);
  };

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

  if (!quickModeEventCreationPromise) {
    quickModeEventCreationPromise = createCalendarEvent()
      .then((id) => {
        const resolved = persistEventId(id);
        if (!resolved) {
          throw new Error('Quick Mode session was created without a valid event ID');
        }
        return resolved;
      })
      .finally(() => {
        quickModeEventCreationPromise = null;
      });
  }

  return quickModeEventCreationPromise;
}
