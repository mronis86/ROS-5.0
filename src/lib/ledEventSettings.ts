import { DatabaseService } from '../services/database';
import type { LedOutputClock } from '../types/ledClock';
import type { LedOutputBackground } from '../types/ledOutput';
import { parseLedClockFromSettings } from './ledClock';
import {
  parseLedOutputBackground,
  parseLedOutputBackgroundFromSettings,
} from './ledOutputBackground';

export const LED_EVENT_SETTINGS_EVENT = 'led-event-settings-updated';

export type LedEventSettings = {
  ledOutputBackground?: LedOutputBackground;
  ledClock?: LedOutputClock;
};

function storageKey(eventId: string) {
  return `ledEventSettings_${eventId}`;
}

export function readLedEventSettingsFromLocal(eventId: string): LedEventSettings | null {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    if (!raw) return null;
    return JSON.parse(raw) as LedEventSettings;
  } catch {
    return null;
  }
}

export function writeLedEventSettingsToLocal(eventId: string, patch: LedEventSettings) {
  const prior = readLedEventSettingsFromLocal(eventId) || {};
  const next: LedEventSettings = { ...prior, ...patch };
  localStorage.setItem(storageKey(eventId), JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(LED_EVENT_SETTINGS_EVENT, { detail: { eventId, settings: next } })
  );
}

export function subscribeLedEventSettings(
  eventId: string,
  onUpdate: (settings: LedEventSettings) => void
): () => void {
  const key = storageKey(eventId);

  const apply = () => {
    const data = readLedEventSettingsFromLocal(eventId);
    if (data) onUpdate(data);
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key === key) apply();
  };

  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<{ eventId?: string }>).detail;
    if (detail?.eventId === eventId) apply();
  };

  window.addEventListener('storage', onStorage);
  window.addEventListener(LED_EVENT_SETTINGS_EVENT, onCustom);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LED_EVENT_SETTINGS_EVENT, onCustom);
  };
}

export function ledEventSettingsFromRosSettings(
  settings: Record<string, unknown> | undefined | null
): LedEventSettings {
  return {
    ledOutputBackground: parseLedOutputBackgroundFromSettings(settings),
    ledClock: parseLedClockFromSettings(settings),
  };
}

export function applyLedEventSettingsPatch(
  settings: Record<string, unknown> | undefined | null,
  patch: LedEventSettings
): Record<string, unknown> {
  const base = { ...(settings || {}) };
  if (patch.ledClock != null) base.ledClock = patch.ledClock;
  if (patch.ledOutputBackground != null) base.ledOutputBackground = patch.ledOutputBackground;
  return base;
}

type PersistLedEventSettingsOptions = {
  eventName?: string;
  eventDate?: string;
  scheduleItems?: unknown[];
  customColumns?: unknown[];
  priorSettings?: Record<string, unknown>;
};

/** Persist event-wide LED output settings (background, clock) for all output pages. */
export async function persistLedEventSettings(
  eventId: string,
  patch: LedEventSettings,
  options: PersistLedEventSettingsOptions = {}
): Promise<boolean> {
  writeLedEventSettingsToLocal(eventId, patch);

  try {
    const existing = await DatabaseService.getRunOfShowData(eventId);
    const baseSettings = applyLedEventSettingsPatch(
      options.priorSettings || existing?.settings,
      patch
    );

    const result = await DatabaseService.saveRunOfShowData({
      event_id: eventId,
      event_name: options.eventName || existing?.event_name || 'Event',
      event_date: options.eventDate || existing?.event_date || '',
      schedule_items: options.scheduleItems || existing?.schedule_items || [],
      custom_columns: options.customColumns || existing?.custom_columns || [],
      settings: baseSettings,
    });

    return !!result;
  } catch (error) {
    console.error('persistLedEventSettings: API save failed (local cache kept)', error);
    return false;
  }
}

export function hydrateLedEventSettingsFromLocal(
  eventId: string
): LedEventSettings | null {
  const local = readLedEventSettingsFromLocal(eventId);
  if (!local) return null;
  return {
    ledOutputBackground: local.ledOutputBackground
      ? parseLedOutputBackground(local.ledOutputBackground)
      : undefined,
    ledClock: local.ledClock ? parseLedClockFromSettings({ ledClock: local.ledClock }) : undefined,
  };
}
