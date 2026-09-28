/** Per-event Extend Event Controls — stored on calendar_events.schedule_data.extendEventControls */

export const EXTEND_EVENT_CONTROL_MODULES = ['civicsBee'] as const;

export type ExtendEventControlModule = (typeof EXTEND_EVENT_CONTROL_MODULES)[number];

export type ExtendEventControlsConfig = {
  enabled: boolean;
  modules: ExtendEventControlModule[];
};

export const EXTEND_MODULE_LABELS: Record<ExtendEventControlModule, string> = {
  civicsBee: 'Civics Bee Students',
};

export function parseExtendEventControls(scheduleData: unknown): ExtendEventControlsConfig {
  const sd =
    scheduleData && typeof scheduleData === 'object'
      ? (scheduleData as Record<string, unknown>)
      : {};
  const raw = sd.extendEventControls;
  if (!raw || typeof raw !== 'object') {
    return { enabled: false, modules: [] };
  }
  const cfg = raw as Record<string, unknown>;
  const modulesRaw = Array.isArray(cfg.modules) ? cfg.modules : [];
  const modules = modulesRaw.filter((m): m is ExtendEventControlModule =>
    EXTEND_EVENT_CONTROL_MODULES.includes(m as ExtendEventControlModule)
  );
  return {
    enabled: cfg.enabled === true,
    modules,
  };
}

export function eventHasExtendEventControls(
  event:
    | { extendEventControlsEnabled?: boolean; extendEventControlModules?: ExtendEventControlModule[] }
    | null
    | undefined
): boolean {
  return event?.extendEventControlsEnabled === true;
}

export function eventHasExtendModule(
  event:
    | {
        extendEventControlsEnabled?: boolean;
        extendEventControlModules?: ExtendEventControlModule[];
      }
    | null
    | undefined,
  moduleId: ExtendEventControlModule
): boolean {
  if (!eventHasExtendEventControls(event)) return false;
  const mods = event?.extendEventControlModules;
  if (!mods || mods.length === 0) return true; // enabled with no list => all known modules
  return mods.includes(moduleId);
}
