export type ReconnectOverlayState = {
  active: boolean;
  message: string;
};

export type ReconnectSnapshot = {
  event_id: string;
  run_of_show: Record<string, unknown>;
  active_timer?: Record<string, unknown> | null;
  completed_cues?: Record<string, unknown>[];
  indented_cues?: Record<string, unknown>[];
  sub_cue_timer?: Record<string, unknown> | null;
};

type OverlayListener = (state: ReconnectOverlayState) => void;

type SnapshotBuilder = () => Promise<{ ok: boolean; snapshot?: ReconnectSnapshot }>;

let flushHandler: (() => Promise<void>) | null = null;
let snapshotBuilder: SnapshotBuilder | null = null;
const overlayListeners = new Set<OverlayListener>();

/** True while upload/connect runs OR briefly after to ignore stale cloud WebSocket/API pulls. */
let reconnecting = false;
let ignoreRemoteUntil = 0;

const idleOverlay: ReconnectOverlayState = { active: false, message: '' };

function emitOverlay(state: ReconnectOverlayState) {
  overlayListeners.forEach((fn) => fn(state));
}

export function subscribeReconnectOverlay(listener: OverlayListener): () => void {
  overlayListeners.add(listener);
  listener(reconnecting ? { active: true, message: 'Syncing offline show to cloud…' } : idleOverlay);
  return () => overlayListeners.delete(listener);
}

export function registerRunOfShowLocalFlush(handler: () => Promise<void>) {
  flushHandler = handler;
}

export function registerRunOfShowSnapshotBuilder(handler: SnapshotBuilder) {
  snapshotBuilder = handler;
}

export function clearRunOfShowReconnectHandlers() {
  flushHandler = null;
  snapshotBuilder = null;
}

export function isCloudReconnecting(): boolean {
  return reconnecting || Date.now() < ignoreRemoteUntil;
}

export async function flushRunOfShowToLocal(): Promise<boolean> {
  if (!flushHandler) return false;
  await flushHandler();
  return true;
}

function setOverlay(message: string) {
  emitOverlay({ active: true, message });
}

/**
 * Full offline → cloud reconnect:
 * 1. Pause + save locally
 * 2. Upload snapshot to Railway (server, while still LAN-only)
 * 3. Enable cloud mode
 * Does NOT reload Run of Show from cloud afterward.
 */
export async function performCloudReconnect(updatedBy?: string): Promise<{
  ok: boolean;
  stats?: Record<string, unknown>;
  error?: string;
}> {
  reconnecting = true;
  setOverlay('Pausing — saving local changes…');

  try {
    await flushRunOfShowToLocal();

    if (!snapshotBuilder) {
      return { ok: false, error: 'Open Run of Show on this event before going online.' };
    }

    setOverlay('Preparing show data…');
    const built = await snapshotBuilder();
    if (!built.ok || !built.snapshot) {
      return { ok: false, error: 'No schedule items on screen to upload.' };
    }

    if (built.snapshot.active_timer) {
      console.log('☁️ Reconnect snapshot active_timer:', built.snapshot.active_timer);
    } else {
      console.warn('☁️ Reconnect snapshot has no active_timer — server will try local SQLite');
    }

    setOverlay('Uploading to cloud — please wait…');
    ignoreRemoteUntil = Date.now() + 120_000;
    const res = await fetch('/api/cloud-mode/reconnect', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...built.snapshot, updatedBy }),
    });

    if (!res.ok) {
      ignoreRemoteUntil = 0;
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: err.error || `Reconnect failed (${res.status})` };
    }

    const data = (await res.json()) as { sync?: Record<string, unknown> };
    return { ok: true, stats: data.sync };
  } finally {
    reconnecting = false;
    emitOverlay(idleOverlay);
  }
}
