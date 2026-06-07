import React, { useEffect, useState } from 'react';
import { formatClockTime } from './clockShowcaseHelpers';
import { DEMO_EVENT } from './demoData';
import { useShowcaseFollow } from './showcaseFollowMode';

export const GreenRoomShowcaseContent: React.FC = () => {
  const { activeCueId, mainRemaining, activeRow, greenRoomRows } = useShowcaseFollow();
  const [syncCountdown, setSyncCountdown] = useState(18);
  const [prevRowIds, setPrevRowIds] = useState<number[]>(() => greenRoomRows.map((r) => r.id));

  useEffect(() => {
    const id = window.setInterval(() => {
      setSyncCountdown((s) => (s <= 1 ? 20 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const currentIds = greenRoomRows.map((r) => r.id);
    const t = window.setTimeout(() => setPrevRowIds(currentIds), 500);
    return () => window.clearTimeout(t);
  }, [greenRoomRows]);

  const newRowIds = new Set(greenRoomRows.map((r) => r.id).filter((id) => !prevRowIds.includes(id)));

  return (
    <div className="w-full h-full text-white relative overflow-hidden">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectFit: 'cover' }}
      >
        <source src="/pointed_crop_loop.webm" type="video/webm" />
      </video>

      <div
        className="absolute inset-0 bg-gradient-to-b from-slate-900/35 via-transparent to-black/55 pointer-events-none"
        aria-hidden
      />

      {/* Fullscreen layout — no event selector / controls overlay */}
      <div className="relative z-10 h-full flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center gap-3 flex-shrink-0">
          <h1
            className="text-white font-bold flex-1 min-w-0 text-center leading-tight"
            style={{
              fontSize: 'clamp(1.1rem, 4.2vw, 1.65rem)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {DEMO_EVENT.name}
          </h1>

          <div className="rounded-md px-2.5 py-2 text-center flex-shrink-0 bg-red-600 w-[112px]">
            <div className="text-white text-[10px] font-semibold leading-none mb-0.5">Stage Timer</div>
            <div className="text-2xl font-bold tabular-nums leading-none my-0.5">
              {formatClockTime(mainRemaining)}
            </div>
            <div className="text-white text-[9px] leading-tight">Finish: {activeRow.endTime}</div>
            <div className="text-white/70 text-[8px] leading-none mt-0.5">Sync: {syncCountdown}s</div>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto px-4 pb-3 min-h-0 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <div className="space-y-1.5">
            {greenRoomRows.map((item) => {
              const isRunning = item.id === activeCueId;
              const isNew = newRowIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`px-2.5 py-2 rounded-md transition-all duration-300 ${
                    isRunning ? 'bg-red-600 text-white' : 'bg-gray-300 text-gray-700'
                  } ${isNew ? 'animate-[greenRoomRowReveal_450ms_ease-out]' : ''}`}
                >
                  <div className="font-bold text-xs uppercase leading-snug mb-0.5 line-clamp-2">
                    {item.segmentName}
                  </div>
                  <div className="text-[10px] leading-tight opacity-90">
                    {item.startTime} – {item.endTime}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes greenRoomRowReveal {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
