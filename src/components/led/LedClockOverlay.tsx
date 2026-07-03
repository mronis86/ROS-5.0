import React from 'react';
import { formatLedCountdown } from '../../lib/ledClock';
import type { LedTimerSnapshot } from '../../hooks/useLedOutputTimer';
import type { LedOutputClock } from '../../types/ledClock';

type LedClockOverlayProps = {
  clock: LedOutputClock;
  timer: LedTimerSnapshot | null;
  /** Preview mode uses a fake countdown when no live timer. */
  preview?: boolean;
};

const LedClockOverlay: React.FC<LedClockOverlayProps> = ({ clock, timer, preview = false }) => {
  const remaining =
    timer?.remainingSeconds ?? (preview ? 14 * 60 + 32 : null);

  const translateX =
    clock.align === 'center' ? '-50%' : clock.align === 'right' ? '-100%' : '0';

  const bg =
    clock.showBackground && clock.backgroundOpacity > 0
      ? {
          backgroundColor: clock.backgroundColor,
          opacity: clock.backgroundOpacity,
        }
      : undefined;

  return (
    <div
      className="absolute inset-0 pointer-events-none led-editor-no-transition"
      style={{ zIndex: 20 }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${clock.x}%`,
          top: `${clock.y}%`,
          transform: `translateX(${translateX}) scale(${clock.scale})`,
          transformOrigin:
            clock.align === 'center'
              ? 'top center'
              : clock.align === 'right'
                ? 'top right'
                : 'top left',
          maxWidth: '90%',
          width: 'max-content',
        }}
      >
        <div className="relative">
          {bg ? (
            <div
              className="absolute inset-0 rounded-2xl"
              style={{
                ...bg,
                margin: -clock.paddingPx,
              }}
            />
          ) : null}
          <div
            className="relative flex flex-col gap-2"
            style={{
              padding: clock.paddingPx,
              textAlign: clock.align,
            }}
          >
            {clock.showLabel && clock.label.trim() ? (
              <div
                style={{
                  fontFamily: clock.fontFamily,
                  fontSize: clock.labelFontSize,
                  fontWeight: clock.fontWeight,
                  fontStyle: clock.fontStyle,
                  color: clock.labelColor,
                  lineHeight: 1.1,
                  textShadow: '0 2px 16px rgba(0,0,0,0.7)',
                }}
              >
                {clock.label}
              </div>
            ) : null}

            {remaining != null ? (
              <div
                style={{
                  fontFamily: clock.fontFamily,
                  fontSize: clock.fontSize,
                  fontWeight: clock.fontWeight,
                  fontStyle: clock.fontStyle,
                  color: clock.color,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                  textShadow: '0 4px 24px rgba(0,0,0,0.75)',
                }}
              >
                {formatLedCountdown(remaining)}
              </div>
            ) : (
              <div
                style={{
                  fontFamily: clock.fontFamily,
                  fontSize: clock.labelFontSize,
                  fontWeight: clock.fontWeight,
                  color: clock.labelColor,
                  opacity: 0.6,
                }}
              >
                No active timer
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LedClockOverlay;
