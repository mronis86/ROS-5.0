import { useSyncExternalStore } from 'react';
import { DEMO_SCHEDULE, DEMO_SUB_CUE, DEMO_SHOWCASE_VISIBLE_CUES, SHOWCASE_FULL_CUE_COUNT, SHOWCASE_GREEN_ROOM_MAX_CUES, type DemoScheduleRow } from './demoData';
import { getShowcaseElapsedSec, subscribeShowcaseTick } from './useFakeCountdown';

export { SHOWCASE_FULL_CUE_COUNT };

/** CUE 1 (welcome) then CUE 2 (keynote) — loops for showcase demos */
export const SHOWCASE_CUE1_PHASE_SEC = 38;
export const SHOWCASE_CUE2_PHASE_SEC = 102;
export const SHOWCASE_FOLLOW_CYCLE_SEC = SHOWCASE_CUE1_PHASE_SEC + SHOWCASE_CUE2_PHASE_SEC;

export type ShowcaseFollowPhase = 'cue1' | 'cue2';

/** Clock layout rotation during CUE 2 — shared with Photo View sub-cue header */
export const SHOWCASE_CLOCK_ROTATION = ['main', 'sub', 'main', 'message', 'main'] as const;
export type ShowcaseClockDisplayMode = (typeof SHOWCASE_CLOCK_ROTATION)[number] | 'main';
export const SHOWCASE_CLOCK_ROTATE_MS = 6000;

export function getShowcaseClockDisplayMode(): ShowcaseClockDisplayMode {
  const { phase, phaseElapsedSec } = getShowcaseFollowState();
  if (phase !== 'cue2') return 'main';
  const step =
    Math.floor((phaseElapsedSec * 1000) / SHOWCASE_CLOCK_ROTATE_MS) % SHOWCASE_CLOCK_ROTATION.length;
  return SHOWCASE_CLOCK_ROTATION[step];
}

/** Sub-cue header on Photo View — only when Clock mock is in sub layout */
export function getShowcaseSubCueVisible(): boolean {
  return getShowcaseClockDisplayMode() === 'sub';
}

export function getCueDurationSec(row: DemoScheduleRow): number {
  return row.durationHours * 3600 + row.durationMinutes * 60 + row.durationSeconds;
}

export function getCueCountdownStartSec(row: DemoScheduleRow): number {
  const total = getCueDurationSec(row);
  return Math.max(1, Math.floor(total * 0.58));
}

export function getShowcaseFollowState(): {
  activeCueId: number;
  phaseElapsedSec: number;
  phase: ShowcaseFollowPhase;
} {
  const cycleElapsed = getShowcaseElapsedSec() % SHOWCASE_FOLLOW_CYCLE_SEC;
  if (cycleElapsed < SHOWCASE_CUE1_PHASE_SEC) {
    return { activeCueId: 1, phaseElapsedSec: cycleElapsed, phase: 'cue1' };
  }
  return {
    activeCueId: 2,
    phaseElapsedSec: cycleElapsed - SHOWCASE_CUE1_PHASE_SEC,
    phase: 'cue2',
  };
}

export function getShowcaseActiveCueRow(): DemoScheduleRow {
  const { activeCueId } = getShowcaseFollowState();
  return DEMO_SCHEDULE.find((r) => r.id === activeCueId) ?? DEMO_SCHEDULE[0];
}

/** Main stage timer — resets each follow phase (CUE 1 → CUE 2). */
export function getShowcaseMainRemaining(): number {
  const { phaseElapsedSec } = getShowcaseFollowState();
  const row = getShowcaseActiveCueRow();
  const initial = getCueCountdownStartSec(row);
  return Math.max(0, initial - phaseElapsedSec);
}

