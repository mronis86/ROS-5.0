import React, { useEffect, useState } from 'react';
import {
  CLOCK_SHOWCASE_STYLES,
  clockMessageFontSize,
  clockProgressColor,
  clockRemainingPercent,
  formatClockMessage,
  formatClockTime,
  formatClockTimeOfDay,
} from './clockShowcaseHelpers';
import { DEMO_STAGE_MESSAGE, DEMO_SUB_CUE } from './demoData';
import {
  SHOWCASE_CLOCK_ROTATE_MS,
  useShowcaseFollow,
} from './showcaseFollowMode';

const LARGE_TIMER = 'text-[15rem] md:text-[16.875rem] lg:text-[22.5rem] leading-none';
const BOTTOM_TIMER = 'text-3xl md:text-4xl lg:text-5xl leading-none';

function ProgressBar({
  remaining,
  total,
  thick = false,
}: {
  remaining: number;
  total: number;
  thick?: boolean;
}) {
  const color = clockProgressColor(remaining);
  const pct = clockRemainingPercent(remaining, total);
  return (
    <div
      className={`w-full bg-slate-700 rounded-full overflow-hidden border-3 border-slate-600 relative ${
        thick ? 'h-8' : 'h-2'
      }`}
    >
      <div
        className="h-full transition-all duration-1000 absolute top-0 right-0"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export const ClockShowcaseContent: React.FC = () => {
  const { activeRow, mainRemaining, activeDurationSec, phase, phaseElapsedSec, clockDisplayMode } =
    useShowcaseFollow();
  const subCueRemaining = Math.max(0, DEMO_SUB_CUE.startRemainingSec - phaseElapsedSec);
  const [now, setNow] = useState(new Date());

  const onCue2 = phase === 'cue2';
  const mode = clockDisplayMode;
  const layoutKey = onCue2
    ? `${phase}-${mode}-${Math.floor((phaseElapsedSec * 1000) / SHOWCASE_CLOCK_ROTATE_MS)}`
    : phase;

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const mainColor = clockProgressColor(mainRemaining);
  const subLine = `${DEMO_SUB_CUE.cue.replace(/CUE(\d+)/, 'CUE $1')} - ${DEMO_SUB_CUE.segmentName}`;
  const formattedMessage = formatClockMessage(DEMO_STAGE_MESSAGE.replace('\n', ' '));

  return (
    <>
      <style>{CLOCK_SHOWCASE_STYLES}</style>
      <div
        className="relative w-full h-full bg-black text-white overflow-hidden flex flex-col items-center justify-center"
        style={{ padding: 0, margin: 0 }}
      >
        <div className="absolute top-10 left-10 text-3xl font-mono text-white z-50">
          <div className="text-slate-400 text-lg mb-1">CURRENT TIME</div>
          <div className="text-white">{formatClockTimeOfDay(now)}</div>
        </div>

        <div className="fixed top-10 right-10 text-3xl font-mono text-white z-50 w-80 text-right">
          <div className="text-slate-400 text-lg mb-1">CURRENT CUE</div>
          <div className="text-white whitespace-nowrap">{activeRow.cue}</div>
        </div>

        <div className="absolute top-10 left-1/2 transform -translate-x-1/2 flex gap-3 z-50">
          <button
            type="button"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-lg transition-colors"
          >
            FULL SCREEN
          </button>
          <button
            type="button"
            disabled
            className="px-4 py-2 rounded-lg font-bold text-lg bg-purple-600 text-white cursor-default"
          >
            WEBSOCKET ONLY
          </button>
        </div>

        <div className="absolute bottom-10 left-10 text-center z-50">
          <div className="text-lg font-bold px-4 py-2 rounded-lg bg-green-600 text-white">⏱️ TIMER RUNNING</div>
        </div>

        <div className="fixed bottom-10 right-4 z-[100] bg-black/50 backdrop-blur-sm rounded-lg p-3 space-y-2 min-w-[140px]">
          <label className="flex items-center gap-2 cursor-default text-sm text-gray-300">
            <input type="checkbox" checked readOnly className="rounded border-slate-500 bg-slate-700 text-blue-500" />
            <span>Schedule sync</span>
          </label>
          <div className="text-sm text-gray-400 font-mono">Sync in 42s</div>
        </div>

        <div key={layoutKey} className="absolute inset-0 z-20">
          {mode === 'main' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-center">
                <div className={`font-mono font-bold ${LARGE_TIMER}`} style={{ color: mainColor }}>
                  {formatClockTime(mainRemaining)}
                </div>
              </div>
              <div className="w-full max-w-5xl mt-0 px-8">
                <ProgressBar remaining={mainRemaining} total={activeDurationSec} thick />
              </div>
            </div>
          )}

          {mode === 'sub' && onCue2 && (
            <div className="absolute inset-0">
              <div
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{ marginTop: '-80px' }}
              >
                <div
                  className="absolute left-1/2 transform -translate-x-1/2 text-orange-400 font-bold text-xl md:text-2xl lg:text-3xl whitespace-nowrap clock-showcase-slide-top"
                  style={{ top: 'calc(50% - 162px)', lineHeight: 1.2 }}
                >
                  {subLine}
                </div>
                <div className={`text-orange-400 font-mono font-bold ${LARGE_TIMER} clock-showcase-zoom-in`}>
                  {formatClockTime(subCueRemaining)}
                </div>
              </div>

              <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 left-1/2 transform -translate-x-1/2">
                <div className={`font-mono font-bold ${BOTTOM_TIMER}`} style={{ color: mainColor }}>
                  {formatClockTime(mainRemaining)}
                </div>
              </div>

              <div className="w-full transition-all duration-500 ease-in-out absolute bottom-8 left-1/2 transform -translate-x-1/2 max-w-2xl px-8">
                <ProgressBar remaining={mainRemaining} total={activeDurationSec} />
              </div>
            </div>
          )}

          {mode === 'message' && onCue2 && (
            <div className="absolute inset-0">
              <div className="absolute inset-0 flex items-center justify-center" style={{ transform: 'translateY(-40px)' }}>
                <div
                  className="font-bold text-white bg-black bg-opacity-50 rounded-lg border-4 border-white text-center flex items-center justify-center clock-showcase-message-in"
                  style={{
                    width: '80vw',
                    minHeight: '50vh',
                    maxHeight: '70vh',
                    lineHeight: 1.2,
                    whiteSpace: 'pre-line',
                    padding: '30px',
                  }}
                >
                  <div style={{ fontSize: clockMessageFontSize(DEMO_STAGE_MESSAGE) }}>{formattedMessage}</div>
                </div>
              </div>

              <div className="text-center transition-all duration-500 ease-in-out absolute bottom-20 left-1/2 transform -translate-x-1/2">
                <div className={`font-mono font-bold ${BOTTOM_TIMER}`} style={{ color: mainColor }}>
                  {formatClockTime(mainRemaining)}
                </div>
              </div>

              <div className="w-full transition-all duration-500 ease-in-out absolute bottom-8 left-1/2 transform -translate-x-1/2 max-w-2xl px-8">
                <ProgressBar remaining={mainRemaining} total={activeDurationSec} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
