/**
 * Pull Admin branding / overtime sign from the show server.
 * When Cloud is on, the server proxies /api/app-settings to Railway/Neon.
 * LAN-only: request may 404 — keep local defaults.
 */
import { getApiBaseUrl } from '../services/api-client';
import {
  applyCountdownColorModeId,
  applyGreenRoomLayoutId,
  applyHideFullscreenTimerOption,
  applyAutoShotTypeFromSpeakers,
  applyShowLiveSyncStatusBadge,
  applyLogoVariantId,
  parseCountdownColorModeId,
  parseGreenRoomLayoutId,
} from './branding';
import { applyOvertimeSignId, parseOvertimeSignId } from './overtimeSign';

let hydratePromise: Promise<void> | null = null;

export async function hydrateAppSettingsFromServer(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/app-settings?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        applyLogoVariantId(data.logoVariantId === 'sinor' ? 'sinor' : 'default');
        applyGreenRoomLayoutId(parseGreenRoomLayoutId(data.greenRoomLayoutId) ?? 'classic');
        applyCountdownColorModeId(parseCountdownColorModeId(data.countdownColorModeId) ?? 'standard');
        const ot = parseOvertimeSignId(data.overtimeSignId);
        if (ot) applyOvertimeSignId(ot);
        applyHideFullscreenTimerOption(data.hideFullscreenTimerOption === true);
        applyAutoShotTypeFromSpeakers(data.autoShotTypeFromSpeakers === true);
        applyShowLiveSyncStatusBadge(data.showLiveSyncStatusBadge === true);
      } catch {
        /* offline / no cloud proxy */
      }
    })();
  }
  return hydratePromise;
}

/** Re-fetch (e.g. after Cloud reconnect) so Admin overtime +/− reaches open clocks. */
export function refreshAppSettingsFromServer(): Promise<void> {
  hydratePromise = null;
  return hydrateAppSettingsFromServer();
}
