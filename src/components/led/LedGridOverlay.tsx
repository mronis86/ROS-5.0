import React from 'react';
import { UHD_HEIGHT, UHD_WIDTH } from '../../types/ledText';

interface LedGridOverlayProps {
  /** Grid cell size in 4K canvas pixels (e.g. 80). */
  gridSize: number;
  visible: boolean;
  /** 0–1 line opacity */
  opacity: number;
  /** CSS scale applied to the 4K canvas — used to draw 1px screen lines. */
  displayScale: number;
}

const MAJOR_EVERY = 4;

/**
 * Screen-space CSS grid so minor lines stay visible after the 4K canvas is scaled down.
 */
export const LedGridOverlay: React.FC<LedGridOverlayProps> = ({
  gridSize,
  visible,
  opacity,
  displayScale,
}) => {
  if (!visible || displayScale <= 0 || gridSize < 1) return null;

  const minorPx = Math.max(6, gridSize * displayScale);
  const majorPx = minorPx * MAJOR_EVERY;
  const displayW = UHD_WIDTH * displayScale;
  const displayH = UHD_HEIGHT * displayScale;

  const o = Math.min(1, Math.max(0.05, opacity));
  const majorAlpha = Math.min(1, o * 1.35);
  const minorAlpha = o * 0.85;

  return (
    <div
      aria-hidden
      className="led-editor-grid pointer-events-none absolute top-0 left-0"
      style={{
        width: displayW,
        height: displayH,
        zIndex: 2,
        backgroundImage: [
          `linear-gradient(to right, rgba(186, 198, 214, ${majorAlpha}) 1px, transparent 1px)`,
          `linear-gradient(to bottom, rgba(186, 198, 214, ${majorAlpha}) 1px, transparent 1px)`,
          `linear-gradient(to right, rgba(100, 116, 139, ${minorAlpha}) 1px, transparent 1px)`,
          `linear-gradient(to bottom, rgba(100, 116, 139, ${minorAlpha}) 1px, transparent 1px)`,
        ].join(', '),
        backgroundSize: [
          `${majorPx}px ${majorPx}px`,
          `${majorPx}px ${majorPx}px`,
          `${minorPx}px ${minorPx}px`,
          `${minorPx}px ${minorPx}px`,
        ].join(', '),
      }}
    />
  );
};

export default LedGridOverlay;
