import { getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders } from './sessionAuth';
import {
  BUILTIN_SCROLL_COLUMNS,
  DEFAULT_ROS_VISIBLE_COLUMNS,
  loadRosVisibleColumns,
  loadRosVisibleCustomByName,
  normalizeColumnOrder,
  parseCustomColumnOrderKey,
  saveRosVisibleColumns,
  saveRosVisibleCustomByName,
  type RosVisibleColumns,
} from './rosColumnOrder';

export type RosUiPreferences = {
  visibleColumns?: RosVisibleColumns;
  visibleCustomByName?: Record<string, boolean>;
  stickyStartColumn?: boolean;
  /** Builtin + custom-by-name order keys: builtins as-is, customs as `name:Column Name` */
  columnOrder?: string[];
};

const CUSTOM_NAME_PREFIX = 'name:';

export function customNameOrderKey(name: string): string {
  return `${CUSTOM_NAME_PREFIX}${name.trim()}`;
}

export function parseCustomNameOrderKey(key: string): string | null {
  return key.startsWith(CUSTOM_NAME_PREFIX) ? key.slice(CUSTOM_NAME_PREFIX.length) : null;
}

/** Build a portable column order (custom columns keyed by name). */
export function toPortableColumnOrder(
  columnOrder: string[],
  customColumns: { id: string; name?: string }[]
): string[] {
  const idToName = new Map(
    customColumns.map((c) => [c.id, (c.name || '').trim()] as const)
  );
  const out: string[] = [];
  for (const key of columnOrder) {
    const customId = parseCustomColumnOrderKey(key);
    if (customId) {
      const name = idToName.get(customId);
      if (name) out.push(customNameOrderKey(name));
      continue;
    }
    if ((BUILTIN_SCROLL_COLUMNS as readonly string[]).includes(key)) {
      out.push(key);
    }
  }
  return out;
}

/** Apply portable order onto current event custom column ids. */
export function fromPortableColumnOrder(
  portable: string[] | null | undefined,
  customColumns: { id: string; name?: string }[]
): string[] {
  const nameToId = new Map(
    customColumns
      .filter((c) => (c.name || '').trim())
      .map((c) => [(c.name || '').trim().toLowerCase(), c.id] as const)
  );
  const asIds: string[] = [];
  for (const key of portable || []) {
    const name = parseCustomNameOrderKey(key);
    if (name) {
      const id = nameToId.get(name.toLowerCase());
      if (id) asIds.push(`custom:${id}`);
      continue;
    }
    if ((BUILTIN_SCROLL_COLUMNS as readonly string[]).includes(key)) {
      asIds.push(key);
    }
  }
  return normalizeColumnOrder(
    asIds,
    customColumns.map((c) => c.id)
  );
}

export function readLocalRosUiPreferences(
  columnOrder: string[],
  customColumns: { id: string; name?: string }[],
  stickyStartColumn: boolean
): RosUiPreferences {
  return {
    visibleColumns: loadRosVisibleColumns(),
    visibleCustomByName: loadRosVisibleCustomByName(),
    stickyStartColumn,
    columnOrder: toPortableColumnOrder(columnOrder, customColumns),
  };
}

export function applyRosUiPreferencesToLocal(prefs: RosUiPreferences): void {
  if (prefs.visibleColumns) {
    saveRosVisibleColumns({ ...DEFAULT_ROS_VISIBLE_COLUMNS, ...prefs.visibleColumns });
  }
  if (prefs.visibleCustomByName) {
    saveRosVisibleCustomByName(prefs.visibleCustomByName);
  }
  if (typeof prefs.stickyStartColumn === 'boolean') {
    try {
      localStorage.setItem('rosStickyStartColumn', prefs.stickyStartColumn ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }
  if (Array.isArray(prefs.columnOrder)) {
    try {
      // Portable order (customs by name). RunOfShowPage maps to ids per event.
      localStorage.setItem('rosColumnOrderPortable', JSON.stringify(prefs.columnOrder));
    } catch {
      /* ignore */
    }
  }
}

export async function fetchUserUiPreferences(userId: string): Promise<RosUiPreferences | null> {
  if (!userId) return null;
  const url = `${getApiBaseUrl()}/api/user-ui-preferences?user_id=${encodeURIComponent(userId)}`;
  const res = await fetch(url, { headers: apiJsonHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load preferences (${res.status})`);
  const data = await res.json();
  return (data?.preferences || null) as RosUiPreferences | null;
}

export async function saveUserUiPreferences(
  userId: string,
  preferences: RosUiPreferences
): Promise<void> {
  if (!userId) return;
  const res = await fetch(`${getApiBaseUrl()}/api/user-ui-preferences`, {
    method: 'PUT',
    headers: apiJsonHeaders(),
    body: JSON.stringify({ user_id: userId, preferences }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save preferences (${res.status})`);
  }
}
