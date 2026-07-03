import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSpeakerForLayoutSlot,
  normalizeLedLayout,
  snapPoint,
  updateSpeakerPlacement,
} from '../../lib/ledText';
import type { LedElementKey, LedLayoutConfig } from '../../types/ledText';
import { UHD_HEIGHT, UHD_WIDTH } from '../../types/ledText';
import { LedFreeformRenderer } from './LedFreeformRenderer';
import { LedGridOverlay } from './LedGridOverlay';

interface SchedulePreviewItem {
  segmentName: string;
  speakersText: string;
}

interface LedWysiwygEditorProps {
  layout: LedLayoutConfig;
  onLayoutChange: (layout: LedLayoutConfig) => void;
  item: SchedulePreviewItem;
  title: string;
  selectedKey: LedElementKey | null;
  onSelectKey: (key: LedElementKey | null) => void;
}

type DragState = {
  key: string;
  startPointerX: number;
  startPointerY: number;
  originX: number;
  originY: number;
};

export const LedWysiwygEditor: React.FC<LedWysiwygEditorProps> = ({
  layout,
  onLayoutChange,
  item,
  title,
  selectedKey,
  onSelectKey,
}) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.1);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const onLayoutChangeRef = useRef(onLayoutChange);
  onLayoutChangeRef.current = onLayoutChange;

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const sw = el.clientWidth / UHD_WIDTH;
      const sh = el.clientHeight / UHD_HEIGHT;
      setScale(Math.min(sw, sh) || 0.1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const speakersBySlot = new Map(
    [1, 2, 3, 4, 5, 6, 7].map((slot) => [
      slot,
      getSpeakerForLayoutSlot(item.speakersText, slot),
    ])
  );

  const clientToPercent = useCallback(
    (clientX: number, clientY: number, snap: boolean) => {
      const surface = surfaceRef.current;
      if (!surface) return { x: 0, y: 0 };
      const rect = surface.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 100;
      const y = ((clientY - rect.top) / rect.height) * 100;
      const current = layoutRef.current;
      return snapPoint(x, y, current.gridSize, snap && current.snapToGrid);
    },
    []
  );

  const applyTransform = useCallback((key: string, x: number, y: number) => {
    const current = layoutRef.current;
    if (key === 'session-title') {
      onLayoutChangeRef.current(
        normalizeLedLayout({
          ...current,
          sessionTitle: { ...current.sessionTitle, x, y },
        })
      );
      return;
    }
    if (key.startsWith('speaker-')) {
      const id = key.replace('speaker-', '');
      onLayoutChangeRef.current(updateSpeakerPlacement(current, id, { x, y }));
    }
  }, []);

  const handleElementPointerDown = useCallback(
    (key: string, clientX: number, clientY: number) => {
      const current = layoutRef.current;
      onSelectKey(key as LedElementKey);

      let originX = current.sessionTitle.x;
      let originY = current.sessionTitle.y;

      if (key.startsWith('speaker-')) {
        const id = key.replace('speaker-', '');
        const sp = current.speakers.find((s) => s.id === id);
        if (!sp) return;
        originX = sp.x;
        originY = sp.y;
      }

      const pointer = clientToPercent(clientX, clientY, false);
      dragRef.current = {
        key,
        startPointerX: pointer.x,
        startPointerY: pointer.y,
        originX,
        originY,
      };
    },
    [clientToPercent, onSelectKey]
  );

  const handleElementPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;

      const current = clientToPercent(clientX, clientY, false);
      const dx = current.x - drag.startPointerX;
      const dy = current.y - drag.startPointerY;
      const next = snapPoint(
        drag.originX + dx,
        drag.originY + dy,
        layoutRef.current.gridSize,
        layoutRef.current.snapToGrid
      );
      applyTransform(drag.key, next.x, next.y);
    },
    [applyTransform, clientToPercent]
  );

  const handleElementPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      ref={outerRef}
      className="led-editor-root relative w-full overflow-hidden rounded-lg border border-slate-500 bg-[#0f172a]"
      style={{ aspectRatio: '16 / 9' }}
    >
      <LedGridOverlay
        gridSize={layout.gridSize}
        visible={layout.showGrid}
        opacity={layout.gridOpacity}
        displayScale={scale}
      />
      <div
        ref={surfaceRef}
        className="led-editor-no-transition absolute top-0 left-0 z-[4]"
        style={{
          width: UHD_WIDTH,
          height: UHD_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <LedFreeformRenderer
          layout={layout}
          title={title}
          speakersBySlot={speakersBySlot}
          interactive
          selectedKey={selectedKey}
          onSelect={(key) => onSelectKey(key as LedElementKey | null)}
          onElementPointerDown={handleElementPointerDown}
          onElementPointerMove={handleElementPointerMove}
          onElementPointerUp={handleElementPointerUp}
        />
      </div>
    </div>
  );
};

export default LedWysiwygEditor;
