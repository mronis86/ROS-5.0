import React from 'react';
import type { ParsedSpeaker } from '../../showcase/photoShowcaseHelpers';
import {
  elementPositionStyle,
  mergeLedStyles,
} from '../../lib/ledText';
import type {
  LedElementTransform,
  LedLayoutConfig,
  LedSessionTitleConfig,
  LedSpeakerPlacement,
} from '../../types/ledText';
import { UHD_HEIGHT, UHD_WIDTH } from '../../types/ledText';

export interface LedFreeformRenderProps {
  layout: LedLayoutConfig;
  title: string;
  speakersBySlot: Map<number, ParsedSpeaker | null>;
  interactive?: boolean;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
  onElementPointerDown?: (key: string, clientX: number, clientY: number) => void;
  onElementPointerMove?: (clientX: number, clientY: number) => void;
  onElementPointerUp?: () => void;
}

function SelectionOutline({ selected, interactive }: { selected: boolean; interactive: boolean }) {
  if (!interactive) return null;
  return (
    <div
      className={`absolute inset-0 rounded pointer-events-none ${
        selected ? 'ring-2 ring-cyan-400' : 'ring-1 ring-white/25'
      }`}
      style={{ margin: -6 }}
    />
  );
}

function TitleContent({
  title,
  transform,
  styles,
}: {
  title: string;
  transform: LedElementTransform;
  styles: ReturnType<typeof mergeLedStyles>;
}) {
  if (!title) {
    return (
      <span style={{ opacity: 0.5, fontStyle: 'italic', fontSize: 48, color: '#fff' }}>
        Session title
      </span>
    );
  }
  return (
    <div
      className="led-editor-no-transition"
      style={{
        fontFamily: styles.sessionFontFamily,
        fontSize: styles.titleFontSize * transform.scale,
        fontWeight: styles.sessionFontWeight,
        fontStyle: styles.sessionFontStyle,
        color: styles.primaryColor,
        lineHeight: 1.15,
        textAlign: transform.align,
        whiteSpace: 'pre-line',
        textShadow: '0 4px 24px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {title}
    </div>
  );
}

function SpeakerContent({
  speaker,
  slot,
  transform,
  styles,
}: {
  speaker: ParsedSpeaker | null;
  slot: number;
  transform: LedElementTransform;
  styles: ReturnType<typeof mergeLedStyles>;
}) {
  const name = speaker?.fullName?.trim() || `Speaker ${slot}`;
  const speakerTitle = speaker?.title?.trim() || '';
  const org = speaker?.org?.trim() || '';
  const detailSize = styles.subtitleFontSize * transform.scale;

  const detailLineStyle: React.CSSProperties = {
    fontFamily: styles.detailFontFamily,
    fontSize: detailSize,
    fontWeight: styles.detailFontWeight,
    fontStyle: styles.detailFontStyle,
    color: styles.accentColor,
    lineHeight: 1.2,
    textShadow: '0 2px 16px rgba(0,0,0,0.5)',
  };

  return (
    <div className="led-editor-no-transition" style={{ textAlign: transform.align, pointerEvents: 'none', userSelect: 'none' }}>
      <div
        style={{
          fontFamily: styles.nameFontFamily,
          fontSize: styles.nameFontSize * transform.scale,
          fontWeight: styles.nameFontWeight,
          fontStyle: styles.nameFontStyle,
          color: styles.primaryColor,
          lineHeight: 1.1,
          textShadow: '0 4px 24px rgba(0,0,0,0.6)',
          opacity: speaker ? 1 : 0.45,
        }}
      >
        {name}
      </div>
      {speakerTitle || org ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {speakerTitle ? <div style={detailLineStyle}>{speakerTitle}</div> : null}
          {org ? <div style={detailLineStyle}>{org}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function PlacedElement({
  elementKey,
  transform,
  interactive,
  selected,
  onSelect,
  onElementPointerDown,
  onElementPointerMove,
  onElementPointerUp,
  children,
}: {
  elementKey: string;
  transform: LedElementTransform;
  interactive?: boolean;
  selected?: boolean;
  onSelect?: (key: string | null) => void;
  onElementPointerDown?: (key: string, clientX: number, clientY: number) => void;
  onElementPointerMove?: (clientX: number, clientY: number) => void;
  onElementPointerUp?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="led-editor-no-transition led-editor-placed"
      style={{
        ...elementPositionStyle(transform, !!interactive),
        zIndex: selected ? 25 : 15,
      }}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(elementKey);
        onElementPointerDown?.(elementKey, e.clientX, e.clientY);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onPointerMove={(e) => {
        if (!interactive || e.buttons === 0) return;
        e.preventDefault();
        onElementPointerMove?.(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (!interactive) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onElementPointerUp?.();
      }}
      onPointerCancel={(e) => {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onElementPointerUp?.();
      }}
    >
      <SelectionOutline selected={!!selected} interactive={!!interactive} />
      {children}
    </div>
  );
}

export const LedFreeformRenderer: React.FC<LedFreeformRenderProps> = ({
  layout,
  title,
  speakersBySlot,
  interactive,
  selectedKey,
  onSelect,
  onElementPointerDown,
  onElementPointerMove,
  onElementPointerUp,
}) => {
  const styles = mergeLedStyles(layout.styles);

  const pointerHandlers = interactive
    ? { onElementPointerDown, onElementPointerMove, onElementPointerUp }
    : {};

  return (
    <div
      className="led-editor-no-transition"
      style={{
        width: UHD_WIDTH,
        height: UHD_HEIGHT,
        position: 'relative',
        backgroundColor: 'transparent',
        overflow: 'visible',
      }}
      onPointerDown={(e) => {
        if (interactive && e.target === e.currentTarget) {
          onSelect?.(null);
        }
      }}
    >
      {layout.sessionTitle.enabled ? (
        <PlacedElement
          elementKey="session-title"
          transform={layout.sessionTitle}
          interactive={interactive}
          selected={selectedKey === 'session-title'}
          onSelect={onSelect}
          {...pointerHandlers}
        >
          <TitleContent title={title} transform={layout.sessionTitle} styles={styles} />
        </PlacedElement>
      ) : null}

      {layout.speakers
        .filter((s) => s.enabled)
        .map((placement: LedSpeakerPlacement) => {
          const key = `speaker-${placement.id}`;
          return (
            <PlacedElement
              key={placement.id}
              elementKey={key}
              transform={placement}
              interactive={interactive}
              selected={selectedKey === key}
              onSelect={onSelect}
              {...pointerHandlers}
            >
              <SpeakerContent
                speaker={speakersBySlot.get(placement.slot) ?? null}
                slot={placement.slot}
                transform={placement}
                styles={styles}
              />
            </PlacedElement>
          );
        })}
    </div>
  );
};

export type { LedSessionTitleConfig };

export default LedFreeformRenderer;
