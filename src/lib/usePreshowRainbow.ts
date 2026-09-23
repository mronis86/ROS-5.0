import { useEffect, useState } from 'react';
import { DatabaseService, type TimerMessage } from '../services/database';
import { isPreshowTimerMessage } from './preshowCountdown';

export {
  PRESHOW_COUNTDOWN_MESSAGE,
  PRESHOW_MESSAGE_TYPE,
  isPreshowTimerMessage,
  findTopPreshowCue,
  resolvePreshowStartHHMM,
  PRESHOW_WARN_MINUTES_BEFORE,
} from './preshowCountdown';

type ActiveTimerLike = {
  is_running?: boolean;
  is_active?: boolean;
  isRunning?: boolean;
  isActive?: boolean;
  item_id?: number | string | null;
  itemId?: number | string | null;
} | null | undefined;

export function isActiveTimerRunning(timer: ActiveTimerLike): boolean {
  if (!timer) return false;
  const running = timer.is_running ?? timer.isRunning;
  const active = timer.is_active ?? timer.isActive;
  if (running === false) return false;
  if (active === false) return false;
  return !!running;
}

/**
 * True when Pre Show Countdown branding should apply (Clock / Photo / Op Large / etc.).
 * Only while a timer is running on the *first* (top) PreShow/End cue — never the
 * end-of-show PreShow/End stack, which shares the same program type.
 * A sticky event timer message alone must NOT brand later cues after START.
 */
export function shouldUsePreshowRainbow(
  msg: { enabled?: boolean; message?: string; message_type?: string } | null | undefined,
  opts?: {
    timer?: ActiveTimerLike;
    isRunning?: boolean;
    programType?: string | null;
    /** Active cue id (preferred over timer.item_id when both exist). */
    itemId?: number | string | null;
    /** First schedule PreShow/End cue id — required to brand; end-of-show PreShow is excluded. */
    topPreshowItemId?: number | string | null;
  }
): boolean {
  const running =
    opts?.isRunning ??
    (opts?.timer != null ? isActiveTimerRunning(opts.timer) : true);
  if (!running) return false;

  const itemId =
    opts?.itemId ?? opts?.timer?.item_id ?? opts?.timer?.itemId ?? null;

  // Only the first PreShow/End cue gets branding (end-of-show is also PreShow/End).
  if (opts?.topPreshowItemId != null) {
    if (itemId == null) return false;
    return String(itemId) === String(opts.topPreshowItemId);
  }

  const programType = opts?.programType;
  if (programType != null && String(programType).trim() !== '') {
    // Without topPreshowItemId we cannot tell first vs end-of-show PreShow/End — do not brand.
    return false;
  }

  // Legacy fallback when schedule/cue type unknown (message still set from top PreShow start)
  return isPreshowTimerMessage(msg);
}

/**
 * Loads / refreshes the event timer message so viewer pages can share Pre Show rainbow
 * without each re-implementing socket wiring.
 */
export function usePreshowRainbow(
  eventId: string | null | undefined,
  opts?: {
    timer?: ActiveTimerLike;
    isRunning?: boolean;
    programType?: string | null;
    itemId?: number | string | null;
    topPreshowItemId?: number | string | null;
    /** Optional message already held by the page (hybridTimerData.timerMessage, etc.) */
    message?: TimerMessage | null;
    pollMs?: number;
  }
): boolean {
  const [fetchedMessage, setFetchedMessage] = useState<TimerMessage | null>(null);
  const running =
    opts?.isRunning ??
    (opts?.timer != null ? isActiveTimerRunning(opts.timer) : false);

  useEffect(() => {
    if (!eventId) {
      setFetchedMessage(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const msg = await DatabaseService.getTimerMessage(eventId);
        if (!cancelled) setFetchedMessage(msg || null);
      } catch {
        if (!cancelled) setFetchedMessage(null);
      }
    };
    void load();
    // Poll while a timer is running so Pre Show message appears without a dedicated socket callback
    const pollMs = opts?.pollMs ?? (running ? 4000 : 15000);
    const id = window.setInterval(() => {
      void load();
    }, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [eventId, running, opts?.pollMs]);

  const message = opts?.message ?? fetchedMessage;
  return shouldUsePreshowRainbow(message, {
    timer: opts?.timer,
    isRunning: opts?.isRunning,
    programType: opts?.programType,
    itemId: opts?.itemId,
    topPreshowItemId: opts?.topPreshowItemId,
  });
}
