/** Visual constants copied from production pages (showcase-only). */

export const PROGRAM_TYPE_COLORS: Record<string, string> = {
  'PreShow/End': '#8B5CF6',
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#F3F4F6',
  'No Transition': '#059669',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  TBD: '#6B7280',
  KILLED: '#DC2626',
  'Full-Stage/Ted-Talk': '#EA580C',
  Break: '#6B7280',
  'Staged Production': '#EA580C',
};

export function rowBackgroundFromProgramType(programType: string, index: number): string {
  const baseColor = PROGRAM_TYPE_COLORS[programType];
  if (!baseColor) return index % 2 === 0 ? 'rgb(30 41 59)' : 'rgb(15 23 42)';
  const hex = baseColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.3)`;
}

export function countdownColor(remainingSec: number, totalSec: number): string {
  if (remainingSec < 0) return '#ef4444';
  const pct = totalSec > 0 ? remainingSec / totalSec : 1;
  if (pct <= 0.1) return '#ef4444';
  if (pct <= 0.25) return '#f59e0b';
  return '#22c55e';
}

export const LOCATION_DOT: Record<string, string> = {
  'Great Hall': 'bg-blue-600',
  'Studio A': 'bg-indigo-600',
  Virtual: 'bg-orange-600',
};
