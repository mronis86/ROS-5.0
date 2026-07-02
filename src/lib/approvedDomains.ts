/** Normalize admin "approved domain" input (e.g. user@company.com → company.com). */
export function normalizeApprovedDomainInput(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  if (value.includes('@')) {
    const parts = value.split('@').filter(Boolean);
    value = parts[parts.length - 1] || '';
  }

  value = value
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .trim();

  if (!value || value.includes(' ') || !value.includes('.')) return null;
  return value;
}

export function approvedDomainInputHint(): string {
  return 'Enter a domain only (e.g. company.com), not a full email address.';
}
