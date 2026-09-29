import React, { useEffect, useState } from 'react';
import {
  formatOperatorCountdownTime,
  OperatorCountdownDisplay,
  operatorCountdownRemaining,
} from '../lib/operatorCountdown';
import { startSecondTicker } from '../utils/secondTicker';

type OperatorCountdownStripProps = {
  timer: OperatorCountdownDisplay | null | undefined;
  clockOffsetMs?: number;
  /** Large countdown when this is the only alt timer on screen */
  large?: boolean;
  className?: string;
};

const OperatorCountdownStrip: React.FC<OperatorCountdownStripProps> = ({
  timer,
  clockOffsetMs = 0,
  large = false,
  className = '',
}) => {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!timer?.is_running) return;
    return startSecondTicker(() => bump((n) => n + 1));
  }, [timer?.is_running, timer?.started_at]);

  if (!timer?.is_active) return null;

  const remaining = operatorCountdownRemaining(timer, clockOffsetMs);
  if (timer.is_running && remaining <= 0) return null;

  const time = formatOperatorCountdownTime(remaining);

  if (large) {
    return (
      <div className={`flex flex-col items-center justify-center text-violet-200 ${className}`}>
        <span className="mb-2 inline-flex items-center gap-2 text-xl font-bold md:text-2xl">
          <span className="rounded bg-violet-500 px-2 py-0.5 text-xs font-black tracking-widest text-black">
            OP
          </span>
          {timer.cue_display}
        </span>
        <span className="font-mono text-[10rem] font-bold leading-none md:text-[12rem]">{time}</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex flex-wrap items-center justify-center gap-2 rounded-md border border-violet-500/40 bg-violet-950/50 px-3 py-1.5 text-violet-100 ${className}`}
    >
      <span className="rounded bg-violet-500 px-1.5 py-0.5 text-[10px] font-black tracking-widest text-black">
        OP
      </span>
      <span className="text-sm font-semibold">{timer.cue_display}</span>
      <span className="font-mono text-lg font-bold tabular-nums">{time}</span>
    </div>
  );
};

export default OperatorCountdownStrip;
