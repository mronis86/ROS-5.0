/** Program types / colors shared with online ROS (offline-safe subset). */

export const ROS_PROGRAM_TYPES = [
  'PreShow/End',
  'Podium Transition',
  'Panel Transition',
  'Full-Stage/Ted-Talk',
  'Sub Cue',
  'No Transition',
  'Video',
  'Panel+Remote',
  'Remote Only',
  'Break F&B/B2B',
  'Breakout Session',
  'Delay Block',
  'TBD',
  'KILLED',
];

/** Head Table is offered on timed ROS for GM / Hollow Square only. */
export const HEAD_TABLE_PROGRAM_TYPE = 'Head Table';

export function eventAllowsHeadTableProgramType(eventType?: string | null): boolean {
  const t = String(eventType || '').trim();
  return t === 'General Meeting' || t === 'Hollow Square';
}

/** Base program types, with Head Table inserted after PreShow/End when allowed. */
export function buildRosProgramTypes(eventType?: string | null): string[] {
  const types = [...ROS_PROGRAM_TYPES];
  if (!eventAllowsHeadTableProgramType(eventType)) return types;
  const idx = types.indexOf('PreShow/End');
  if (idx < 0) return [HEAD_TABLE_PROGRAM_TYPE, ...types];
  if (types.includes(HEAD_TABLE_PROGRAM_TYPE)) return types;
  types.splice(idx + 1, 0, HEAD_TABLE_PROGRAM_TYPE);
  return types;
}

export const ROS_PROGRAM_TYPE_COLORS: Record<string, string> = {
  'PreShow/End': '#8B5CF6',
  'Head Table': '#4338CA',
  'Podium Transition': '#8B4513',
  'Panel Transition': '#404040',
  'Sub Cue': '#F3F4F6',
  'No Transition': '#059669',
  Video: '#F59E0B',
  'Panel+Remote': '#1E40AF',
  'Remote Only': '#60A5FA',
  'Break F&B/B2B': '#EC4899',
  'Breakout Session': '#20B2AA',
  'Delay Block': '#7C3AED',
  TBD: '#6B7280',
  KILLED: '#DC2626',
  'Full-Stage/Ted-Talk': '#EA580C',
};
