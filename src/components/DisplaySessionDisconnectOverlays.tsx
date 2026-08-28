import React, { useEffect, useRef, useState } from 'react';
import {
  DISPLAY_SESSION_MAX_HINT,
  DISPLAY_SESSION_MAX_LABEL,
} from '../lib/displaySession';

type DisplaySessionDisconnectModalProps = {
  onConfirm: (hours: number, minutes: number) => void;
  onNever: () => void;
};

export const DisplaySessionDisconnectModal: React.FC<DisplaySessionDisconnectModalProps> = ({
  onConfirm,
  onNever,
}) => {
  const [hours, setHours] = useState(2);
  const [minutes, setMinutes] = useState(0);

  const minuteValues = [0, 5, 10, 15, 20, 25, 30];
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hoursRef.current) {
      hoursRef.current.scrollTop = hours * 50;
    }
    if (minutesRef.current) {
      minutesRef.current.scrollTop = minuteValues.indexOf(minutes) * 50;
    }
  }, []);

  const handleHoursScroll = () => {
    if (!hoursRef.current) return;
    const index = Math.round(hoursRef.current.scrollTop / 50);
    setHours(Math.max(0, Math.min(index, 24)));
  };

  const handleMinutesScroll = () => {
    if (!minutesRef.current) return;
    const index = Math.round(minutesRef.current.scrollTop / 50);
    setMinutes(minuteValues[Math.max(0, Math.min(index, minuteValues.length - 1))]);
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black bg-opacity-80">
      <div className="w-[90%] max-w-3xl rounded-2xl border border-slate-700 bg-slate-800 p-10 shadow-2xl">
        <h3 className="mb-2 text-center text-3xl font-semibold text-slate-100">⏰ Auto-Disconnect Timer</h3>
        <p className="mb-8 text-center text-slate-400">How long should this connection stay active?</p>

        <div className="mb-10 flex items-center justify-center gap-12 py-8">
          <div className="flex flex-col items-center gap-4">
            <div className="text-sm font-medium uppercase tracking-wider text-slate-300">Hours</div>
            <div className="relative h-56 w-32 overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-inner">
              <div className="pointer-events-none absolute left-0 right-0 top-1/2 z-10 h-12 -translate-y-1/2 border-y border-slate-500/20 bg-blue-500/10" />
              <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-20 bg-gradient-to-b from-slate-900 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-20 bg-gradient-to-t from-slate-900 to-transparent" />
              <div
                ref={hoursRef}
                onScroll={handleHoursScroll}
                className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll pb-24 pt-24"
                style={{ scrollBehavior: 'smooth' }}
              >
                {Array.from({ length: 25 }, (_, i) => (
                  <div
                    key={i}
                    className={`flex h-12 snap-center items-center justify-center text-2xl font-medium transition-all ${
                      hours === i ? 'scale-110 text-slate-100' : 'scale-90 text-slate-600'
                    }`}
                  >
                    {i}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-10 text-4xl font-light text-slate-300">:</div>

          <div className="flex flex-col items-center gap-4">
            <div className="text-sm font-medium uppercase tracking-wider text-slate-300">Minutes</div>
            <div className="relative h-56 w-32 overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-inner">
              <div className="pointer-events-none absolute left-0 right-0 top-1/2 z-10 h-12 -translate-y-1/2 border-y border-slate-500/20 bg-blue-500/10" />
              <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-20 bg-gradient-to-b from-slate-900 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-20 bg-gradient-to-t from-slate-900 to-transparent" />
              <div
                ref={minutesRef}
                onScroll={handleMinutesScroll}
                className="scrollbar-hide h-full snap-y snap-mandatory overflow-y-scroll pb-24 pt-24"
                style={{ scrollBehavior: 'smooth' }}
              >
                {minuteValues.map((m) => (
                  <div
                    key={m}
                    className={`flex h-12 snap-center items-center justify-center text-2xl font-medium transition-all ${
                      minutes === m ? 'scale-110 text-slate-100' : 'scale-90 text-slate-600'
                    }`}
                  >
                    {m}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => onConfirm(hours, minutes)}
            className="flex-1 rounded-xl bg-blue-600 px-8 py-4 text-lg font-medium text-white transition hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/40"
          >
            Start Timer
          </button>
          <button
            type="button"
            onClick={onNever}
            className="flex-1 rounded-xl bg-slate-600 px-8 py-4 text-lg font-medium text-slate-200 transition hover:-translate-y-0.5 hover:bg-slate-500 hover:shadow-lg hover:shadow-slate-600/30"
          >
            {DISPLAY_SESSION_MAX_LABEL}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">⚠️ {DISPLAY_SESSION_MAX_HINT}</p>
      </div>
    </div>
  );
};

type DisplaySessionDisconnectNotificationProps = {
  duration: string;
  onReconnect: () => void;
};

export const DisplaySessionDisconnectNotification: React.FC<DisplaySessionDisconnectNotificationProps> = ({
  duration,
  onReconnect,
}) => (
  <>
    <div className="pointer-events-auto fixed inset-0 z-[999998] animate-fade-in bg-black bg-opacity-70" />
    <div className="pointer-events-auto fixed left-1/2 top-1/2 z-[999999] -translate-x-1/2 -translate-y-1/2 animate-slide-in">
      <div className="flex min-w-[450px] items-center gap-6 rounded-2xl border-2 border-slate-600 bg-gradient-to-br from-slate-800 to-slate-700 p-10 shadow-2xl">
        <div className="animate-pulse-slow text-6xl">🔌</div>
        <div className="flex-1">
          <h4 className="mb-2 text-2xl font-semibold text-slate-100">Connection Closed</h4>
          <p className="text-base text-slate-400">Auto-disconnected after {duration}</p>
        </div>
        <button
          type="button"
          onClick={onReconnect}
          className="whitespace-nowrap rounded-xl bg-blue-600 px-6 py-3 text-base font-medium text-white transition hover:-translate-y-1 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/40"
        >
          🔄 Reconnect
        </button>
      </div>
    </div>
  </>
);

export type DisplaySessionDisconnectOverlaysProps = {
  showModal: boolean;
  showNotification: boolean;
  disconnectDuration: string;
  onConfirm: (hours: number, minutes: number) => void;
  onNever: () => void;
  onReconnect: () => void;
};

const DisplaySessionDisconnectOverlays: React.FC<DisplaySessionDisconnectOverlaysProps> = ({
  showModal,
  showNotification,
  disconnectDuration,
  onConfirm,
  onNever,
  onReconnect,
}) => (
  <>
    {showModal ? <DisplaySessionDisconnectModal onConfirm={onConfirm} onNever={onNever} /> : null}
    {showNotification ? (
      <DisplaySessionDisconnectNotification duration={disconnectDuration} onReconnect={onReconnect} />
    ) : null}
  </>
);

export default DisplaySessionDisconnectOverlays;
