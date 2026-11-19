import {
  qaAutoStartDueAtMs,
  shouldArmQaFlash,
  shouldAutoStartQa,
  shouldAutoStartQaAtWallClock,
} from './qaPlan';

describe('Q&A auto-start gates', () => {
  const started = Date.parse('2026-11-19T18:57:54.390Z');
  const total = 2400; // Cue 13 — 40:00
  const threshold = 600; // last 10:00

  test('due time is parent start + (total - threshold)', () => {
    expect(qaAutoStartDueAtMs(started, total, threshold)).toBe(started + 1800_000);
  });

  test('wall clock does not fire at parent START', () => {
    expect(
      shouldAutoStartQaAtWallClock({
        parentRunning: true,
        parentStartedAtMs: started,
        parentTotalSeconds: total,
        thresholdSeconds: threshold,
        nowMs: started + 5_000,
      })
    ).toBe(false);
  });

  test('wall clock fires at and after the 10:00-remaining mark', () => {
    const due = started + 1800_000;
    expect(
      shouldAutoStartQaAtWallClock({
        parentRunning: true,
        parentStartedAtMs: started,
        parentTotalSeconds: total,
        thresholdSeconds: threshold,
        nowMs: due,
      })
    ).toBe(true);
    expect(
      shouldAutoStartQaAtWallClock({
        parentRunning: true,
        parentStartedAtMs: started,
        parentTotalSeconds: total,
        thresholdSeconds: threshold,
        nowMs: due + 6_000,
      })
    ).toBe(true);
  });

  test('remaining poll rejects stale prior-cue hybrid progress', () => {
    // Previous cue nearly done (remaining 100 of 2100) while new parent is Cue 13 (2400).
    expect(
      shouldAutoStartQa({
        parentRunning: true,
        parentRemainingSeconds: 100,
        parentTotalSeconds: 2100,
        thresholdSeconds: threshold,
        parentElapsedSeconds: 2000,
        expectedParentTotalSeconds: total,
      })
    ).toBe(false);
  });

  test('remaining poll still fires when progress matches parent duration', () => {
    expect(
      shouldAutoStartQa({
        parentRunning: true,
        parentRemainingSeconds: 600,
        parentTotalSeconds: total,
        thresholdSeconds: threshold,
        parentElapsedSeconds: 1800,
        expectedParentTotalSeconds: total,
      })
    ).toBe(true);
  });

  test('flash arm uses wall clock and rejects stale prior-cue remaining', () => {
    expect(
      shouldArmQaFlash({
        parentRunning: true,
        parentStartedAtMs: started,
        parentRemainingSeconds: 100,
        parentTotalSeconds: 2100,
        thresholdSeconds: threshold,
        parentElapsedSeconds: 2000,
        expectedParentTotalSeconds: total,
        nowMs: started + 5_000,
      })
    ).toBe(false);
    expect(
      shouldArmQaFlash({
        parentRunning: true,
        parentStartedAtMs: started,
        parentRemainingSeconds: 600,
        parentTotalSeconds: total,
        thresholdSeconds: threshold,
        parentElapsedSeconds: 1800,
        expectedParentTotalSeconds: total,
        nowMs: started + 1800_000,
      })
    ).toBe(true);
  });
});
