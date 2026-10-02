import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  isVoiceNoteScriptLine,
  normalizeSpeechToken,
  tokenizeScriptForSpeech,
} from '../lib/teleprompter-voice-alignment';

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

export type TeleprompterVoiceHighlight = {
  enabled: boolean;
  wordIndex: number | null;
  lineIndex: number | null;
  style: 'off' | 'words' | 'band';
  color: string;
};

export type TeleprompterClockFeed = {
  enabled: boolean;
  scriptText: string;
  scrollPosition: number;
  settings: TeleprompterClockSettings;
  guideLinePosition?: number;
  comments?: TeleprompterClockComment[];
  scriptName?: string;
  voiceHighlight?: TeleprompterVoiceHighlight | null;
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

function hexWithAlpha(hex: string, alpha: string): string {
  const raw = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return `${raw}${alpha}`;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}${alpha}`;
  }
  return raw;
}

/**
 * 16:9 teleprompter for Clock / Fullscreen Timer / Director View.
 * Same 1920×1080 design canvas as Viewer; scaled via a sized wrapper so it stays centered
 * (transform-only scale leaves a 1920×1080 layout box that browsers clip off-center).
 */
export const TeleprompterClockOverlay: React.FC<{
  feed: TeleprompterClockFeed;
  className?: string;
  /** When false, leave scroll to the user (Director View free-scroll). Default true. */
  followScroll?: boolean;
}> = ({ feed, className = '', followScroll = true }) => {
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
  const voice = feed.voiceHighlight;
  // Show speaker mark whenever the scroller is broadcasting an active highlight
  const voiceOn = !!(
    voice &&
    voice.style !== 'off' &&
    (voice.enabled ||
      voice.wordIndex != null ||
      voice.lineIndex != null)
  );
  const speechTokens = useMemo(
    () => (voiceOn ? tokenizeScriptForSpeech(feed.scriptText || '') : []),
    [voiceOn, feed.scriptText]
  );

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

  // Apply scroll before paint so Director Follow stays locked to the scroller
  // (voice highlight reflow can shift content — re-apply after that too).
  useLayoutEffect(() => {
    if (!followScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = feed.scrollPosition || 0;
    if (Math.abs(el.scrollTop - target) > 0.5) {
      el.scrollTop = target;
    }
  }, [
    feed.scrollPosition,
    scale,
    feed.scriptText,
    followScroll,
    feed.voiceHighlight?.wordIndex,
    feed.voiceHighlight?.lineIndex,
    feed.voiceHighlight?.enabled,
    settings.fontSize,
    settings.lineHeight,
    settings.showComments,
  ]);

  const commentsForPrevLine = (lineIndex: number) => {
    if (!settings.showComments || lineIndex <= 0) return [];
    return comments.filter((c) => c.lineNumber === lineIndex - 1);
  };

  const renderVoiceLineText = (line: string, lineIndex: number) => {
    if (!line) return '\u00A0';
    if (!voiceOn || !voice) return line;

    const parts = line.split(/(\s+)/);
    let tokenIdx = speechTokens.findIndex((t) => t.lineIndex === lineIndex);
    if (tokenIdx < 0) return line;

    const useUnderline = voice.style === 'words' && voice.wordIndex != null;
    const color = voice.color || '#FBBF24';

    return parts.map((part, i) => {
      if (!part || /^\s+$/.test(part)) {
        return <React.Fragment key={i}>{part}</React.Fragment>;
      }
      if (/^\[[^\]]*\]$/.test(part.trim())) {
        return (
          <span key={i} className="opacity-45 italic">
            {part}
          </span>
        );
      }
      const norm = normalizeSpeechToken(part);
      const expected = tokenIdx >= 0 ? speechTokens[tokenIdx] : null;
      if (!norm || !expected || expected.lineIndex !== lineIndex || expected.word !== norm) {
        return <React.Fragment key={i}>{part}</React.Fragment>;
      }
      const thisWordIdx = tokenIdx;
      tokenIdx += 1;
      const spoken =
        useUnderline && voice.wordIndex != null && thisWordIdx <= voice.wordIndex;
      const current = useUnderline && thisWordIdx === voice.wordIndex;
      return (
        <span
          key={i}
          data-voice-word={thisWordIdx}
          style={
            spoken
              ? {
                  textDecoration: 'underline',
                  textDecorationColor: color,
                  textDecorationThickness: current ? '3px' : '2px',
                  textUnderlineOffset: '6px',
                  color: current ? color : undefined,
                }
              : undefined
          }
        >
          {part}
        </span>
      );
    });
  };

  const stageW = DESIGN_W * scale;
  const stageH = DESIGN_H * scale;

  return (
    <div
      ref={outerRef}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-black ${className}`}
    >
      {/* Layout-sized stage so centering is true; design canvas scales from top-left inside */}
      <div
        className="relative overflow-hidden"
        style={{
          width: stageW,
          height: stageH,
          backgroundColor: settings.backgroundColor || '#000',
        }}
      >
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            backgroundColor: settings.backgroundColor || '#000',
          }}
        >
          {/* Scrollable content — same coordinate space as Teleprompter Viewer */}
          <div
            ref={scrollRef}
            className="teleprompter-clock-scroll h-full w-full overflow-y-auto overflow-x-hidden"
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
                // Match Teleprompter 16:9 preview / viewer (was flex-start — caused vertical drift)
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
                  const isVoiceNoteLine = isVoiceNoteScriptLine(line);
                  const voiceLineActive =
                    voiceOn &&
                    voice?.style === 'band' &&
                    voice.lineIndex === index;
                  const voiceHighlightCss: React.CSSProperties = voiceLineActive
                    ? {
                        backgroundColor: hexWithAlpha(voice?.color || '#FBBF24', '40'),
                        borderRadius: 4,
                        boxShadow: `inset 0 0 0 1px ${hexWithAlpha(voice?.color || '#FBBF24', '88')}`,
                        paddingLeft: '0.5rem',
                        paddingRight: '0.5rem',
                      }
                    : isVoiceNoteLine
                      ? { opacity: 0.45, fontStyle: 'italic' }
                      : {};
                  return (
                    <div
                      key={index}
                      className="mb-2 transition-[background-color,box-shadow] duration-200"
                      style={voiceHighlightCss}
                      data-line-number={index}
                    >
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
                      <div>{renderVoiceLineText(line, index)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Reading guide — same SVG as Viewer (fixed to 1920×1080 frame) */}
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

      <style>{`
        .teleprompter-clock-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
      `}</style>
    </div>
  );
};

export default TeleprompterClockOverlay;
