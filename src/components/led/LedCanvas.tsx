import React, { useEffect, useState } from 'react';
import { UHD_HEIGHT, UHD_WIDTH } from '../../types/ledText';

interface LedCanvasProps {
  children: React.ReactNode;
  /** When true, scale to fit parent (preview). When false, scale to viewport (output). */
  fitParent?: boolean;
  className?: string;
  backgroundColor?: string;
}

export const LedCanvas: React.FC<LedCanvasProps> = ({
  children,
  fitParent = false,
  className = '',
  backgroundColor = 'transparent',
}) => {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const update = () => {
      if (fitParent) {
        const el = document.getElementById('led-canvas-fit-parent');
        if (el) {
          const sw = el.clientWidth / UHD_WIDTH;
          const sh = el.clientHeight / UHD_HEIGHT;
          setScale(Math.min(sw, sh, 1));
        }
        return;
      }
      const sw = window.innerWidth / UHD_WIDTH;
      const sh = window.innerHeight / UHD_HEIGHT;
      setScale(Math.min(sw, sh));
    };

    update();
    window.addEventListener('resize', update);
    const ro = fitParent
      ? new ResizeObserver(update)
      : null;
    const el = document.getElementById('led-canvas-fit-parent');
    if (ro && el) ro.observe(el);

    return () => {
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [fitParent]);

  const inner = (
    <div
      style={{
        width: UHD_WIDTH,
        height: UHD_HEIGHT,
        transform: `scale(${scale})`,
        transformOrigin: fitParent ? 'top left' : 'center center',
        backgroundColor,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );

  if (fitParent) {
    return (
      <div
        id="led-canvas-fit-parent"
        className={`relative w-full overflow-hidden bg-black/40 rounded-lg border border-slate-600 ${className}`}
        style={{ aspectRatio: '16 / 9' }}
      >
        <div className="absolute left-0 top-0">{inner}</div>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 overflow-hidden flex items-center justify-center ${className}`}
      style={{ backgroundColor: 'transparent' }}
    >
      {inner}
    </div>
  );
};

export default LedCanvas;
