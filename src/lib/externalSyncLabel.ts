/**
 * Companion Resolume / Mitti / AV-Playout sync labels for timer feedback.
 * Shared by Run of Show–adjacent views (Mic, Op, Director, etc.).
 */

export type ExternalSyncTimer = {
  time_source?: string;
  resolume_state?: string;
  mitti_state?: string;
  avplayout_state?: string;
  user_id?: string;
  user_name?: string;
  is_running?: boolean;
  timer_state?: string;
} | null | undefined;

export type ExternalSyncLabel = 'Mitti' | 'AV-Playout' | 'Resolume';

export function isExternalSyncArmed(timer: ExternalSyncTimer): boolean {
  return (
    timer?.resolume_state === 'armed' ||
    timer?.mitti_state === 'armed' ||
    timer?.avplayout_state === 'armed'
  );
}

export function isExternalSyncSynced(timer: ExternalSyncTimer): boolean {
  return (
    timer?.resolume_state === 'synced' ||
    timer?.mitti_state === 'synced' ||
    timer?.avplayout_state === 'synced' ||
    (timer?.time_source === 'resolume' && timer?.resolume_state !== 'armed') ||
    (timer?.time_source === 'mitti' && timer?.mitti_state !== 'armed') ||
    (timer?.time_source === 'avplayout' && timer?.avplayout_state !== 'armed')
  );
}

export function getExternalSyncLabel(timer: ExternalSyncTimer): ExternalSyncLabel {
  if (
    timer?.time_source === 'avplayout' ||
    timer?.avplayout_state === 'armed' ||
    timer?.avplayout_state === 'synced' ||
    timer?.user_id === 'companion-avplayout' ||
    timer?.user_name === 'AV-Playout Sync'
  ) {
    return 'AV-Playout';
  }
  if (
    timer?.time_source === 'mitti' ||
    timer?.mitti_state === 'armed' ||
    timer?.mitti_state === 'synced' ||
    timer?.user_id === 'companion-mitti' ||
    timer?.user_name === 'Mitti Sync'
  ) {
    return 'Mitti';
  }
  return 'Resolume';
}

/** Infer sync meta from companion user fields when server flags were dropped. */
export function enrichExternalSyncTimer<T extends Record<string, any>>(timer: T | null | undefined): T | null | undefined {
  if (!timer || typeof timer !== 'object') return timer;
  if (isExternalSyncSynced(timer) || isExternalSyncArmed(timer)) return timer;
  const isAv =
    timer?.user_id === 'companion-avplayout' || timer?.user_name === 'AV-Playout Sync';
  const isMitti = timer?.user_id === 'companion-mitti' || timer?.user_name === 'Mitti Sync';
  const isResolume =
    timer?.user_id === 'companion-resolume' || timer?.user_name === 'Resolume Sync';
  if (!isAv && !isMitti && !isResolume) return timer;
  return {
    ...timer,
    time_source: isAv ? 'avplayout' : isMitti ? 'mitti' : 'resolume',
    ...(isAv
      ? { avplayout_state: timer.is_running ? 'synced' : 'armed' }
      : isMitti
        ? { mitti_state: timer.is_running ? 'synced' : 'armed' }
        : { resolume_state: timer.is_running ? 'synced' : 'armed' }),
  };
}

export function hasExternalSyncSource(timer: ExternalSyncTimer): boolean {
  const t = enrichExternalSyncTimer(timer as any);
  return Boolean(t && (isExternalSyncArmed(t) || isExternalSyncSynced(t)));
}

/**
 * Status line matching Run of Show feedback, e.g.:
 * - LOADED · AV-PLAYOUT - CUE 1
 * - RUNNING · MITTI - CUE 2
 * - LOADED - CUE 1 (no sync)
 */
export function formatExternalSyncStatusLine(options: {
  running: boolean;
  loaded: boolean;
  timer?: ExternalSyncTimer;
  cueLabel?: string;
  idleLabel?: string;
  /** When true and no cue, omit trailing cue (Director dock). */
  includeCue?: boolean;
}): string {
  const {
    running,
    loaded,
    timer,
    cueLabel = '',
    idleLabel = 'STANDBY',
    includeCue = true,
  } = options;
  const enriched = enrichExternalSyncTimer(timer as any);
  const sync =
    enriched && (isExternalSyncArmed(enriched) || isExternalSyncSynced(enriched))
      ? getExternalSyncLabel(enriched).toUpperCase()
      : '';
  const cuePart = includeCue && cueLabel ? ` - ${cueLabel}` : '';

  if (running) {
    return sync ? `RUNNING · ${sync}${cuePart}` : cueLabel ? `RUNNING - ${cueLabel}` : 'RUNNING';
  }
  if (loaded) {
    return sync ? `LOADED · ${sync}${cuePart}` : cueLabel ? `LOADED - ${cueLabel}` : 'LOADED';
  }
  return idleLabel;
}

/** Tailwind text class for sync feedback (armed → purple, running sync → yellow). */
export function externalSyncStatusClass(options: {
  running: boolean;
  loaded: boolean;
  timer?: ExternalSyncTimer;
  idleClass?: string;
}): string {
  const { running, loaded, timer, idleClass = 'text-slate-300' } = options;
  const enriched = enrichExternalSyncTimer(timer as any);
  if (running && enriched && isExternalSyncSynced(enriched)) return 'text-yellow-300';
  if (loaded && enriched && isExternalSyncArmed(enriched)) return 'text-purple-300';
  if (running) return 'text-green-400';
  if (loaded) return 'text-yellow-400';
  return idleClass;
}
