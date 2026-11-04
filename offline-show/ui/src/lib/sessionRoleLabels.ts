/** Session role display names (internal values stay VIEWER / EDITOR / OPERATOR). */
export function sessionRoleLabel(role: string | null | undefined): string {
  const raw = String(role || '').trim().toUpperCase();
  if (raw === 'EDITOR') return 'Content Editor';
  if (raw === 'OPERATOR') return 'Operator';
  if (raw === 'VIEWER') return 'Viewer';
  return String(role || '').trim() || 'Viewer';
}
