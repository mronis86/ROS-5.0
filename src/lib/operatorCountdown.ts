/** Programmable operator countdown — display shape aligned with sub-cue timers. */

export type OperatorCountdownRow = {
  event_id: string;
  label?: string;
  duration_seconds: number;
  is_active?: boolean;
  is_running?: boolean;
  started_at?: string | null;
  sent_by?: string | null;
  sent_by_name?: string | null;
  sent_by_role?: string | null;
  updated_at?: string;
};

export type OperatorCountdownDisplay = {
  source: 'operator';
  cue_display: string;
  duration_seconds: number;
  is_active: boolean;
  is_running: boolean;
  started_at: string | null;
  timer_id: string;
  remaining?: number;
};

export function parseDurationParts(totalSeconds: number): { minutes: number; seconds: number } {
  const n = Math.max(1, Math.floor(totalSeconds || 0));
  return { minutes: Math.floor(n / 60), seconds: n % 60 };
}

export function durationFromParts(minutes: number, seconds: number): number {
  const m = Math.max(0, Math.floor(minutes || 0));
  const s = Math.max(0, Math.min(59, Math.floor(seconds || 0)));
  const total = m * 60 + s;
  return total > 0 ? total : 60;
}

export function mapOperatorCountdownRow(row: OperatorCountdownRow | null | undefined): OperatorCountdownDisplay | null {
  if (!row || !row.is_active) return null;
  const label = String(row.label || 'Operator Timer').trim() || 'Operator Timer';
  return {
    source: 'operator',
    cue_display: label,
    duration_seconds: Number(row.duration_seconds) || 0,
    is_active: row.is_active === true,
    is_running: row.is_running === true,
    started_at: row.started_at || null,
    timer_id: 'OPERATOR',
  };
}

/** Shape compatible with Clock / FullScreen secondary (indented sub-cue) display. */
export function operatorAsSecondaryTimer(
  op: OperatorCountdownDisplay | null | undefined
): Record<string, unknown> | null {
  if (!op?.is_active || !op.is_running || !op.started_at) return null;
  return {
    source: 'operator',
    cue_display: op.cue_display,
    cue: op.cue_display,
    segment_name: '',
    duration_seconds: op.duration_seconds,
    is_active: true,
    is_running: true,
    started_at: op.started_at,
    timer_id: 'OPERATOR',
    timer_state: 'running',
  };
}

/**
 * Prefer a live indented sub-cue; otherwise show the operator countdown in the
 * same secondary / ALT timer slot on Clock and Full Screen.
 */
export function resolveDisplaySecondaryTimer(hybrid: {
  secondaryTimer?: any;
  operatorCountdown?: OperatorCountdownDisplay | null;
} | null | undefined): any {
  const sub = hybrid?.secondaryTimer;
  if (sub && (sub.is_running === true || sub.timer_state === 'running')) {
    return sub;
  }
  return operatorAsSecondaryTimer(hybrid?.operatorCountdown);
}

export function operatorCountdownRemaining(
  timer: OperatorCountdownDisplay | null | undefined,
  clockOffsetMs = 0
): number {
  if (!timer?.is_active || !timer.is_running || !timer.started_at) {
    return timer?.duration_seconds ?? 0;
  }
  const startedMs = new Date(timer.started_at).getTime();
  if (!Number.isFinite(startedMs)) return timer.duration_seconds;
  const elapsed = (Date.now() + clockOffsetMs - startedMs) / 1000;
  return timer.duration_seconds - elapsed;
}

export type OperatorTimerPreset = {
  id: string;
  label: string;
  duration_seconds: number;
};

const DEFAULT_PRESETS: OperatorTimerPreset[] = [
  { id: 'p1', label: 'Break', duration_seconds: 300 },
  { id: 'p2', label: 'Stretch', duration_seconds: 120 },
  { id: 'p3', label: 'Wrap up', duration_seconds: 60 },
  { id: 'p4', label: 'Hold', duration_seconds: 180 },
];

function presetStorageKey(eventId: string) {
  return `ros-operator-timer-presets-${eventId}`;
}

export function loadOperatorTimerPresets(eventId: string): OperatorTimerPreset[] {
  if (!eventId) return DEFAULT_PRESETS.map((p) => ({ ...p }));
  try {
    const raw = localStorage.getItem(presetStorageKey(eventId));
    if (!raw) return DEFAULT_PRESETS.map((p) => ({ ...p }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PRESETS.map((p) => ({ ...p }));
    return parsed.map((p: OperatorTimerPreset, i: number) => ({
      id: p.id || `p${i + 1}`,
      label: String(p.label || `Timer ${i + 1}`),
      duration_seconds: Math.max(1, Number(p.duration_seconds) || 60),
    }));
  } catch {
    return DEFAULT_PRESETS.map((p) => ({ ...p }));
  }
}

export function saveOperatorTimerPresets(eventId: string, presets: OperatorTimerPreset[]) {
  if (!eventId) return;
  try {
    localStorage.setItem(presetStorageKey(eventId), JSON.stringify(presets));
  } catch {
    /* ignore quota */
  }
}

export function formatOperatorCountdownTime(remainingSeconds: number): string {
  const abs = Math.abs(remainingSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = Math.floor(abs % 60);
  const prefix = remainingSeconds < 0 ? '-' : '';
  if (hours === 0) {
    return `${prefix}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${prefix}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
