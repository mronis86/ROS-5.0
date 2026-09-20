import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type TeleprompterClockComment = {
  id: string;
  lineNumber: number;
  text: string;
  type: string;
};

export type TeleprompterClockSettings = {
  fontSize: number;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  backgroundColor: string;
  isMirroredHorizontal?: boolean;
  showComments?: boolean;
  readingGuideMode?: 'off' | 'arrows' | 'arrows-with-lines';
  readingGuideColor?: string;
};

export type TeleprompterClockFeed = {
  enabled: boolean;
  scriptText: string;
  scrollPosition: number;
  settings: TeleprompterClockSettings;
  guideLinePosition?: number;
  comments?: TeleprompterClockComment[];
  scriptName?: string;
};

/** Match TeleprompterPage COMMENT_TYPES styling */
const COMMENT_META: Record<string, { label: string; color: string; bgColor: string; icon: string }> = {
  CUE: { label: 'Cue', color: 'text-yellow-300', bgColor: 'bg-yellow-700', icon: '🎯' },
  NOTE: { label: 'Note', color: 'text-blue-300', bgColor: 'bg-blue-700', icon: '📝' },
  GENERAL: { label: 'General', color: 'text-blue-300', bgColor: 'bg-blue-700', icon: '💬' },
  AUDIO: { label: 'Audio', color: 'text-green-300', bgColor: 'bg-green-700', icon: '🔊' },
  GFX: { label: 'GFX', color: 'text-pink-300', bgColor: 'bg-pink-700', icon: '🖼️' },
  GRAPHICS: { label: 'Graphics', color: 'text-pink-300', bgColor: 'bg-pink-700', icon: '🖼️' },
  VIDEO: { label: 'Video', color: 'text-purple-300', bgColor: 'bg-purple-700', icon: '🎬' },
  LIGHTING: { label: 'Lighting', color: 'text-orange-300', bgColor: 'bg-orange-700', icon: '💡' },
};

const DESIGN_W = 1920;
const DESIGN_H = 1080;

/**
 * 16:9 teleprompter for Clock / Fullscreen Timer.
 * Same 1920×1080 design canvas, font scale, padding, and SVG guide as Viewer.
 */
export const TeleprompterClockOverlay: React.FC<{
  feed: TeleprompterClockFeed;
  className?: string;
}> = ({ feed, className = '' }) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const settings = feed.settings;
  const lines = (feed.scriptText || '').split('\n');
  const comments = feed.comments || [];
  const guidePct = feed.guideLinePosition ?? 50;
  const guideMode = settings.readingGuideMode || 'off';
  const guideColor = settings.readingGuideColor || '#FF0000';
  const fontSize = settings.fontSize || 48;
  const lineHeight = settings.lineHeight || 1.4;
  const mirrored = !!settings.isMirroredHorizontal;

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w <= 0 || h <= 0) return;
      setScale(Math.min(w / DESIGN_W, h / DESIGN_H));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = feed.scrollPosition || 0;
  }, [feed.scrollPosition, scale, feed.scriptText]);

  const commentsForPrevLine = (lineIndex: number) => {
    if (!settings.showComments || lineIndex <= 0) return [];
    return comments.filter((c) => c.lineNumber === lineIndex - 1);
  };

  return (
    <div
      ref={outerRef}
      className={`relative grid h-full w-full place-items-center overflow-hidden bg-black ${className}`}
    >
      <div
        className="relative shrink-0 overflow-hidden"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          backgroundColor: settings.backgroundColor || '#000',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Scrollable content — same coordinate space as Teleprompter Viewer */}
        <div
          ref={scrollRef}
          className="h-full w-full overflow-auto"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            transform: mirrored ? 'scaleX(-1)' : undefined,
          }}
        >
          <div
            style={{
              minHeight: '100%',
              paddingTop: 540,
              paddingBottom: 540,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                fontSize: `${fontSize * 1.35}px`,
                lineHeight,
                textAlign: settings.textAlign || 'center',
                color: settings.textColor || '#FFFFFF',
                fontFamily: 'Arial, sans-serif',
                fontWeight: 500,
                width: '95%',
                margin: '0 auto',
              }}
            >
              {lines.map((line, index) => {
                const lineComments = commentsForPrevLine(index);
                return (
                  <div key={index} className="mb-2" data-line-number={index}>
                    {lineComments.length > 0 ? (
                      <div className="mb-2 space-y-2">
                        {lineComments.map((c) => {
                          const meta = COMMENT_META[c.type] || COMMENT_META.GENERAL;
                          return (
                            <div
                              key={c.id}
                              className={`${meta.bgColor} rounded-lg border-l-4 px-4 py-3`}
                              style={{
                                fontSize: `${fontSize * 0.6}px`,
                                transform: mirrored ? 'scaleX(-1)' : undefined,
                              }}
                            >
                              <div className="flex items-start gap-2">
                                <span className="text-3xl">{meta.icon}</span>
                                <div className="min-w-0 flex-1">
                                  <div className={`text-base font-bold ${meta.color}`}>
                                    {meta.label}
                                  </div>
                                  <div className="mt-1 text-white">{c.text}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    <div>{line || '\u00A0'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Reading guide — same SVG arrows/lines as Viewer (fixed to 1920×1080 frame) */}
        {guideMode !== 'off' ? (
          <div
            className="pointer-events-none absolute left-0 right-0 z-50"
            style={{
              top: `${guidePct}%`,
              transform: 'translateY(-50%)',
              width: '100%',
              height: 60,
            }}
          >
            {guideMode === 'arrows-with-lines' ? (
              <svg width="100%" height="60" style={{ position: 'absolute', top: 0, left: 0 }}>
                <line
                  x1="0"
                  y1="0"
                  x2="100%"
                  y2="0"
                  stroke={guideColor}
                  strokeWidth="3"
                  opacity="0.7"
                />
                <line
                  x1="0"
                  y1="60"
                  x2="100%"
                  y2="60"
                  stroke={guideColor}
                  strokeWidth="3"
                  opacity="0.7"
                />
              </svg>
            ) : null}

            <div className="absolute left-0 top-1/2 -translate-y-1/2">
              <svg width="60" height="60" viewBox="0 0 60 60">
                <polygon
                  points="15,10 45,30 15,50"
                  fill={guideColor}
                  stroke={guideColor}
                  strokeWidth="4"
                  opacity="0.75"
                />
              </svg>
            </div>

            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              <svg width="60" height="60" viewBox="0 0 60 60">
                <polygon
                  points="45,10 15,30 45,50"
                  fill={guideColor}
                  stroke={guideColor}
                  strokeWidth="4"
                  opacity="0.75"
                />
              </svg>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TeleprompterClockOverlay;
