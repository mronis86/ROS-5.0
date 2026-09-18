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
 * Prefers timer message; falls back to active cue programType === PreShow/End while running.
 */
export function shouldUsePreshowRainbow(
  msg: { enabled?: boolean; message?: string; message_type?: string } | null | undefined,
  opts?: {
    timer?: ActiveTimerLike;
    isRunning?: boolean;
    programType?: string | null;
  }
): boolean {
  const running =
    opts?.isRunning ??
    (opts?.timer != null ? isActiveTimerRunning(opts.timer) : true);
  if (!running) return false;
  if (isPreshowTimerMessage(msg)) return true;
  return opts?.programType === 'PreShow/End';
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
  });
}
