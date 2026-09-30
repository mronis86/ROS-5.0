import { useEffect, useState } from 'react';
import { DatabaseService, type TimerMessage } from '../services/database';
import { isPreshowProgramType, isPreshowTimerMessage } from './preshowCountdown';

export {
  PRESHOW_COUNTDOWN_MESSAGE,
  PRESHOW_MESSAGE_TYPE,
  isPreshowTimerMessage,
  isPreshowProgramType,
  findTopPreshowCue,
  resolvePreshowStartHHMM,
  PRESHOW_WARN_MINUTES_BEFORE,
} from './preshowCountdown';

type ActiveTimerLike = {
  is_running?: boolean;
  is_active?: boolean;
  isRunning?: boolean;
  isActive?: boolean;
  timer_state?: string | null;
  timerState?: string | null;
  item_id?: number | string | null;
  itemId?: number | string | null;
} | null | undefined;

export function isActiveTimerRunning(timer: ActiveTimerLike): boolean {
  if (!timer) return false;
  const active = timer.is_active ?? timer.isActive;
  if (active === false) return false;
  const state = String(timer.timer_state ?? timer.timerState ?? '').toLowerCase();
  if (state === 'running') return true;
  const running = timer.is_running ?? timer.isRunning;
  if (running === false) return false;
  return !!running;
}

/**
 * True when Pre Show Countdown branding should apply (Clock / Photo / Op Large / etc.).
 * Only while a timer is running on the *first* (top) PreShow/End cue — never the
 * end-of-show PreShow/End stack, which shares the same program type.
 *
 * The sticky "Pre Show Countdown" timer message is only activated when the top
 * PreShow starts (and cleared when leaving it), so message + PreShow/End program
 * type is a reliable signal even if schedule top-cue lookup failed on the display.
 */
export function shouldUsePreshowRainbow(
  msg: { enabled?: boolean; message?: string; message_type?: string } | null | undefined,
  opts?: {
    timer?: ActiveTimerLike;
    isRunning?: boolean;
    programType?: string | null;
    /** Active cue id (preferred over timer.item_id when both exist). */
    itemId?: number | string | null;
    /** First schedule PreShow/End cue id — preferred match; end-of-show PreShow is excluded. */
    topPreshowItemId?: number | string | null;
  }
): boolean {
  const running =
    opts?.isRunning ??
    (opts?.timer != null ? isActiveTimerRunning(opts.timer) : true);
  if (!running) return false;

  const itemId =
    opts?.itemId ?? opts?.timer?.item_id ?? opts?.timer?.itemId ?? null;
  const programType = opts?.programType;
  const hasPreshowMessage = isPreshowTimerMessage(msg);
  const isPreshowCue = isPreshowProgramType(programType);

  // Strongest: active cue is the known top PreShow for the day
  if (opts?.topPreshowItemId != null && itemId != null) {
    if (String(itemId) === String(opts.topPreshowItemId)) return true;
    // Id mismatch: still brand if the sticky Pre Show message is live on a PreShow cue.
    // Message is only activated for the top PreShow and cleared when leaving it, so this
    // covers day-mismatch (Day 1 top resolved while Day 2 PreShow is running) without
    // branding Panel/START cues.
    return hasPreshowMessage && isPreshowCue;
  }

  // Top-cue lookup failed (display schedule not loaded / indent flags).
  // Sticky Pre Show message is only set while the top PreShow is running — safe to brand.
  if (hasPreshowMessage && (isPreshowCue || programType == null || String(programType).trim() === '')) {
    return true;
  }

  // Non-PreShow cue with a leftover message must not get rainbow
  if (programType != null && String(programType).trim() !== '' && !isPreshowCue) {
    return false;
  }

  return hasPreshowMessage;
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
