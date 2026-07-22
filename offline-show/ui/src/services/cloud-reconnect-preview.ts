import type { ReconnectSnapshot } from './offline-sync-bridge';
import { peekCloudReconnectSnapshot } from './offline-sync-bridge';

export type PreviewRowFlag = 'running' | 'loaded' | 'completed' | 'indented';

export type CloudReconnectPreviewRow = {
  id: number;
  cue: string;
  segmentName: string;
  programType: string;
  durationLabel: string;
  flags: PreviewRowFlag[];
};

export type CloudReconnectPreview = {
  ok: boolean;
  error?: string;
  eventName: string;
  eventId: string;
  showMode: string | null;
  scheduleCount: number;
  rows: CloudReconnectPreviewRow[];
  liveCue: {
    itemId: number;
    cue: string;
    segmentName: string;
    programType: string;
    timerState: 'running' | 'loaded' | string;
    remainingLabel: string | null;
    durationLabel: string;
  } | null;
  completed: { itemId: number; cue: string; segmentName: string }[];
  indentedCount: number;
  subCue: {
    itemId: number;
    cue: string;
    timerState: string;
    durationLabel: string;
  } | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatDurationSeconds(total: number | null | undefined): string {
  if (total == null || !Number.isFinite(total)) return '—';
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(Math.floor(total));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${sign}${m}:${String(s).padStart(2, '0')}`;
}

function itemDurationSeconds(item: Record<string, unknown>): number {
  const h = Number(item.durationHours) || 0;
  const m = Number(item.durationMinutes) || 0;
  const s = Number(item.durationSeconds) || 0;
  return h * 3600 + m * 60 + s;
}

function cueLabel(item: Record<string, unknown>, fallbackId: number): string {
  const custom = asRecord(item.customFields);
  const fromCustom = custom?.cue != null ? String(custom.cue).trim() : '';
  if (fromCustom) return fromCustom.startsWith('CUE') ? fromCustom : `CUE ${fromCustom}`;
  const timerId = item.timerId != null ? String(item.timerId).trim() : '';
  if (timerId) return timerId.startsWith('CUE') ? timerId : `CUE ${timerId}`;
  return `Row ${fallbackId}`;
}

export function buildCloudReconnectPreview(snapshot: ReconnectSnapshot): CloudReconnectPreview {
  const ros = asRecord(snapshot.run_of_show) || {};
  const settings = asRecord(ros.settings) || {};
  const items = Array.isArray(ros.schedule_items) ? (ros.schedule_items as Record<string, unknown>[]) : [];
  const timer = asRecord(snapshot.active_timer);
  const liveItemId = timer ? toNum(timer.item_id) : null;
  const timerState = timer ? String(timer.timer_state || (timer.is_running ? 'running' : 'loaded')) : null;

  const completedRaw = Array.isArray(snapshot.completed_cues) ? snapshot.completed_cues : [];
  const completedIds = new Set<number>();
  for (const c of completedRaw) {
    const row = asRecord(c);
    if (!row) continue;
    const id = toNum(row.item_id);
    if (id != null) completedIds.add(id);
  }

  const indentedRaw = Array.isArray(snapshot.indented_cues) ? snapshot.indented_cues : [];
  const indentedIds = new Set<number>();
  for (const row of indentedRaw) {
    const r = asRecord(row);
    const id = r ? toNum(r.item_id) : null;
    if (id != null) indentedIds.add(id);
  }
  for (const item of items) {
    if (item.isIndented === true) {
      const id = toNum(item.id);
      if (id != null) indentedIds.add(id);
    }
  }

  const rows: CloudReconnectPreviewRow[] = items.map((item) => {
    const id = toNum(item.id) ?? 0;
    const flags: PreviewRowFlag[] = [];
    if (liveItemId === id && timerState === 'running') flags.push('running');
    else if (liveItemId === id) flags.push('loaded');
    if (completedIds.has(id)) flags.push('completed');
    if (indentedIds.has(id) || item.isIndented === true) flags.push('indented');
    return {
      id,
      cue: cueLabel(item, id),
      segmentName: item.segmentName != null ? String(item.segmentName) : '',
      programType: item.programType != null ? String(item.programType) : '',
      durationLabel: formatDurationSeconds(itemDurationSeconds(item)),
      flags,
    };
  });

  // Build completed list from the same row flags as the full schedule list.
  const completed: CloudReconnectPreview['completed'] = rows
    .filter((r) => r.flags.includes('completed'))
    .map((r) => ({
      itemId: r.id,
      cue: r.cue,
      segmentName: r.segmentName,
    }));
  // Orphans in snapshot that aren't on the current schedule still get listed.
  for (const c of completedRaw) {
    const row = asRecord(c);
    if (!row) continue;
    const id = toNum(row.item_id);
    if (id == null || completed.some((x) => x.itemId === id)) continue;
    if (items.some((i) => toNum(i.id) === id)) continue;
    completed.push({
      itemId: id,
      cue: row.cue_id != null ? String(row.cue_id) : `Row ${id}`,
      segmentName: '',
    });
  }

  let liveCue: CloudReconnectPreview['liveCue'] = null;
  if (timer && liveItemId != null) {
    const scheduleItem = items.find((i) => toNum(i.id) === liveItemId);
    const remaining =
      timer.remaining_seconds != null && Number.isFinite(Number(timer.remaining_seconds))
        ? Number(timer.remaining_seconds)
        : null;
    const duration =
      timer.duration_seconds != null && Number.isFinite(Number(timer.duration_seconds))
        ? Number(timer.duration_seconds)
        : scheduleItem
          ? itemDurationSeconds(scheduleItem)
          : null;
    liveCue = {
      itemId: liveItemId,
      cue:
        timer.cue_is != null && String(timer.cue_is).trim()
          ? String(timer.cue_is)
          : scheduleItem
            ? cueLabel(scheduleItem, liveItemId)
            : `Row ${liveItemId}`,
      segmentName: scheduleItem?.segmentName != null ? String(scheduleItem.segmentName) : '',
      programType: scheduleItem?.programType != null ? String(scheduleItem.programType) : '',
      timerState: timerState || 'loaded',
      remainingLabel: remaining != null ? formatDurationSeconds(remaining) : null,
      durationLabel: formatDurationSeconds(duration),
    };
  }

  const subRaw = asRecord(snapshot.sub_cue_timer);
  let subCue: CloudReconnectPreview['subCue'] = null;
  if (subRaw && (subRaw.is_active || subRaw.is_running || subRaw.item_id != null)) {
    const sid = toNum(subRaw.item_id);
    if (sid != null && (subRaw.is_active === true || subRaw.is_active === 1 || subRaw.is_running === true || subRaw.is_running === 1)) {
      subCue = {
        itemId: sid,
        cue:
          subRaw.cue_display != null
            ? String(subRaw.cue_display)
            : `Row ${sid}`,
        timerState: subRaw.is_running === true || subRaw.is_running === 1 ? 'running' : 'active',
        durationLabel: formatDurationSeconds(
          subRaw.duration_seconds != null ? Number(subRaw.duration_seconds) : null
        ),
      };
    }
  }

  return {
    ok: true,
    eventName: ros.event_name != null ? String(ros.event_name) : 'This event',
    eventId: String(snapshot.event_id || ros.event_id || ''),
    showMode: settings.show_mode != null ? String(settings.show_mode) : null,
    scheduleCount: items.length,
    rows,
    liveCue,
    completed,
    indentedCount: indentedIds.size,
    subCue,
  };
}

/** Build a live push preview from the open Run of Show (no upload). */
export async function loadCloudReconnectPreview(): Promise<CloudReconnectPreview> {
  const peeked = await peekCloudReconnectSnapshot();
  if (!peeked.ok || !peeked.snapshot) {
    return {
      ok: false,
      error: peeked.error || 'Open Run of Show on this event to preview what will upload.',
      eventName: '',
      eventId: '',
      showMode: null,
      scheduleCount: 0,
      rows: [],
      liveCue: null,
      completed: [],
      indentedCount: 0,
      subCue: null,
    };
  }
  return buildCloudReconnectPreview(peeked.snapshot);
}
