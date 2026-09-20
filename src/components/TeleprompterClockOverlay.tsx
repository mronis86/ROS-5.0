import React, { useEffect, useRef } from 'react';

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

const COMMENT_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  CUE: { label: 'Cue', color: 'text-yellow-300', bg: 'bg-yellow-700', icon: '🎯' },
  NOTE: { label: 'Note', color: 'text-blue-300', bg: 'bg-blue-700', icon: '📝' },
  AUDIO: { label: 'Audio', color: 'text-green-300', bg: 'bg-green-700', icon: '🔊' },
  VIDEO: { label: 'Video', color: 'text-purple-300', bg: 'bg-purple-700', icon: '🎬' },
  GRAPHICS: { label: 'Graphics', color: 'text-pink-300', bg: 'bg-pink-700', icon: '🖼️' },
  LIGHTING: { label: 'Lighting', color: 'text-orange-300', bg: 'bg-orange-700', icon: '💡' },
  GENERAL: { label: 'Note', color: 'text-slate-300', bg: 'bg-slate-700', icon: '💬' },
};

/**
 * 16:9 teleprompter preview for Clock / Fullscreen Timer.
 * Scroll position tracks the scroller while the feed is live.
 */
export const TeleprompterClockOverlay: React.FC<{
  feed: TeleprompterClockFeed;
  className?: string;
}> = ({ feed, className = '' }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const settings = feed.settings;
  const lines = (feed.scriptText || '').split('\n');
  const comments = feed.comments || [];
  const guidePct = feed.guideLinePosition ?? 50;
  const guideMode = settings.readingGuideMode || 'off';
  const guideColor = settings.readingGuideColor || '#22c55e';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = feed.scrollPosition || 0;
  }, [feed.scrollPosition]);

  const commentsForPrevLine = (lineIndex: number) => {
    if (!settings.showComments || lineIndex <= 0) return [];
    return comments.filter((c) => c.lineNumber === lineIndex - 1).slice(0, 3);
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${className}`}
      style={{ backgroundColor: settings.backgroundColor || '#000' }}
    >
      <div
        ref={scrollRef}
        className="h-full w-full overflow-hidden"
        style={{
          transform: settings.isMirroredHorizontal ? 'scaleX(-1)' : undefined,
        }}
      >
        <div
          style={{
            minHeight: '100%',
            paddingTop: '50%',
            paddingBottom: '50%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: `clamp(1.1rem, 2.6vw, ${Math.round((settings.fontSize || 48) * 0.85)}px)`,
              lineHeight: settings.lineHeight || 1.4,
              textAlign: settings.textAlign || 'center',
              color: settings.textColor || '#fff',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 500,
              width: '92%',
              margin: '0 auto',
            }}
          >
            {lines.map((line, index) => {
              const lineComments = commentsForPrevLine(index);
              return (
                <div key={index} className="mb-2">
                  {lineComments.length > 0 ? (
                    <div className="mb-2 space-y-1">
                      {lineComments.map((c) => {
                        const meta = COMMENT_META[c.type] || COMMENT_META.GENERAL;
                        return (
                          <div
                            key={c.id}
                            className={`${meta.bg} rounded-md border-l-4 px-3 py-2`}
                          >
                            <div className={`text-xs font-bold ${meta.color}`}>
                              {meta.icon} {meta.label}
                            </div>
                            <div className="text-sm font-semibold text-white">{c.text}</div>
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

      {guideMode !== 'off' ? (
        <div
          className="pointer-events-none absolute left-0 right-0 z-10 flex items-center justify-between px-3"
          style={{ top: `${guidePct}%`, transform: 'translateY(-50%)' }}
        >
          <span style={{ color: guideColor, fontSize: '1.5rem' }}>▶</span>
          {guideMode === 'arrows-with-lines' ? (
            <div
              className="mx-2 h-px flex-1 opacity-70"
              style={{ backgroundColor: guideColor }}
            />
          ) : (
            <div className="flex-1" />
          )}
          <span style={{ color: guideColor, fontSize: '1.5rem' }}>◀</span>
        </div>
      ) : null}

      {feed.scriptName ? (
        <div className="absolute left-3 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white/80">
          {feed.scriptName}
        </div>
      ) : null}
    </div>
  );
};

export default TeleprompterClockOverlay;