/** Sub-cue countdown — only meaningful while Clock is showing sub layout */
export function getShowcaseSubCueRemaining(): number | null {
  if (!getShowcaseSubCueVisible()) return null;
  const { phaseElapsedSec } = getShowcaseFollowState();
  const initial = DEMO_SUB_CUE.startRemainingSec;
  const remaining = initial - phaseElapsedSec;
  if (remaining <= 0) return 0;
  return remaining;
}

export function getShowcaseSubCueLabel(): string {
  return DEMO_SUB_CUE.cue.replace(/CUE(\d+[A-Z]?)/, 'CUE $1');
}
export function getShowcasePhotoPreviewRows(): DemoScheduleRow[] {
  const { activeCueId } = getShowcaseFollowState();
  const idx = DEMO_SCHEDULE.findIndex((r) => r.id === activeCueId);
  if (idx === -1) return DEMO_SCHEDULE.slice(0, 3);
  return DEMO_SCHEDULE.slice(idx, Math.min(idx + 3, DEMO_SCHEDULE.length));
}

/** Green Room — public cues from active onwards (mirrors production follow filter). */
export function getShowcaseGreenRoomRows(max = SHOWCASE_GREEN_ROOM_MAX_CUES): DemoScheduleRow[] {
  const { activeCueId } = getShowcaseFollowState();
  const publicRows = DEMO_SCHEDULE.filter((r) => r.isPublic !== false);
  const idx = publicRows.findIndex((r) => r.id === activeCueId);
  if (idx === -1) return publicRows.slice(0, max);
  return publicRows.slice(idx, Math.min(idx + max, publicRows.length));
}

/** Run of Show grid — cues from active through end of schedule (full cue count). */
export function getShowcaseRunOfShowRows(max = SHOWCASE_FULL_CUE_COUNT): DemoScheduleRow[] {
  const { activeCueId } = getShowcaseFollowState();
  const idx = DEMO_SCHEDULE.findIndex((r) => r.id === activeCueId);
  if (idx === -1) return DEMO_SCHEDULE.slice(0, max);
  return DEMO_SCHEDULE.slice(idx, Math.min(idx + max, DEMO_SCHEDULE.length));
}

/** Notes popout — same follow window as Green Room (remaining public cues). */
export function getShowcasePinNotesRows(): DemoScheduleRow[] {
  return getShowcaseGreenRoomRows();
}

export type ShowcaseRowTimerState = 'running' | 'completed' | 'idle';

export function getShowcaseRowTimerState(rowId: number): ShowcaseRowTimerState {
  const { activeCueId } = getShowcaseFollowState();
  if (rowId === activeCueId) return 'running';
  if (rowId < activeCueId) return 'completed';
  return 'idle';
}

export function getShowcaseScheduleTrt(): { hours: number; minutes: number; seconds: number } {
  let total = 0;
  for (const row of DEMO_SHOWCASE_VISIBLE_CUES) {
    total += row.durationHours * 3600 + row.durationMinutes * 60 + row.durationSeconds;
  }
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function useShowcaseFollowTick(): number {
  return useSyncExternalStore(subscribeShowcaseTick, getShowcaseElapsedSec, () => 0);
}

export function useShowcaseFollow() {
  const tick = useShowcaseFollowTick();
  void tick;
  const state = getShowcaseFollowState();
  return {
    ...state,
    activeRow: getShowcaseActiveCueRow(),
    mainRemaining: getShowcaseMainRemaining(),
    photoPreviewRows: getShowcasePhotoPreviewRows(),
    runOfShowRows: getShowcaseRunOfShowRows(),
    pinNotesRows: getShowcasePinNotesRows(),
    greenRoomRows: getShowcaseGreenRoomRows(),
    activeDurationSec: getCueDurationSec(getShowcaseActiveCueRow()),
    clockDisplayMode: getShowcaseClockDisplayMode(),
    showSubCueHeader: getShowcaseSubCueVisible(),
    subCueRemaining: getShowcaseSubCueRemaining(),
    subCueLabel: getShowcaseSubCueLabel(),
  };
}
