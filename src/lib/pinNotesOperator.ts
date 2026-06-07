const OPERATOR_NAME_KEY = 'ros_pin_notes_operator_name';

/** Display label: first name only when stored as "Name — Role". */
export function personNameOnly(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return trimmed;
  for (const sep of [' — ', ' – ', ' - ']) {
    const idx = trimmed.indexOf(sep);
    if (idx > 0) return trimmed.slice(0, idx).trim();
  }
  return trimmed;
}

/** Column header for a person: "Bob" not "Bob's notes" or "Bob — Graphics". */
export function personColumnLabel(displayName: string): string {
  const withoutSuffix = displayName.trim().replace(/'s notes$/i, '');
  return personNameOnly(withoutSuffix);
}

/** Stable API user_id from a display name — same name on any browser loads the same notes. */
export function operatorUserId(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `operator:${slug || 'unknown'}`;
}

export function getStoredOperatorName(): string | null {
  try {
    const name = localStorage.getItem(OPERATOR_NAME_KEY)?.trim();
    return name || null;
  } catch {
    return null;
  }
}

export function storeOperatorName(displayName: string): void {
  const trimmed = displayName.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(OPERATOR_NAME_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function clearStoredOperatorName(): void {
  try {
    localStorage.removeItem(OPERATOR_NAME_KEY);
  } catch {
    /* ignore */
  }
}
